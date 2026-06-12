import { z } from "zod";

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const KEY_VERSION_RE = /^[A-Za-z0-9._-]+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
    /** Provider key version identifier, 1-128 chars of [A-Za-z0-9._-]. */
    key_version: z.string().min(1).max(128).regex(KEY_VERSION_RE),
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
    schema: z.string().regex(/^[a-z]{2}\.[a-z]+\.v\d+$/, {
      error: "schema must be in format 'xx.type.vN' (e.g. 'au.payslip.v1')",
    }),
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
 * Request for `client.verifyBarcode`. Calls POST /v1/verifications/payload.
 * Send either the raw scanned barcode text or the pre-parsed parts.
 */
export const verifyBarcodeRequestSchema = z.union([
  z.object({ barcode: z.string().min(1) }).strict(),
  z
    .object({
      lt: z.string().length(22).regex(BASE64URL_RE),
      ct: z.string().min(1).max(10_000).regex(BASE64URL_RE),
    })
    .strict(),
]);

export type VerifyBarcodeRequest = z.infer<typeof verifyBarcodeRequestSchema>;

export const verifyBarcodeResponseSchema = z.object({
  verified: z.boolean(),
  linking_token: z.string().length(22).regex(BASE64URL_RE),
  /** Non-PII payslip data as registered. */
  payslip: z.record(z.string(), z.unknown()),
  /** Decrypted employee PII fields. */
  employee: z.record(z.string(), z.unknown()),
  decrypted_at: z.iso.datetime({ offset: true }),
});

export type VerifyBarcodeResponse = z.infer<typeof verifyBarcodeResponseSchema>;

/**
 * Error codes the API is known to return today. The API may add codes
 * over time; treat anything not in this list as a generic failure rather
 * than rejecting the response.
 */
export const KNOWN_VERIFIABL_ERROR_CODES = [
  "VALIDATION_FAILED",
  "DECRYPTION_FAILED",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "LINKING_TOKEN_NOT_FOUND",
  "KEY_VERSION_UNAVAILABLE",
  "INTERNAL_ERROR",
  "SERVICE_UNAVAILABLE",
] as const;

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
