export { VerifiablApiError, VerifiablClient, type VerifiablClientOptions } from "./client.js";
export { type EncryptedPii, encryptPii } from "./crypto.js";
export {
  formatP1,
  P1_FIELD_ORDER,
  type P1FieldName,
  type P1Fields,
  p1FieldsSchema,
  parseP1,
} from "./p1.js";
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

export { createVerificationQrPng, type VerificationQrPngResult } from "./qr/png.js";
export {
  createVerificationQr,
  type QrErrorCorrectionLevel,
  type VerificationQrColors,
  type VerificationQrOptions,
  type VerificationQrResult,
} from "./qr/styled.js";

export type {
  CreatePayslipSymbolRequest,
  CreatePayslipSymbolResponse,
  DataMatrixSymbol,
  EncryptionMetadata,
  PayslipData,
  RegisterPayslipRequest,
  RegisterPayslipResponse,
  VerifiablErrorBody,
  VerifiablErrorCode,
  VerifiablErrorDetail,
  VerifyBarcodeRequest,
  VerifyBarcodeResponse,
} from "./types.js";
