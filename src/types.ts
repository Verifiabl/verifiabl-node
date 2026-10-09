import { z } from "zod";
import { ciphertextSchema, verifiablReferenceSchema } from "./payload.js";
import {
  AUSTRALIAN_PAYSLIP_V2_SCHEMA,
  australianPayslipV2Schema,
  australianPayslipV2ToWire,
  NEW_ZEALAND_PAYSLIP_V2_SCHEMA,
  newZealandPayslipV2Schema,
  newZealandPayslipV2ToWire,
} from "./payslipV2.js";

function tuple<const T extends readonly string[]>(value: T): T {
  return value;
}

export const SCHEMA_RE = /^[a-z]{2}\.[a-z]+\.v\d+$/;

export const payslipSchemaIdSchema = z.string().regex(SCHEMA_RE, {
  error: "schema must be in format 'xx.type.vN' (e.g. 'au.payslip.v2')",
});

/**
 * Request and response types for the Verifiabl API.
 *
 * The SDK surface is camelCase throughout. The HTTP API speaks snake_case
 * (`issued_at`, `payslip_non_pii`, `verifiabl_reference`, ...); the SDK translates
 * to and from that wire format at the network boundary (see the `*ToWire`
 * and `*FromWire` helpers below), so you never handle snake_case yourself.
 *
 * Request schemas are strict: they reject unknown fields so integration
 * mistakes fail fast and locally. Response schemas are deliberately
 * tolerant: they validate the fields this SDK version knows about and
 * ignore any the API adds later, so an additive API change never breaks
 * a deployed integration.
 */

/** Decryption metadata stored server-side at registration time. */
export const encryptionMetadataSchema = z
  .object({
    /** 96-bit (12-byte) IV. */
    iv: z.instanceof(Uint8Array).refine((value) => value.length === 12, "IV must be 12 bytes"),
    /** 128-bit (16-byte) GCM authentication tag. */
    tag: z
      .instanceof(Uint8Array)
      .refine((value) => value.length === 16, "Authentication tag must be 16 bytes"),
  })
  .strict();

export type EncryptionMetadata = z.infer<typeof encryptionMetadataSchema>;

const registrationFields = {
  issuedAt: z.iso.datetime({
    error: "issuedAt must be an ISO 8601 UTC datetime ending in 'Z' (use new Date().toISOString())",
  }),
  encryptionMetadata: encryptionMetadataSchema,
};

const australianV2RegistrationSchema = z
  .object({
    /**
     * Payslip schema identifier. A literal, exactly as the API pins it on the
     * single-registration endpoints: `payslipNonPii` below IS the au.payslip.v2
     * shape, so accepting another identifier here would impose AU rules on a
     * payload that does not claim to be AU. The public registration schema is
     * a discriminated union keyed on `schema`, with one member per version.
     */
    schema: z.literal(AUSTRALIAN_PAYSLIP_V2_SCHEMA),
    /**
     * ISO 8601 UTC datetime the payslip was issued. The API only accepts
     * UTC ("Z") timestamps; convert local times first, e.g. with
     * `new Date().toISOString()`.
     */
    issuedAt: registrationFields.issuedAt,
    payslipNonPii: australianPayslipV2Schema,
    encryptionMetadata: registrationFields.encryptionMetadata,
  })
  .strict();

const newZealandV2RegistrationSchema = z
  .object({
    schema: z.literal(NEW_ZEALAND_PAYSLIP_V2_SCHEMA),
    issuedAt: registrationFields.issuedAt,
    payslipNonPii: newZealandPayslipV2Schema,
    encryptionMetadata: registrationFields.encryptionMetadata,
  })
  .strict();

const basePayslipRegistrationSchema = z.discriminatedUnion("schema", [
  australianV2RegistrationSchema,
  newZealandV2RegistrationSchema,
]);

/**
 * Request for `client.registerNonPii`. Calls POST /v1/registerNonPII.
 * The encrypted PII stays with you and goes into a locally generated
 * barcode; only non-PII data and decryption metadata are sent.
 */
