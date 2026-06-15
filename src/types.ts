import { z } from "zod";

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
 * Request and response schemas for the Verifiabl API. Field names are the
 * wire contract, while client method names use the SDK's domain language.
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
    key_version: keyVersionSchema,
  })
  .strict();

export type EncryptionMetadata = z.infer<typeof encryptionMetadataSchema>;

/** Non-PII payslip data. `period_start`/`period_end` are required (YYYY-MM-DD); other fields are schema-defined. */
export const payslipDataSchema = z
  .object({
    period_start: z.string().regex(ISO_DATE_RE),
    period_end: z.string().regex(ISO_DATE_RE),
  })
  .catchall(z.unknown());

export type PayslipData = z.infer<typeof payslipDataSchema>;

const basePayslipRegistrationSchema = z
  .object({
    /** Payslip schema identifier, e.g. "au.payslip.v1". */
    schema: payslipSchemaIdSchema,
    /**
     * ISO 8601 UTC datetime the payslip was issued. The API only accepts
     * UTC ("Z") timestamps; convert local times first, e.g. with
     * `new Date().toISOString()`.
     */
    issued_at: z.iso.datetime({
      error:
        "issued_at must be an ISO 8601 UTC datetime ending in 'Z' (use new Date().toISOString())",
    }),
    payslip_data: payslipDataSchema,
    encryption_metadata: encryptionMetadataSchema,
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
  /** Server record id (UUID). */
  id: z.string().min(1),
  /** 22-char base64url linking token to embed in the barcode. */
  linking_token: z.string().length(22).regex(BASE64URL_RE),
});

export type RegisterNonPiiResponse = z.infer<typeof registerNonPiiResponseSchema>;

/**
 * Request for `client.createBarcode`. Calls POST
 * /v1/registerAndBuildSymbol. This API-managed flow also sends the
 * ciphertext, and the server returns a ready-made barcode image.
 */
export const createBarcodeRequestSchema = basePayslipRegistrationSchema
  .extend({
    /** Base64url AES-256-GCM ciphertext of the formatted PII plaintext. */
    encrypted_pii: z.string().min(1).max(10_000).regex(BASE64URL_RE),
  })
  .strict();

export type CreateBarcodeRequest = z.infer<typeof createBarcodeRequestSchema>;

export const barcodeImageSchema = z.object({
  format: z.literal("png"),
  /** Base64-encoded PNG. */
  data: z.string().min(1),
  width_px: z.number().int().positive(),
  height_px: z.number().int().positive(),
});

export type BarcodeImage = z.infer<typeof barcodeImageSchema>;

export const createBarcodeApiResponseSchema = z.object({
  id: z.string().min(1),
  symbol: barcodeImageSchema,
});

export const createBarcodeResponseSchema = z.object({
  id: z.string().min(1),
  barcode: barcodeImageSchema,
});

export type CreateBarcodeResponse = z.infer<typeof createBarcodeResponseSchema>;

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

/** Body shape of every non-2xx JSON response. */
export const verifiablErrorBodySchema = z.object({
  error: z.string(),
  code: z.string(),
  detail: z.string().optional(),
  details: z.array(verifiablErrorDetailSchema).optional(),
});

export type VerifiablErrorBody = z.infer<typeof verifiablErrorBodySchema>;
