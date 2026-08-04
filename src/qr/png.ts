import { type BarcodeParts, buildScanUrl, type ScanUrlOptions } from "../payload.js";
import { blitQrOntoFrame } from "./blit.js";
import { frameRaster, SUPPORTED_PNG_PIXEL_WIDTHS, type SupportedPngPixelWidth } from "./frame.js";
import { encodePng, type PngEncodeOptions } from "./pngEncode.js";
import {
  type BarcodeErrorCorrectionLevel,
  type BarcodeSvgOptions,
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

function isSupportedPixelWidth(value: number): value is SupportedPngPixelWidth {
  return SUPPORTED_PNG_PIXEL_WIDTHS.some((width) => width === value);
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
 * {@link SUPPORTED_PNG_PIXEL_WIDTHS}. If you need a different size, prefer
 * `createBarcodeSvg` (continuously scalable), or scale at placement time: PDF
 * toolchains set the physical size independently of the pixel size.
 *
 * @param pixelWidth Output bitmap width in pixels (default: 720).
 */
export async function createBarcodePng(
  parts: BarcodeParts,
  options: BarcodePngOptions = {},
  pixelWidth = 720,
): Promise<BarcodePngResult> {
  if (!Number.isInteger(pixelWidth) || !isSupportedPixelWidth(pixelWidth)) {
    throw new Error(`pixelWidth must be one of ${SUPPORTED_PNG_PIXEL_WIDTHS.join(", ")}`);
  }

  const scanOptions: ScanUrlOptions = {};
  if (options.environment !== undefined) {
    scanOptions.environment = options.environment;
  }
  if (options.scanBaseUrl !== undefined) {
    scanOptions.scanBaseUrl = options.scanBaseUrl;
  }
  const content = buildScanUrl(parts, scanOptions);

  const ladder = errorCorrectionLadder(options.maxErrorCorrection ?? DEFAULT_MAX_ERROR_CORRECTION);
  const selected = selectQrRendering(content, pixelWidth, ladder);
  const degraded =
    selected.errorCorrectionLevel !== ladder[0] || selected.modulePx < IDEAL_MODULE_PX;

  const raster = frameRaster(pixelWidth);
  blitQrOntoFrame(
    raster,
    {
      matrixData: selected.qr.modules.data,
      size: selected.size,
      insetModules: selected.insetModules,
    },
    pixelWidth,
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
    modulePx: round2(selected.modulePx),
    degraded,
  };
}