export const registerNonPiiRequestSchema = z.discriminatedUnion("schema", [
  australianV2RegistrationSchema.extend({
    /**
     * Optional provider-generated reference (from `generateVerifiablReference`).
     * When omitted, the SDK generates one for this call. The reference makes
     * automatic retries idempotent: an identical replay succeeds without
     * creating another record, while reuse with different data returns a
     * conflict. Supply and persist one when retries must survive a process
     * restart or occur in a separate call.
     */
    verifiablReference: verifiablReferenceSchema.optional(),
  }),
  newZealandV2RegistrationSchema.extend({
    verifiablReference: verifiablReferenceSchema.optional(),
  }),
]);

export type RegisterNonPiiRequest = z.input<typeof registerNonPiiRequestSchema>;

export const registerNonPiiResponseSchema = z.object({
  /** 22-char base64url Verifiabl reference to embed in the barcode. */
  verifiablReference: verifiablReferenceSchema,
});

export type RegisterNonPiiResponse = z.infer<typeof registerNonPiiResponseSchema>;

/**
 * Request for `client.registerAndBuildBarcode`. Calls POST
 * /v1/registerAndBuildBarcode. This API-managed flow also sends the
 * ciphertext, and the server returns a ready-made barcode image.
 */
export const registerAndBuildBarcodeRequestSchema = z.discriminatedUnion("schema", [
  australianV2RegistrationSchema.extend({
    /** AES-256-GCM ciphertext bytes for the formatted PII plaintext. */
    encryptedPii: ciphertextSchema,
  }),
  newZealandV2RegistrationSchema.extend({ encryptedPii: ciphertextSchema }),
]);

export type RegisterAndBuildBarcodeRequest = z.input<typeof registerAndBuildBarcodeRequestSchema>;

export const barcodeImageSchema = z.object({
  format: z.literal("png"),
  /** Base64-encoded PNG. */
  data: z.string().min(1),
});

export type BarcodeImage = z.infer<typeof barcodeImageSchema>;

export const registerAndBuildBarcodeResponseSchema = z.object({
  /** 22-char base64url Verifiabl reference embedded in the returned barcode. */
  verifiablReference: verifiablReferenceSchema,
  barcode: barcodeImageSchema,
});

export type RegisterAndBuildBarcodeResponse = z.infer<typeof registerAndBuildBarcodeResponseSchema>;

/* ------------------------------------------------------------------ *
 * Wire translation                                                    *
 *                                                                     *
 * The HTTP API uses snake_case. These helpers convert the camelCase   *
 * SDK types to and from that wire shape at the network boundary, so   *
 * the public surface never exposes snake_case. Only SDK-defined keys  *
 * are renamed; provider-specific payslip fields pass through verbatim. *
 * ------------------------------------------------------------------ */

function encryptionMetadataToWire(metadata: EncryptionMetadata): Record<string, unknown> {
  return {
    iv: Buffer.from(metadata.iv).toString("base64url"),
    tag: Buffer.from(metadata.tag).toString("base64url"),
  };
}

/** Include a key only when the value was supplied, so optionals stay absent rather than null. */
function when<T>(value: T | undefined, key: string): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

type NormalizedRegistration = z.output<typeof basePayslipRegistrationSchema>;

function registrationFieldsToWire(request: NormalizedRegistration): Record<string, unknown> {
  const payslipNonPii = (() => {
    switch (request.schema) {
      case AUSTRALIAN_PAYSLIP_V2_SCHEMA:
        return australianPayslipV2ToWire(request.payslipNonPii);
      case NEW_ZEALAND_PAYSLIP_V2_SCHEMA:
        return newZealandPayslipV2ToWire(request.payslipNonPii);
    }
  })();
  return {
    schema: request.schema,
    issued_at: request.issuedAt,
    payslip_non_pii: payslipNonPii,
    encryption_metadata: encryptionMetadataToWire(request.encryptionMetadata),
  };
}

/** Validate and map a registration request to the snake_case wire body. */
export function registrationToWire(request: RegisterNonPiiRequest): Record<string, unknown> {
  const validated = registerNonPiiRequestSchema.parse(request);
  return {
    ...when(validated.verifiablReference, "verifiabl_reference"),
    ...registrationFieldsToWire(validated),
  };
}

