import { type BarcodeParts, rejectRemovedBarcodeFormat, type ScanUrlOptions } from "../payload.js";
import { blitQrOntoFrame } from "./blit.js";
import { frameRaster, supportedPngPixelWidths } from "./frame.js";
import { encodePng, type PngEncodeOptions } from "./pngEncode.js";
import {
  type BarcodeErrorCorrectionLevel,
  type BarcodeSvgOptions,
  badgeGeometry,
  buildQrEncoding,
  DEFAULT_MAX_ERROR_CORRECTION,
  errorCorrectionLadder,
  IDEAL_MODULE_PX,
  round2,
  selectQrRendering,
} from "./styled.js";

export interface BarcodePngResult {
  /** PNG image bytes. */
  png: Buffer;
  width: number;
  height: number;
  /** The exact string encoded in the QR code. */
  content: string;
  /** Error-correction level actually used (see {@link BarcodeSvgResult}). */
  errorCorrectionLevel: BarcodeErrorCorrectionLevel;
  /** QR symbol version (1-40), for scanner-fixture attribution. */
  qrVersion: number;
  /** Rendered size of one QR module, in output pixels. */
  modulePx: number;
  /** True when the ladder traded scan robustness to fit the payload. */
  degraded: boolean;
}

/** PNG-specific options. A superset of the SVG options, so callers can pass either. */
export interface BarcodePngOptions extends BarcodeSvgOptions {
  /**
   * @deprecated The compositor always emits the smallest lossless encoding
   * (an 8-bit palette PNG; truecolour only if the palette ever overflows).
   * This flag is ignored and will be removed in a future release.
   */
  palette?: boolean;
  /**
   * DEFLATE level (0-9, default 6). Lossless at every level; only trades file
   * size for encode speed.
   */
  compressionLevel?: number;
}

/**
 * Render the branded Verifiabl QR code as a PNG.
 *
 * The PNG is composited deterministically from a pre-rasterised frame plus
 * exact pixel-aligned QR modules - no vector rasteriser is involved, so there
 * is no native dependency, and the same record produces the byte-identical
 * raster in every Verifiabl SDK.
 *
 * Because the frame is pre-rasterised, PNG output exists only at the widths in
 * `SUPPORTED_PNG_PIXEL_WIDTHS` for the vertical layout and
 * `SUPPORTED_HORIZONTAL_PNG_PIXEL_WIDTHS` for the horizontal layout. Both width
 * sets render the QR code at the same sizes. If you need a different size, prefer
 * `createBarcodeSvg` (continuously scalable), or scale at placement time: PDF
 * toolchains set the physical size independently of the pixel size.
 *
 * Rejects with `QrCapacityError` when the encrypted PII is too long to encode.
 *
 * @param pixelWidth Output bitmap width in pixels (default: 720 for the
 *   vertical layout, 1410 for the horizontal layout).
 */
export async function createBarcodePng(
  parts: BarcodeParts,
  options: BarcodePngOptions = {},
  pixelWidth?: number,
): Promise<BarcodePngResult> {
  rejectRemovedBarcodeFormat(options);
  const layout = options.layout ?? "vertical";
  const geometry = badgeGeometry(layout);
  const supportedWidths = supportedPngPixelWidths(layout);
  const width = pixelWidth ?? (layout === "horizontal" ? 1410 : 720);
  if (!Number.isInteger(width) || !supportedWidths.includes(width)) {
    throw new Error(
      `pixelWidth must be one of ${supportedWidths.join(", ")} for the ${layout} layout`,
    );
  }

  const scanOptions: ScanUrlOptions = {};
  if (options.environment !== undefined) {
    scanOptions.environment = options.environment;
  }
  if (options.scanBaseUrl !== undefined) {
    scanOptions.scanBaseUrl = options.scanBaseUrl;
  }
  const encoding = buildQrEncoding(parts, scanOptions);
  const content = encoding.content;

  const ladder = errorCorrectionLadder(options.maxErrorCorrection ?? DEFAULT_MAX_ERROR_CORRECTION);
  const selected = selectQrRendering(encoding.data, width, ladder, content.length, geometry);
  const degraded =
    selected.errorCorrectionLevel !== ladder[0] || selected.modulePx < IDEAL_MODULE_PX;

  const raster = frameRaster(width, layout);
  blitQrOntoFrame(
    raster,
    {
      matrixData: selected.qr.modules.data,
      size: selected.size,
    },
    width,
    geometry,
  );

  const encodeOptions: PngEncodeOptions = {};
  if (options.compressionLevel !== undefined) {
    encodeOptions.compressionLevel = options.compressionLevel;
  }
  const png = encodePng(raster, encodeOptions);

  return {
    png,
    width: raster.width,
    height: raster.height,
    content,
    errorCorrectionLevel: selected.errorCorrectionLevel,
    qrVersion: (selected.size - 17) / 4,
    modulePx: round2(selected.modulePx),
    degraded,
  };
}
