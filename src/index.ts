export {
  VerifiablApiError,
  VerifiablClient,
  type VerifiablClientOptions,
  type VerifiablEnvironment,
} from "./client.js";
export { type EncryptedPii, encryptPii } from "./crypto.js";
export {
  type BarcodeParts,
  buildBarcodePayload,
  buildScanUrl,
  ciphertextSchema,
  DEFAULT_ISSUER_BASE_URL,
  DEFAULT_VERIFIER_BASE_URL,
  extractPayloadFromScan,
  linkingTokenSchema,
  SANDBOX_ISSUER_BASE_URL,
  SANDBOX_VERIFIER_BASE_URL,
  type ScanUrlOptions,
} from "./payload.js";
export {
  formatPii,
  PII_FIELD_ORDER,
  type PiiFieldName,
  type PiiFields,
  parsePii,
  piiFieldsSchema,
} from "./pii.js";

export { type RenderQrPngResult, renderQrPng } from "./qr/png.js";
export {
  type QrErrorCorrectionLevel,
  type RenderQrColors,
  type RenderQrOptions,
  type RenderQrSvgResult,
  renderQrSvg,
} from "./qr/styled.js";

export {
  type BarcodeImage,
  type CreateBarcodeRequest,
  type CreateBarcodeResponse,
  type EncryptionMetadata,
  KNOWN_VERIFIABL_ERROR_CODES,
  type KnownVerifiablErrorCode,
  type PayslipData,
  type RegisterNonPiiRequest,
  type RegisterNonPiiResponse,
  type VerifiablErrorBody,
  type VerifiablErrorCode,
  type VerifiablErrorDetail,
  type VerifyBarcodeRequest,
  type VerifyBarcodeResponse,
} from "./types.js";