/** Map a validated register-and-build-barcode request to the snake_case wire body. */
export function registerAndBuildBarcodeToWire(
  request: RegisterAndBuildBarcodeRequest,
): Record<string, unknown> {
  const validated = registerAndBuildBarcodeRequestSchema.parse(request);
  return {
    ...registrationFieldsToWire(validated),
    encrypted_pii: Buffer.from(validated.encryptedPii).toString("base64url"),
  };
}

const registerNonPiiWireResponseSchema = z.object({
  verifiabl_reference: verifiablReferenceSchema,
});

/** Parse and map a registration response from the snake_case wire shape. */
export function registrationFromWire(value: unknown): RegisterNonPiiResponse {
  const wire = registerNonPiiWireResponseSchema.parse(value);
  return { verifiablReference: wire.verifiabl_reference };
}

const barcodeImageWireSchema = z.object({
  format: z.literal("png"),
  data: z.string().min(1),
});

const registerAndBuildBarcodeApiWireResponseSchema = z.object({
  verifiabl_reference: verifiablReferenceSchema,
  barcode: barcodeImageWireSchema,
});

/** Parse and map a register-and-build-barcode response from the snake_case wire shape. */
export function registerAndBuildBarcodeFromWire(value: unknown): RegisterAndBuildBarcodeResponse {
  const wire = registerAndBuildBarcodeApiWireResponseSchema.parse(value);
  return {
    verifiablReference: wire.verifiabl_reference,
    barcode: {
      format: wire.barcode.format,
      data: wire.barcode.data,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Batch registration                                                  *
 *                                                                     *
 * `registerNonPiiBatch` lets a pay run be submitted in one request.    *
 * The provider generates each record's reference up-front with         *
 * `generateVerifiablReference` and includes it in the record.          *
 * ------------------------------------------------------------------ */

/** Maximum records per batch request. Matches the API's MAX_BATCH_RECORDS. */
export const MAX_BATCH_RECORDS = 1000;

/** Longest accepted externalId. Matches the API's limit. */
const MAX_EXTERNAL_ID_LENGTH = 255;

/**
 * Optional caller-supplied correlation id for a batch record. The API echoes it
 * back verbatim in the matching result and never stores it, so you can line up
 * results (and error logs) with your own payslip records by your own id rather
 * than by array position. Printable ASCII, so it is safe to place in logs.
 */
const externalIdSchema = z
  .string()
  .min(1)
  .max(MAX_EXTERNAL_ID_LENGTH)
  .regex(/^[\x20-\x7e]+$/);

export const batchRecordRequestSchema = z.discriminatedUnion("schema", [
  australianV2RegistrationSchema.extend({
    verifiablReference: verifiablReferenceSchema,
    externalId: externalIdSchema.optional(),
  }),
  newZealandV2RegistrationSchema.extend({
    verifiablReference: verifiablReferenceSchema,
    externalId: externalIdSchema.optional(),
  }),
]);

export type BatchRecordRequest = z.input<typeof batchRecordRequestSchema>;

export const registerNonPiiBatchRequestSchema = z
  .object({
    records: z
      .array(batchRecordRequestSchema)
      .min(1, "records must contain at least one record")
      .max(MAX_BATCH_RECORDS, `records must contain at most ${MAX_BATCH_RECORDS} records`),
  })
  .strict();

/**
 * Batch record with the payslip body left unvalidated, mirroring the API's own
 * batch envelope exactly: reference, schema id, timestamp and encryption
 * metadata are envelope-level and a bad one fails the request, while
 * `payslipNonPii` is checked per record so one non-conforming payslip becomes
 * that record's error result rather than costing the caller the whole pay run.
 */
const batchRecordEnvelopeSchema = z
  .object({
    verifiablReference: verifiablReferenceSchema,
    externalId: externalIdSchema.optional(),
    payslipNonPii: z.unknown(),
    // Format-checked here, version-checked per record, as the API does: an
    // unsupported version is one record's error, not the whole batch's.
    schema: payslipSchemaIdSchema,
    issuedAt: registrationFields.issuedAt,
    encryptionMetadata: registrationFields.encryptionMetadata,
  })
  .strict();

/** Every payslip schema this SDK can validate and map. */
export const SUPPORTED_PAYSLIP_SCHEMAS = tuple([
  AUSTRALIAN_PAYSLIP_V2_SCHEMA,
  NEW_ZEALAND_PAYSLIP_V2_SCHEMA,
]);

export const registerNonPiiBatchEnvelopeSchema = z
  .object({
    records: z
      .array(batchRecordEnvelopeSchema)
      .min(1, "records must contain at least one record")
      .max(MAX_BATCH_RECORDS, `records must contain at most ${MAX_BATCH_RECORDS} records`),
  })
  .strict();

/** Batch input accepts future schema ids and invalid payslips for per-record error reporting. */
export type RegisterNonPiiBatchRequest = z.input<typeof registerNonPiiBatchEnvelopeSchema>;

/** Opt-in typed batch input for the payslip schemas currently known to this SDK. */
export type KnownSchemaRegisterNonPiiBatchRequest = z.input<
  typeof registerNonPiiBatchRequestSchema
>;

export type BatchRecordEnvelope = z.infer<typeof batchRecordEnvelopeSchema>;

/**
 * The error result for a record whose payslip the SDK rejected, in the same
 * shape the API returns for a record it rejects, so callers handle one type.
 * The detail carries the zod issue paths and messages, which name the field and
 * the expected shape but never the supplied value, so it is safe to log.
 */
export function localBatchValidationError(
  record: BatchRecordEnvelope,
  error: z.ZodError,
): BatchRecordResult {
  return {
    status: "error",
    code: "VALIDATION_FAILED",
    detail: error.issues
      .slice(0, 5)
      .map((issue) => {
        const path = issue.path.join(".");
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join("; "),
    verifiablReference: record.verifiablReference,
    ...(record.externalId !== undefined ? { externalId: record.externalId } : {}),
  };
}

/**
 * Per-record outcome statuses the API returns today: "created" for a newly
 * registered record, "duplicate" for an idempotent resend of identical
 * content, "error" for a per-record failure. Like the error codes, the API
 * may add statuses over time, so an unknown status flows through rather than
 * failing the whole response.
 */
export const KNOWN_BATCH_RECORD_STATUSES = tuple(["created", "duplicate", "error"]);

export type KnownBatchRecordStatus = (typeof KNOWN_BATCH_RECORD_STATUSES)[number];

/**
 * Per-record status. Typed as the known statuses plus `string` so a future
 * API status flows through to your handling untouched while autocomplete
 * still offers the known values.
 */
export type BatchRecordStatus = KnownBatchRecordStatus | (string & {});

/**
 * Per-record outcome, in the same order as the input `records` (so `results[i]`
 * is the outcome of `records[i]`). `code` and `detail` accompany an "error"
 * status. One bad record never fails the whole batch. Correlate by position, by
 * the record's `externalId` (echoed when supplied), or by `verifiablReference`.
 */
export interface BatchRecordResult {
  status: BatchRecordStatus;
  verifiablReference: string;
  /** Echoed back when the record supplied one. */
  externalId?: string;
  code?: VerifiablErrorCode;
  detail?: string;
}

/** Error code the API returns for a record whose iv is already registered. */
export const IV_REUSED_CODE = "IV_REUSED";

/**
 * True when the API rejected this batch record because its
 * `encryptionMetadata.iv` is already registered to your issuer, either against
 * a stored record or against another record in the same batch.
 *
 * Encrypt the payslip again with `encryptPii` to get a new iv, then resend the
 * record with the new `encryptionMetadata`. Rebuild any barcode that you
 * rendered from the previous ciphertext. Resending the record unchanged gives
 * the same result.
 */
export function isIvReuseResult(result: BatchRecordResult): boolean {
  return result.status === "error" && result.code === IV_REUSED_CODE;
}

export interface RegisterNonPiiBatchResponse {
  results: BatchRecordResult[];
}

/** Map a validated batch request to the snake_case wire body. */
export function registerNonPiiBatchToWire(
  request: RegisterNonPiiBatchRequest,
): Record<string, unknown> {
  const validated = registerNonPiiBatchRequestSchema.parse(request);
  return {
    records: validated.records.map((record) => ({
      verifiabl_reference: record.verifiablReference,
      ...(record.externalId !== undefined && { external_id: record.externalId }),
      ...registrationFieldsToWire(record),
    })),
  };
}

const batchRecordResultWireSchema = z.object({
  // Tolerant on purpose: an unknown status must pass through, not throw and
  // discard the whole batch response. Known values are listed in
  // KNOWN_BATCH_RECORD_STATUSES for callers to branch on.
  status: z.string(),
  verifiabl_reference: verifiablReferenceSchema,
  external_id: z.string().optional(),
  code: z.string().optional(),
  detail: z.string().optional(),
});

const registerNonPiiBatchWireResponseSchema = z.object({
  results: z.array(batchRecordResultWireSchema),
});

/** Parse and map a batch response from the snake_case wire shape. */
export function registerNonPiiBatchFromWire(value: unknown): RegisterNonPiiBatchResponse {
  const wire = registerNonPiiBatchWireResponseSchema.parse(value);
  return {
    results: wire.results.map((result) => {
      const mapped: BatchRecordResult = {
        status: result.status,
        verifiablReference: result.verifiabl_reference,
      };
      if (result.external_id !== undefined) {
        mapped.externalId = result.external_id;
      }
      if (result.code !== undefined) {
        mapped.code = result.code;
      }
      if (result.detail !== undefined) {
        mapped.detail = result.detail;
      }
      return mapped;
    }),
  };
}

/**
 * Error codes the API is known to return today. The API may add codes
 * over time; treat anything not in this list as a generic failure rather
 * than rejecting the response.
 */
export const KNOWN_VERIFIABL_ERROR_CODES = tuple([
  "VALIDATION_FAILED",
  "DECRYPTION_FAILED",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "CONFLICT",
  "IV_REUSED",
  "KEY_VERSION_UNAVAILABLE",
  "INTERNAL_ERROR",
  "SERVICE_UNAVAILABLE",
]);

export type KnownVerifiablErrorCode = (typeof KNOWN_VERIFIABL_ERROR_CODES)[number];

/**
 * Stable machine-readable error code. Typed as the known codes plus
 * `string` so future API codes flow through to your error handling
 * untouched while autocomplete still offers the known values.
 */
export type VerifiablErrorCode = KnownVerifiablErrorCode | (string & {});

export const verifiablErrorDetailSchema = z.object({
  /** Dot-delimited field path, or "" when not field-specific. */
  path: z.string(),
  message: z.string(),
});

export type VerifiablErrorDetail = z.infer<typeof verifiablErrorDetailSchema>;

/**
 * Body shape of every non-2xx JSON response.
 *
 * The API returns per-field validation errors under the snake_case wire key
 * `field_errors`; the SDK surfaces them camelCase as `fieldErrors`, consistent
 * with the rest of the public surface. `fieldErrors` is omitted entirely when
 * the response carries none, so it is absent (not present-but-undefined) on
 * non-validation errors.
 */
export const verifiablErrorBodySchema = z.preprocess(
  // Rename the wire key `field_errors` to camelCase `fieldErrors`, dropping it
  // entirely when absent so the validated body has no present-but-undefined key.
  (value) => {
    if (typeof value !== "object" || value === null) return value;
    const { field_errors: fieldErrors, ...rest } = value as Record<string, unknown>;
    return fieldErrors === undefined ? rest : { ...rest, fieldErrors };
  },
  z.object({
    error: z.string(),
    code: z.string(),
    detail: z.string().optional(),
    fieldErrors: z.array(verifiablErrorDetailSchema).optional(),
  }),
);

export type VerifiablErrorBody = z.output<typeof verifiablErrorBodySchema>;
