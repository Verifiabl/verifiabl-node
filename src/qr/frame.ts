import { inflateRawSync } from "node:zlib";

import {
  FRAME_ASSETS_V1,
  HORIZONTAL_FRAME_ASSETS_V1,
  SUPPORTED_HORIZONTAL_PNG_PIXEL_WIDTHS,
  SUPPORTED_PNG_PIXEL_WIDTHS,
  type SupportedHorizontalPngPixelWidth,
  type SupportedPngPixelWidth,
} from "./frameAssets.generated.js";
import type { RgbaRaster } from "./pngEncode.js";
import type { BarcodeLayout } from "./styled.js";

export type { SupportedHorizontalPngPixelWidth, SupportedPngPixelWidth };
/**
 * Pixel widths the PNG compositor supports for each layout. The frames are
 * pre-rasterised at generation time, so PNG output exists only at these widths;
 * SVG output remains continuously scalable. Each horizontal width renders the
 * QR code at the same size as the matching vertical width (940 matches 480,
 * 1410 matches 720, and so on).
 */
export { SUPPORTED_HORIZONTAL_PNG_PIXEL_WIDTHS, SUPPORTED_PNG_PIXEL_WIDTHS };

/** The supported PNG pixel widths for `layout`. */
export function supportedPngPixelWidths(layout: BarcodeLayout): readonly number[] {
  return layout === "horizontal"
    ? SUPPORTED_HORIZONTAL_PNG_PIXEL_WIDTHS
    : SUPPORTED_PNG_PIXEL_WIDTHS;
}

export interface ParsedFrameAsset {
  width: number;
  height: number;
  /** RGBA (straight alpha), 4 bytes per palette entry. */
  palette: Buffer;
  /** One palette index per pixel, row-major. */
  indices: Buffer;
}

const parsedAssets = new Map<string, ParsedFrameAsset>();

function parseAsset(layout: BarcodeLayout, pixelWidth: number): ParsedFrameAsset {
  const key = `${layout}-${pixelWidth}`;
  const cached = parsedAssets.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const assets: Readonly<Record<number, string>> =
    layout === "horizontal" ? HORIZONTAL_FRAME_ASSETS_V1 : FRAME_ASSETS_V1;
  const asset = assets[pixelWidth];
  if (asset === undefined) {
    throw new Error(`no ${layout} frame asset at width ${pixelWidth}`);
  }
  const parsed = parseFrameContainer(Buffer.from(asset, "base64"));
  parsedAssets.set(key, parsed);
  return parsed;
}

/**
 * Decode and validate one VFR1 frame container. Exported for the package's own
 * tests (not re-exported from the entrypoint); production callers reach frames
 * through {@link frameRaster}.
 */
export function parseFrameContainer(container: Buffer): ParsedFrameAsset {
  if (container.length < 14 || container.toString("ascii", 0, 4) !== "VFR1") {
    throw new Error("corrupt frame asset: bad magic");
  }
  const width = container.readUInt16BE(4);
  const height = container.readUInt16BE(6);
  const paletteCount = container.readUInt16BE(8);
  if (width <= 0 || height <= 0) {
    throw new Error("corrupt frame asset: unexpected dimensions");
  }
  if (paletteCount < 1 || paletteCount > 256) {
    throw new Error("corrupt frame asset: implausible palette size");
  }
  const paletteStart = 10;
  const deflatedLengthOffset = paletteStart + paletteCount * 4;
  if (deflatedLengthOffset + 4 > container.length) {
    throw new Error("corrupt frame asset: truncated header");
  }
  const deflatedLength = container.readUInt32BE(deflatedLengthOffset);
  const deflatedStart = deflatedLengthOffset + 4;
  if (deflatedStart + deflatedLength !== container.length) {
    throw new Error("corrupt frame asset: length mismatch");
  }

  const indices = inflateRawSync(container.subarray(deflatedStart, deflatedStart + deflatedLength));
  if (indices.length !== width * height) {
    throw new Error("corrupt frame asset: pixel count mismatch");
  }

  // Every index must address a palette entry. Validating here means a corrupt
  // asset fails fast with a clear message; the ?? 0 reads in frameRaster then
  // can never silently turn an out-of-range index into a black pixel.
  let maxIndex = 0;
  for (let p = 0; p < indices.length; p++) {
    const index = indices[p] ?? 0;
    if (index > maxIndex) {
      maxIndex = index;
    }
  }
  if (maxIndex >= paletteCount) {
    throw new Error("corrupt frame asset: palette index out of range");
  }

  return {
    width,
    height,
    palette: container.subarray(paletteStart, deflatedLengthOffset),
    indices,
  };
}

/**
 * Expand the baked `layout` frame for `pixelWidth` into a fresh straight-alpha
 * RGBA raster the compositor can blit onto. A new buffer every call: the caller
 * mutates it.
 */
export function frameRaster(pixelWidth: number, layout: BarcodeLayout = "vertical"): RgbaRaster {
  const { width, height, palette, indices } = parseAsset(layout, pixelWidth);
  const data = Buffer.alloc(width * height * 4);
  for (let p = 0; p < indices.length; p++) {
    const entry = (indices[p] ?? 0) * 4;
    const offset = p * 4;
    data[offset] = palette[entry] ?? 0;
    data[offset + 1] = palette[entry + 1] ?? 0;
    data[offset + 2] = palette[entry + 2] ?? 0;
    data[offset + 3] = palette[entry + 3] ?? 0;
  }
  return { data, width, height };
}
