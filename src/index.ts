export { VerifiablApiError, VerifiablClient, type VerifiablClientOptions } from "./client.js";
export { type EncryptedPii, encryptPii } from "./crypto.js";
export {
  type BarcodeParts,
  buildBarcodePayload,
  buildScanUrl,
  ciphertextSchema,
  DEFAULT_BASE_URL,
  extractPayloadFromScan,
  linkingTokenSchema,
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
  type BarcodeSvgColors,
  type BarcodeSvgOptions,
  type BarcodeSvgResult,
  createBarcodeSvg,
  type QrErrorCorrectionLevel,
} from "./qr/styled.js";

export type {
  BarcodeImage,
  CreateBarcodeRequest,
  CreateBarcodeResponse,
  EncryptionMetadata,
  PayslipData,
  RegisterNonPiiRequest,
  RegisterNonPiiResponse,
  VerifiablErrorBody,
  VerifiablErrorCode,
  VerifiablErrorDetail,
  VerifyBarcodeRequest,
  VerifyBarcodeResponse,
} from "./types.js";
