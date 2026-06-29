import type { BarcodeParts } from "../payload.js";
import { encodePng, type PngEncodeOptions, unpremultiplyInPlace } from "./pngEncode.js";
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

/** PNG-specific options. A superset of the SVG options, so callers can pass either. */
export interface BarcodePngOptions extends BarcodeSvgOptions {
  /**
   * Encode as an 8-bit palette PNG instead of truecolour (default false).
   *
   * The badge is a low-colour image, so a palette PNG is roughly 60% smaller —
   * worth it when many codes are embedded in a PDF or stored. The tradeoff is
   * speed: the palette path encodes in this SDK (composite-free, but a JS
   * DEFLATE pass) and is about 2x slower than resvg's native truecolour
   * encoder. Output is lossless and visually identical either way.
   */
  palette?: boolean;
  /**
   * DEFLATE level (0-9, default 6) for the palette encoder. Lossless at every
   * level; only trades file size for encode speed. Ignored unless `palette`.
   */
  compressionLevel?: number;
}

const MIN_PIXEL_WIDTH = 480;

type ResvgConstructor = typeof import("@resvg/resvg-js").Resvg;

let resvgLoad: Promise<ResvgConstructor> | undefined;

/**
 * Load the optional `@resvg/resvg-js` peer dependency once and cache the
 * constructor. A failed load is not cached, so a later install can recover.
 */
async function loadResvg(): Promise<ResvgConstructor> {
  if (resvgLoad === undefined) {
    resvgLoad = import("@resvg/resvg-js")
      .then((mod) => mod.Resvg)
      .catch((cause: unknown) => {
        resvgLoad = undefined;
        throw new Error(
          "PNG output requires the optional peer dependency '@resvg/resvg-js'. " +
            "Install it with: npm install @resvg/resvg-js, or use createBarcodeSvg for SVG output.",
          { cause },
        );
      });
  }
  return resvgLoad;
}

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
 * System fonts are disabled on the render: every glyph in the badge is a
 * pre-vectorised path (there is no `<text>`), so this is visually identical
 * (verified by pixel-diff) while skipping resvg's slow system-font-database
 * enumeration — the dominant cost — and making output deterministic across
 * machines. The first render is as fast as the rest; there is no warm-up.
 *
 * Pass `palette: true` for a ~60% smaller palette PNG, at ~2x the encode time.
 *
 * @param pixelWidth Output bitmap width in pixels (default: 720).
 */
export async function createBarcodePng(
  parts: BarcodeParts,
  options: BarcodePngOptions = {},
  pixelWidth = 720,
): Promise<BarcodePngResult> {
  if (!Number.isInteger(pixelWidth) || pixelWidth <= 0) {
    throw new Error("pixelWidth must be a positive integer");
  }
  if (pixelWidth < MIN_PIXEL_WIDTH) {
    throw new Error(`pixelWidth must be at least ${MIN_PIXEL_WIDTH}`);
  }

  const Resvg = await loadResvg();

  // resvg rasterises to pixelWidth regardless of the SVG's width attribute, so
  // build the SVG at that same width. This keeps the scannability floor in
  // styled.ts reflecting the actual PNG resolution.
  const { svg, content, errorCorrectionLevel, modulePx, degraded } = createBarcodeSvg(parts, {
    ...options,
    width: pixelWidth,
  });

  let png: Buffer;
  let width: number;
  let height: number;
  try {
    const rendered = new Resvg(svg, {
      fitTo: { mode: "width", value: pixelWidth },
      font: { loadSystemFonts: false },
    }).render();
    width = rendered.width;
    height = rendered.height;
    png = options.palette === true ? encodePalette(rendered, options) : rendered.asPng();
  } catch (cause) {
    throw new Error("Failed to rasterise the Verifiabl barcode PNG", { cause });
  }

  return { png, width, height, content, errorCorrectionLevel, modulePx, degraded };
}

function encodePalette(
  rendered: { pixels: Buffer; width: number; height: number },
  options: BarcodePngOptions,
): Buffer {
  // resvg's pixels are premultiplied; PNG is straight alpha.
  const raster = unpremultiplyInPlace({
    data: Buffer.from(rendered.pixels),
    width: rendered.width,
    height: rendered.height,
  });
  const encodeOptions: PngEncodeOptions = {};
  if (options.compressionLevel !== undefined) {
    encodeOptions.compressionLevel = options.compressionLevel;
  }
  return encodePng(raster, encodeOptions);
}

/** One barcode to render in a batch. */
export interface BarcodePngBatchItem {
  parts: BarcodeParts;
  options?: BarcodePngOptions;
  pixelWidth?: number;
}

export interface BarcodePngBatchOptions {
  /**
   * Yield to the event loop after this many codes (default 1). Only relevant
   * with `palette: true`: that path reads resvg's native pixel buffer, whose
   * memory is freed by finalizers that run on event-loop turns, so a tight loop
   * over thousands of codes can let RSS climb. Yielding keeps peak memory flat.
   * The default truecolour path does not have this issue.
   */
  yieldEvery?: number;
}

/**
 * Render many barcodes, preserving input order. A thin wrapper over
 * {@link createBarcodePng} that yields to the event loop periodically, which
 * keeps peak memory flat when rendering with `palette: true` at scale.
 */
export async function createBarcodePngBatch(
  items: readonly BarcodePngBatchItem[],
  batchOptions: BarcodePngBatchOptions = {},
): Promise<BarcodePngResult[]> {
  if (!Array.isArray(items)) {
    throw new Error("items must be an array");
  }
  const yieldEvery = batchOptions.yieldEvery ?? 1;
  if (!Number.isInteger(yieldEvery) || yieldEvery <= 0) {
    throw new Error("yieldEvery must be a positive integer");
  }

  const results: BarcodePngResult[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item === undefined) {
      throw new Error(`items[${i}] is missing`);
    }
    results.push(await createBarcodePng(item.parts, item.options ?? {}, item.pixelWidth ?? 720));
    if ((i + 1) % yieldEvery === 0) {
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    }
  }
  return results;
}
