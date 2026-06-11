import { z } from "zod";

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const KEY_VERSION_RE = /^[A-Za-z0-9._-]+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Request and response schemas for the Verifiabl API. Field names are the
 * wire contract, while client method names use the SDK's domain language.
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
    schema: z.string().min(1),
    /** ISO 8601 datetime the payslip was issued. */
    issued_at: z.string().datetime({ offset: true }),
    payslip_data: payslipDataSchema,
    encryption_metadata: encryptionMetadataSchema,
  })
  .strict();

/**
 * Request for `client.registerPayslip`. Calls POST /v1/registerNonPII.
 * The encrypted PII stays with you and goes into a locally generated
 * barcode; only non-PII data and decryption metadata are sent.
 */
export const registerPayslipRequestSchema = basePayslipRegistrationSchema;

export type RegisterPayslipRequest = z.infer<typeof registerPayslipRequestSchema>;

export const registerPayslipResponseSchema = z
  .object({
    /** Server record id (UUID). */
    id: z.string().min(1),
    /** 22-char base64url linking token to embed in the barcode. */
    linking_token: z.string().length(22).regex(BASE64URL_RE),
  })
  .strict();

export type RegisterPayslipResponse = z.infer<typeof registerPayslipResponseSchema>;

/**
 * Request for `client.createPayslipSymbol`. Calls POST
 * /v1/registerAndBuildSymbol. This API-managed flow also sends the
 * ciphertext, and the server returns a ready-made Data Matrix symbol.
 */
export const createPayslipSymbolRequestSchema = basePayslipRegistrationSchema
  .extend({
    /** Base64url AES-256-GCM ciphertext of the P1 plaintext. */
    encrypted_pii: z.string().min(1).max(10_000).regex(BASE64URL_RE),
  })
  .strict();

export type CreatePayslipSymbolRequest = z.infer<typeof createPayslipSymbolRequestSchema>;

export const dataMatrixSymbolSchema = z
  .object({
    format: z.literal("png"),
    /** Base64-encoded PNG. */
    data: z.string().min(1),
    width_px: z.number().int().positive(),
    height_px: z.number().int().positive(),
  })
  .strict();

export type DataMatrixSymbol = z.infer<typeof dataMatrixSymbolSchema>;

export const createPayslipSymbolResponseSchema = z
  .object({
    id: z.string().min(1),
    symbol: dataMatrixSymbolSchema,
  })
  .strict();

export type CreatePayslipSymbolResponse = z.infer<typeof createPayslipSymbolResponseSchema>;

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

export const verifyBarcodeResponseSchema = z
  .object({
    verified: z.boolean(),
    linking_token: z.string().length(22).regex(BASE64URL_RE),
    /** Non-PII payslip data as registered. */
    payslip: z.record(z.string(), z.unknown()),
    /** Decrypted employee PII fields (P1 layout). */
    employee: z.record(z.string(), z.unknown()),
    decrypted_at: z.string().datetime({ offset: true }),
  })
  .strict();

export type VerifyBarcodeResponse = z.infer<typeof verifyBarcodeResponseSchema>;

/** Stable machine-readable error codes returned by the API. */
export const verifiablErrorCodeSchema = z.enum([
  "VALIDATION_FAILED",
  "DECRYPTION_FAILED",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "LINKING_TOKEN_NOT_FOUND",
  "KEY_VERSION_UNAVAILABLE",
  "INTERNAL_ERROR",
  "SERVICE_UNAVAILABLE",
]);

export type VerifiablErrorCode = z.infer<typeof verifiablErrorCodeSchema>;

export const verifiablErrorDetailSchema = z
  .object({
    /** Dot-delimited field path, or "" when not field-specific. */
    path: z.string(),
    message: z.string(),
  })
  .strict();

export type VerifiablErrorDetail = z.infer<typeof verifiablErrorDetailSchema>;

/** Body shape of every non-2xx JSON response. */
export const verifiablErrorBodySchema = z
  .object({
    error: z.string(),
    code: verifiablErrorCodeSchema,
    detail: z.string().optional(),
    details: z.array(verifiablErrorDetailSchema).optional(),
  })
  .strict();

export type VerifiablErrorBody = z.infer<typeof verifiablErrorBodySchema>;
