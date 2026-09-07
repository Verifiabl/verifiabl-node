import {
  type BarcodeParts,
  type BarcodePayloadOptions,
  buildBarcodePayload,
  PDF_PAYLOAD_XMP_NAMESPACE,
  PDF_PAYLOAD_XMP_PROPERTY,
} from "./payload.js";
import { type BarcodeSvgOptions, type BarcodeSvgResult, createBarcodeSvg } from "./qr/styled.js";

/** XMP metadata copy to write alongside the rendered QR barcode. */
export interface BarcodePdfMetadata {
  readonly xmpNamespace: typeof PDF_PAYLOAD_XMP_NAMESPACE;
  readonly xmpProperty: typeof PDF_PAYLOAD_XMP_PROPERTY;
  readonly payload: string;
}

/** Matching local artifacts for one self-managed payslip PDF. */
export interface BarcodeArtifactsResult {
  readonly barcode: BarcodeSvgResult;
  readonly pdfMetadata: BarcodePdfMetadata;
}

/**
 * Render the branded SVG barcode and build its matching PDF XMP metadata copy.
 *
 * Both artifacts are derived from the same reference, ciphertext bytes and
 * format option. Prefer this over calling `createBarcodeSvg` and
 * `buildBarcodePayload` separately, where mismatched format options can produce
 * a PDF whose QR and metadata copies disagree.
 */
export function createBarcodeArtifacts(
  parts: BarcodeParts,
  options: BarcodeSvgOptions = {},
): BarcodeArtifactsResult {
  const payloadOptions: BarcodePayloadOptions = {};
  if (options.format !== undefined) {
    payloadOptions.format = options.format;
  }

  return {
    barcode: createBarcodeSvg(parts, options),
    pdfMetadata: {
      xmpNamespace: PDF_PAYLOAD_XMP_NAMESPACE,
      xmpProperty: PDF_PAYLOAD_XMP_PROPERTY,
      payload: buildBarcodePayload(parts, payloadOptions),
    },
  };
}
