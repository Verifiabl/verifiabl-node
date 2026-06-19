export {
  VerifiablApiError,
  type VerifiablAuth,
  VerifiablAuthError,
  VerifiablClient,
  type VerifiablClientOptions,
  type VerifiablEnvironment,
  type VerifiablErrorEvent,
  type VerifiablRequestEvent,
  type VerifiablRequestOptions,
  type VerifiablResponseEvent,
} from "./client.js";
export { type EncryptedPii, encryptPii } from "./crypto.js";
export {
  type BarcodeParts,
  buildBarcodePayload,
  buildScanUrl,
  ciphertextSchema,
  DEFAULT_ISSUER_BASE_URL,
  DEFAULT_SCAN_BASE_URL,
  linkingTokenSchema,
  PDF_PAYLOAD_XMP_NAMESPACE,
  PDF_PAYLOAD_XMP_PREFIX,
  PDF_PAYLOAD_XMP_PROPERTY,
  SANDBOX_ISSUER_BASE_URL,
  SANDBOX_SCAN_BASE_URL,
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

export { type BarcodePngResult, createBarcodePng } from "./qr/png.js";
export {
  type BarcodeErrorCorrectionLevel,
  type BarcodeSvgOptions,
  type BarcodeSvgResult,
  createBarcodeSvg,
} from "./qr/styled.js";

export {
  type BarcodeImage,
  type CreateBarcodeRequest,
  type CreateBarcodeResponse,
  type EncryptionMetadata,
  KEY_VERSION_RE,
  KNOWN_VERIFIABL_ERROR_CODES,
  type KnownVerifiablErrorCode,
  type PayslipData,
  type RegisterNonPiiRequest,
  type RegisterNonPiiResponse,
  SCHEMA_RE,
  type VerifiablErrorBody,
  type VerifiablErrorCode,
  type VerifiablErrorDetail,
} from "./types.js";
