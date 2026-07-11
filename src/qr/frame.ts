import { inflateRawSync } from "node:zlib";

import { FRAME_ASSETS_V1 } from "./frameAssets.generated.js";
import type { RgbaRaster } from "./pngEncode.js";

/**
 * Pixel widths the PNG compositor supports. The frame is pre-rasterised at
 * bake time (scripts/bake-frames.mjs), so PNG output exists only at these
 * widths; SVG output remains continuously scalable.
 */
export const SUPPORTED_PNG_PIXEL_WIDTHS = [480, 720, 960, 1440] as const;

export type SupportedPngPixelWidth = (typeof SUPPORTED_PNG_PIXEL_WIDTHS)[number];

interface ParsedFrameAsset {
  width: number;
  height: number;
  /** RGBA (straight alpha), 4 bytes per palette entry. */
  palette: Buffer;
  /** One palette index per pixel, row-major. */
  indices: Buffer;
}

const parsedAssets = new Map<SupportedPngPixelWidth, ParsedFrameAsset>();

function parseAsset(pixelWidth: SupportedPngPixelWidth): ParsedFrameAsset {
  const cached = parsedAssets.get(pixelWidth);
  if (cached !== undefined) {
    return cached;
  }

  const container = Buffer.from(FRAME_ASSETS_V1[pixelWidth], "base64");
  if (container.toString("ascii", 0, 4) !== "VFR1") {
    throw new Error("corrupt frame asset: bad magic");
  }
  const width = container.readUInt16BE(4);
  const height = container.readUInt16BE(6);
  const paletteCount = container.readUInt16BE(8);
  const paletteStart = 10;
  const deflatedLengthOffset = paletteStart + paletteCount * 4;
  const deflatedLength = container.readUInt32BE(deflatedLengthOffset);
  const deflatedStart = deflatedLengthOffset + 4;
  if (deflatedStart + deflatedLength !== container.length) {
    throw new Error("corrupt frame asset: length mismatch");
  }

  const indices = inflateRawSync(container.subarray(deflatedStart, deflatedStart + deflatedLength));
  if (indices.length !== width * height) {
    throw new Error("corrupt frame asset: pixel count mismatch");
  }

  const parsed: ParsedFrameAsset = {
    width,
    height,
    palette: container.subarray(paletteStart, deflatedLengthOffset),
    indices,
  };
  parsedAssets.set(pixelWidth, parsed);
  return parsed;
}

/**
 * Expand the baked frame for `pixelWidth` into a fresh straight-alpha RGBA
 * raster the compositor can blit onto. A new buffer every call: the caller
 * mutates it.
 */
export function frameRaster(pixelWidth: SupportedPngPixelWidth): RgbaRaster {
  const { width, height, palette, indices } = parseAsset(pixelWidth);
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
