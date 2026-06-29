import type { BarcodeParts } from "../payload.js";
import { encodePng, type PngEncodeOptions } from "./pngEncode.js";
import { compositeQrOverFrame, type RgbaRaster, unpremultiplyInPlace } from "./raster.js";
import {
  type BarcodeErrorCorrectionLevel,
  type BarcodeSvgOptions,
  buildBarcodeLayers,
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
   * DEFLATE level (0-9, default 6) for the PNG encoder. PNG is lossless at
   * every level, so this only trades file size for encode speed; it never
   * affects scannability. Lower it in throughput-critical batches.
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

function renderRgba(Resvg: ResvgConstructor, svg: string, pixelWidth: number): RgbaRaster {
  // loadSystemFonts:false is safe because every glyph in the badge is a
  // pre-vectorised path (no <text>), and it skips the slow system-font-database
  // enumeration while making output deterministic across machines.
  const rendered = new Resvg(svg, {
    fitTo: { mode: "width", value: pixelWidth },
    font: { loadSystemFonts: false },
  }).render();
  return { data: rendered.pixels, width: rendered.width, height: rendered.height };
}

// The branded frame is identical for every barcode at a given width, so its
// rasterised pixels are cached and only the QR is re-rendered per code. Keyed
// by pixel width; the set of distinct widths in any process is tiny.
const frameCache = new Map<number, RgbaRaster>();

function getFrameRaster(Resvg: ResvgConstructor, pixelWidth: number, frameSvg: string): RgbaRaster {
  const cached = frameCache.get(pixelWidth);
  if (cached !== undefined) {
    return cached;
  }
  const frame = renderRgba(Resvg, frameSvg, pixelWidth);
  frameCache.set(pixelWidth, frame);
  return frame;
}

/** Clear the cached frame rasters (e.g. to release memory). Rarely needed. */
export function clearBarcodeFrameCache(): void {
  frameCache.clear();
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
 * The static branded frame (header, logo, text, card) is rasterised once and
 * cached; each call re-renders only the QR and composites it onto a copy of the
 * cached frame, so per-code work is just the QR raster plus a palette-PNG
 * encode. Output is visually identical to a single-document render.
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
  // build the layers at that same width. This keeps the scannability floor in
  // styled.ts reflecting the actual PNG resolution.
  const layers = buildBarcodeLayers(parts, { ...options, width: pixelWidth });

  let png: Buffer;
  let composited: RgbaRaster;
  try {
    const frame = getFrameRaster(Resvg, pixelWidth, layers.frameSvg);
    const qr = renderRgba(Resvg, layers.qrSvg, pixelWidth);
    // Composite onto a copy so the cached frame is never mutated, then convert
    // the premultiplied result to straight alpha for PNG.
    composited = unpremultiplyInPlace(
      compositeQrOverFrame(
        { data: Buffer.from(frame.data), width: frame.width, height: frame.height },
        qr,
      ),
    );
    const encodeOptions: PngEncodeOptions = {};
    if (options.compressionLevel !== undefined) {
      encodeOptions.compressionLevel = options.compressionLevel;
    }
    png = encodePng(composited, encodeOptions);
  } catch (cause) {
    throw new Error("Failed to rasterise the Verifiabl barcode PNG", { cause });
  }

  return {
    png,
    width: composited.width,
    height: composited.height,
    content: layers.content,
    errorCorrectionLevel: layers.errorCorrectionLevel,
    modulePx: layers.modulePx,
    degraded: layers.degraded,
  };
}

/** One barcode to render in a batch. */
export interface BarcodePngBatchItem {
  parts: BarcodeParts;
  options?: BarcodePngOptions;
  pixelWidth?: number;
}

export interface BarcodePngBatchOptions {
  /**
   * Yield to the event loop after this many codes (default 1). resvg's native
   * render memory is freed by finalizers that only run on event-loop turns, so
   * a tight `for`-loop over thousands of codes lets it climb into the gigabytes.
   * Yielding keeps peak RSS flat (≈150 MB for any batch size). Raise it to
   * trade a little peak memory for marginally less scheduling overhead.
   */
  yieldEvery?: number;
}

/**
 * Render many barcodes with bounded memory. Functionally a loop over
 * {@link createBarcodePng}, but it yields to the event loop periodically so
 * resvg's native render memory is reclaimed between codes; without that, a
 * large run climbs into the gigabytes and can OOM. Results are returned in input
 * order. This is single-threaded; for multi-core throughput see the worker-pool
 * batch.
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
