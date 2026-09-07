import {
  type BarcodeParts,
  type BarcodePayloadOptions,
  buildBarcodePayload,
  PDF_PAYLOAD_XMP_NAMESPACE,
  PDF_PAYLOAD_XMP_PROPERTY,
} from "./payload.js";
import { type BarcodePngOptions, createBarcodePng } from "./qr/png.js";
import { type BarcodeErrorCorrectionLevel, createBarcodeSvg } from "./qr/styled.js";

export type BarcodeImageFormat = "svg" | "png";

/** Options for building both self-managed PDF artifacts. */
export interface BarcodeArtifactsOptions extends BarcodePngOptions {
  /** Image representation for the branded barcode. Defaults to `svg`. */
  imageFormat?: BarcodeImageFormat;
  /** PNG bitmap width. Used only when `imageFormat` is `png`; defaults to 720. */
  pixelWidth?: number;
}

/** A rendered barcode image. `data` contains UTF-8 SVG bytes or PNG bytes according to `format`. */
export interface BarcodeImageArtifact {
  readonly format: BarcodeImageFormat;
  readonly data: Buffer;
  readonly width: number;
  readonly height: number;
  /** The exact string encoded in the QR code. */
  readonly content: string;
  readonly errorCorrectionLevel: BarcodeErrorCorrectionLevel;
  readonly qrVersion: number;
  readonly modulePx: number;
  readonly degraded: boolean;
}

/** XMP metadata copy to write alongside the rendered QR barcode. */
export interface BarcodePdfMetadata {
  readonly xmpNamespace: typeof PDF_PAYLOAD_XMP_NAMESPACE;
  readonly xmpProperty: typeof PDF_PAYLOAD_XMP_PROPERTY;
  readonly payload: string;
}

/** Matching local artifacts for one self-managed payslip PDF. */
export interface BarcodeArtifactsResult {
  readonly barcode: BarcodeImageArtifact;
  readonly pdfMetadata: BarcodePdfMetadata;
}

/**
 * Render a branded SVG or PNG barcode and build its matching PDF XMP metadata copy.
 *
 * Both artifacts are derived from the same reference, ciphertext bytes and
 * barcode-format option. Prefer this over calling an image renderer and
 * `buildBarcodePayload` separately, where mismatched format options can produce
 * a PDF whose QR and metadata copies disagree.
 */
export async function createBarcodeArtifacts(
  parts: BarcodeParts,
  options: BarcodeArtifactsOptions = {},
): Promise<BarcodeArtifactsResult> {
  const payloadOptions: BarcodePayloadOptions = {};
  if (options.format !== undefined) {
    payloadOptions.format = options.format;
  }

  const barcode =
    options.imageFormat === "png"
      ? barcodeArtifactFromPng(await createBarcodePng(parts, options, options.pixelWidth ?? 720))
      : barcodeArtifactFromSvg(createBarcodeSvg(parts, options));

  return {
    barcode,
    pdfMetadata: {
      xmpNamespace: PDF_PAYLOAD_XMP_NAMESPACE,
      xmpProperty: PDF_PAYLOAD_XMP_PROPERTY,
      payload: buildBarcodePayload(parts, payloadOptions),
    },
  };
}

function barcodeArtifactFromSvg(result: ReturnType<typeof createBarcodeSvg>): BarcodeImageArtifact {
  return {
    format: "svg",
    data: Buffer.from(result.svg, "utf8"),
    width: result.width,
    height: result.height,
    content: result.content,
    errorCorrectionLevel: result.errorCorrectionLevel,
    qrVersion: result.qrVersion,
    modulePx: result.modulePx,
    degraded: result.degraded,
  };
}

function barcodeArtifactFromPng(
  result: Awaited<ReturnType<typeof createBarcodePng>>,
): BarcodeImageArtifact {
  return {
    format: "png",
    data: result.png,
    width: result.width,
    height: result.height,
    content: result.content,
    errorCorrectionLevel: result.errorCorrectionLevel,
    qrVersion: result.qrVersion,
    modulePx: result.modulePx,
    degraded: result.degraded,
  };
}
