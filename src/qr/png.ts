import type { BarcodeParts } from "../payload.js";
import {
  type BarcodeErrorCorrectionLevel,
  type BarcodeSvgOptions,
  createBarcodeSvg,
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

const MIN_PIXEL_WIDTH = 480;

/**
 * Render the branded Verifiabl QR badge as a PNG.
 *
 * Requires the optional peer dependency `@resvg/resvg-js`:
 *
 *   npm install @resvg/resvg-js
 *
 * If your PDF pipeline accepts SVG, prefer `createBarcodeSvg`. It has no
 * native dependencies and scales without rasterisation artefacts.
 *
 * @param pixelWidth Output bitmap width in pixels (default: 720).
 */
export async function createBarcodePng(
  parts: BarcodeParts,
  options: BarcodeSvgOptions = {},
  pixelWidth = 720,
): Promise<BarcodePngResult> {
  if (!Number.isInteger(pixelWidth) || pixelWidth <= 0) {
    throw new Error("pixelWidth must be a positive integer");
  }
  if (pixelWidth < MIN_PIXEL_WIDTH) {
    throw new Error(`pixelWidth must be at least ${MIN_PIXEL_WIDTH}`);
  }

  let Resvg: typeof import("@resvg/resvg-js").Resvg;
  try {
    ({ Resvg } = await import("@resvg/resvg-js"));
  } catch {
    throw new Error(
      "PNG output requires the optional peer dependency '@resvg/resvg-js'. " +
        "Install it with: npm install @resvg/resvg-js, or use createBarcodeSvg for SVG output.",
    );
  }

  // resvg rasterises to pixelWidth regardless of the SVG's width attribute, so
  // build the SVG at that same width. This makes the scannability floor in
  // createBarcodeSvg reflect the actual PNG resolution rather than the default.
  const { svg, content, errorCorrectionLevel, modulePx, degraded } = createBarcodeSvg(parts, {
    ...options,
    width: pixelWidth,
  });
  const rendered = new Resvg(svg, {
    fitTo: { mode: "width", value: pixelWidth },
  }).render();

  return {
    png: rendered.asPng(),
    width: rendered.width,
    height: rendered.height,
    content,
    errorCorrectionLevel,
    modulePx,
    degraded,
  };
}
