import { z } from "zod";

function tuple<const T extends readonly string[]>(value: T): T {
  return value;
}

/**
 * Verifiabl's compact PII wire format is a pipe-delimited plaintext string.
 * It is encrypted before being embedded in the barcode and is never sent to
 * the Verifiabl API in plaintext.
 *
 * Layout (9 segments, "P2" prefix + 8 fields, in this exact order):
 *
 *   P2|employeeName|position|department|employerAbn|bsb|accountNumber|accountName|address
 *
 * Example:
 *
 *   P2|Jane A. Doe|Senior Developer|Engineering|12345678901|062-000|12345678|Jane A Doe|12 Example St, Sydney NSW 2000
 *
 * Omitted fields are encoded as empty segments and skipped by Verifiabl.
 *
 * P2 is what this SDK emits. P1 is the same layout without the trailing
 * `address` field; `parsePii` still reads it, because documents issued before
 * P2 carry it and cannot be reissued.
 */

/** P1's field order is the wire contract for documents already issued. Never reorder. */
const P1_FIELD_ORDER = tuple([
  "employeeName",
  "position",
  "department",
  "employerAbn",
  "bsb",
  "accountNumber",
  "accountName",
]);

/** Field order is the wire contract. Never reorder; append only, as a new version. */
export const PII_FIELD_ORDER = tuple([...P1_FIELD_ORDER, "address"]);

export type PiiFieldName = (typeof PII_FIELD_ORDER)[number];

/**
 * Round per-field sanity cap in UTF-16 code units, not bytes. It is not derived
 * from QR capacity and does not bound it: 8 fields at this cap (~2050 chars)
 * far exceeds the ~1100-char plaintext ceiling above which createBarcodeSvg
 * cannot render at all (and ~455, above which it degrades). Total plaintext is
 * the real budget, so recheck it before adding fields.
 */
export const PII_FIELD_MAX_LENGTH = 256;

/**
 * Allow-list for a single PII field value: any printable character except
 * the pipe delimiter and control characters. Pipes would corrupt the
 * positional layout; control characters have no place in PII fields.
 */
function isPrintableWithoutPipe(value: string): boolean {
  if (value.includes("|")) return false;
  return !/\p{Cc}/u.test(value);
}

const piiFieldSchema = z
  .string()
  .max(PII_FIELD_MAX_LENGTH, `PII field exceeds ${PII_FIELD_MAX_LENGTH} characters`)
  .refine(isPrintableWithoutPipe, "PII field must not contain '|' or control characters");

export const piiFieldsSchema = z
  .object({
    employeeName: piiFieldSchema.optional(),
    position: piiFieldSchema.optional(),
    department: piiFieldSchema.optional(),
    employerAbn: piiFieldSchema.optional(),
    bsb: piiFieldSchema.optional(),
    accountNumber: piiFieldSchema.optional(),
    accountName: piiFieldSchema.optional(),
    address: piiFieldSchema.optional(),
  })
  .strict();

export type PiiFields = z.infer<typeof piiFieldsSchema>;

/** Why a PII field value cannot be encoded in the PII wire format. */
export type PiiFieldViolationReason = "pipe" | "control-character" | "too-long";

/** A single field `formatPii` refused to encode, and why. */
export interface PiiFieldViolation {
  field: PiiFieldName;
  reason: PiiFieldViolationReason;
}

const VIOLATION_DESCRIPTIONS: Record<PiiFieldViolationReason, string> = {
  pipe: "must not contain '|'",
  "control-character": "must not contain control characters",
  "too-long": `exceeds ${PII_FIELD_MAX_LENGTH} characters`,
};

/**
 * Thrown by {@link formatPii} when a field value cannot be encoded in the PII
 * wire format. The pipe is the field delimiter and the format has no escape
 * mechanism, so an offending value must be corrected at the source (strip the
 * character) rather than escaped. `violations` names each field and reason so
 * callers can guide the user without echoing the value, which is PII.
 */
export class PiiValidationError extends Error {
  readonly violations: readonly PiiFieldViolation[];

  constructor(violations: readonly PiiFieldViolation[]) {
    const detail = violations
      .map((v) => `${v.field} ${VIOLATION_DESCRIPTIONS[v.reason]}`)
      .join("; ");
    super(`Invalid PII field${violations.length === 1 ? "" : "s"}: ${detail}`);
    this.name = "PiiValidationError";
    this.violations = violations;
    Object.setPrototypeOf(this, PiiValidationError.prototype);
  }
}

/**
 * Inspect each supplied field for content the wire format cannot carry, in
 * field order. Non-object inputs and non-string values are left for
 * {@link piiFieldsSchema} to reject with its own (structural) ZodError, so
 * `formatPii`'s documented error contract holds for nullish callers too.
 */
function findPiiViolations(fields: PiiFields): PiiFieldViolation[] {
  const violations: PiiFieldViolation[] = [];
  if (typeof fields !== "object" || fields === null) {
    return violations;
  }
  for (const field of PII_FIELD_ORDER) {
    const value = fields[field];
    if (typeof value !== "string") continue;
    if (value.length > PII_FIELD_MAX_LENGTH) {
      violations.push({ field, reason: "too-long" });
    } else if (value.includes("|")) {
      violations.push({ field, reason: "pipe" });
    } else if (/\p{Cc}/u.test(value)) {
      violations.push({ field, reason: "control-character" });
    }
  }
  return violations;
}

/**
 * Format employee PII into Verifiabl's compact plaintext wire format.
 *
 * The result is what you encrypt with `encryptPii` before embedding it in
 * a barcode. Throws {@link PiiValidationError} if any field contains a pipe
 * or control character or exceeds the length limit. Each such value must be
 * corrected at the source, as the format has no escape mechanism. Throws
 * `ZodError` for structural problems (unknown field, non-string value).
 */
export function formatPii(fields: PiiFields): string {
  const violations = findPiiViolations(fields);
  if (violations.length > 0) {
    throw new PiiValidationError(violations);
  }
  const validated = piiFieldsSchema.parse(fields);
  const segments = PII_FIELD_ORDER.map((name) => validated[name] ?? "");
  return `P2|${segments.join("|")}`;
}

const PII_LAYOUTS: ReadonlyArray<{ version: string; order: readonly PiiFieldName[] }> = [
  { version: "P1", order: P1_FIELD_ORDER },
  { version: "P2", order: PII_FIELD_ORDER },
];

/**
 * Parse Verifiabl's compact PII wire format, P2 or P1, back into named fields.
 * Empty segments are omitted from the result, mirroring Verifiabl's scan-time
 * behaviour.
 *
 * Useful for round-trip testing your integration; not needed in the
 * normal issuance flow.
 */
export function parsePii(plaintext: string): PiiFields {
  for (const { version, order } of PII_LAYOUTS) {
    const prefix = `${version}|`;
    if (!plaintext.startsWith(prefix)) {
      continue;
    }

    const values = plaintext.slice(prefix.length).split("|");
    if (values.length !== order.length) {
      throw new Error(`Expected ${order.length} ${version} fields but got ${values.length}`);
    }

    const result: PiiFields = {};
    for (let i = 0; i < order.length; i++) {
      const value = values[i];
      const name = order[i];
      if (name !== undefined && value !== undefined && value !== "") {
        result[name] = value;
      }
    }
    return piiFieldsSchema.parse(result);
  }

  throw new Error("Invalid PII format: expected 'P1|' or 'P2|' prefix");
}
