import { z } from "zod";
import { encryptPii } from "./crypto.js";
import {
  type BarcodeParts,
  generateVerifiablReference,
  verifiablReferenceSchema,
} from "./payload.js";
import {
  AUSTRALIAN_PAYSLIP_V2_SCHEMA,
  type AustralianPayslipV2,
  australianPayslipV2Schema,
  NEW_ZEALAND_PAYSLIP_V2_SCHEMA,
  type NewZealandPayslipV2,
  newZealandPayslipV2Schema,
} from "./payslipV2.js";
import {
  type AustralianPiiFields,
  australianPiiFieldsSchema,
  formatAustralianPii,
  formatNewZealandPii,
  type NewZealandPiiFields,
  newZealandPiiFieldsSchema,
} from "./pii.js";
import {
  type RegisterAndBuildBarcodeRequest,
  type RegisterNonPiiRequest,
  registerNonPiiRequestSchema,
} from "./types.js";

export interface PreparedV2Payslip {
  /** Persist this reference with the registration for cross-process self-managed retries. */
  readonly verifiablReference: string;
  readonly registration: RegisterNonPiiRequest;
  /** API-managed issuance has no caller reference and cannot safely retry ambiguous failures. */
  readonly apiManagedRegistration: RegisterAndBuildBarcodeRequest;
  /** Use the reference returned by registration (or the batch result). */
  barcodeParts(reference: string): BarcodeParts;
}

export interface AustralianV2IssuanceInput {
  pii: AustralianPiiFields;
  payslipNonPii: AustralianPayslipV2;
  issuedAt: string;
  key: Buffer;
  verifiablReference?: string;
}

export interface NewZealandV2IssuanceInput {
  pii: NewZealandPiiFields;
  payslipNonPii: NewZealandPayslipV2;
  issuedAt: string;
  key: Buffer;
  verifiablReference?: string;
}

// Do not accept a schema or preformatted/encrypted PII from the caller.
export function prepareAustralianV2Payslip(input: AustralianV2IssuanceInput): PreparedV2Payslip {
  return prepare(
    input,
    AUSTRALIAN_PAYSLIP_V2_SCHEMA,
    australianPayslipV2Schema,
    australianPiiFieldsSchema,
    formatAustralianPii,
  );
}

export function prepareNewZealandV2Payslip(input: NewZealandV2IssuanceInput): PreparedV2Payslip {
  return prepare(
    input,
    NEW_ZEALAND_PAYSLIP_V2_SCHEMA,
    newZealandPayslipV2Schema,
    newZealandPiiFieldsSchema,
    formatNewZealandPii,
  );
}

function parseSafe<T>(schema: z.ZodType<T>, value: unknown, field: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    // Zod's default error text may quote input values; never surface PII values.
    throw new TypeError(
      result.error.issues
        .map((issue) => `${field}${issue.path.length ? `.${issue.path.join(".")}` : ""}: invalid`)
        .join("; "),
    );
  }
  return result.data;
}

function prepare<P, N>(
  input: { pii: P; payslipNonPii: N; issuedAt: string; key: Buffer; verifiablReference?: string },
  schema: typeof AUSTRALIAN_PAYSLIP_V2_SCHEMA | typeof NEW_ZEALAND_PAYSLIP_V2_SCHEMA,
  nonPiiSchema: z.ZodType<N>,
  piiSchema: z.ZodType<P>,
  formatter: (pii: P) => string,
): PreparedV2Payslip {
  const allowed = new Set(["pii", "payslipNonPii", "issuedAt", "key", "verifiablReference"]);
  for (const field of Object.keys(input)) {
    if (!allowed.has(field)) throw new TypeError("Unexpected issuance input field");
  }
  const payslipNonPii = parseSafe(nonPiiSchema, input.payslipNonPii, "payslipNonPii");
  const pii = parseSafe(piiSchema, input.pii, "pii");
  parseSafe(z.iso.datetime(), input.issuedAt, "issuedAt");
  const reference = parseSafe(
    verifiablReferenceSchema,
    input.verifiablReference ?? generateVerifiablReference(),
    "verifiablReference",
  );
  const encrypted = encryptPii(formatter(pii), input.key);
  const registration = registerNonPiiRequestSchema.parse({
    schema,
    issuedAt: input.issuedAt,
    payslipNonPii,
    encryptionMetadata: encrypted.encryptionMetadata,
    verifiablReference: reference,
  }) as RegisterNonPiiRequest;
  // Zod snapshots the non-PII tree, but Uint8Arrays remain mutable. Never expose
  // the stored request or encryption buffers through the public accessors.
  const copyFields = () => ({
    schema,
    issuedAt: registration.issuedAt,
    payslipNonPii: structuredClone(registration.payslipNonPii),
    encryptionMetadata: {
      iv: new Uint8Array(registration.encryptionMetadata.iv),
      tag: new Uint8Array(registration.encryptionMetadata.tag),
    },
  });
  return {
    verifiablReference: reference,
    get registration() {
      return { ...copyFields(), verifiablReference: reference } as RegisterNonPiiRequest;
    },
    get apiManagedRegistration() {
      return {
        ...copyFields(),
        encryptedPii: new Uint8Array(encrypted.encryptedPii),
      } as RegisterAndBuildBarcodeRequest;
    },
    barcodeParts: (resultReference: string) => ({
      verifiablReference: parseSafe(
        verifiablReferenceSchema,
        resultReference,
        "verifiablReference",
      ),
      encryptedPii: new Uint8Array(encrypted.encryptedPii),
    }),
  };
}
