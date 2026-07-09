import { z } from "zod";
import { verifiablReferenceSchema } from "./payload.js";

function tuple<const T extends readonly string[]>(value: T): T {
  return value;
}

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Key version contract: `<provider-id>.<n>` where provider-id is your
 * lowercase provider ID and n increments on each key rotation, starting at
 * 1. Verifiabl looks up the matching encryption key by this value at
 * verification time. Note this provider ID is distinct from your OAuth
 * `clientId`.
 */
export const KEY_VERSION_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[1-9][0-9]{0,5}$/;

export const SCHEMA_RE = /^[a-z]{2}\.[a-z]+\.v\d+$/;

export const keyVersionSchema = z.string().regex(KEY_VERSION_RE, {
  error: "keyVersion must be '<provider-id>.<n>' (lowercase provider ID, rotation counter from 1)",
});

export const payslipSchemaIdSchema = z.string().regex(SCHEMA_RE, {
  error: "schema must be in format 'xx.type.vN' (e.g. 'au.payslip.v1')",
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
    /** 96-bit IV, exactly 16 base64url characters. */
    iv: z.string().length(16).regex(BASE64URL_RE),
    /** 128-bit GCM auth tag, exactly 22 base64url characters. */
    tag: z.string().length(22).regex(BASE64URL_RE),
    /** Provider key version identifier in deployed `<provider-id>.<n>` format. */
    keyVersion: keyVersionSchema,
  })
  .strict();

export type EncryptionMetadata = z.infer<typeof encryptionMetadataSchema>;

/**
 * Non-PII payslip data. `periodStart`/`periodEnd` are required (YYYY-MM-DD).
 *
 * Any other fields are passed through to the API verbatim, under the exact
 * keys you supply: only `periodStart`/`periodEnd` are SDK-defined and
 * translated. Provider-specific fields (e.g. line items) use whatever names
 * your payslip schema specifies, which are typically snake_case on the wire.
 */
export const payslipNonPiiSchema = z
  .object({
    periodStart: z.string().regex(ISO_DATE_RE),
    periodEnd: z.string().regex(ISO_DATE_RE),
  })
  .catchall(z.unknown());

export type PayslipNonPii = z.infer<typeof payslipNonPiiSchema>;

const basePayslipRegistrationSchema = z
  .object({
    /** Payslip schema identifier, e.g. "au.payslip.v1". */
    schema: payslipSchemaIdSchema,
    /**
     * ISO 8601 UTC datetime the payslip was issued. The API only accepts
     * UTC ("Z") timestamps; convert local times first, e.g. with
     * `new Date().toISOString()`.
     */
    issuedAt: z.iso.datetime({
      error:
        "issuedAt must be an ISO 8601 UTC datetime ending in 'Z' (use new Date().toISOString())",
    }),
    payslipNonPii: payslipNonPiiSchema,
    encryptionMetadata: encryptionMetadataSchema,
  })
  .strict();

/**
 * Request for `client.registerNonPii`. Calls POST /v1/registerNonPII.
 * The encrypted PII stays with you and goes into a locally generated
 * barcode; only non-PII data and decryption metadata are sent.
 */
export const registerNonPiiRequestSchema = basePayslipRegistrationSchema;

export type RegisterNonPiiRequest = z.infer<typeof registerNonPiiRequestSchema>;

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
export const registerAndBuildBarcodeRequestSchema = basePayslipRegistrationSchema
  .extend({
    /** Base64url AES-256-GCM ciphertext of the formatted PII plaintext. */
    encryptedPii: z.string().min(1).max(10_000).regex(BASE64URL_RE),
  })
  .strict();

export type RegisterAndBuildBarcodeRequest = z.infer<typeof registerAndBuildBarcodeRequestSchema>;

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
  return { iv: metadata.iv, tag: metadata.tag, key_version: metadata.keyVersion };
}

function payslipNonPiiToWire(data: PayslipNonPii): Record<string, unknown> {
  const { periodStart, periodEnd, ...rest } = data;
  // Spread provider-specific passthrough fields first so the SDK-mapped
  // period_start/period_end always win, even if a caller put a stray
  // snake_case "period_start"/"period_end" in payslipNonPii.
  return { ...rest, period_start: periodStart, period_end: periodEnd };
}

/** Map a validated registration request to the snake_case wire body. */
export function registrationToWire(request: RegisterNonPiiRequest): Record<string, unknown> {
  return {
    schema: request.schema,
    issued_at: request.issuedAt,
    payslip_non_pii: payslipNonPiiToWire(request.payslipNonPii),
    encryption_metadata: encryptionMetadataToWire(request.encryptionMetadata),
  };
}

/** Map a validated register-and-build-barcode request to the snake_case wire body. */
export function registerAndBuildBarcodeToWire(
  request: RegisterAndBuildBarcodeRequest,
): Record<string, unknown> {
  return { ...registrationToWire(request), encrypted_pii: request.encryptedPii };
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

const batchRecordRequestSchema = basePayslipRegistrationSchema
  .extend({
    verifiablReference: verifiablReferenceSchema,
  })
  .strict();

export const registerNonPiiBatchRequestSchema = z
  .object({
    records: z
      .array(batchRecordRequestSchema)
      .min(1, "records must contain at least one record")
      .max(MAX_BATCH_RECORDS, `records must contain at most ${MAX_BATCH_RECORDS} records`),
  })
  .strict();

export type RegisterNonPiiBatchRequest = z.infer<typeof registerNonPiiBatchRequestSchema>;

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
 * Per-record outcome, index-aligned to the input `records` array. `code` and
 * `detail` accompany an "error" status. One bad record never fails the whole
 * batch.
 */
export interface BatchRecordResult {
  index: number;
  status: BatchRecordStatus;
  verifiablReference: string;
  code?: string;
  detail?: string;
}

export interface RegisterNonPiiBatchResponse {
  results: BatchRecordResult[];
}

/** Map a validated batch request to the snake_case wire body. */
export function registerNonPiiBatchToWire(
  request: RegisterNonPiiBatchRequest,
): Record<string, unknown> {
  return {
    records: request.records.map((record) => ({
      verifiabl_reference: record.verifiablReference,
      ...registrationToWire({
        schema: record.schema,
        issuedAt: record.issuedAt,
        payslipNonPii: record.payslipNonPii,
        encryptionMetadata: record.encryptionMetadata,
      }),
    })),
  };
}

const batchRecordResultWireSchema = z.object({
  index: z.number().int().nonnegative(),
  // Tolerant on purpose: an unknown status must pass through, not throw and
  // discard the whole batch response. Known values are listed in
  // KNOWN_BATCH_RECORD_STATUSES for callers to branch on.
  status: z.string(),
  verifiabl_reference: verifiablReferenceSchema,
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
        index: result.index,
        status: result.status,
        verifiablReference: result.verifiabl_reference,
      };
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
