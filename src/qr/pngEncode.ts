import { deflateSync } from "node:zlib";

/** Decoded straight-alpha RGBA image: `data` is `width * height * 4` bytes. */
export interface RgbaRaster {
  data: Buffer;
  width: number;
  height: number;
}

/**
 * Convert a premultiplied RGBA raster (resvg's `.pixels`) to straight
 * (non-premultiplied) alpha in place, as PNG requires. Fully-opaque pixels are
 * unchanged; fully-transparent collapse to 0,0,0,0; only anti-aliased edges are
 * scaled back up. Matches resvg's own `asPng()` conversion byte-for-byte.
 */
export function unpremultiplyInPlace(raster: RgbaRaster): RgbaRaster {
  const d = raster.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] ?? 0;
    if (a === 0) {
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
      continue;
    }
    if (a === 255) {
      continue;
    }
    d[i] = Math.min(255, Math.round(((d[i] ?? 0) * 255) / a));
    d[i + 1] = Math.min(255, Math.round(((d[i + 1] ?? 0) * 255) / a));
    d[i + 2] = Math.min(255, Math.round(((d[i + 2] ?? 0) * 255) / a));
  }
  return raster;
}

/**
 * Minimal, dependency-free PNG encoder for the composited badge raster.
 *
 * The branded badge is a low-colour image (navy header, white card, grey
 * border, black QR, plus anti-aliased blends — measured at ~140 distinct
 * colours), so it encodes losslessly as an 8-bit palette PNG (colour type 3)
 * with a `tRNS` chunk for the rounded-corner alpha. That is ~1 byte/pixel
 * versus 4 for truecolour, so both the buffer and the DEFLATE pass are smaller.
 * If a raster ever exceeds 256 distinct colours we fall back to truecolour
 * RGBA (colour type 6) so encoding is always correct.
 *
 * Built on `node:zlib` (DEFLATE) with a local CRC32, so it adds no dependency
 * and runs on Node >=20 (`zlib.crc32` only exists on Node >=22.2).
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_PALETTE = 256;

export interface PngEncodeOptions {
  /** DEFLATE level 0-9 (default 6). PNG is lossless at every level; this only trades size for speed. */
  compressionLevel?: number;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = (CRC_TABLE[(crc ^ (buffer[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function ihdr(width: number, height: number, colorType: 3 | 6): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data.writeUInt8(8, 8); // bit depth
  data.writeUInt8(colorType, 9);
  data.writeUInt8(0, 10); // compression
  data.writeUInt8(0, 11); // filter
  data.writeUInt8(0, 12); // interlace
  return chunk("IHDR", data);
}

interface Palette {
  rgb: Buffer; // 3 bytes per entry, in index order
  alpha: number[]; // one per entry, in index order
  indices: Uint8Array; // one palette index per pixel
}

/** Build an indexed palette, or null when the image has more than 256 colours. */
function buildPalette(raster: RgbaRaster): Palette | null {
  const { data, width, height } = raster;
  const pixelCount = width * height;
  const map = new Map<number, number>();
  const indices = new Uint8Array(pixelCount);
  const rgb: number[] = [];
  const alpha: number[] = [];

  for (let p = 0; p < pixelCount; p++) {
    const i = p * 4;
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const a = data[i + 3] ?? 0;
    const key = ((r * 256 + g) * 256 + b) * 256 + a;
    let index = map.get(key);
    if (index === undefined) {
      if (alpha.length >= MAX_PALETTE) {
        return null;
      }
      index = alpha.length;
      map.set(key, index);
      rgb.push(r, g, b);
      alpha.push(a);
    }
    indices[p] = index;
  }
  return { rgb: Buffer.from(rgb), alpha, indices };
}

function deflate(raw: Buffer, level: number): Buffer {
  return deflateSync(raw, { level });
}

function encodeIndexed(raster: RgbaRaster, palette: Palette, level: number): Buffer {
  const { width, height } = raster;
  const stride = width + 1; // one filter byte per scanline
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter: None
    palette.indices.subarray(y * width, (y + 1) * width).forEach((v, x) => {
      raw[rowStart + 1 + x] = v;
    });
  }

  // tRNS may omit trailing fully-opaque entries (decoders assume 255).
  let trnsLength = palette.alpha.length;
  while (trnsLength > 0 && palette.alpha[trnsLength - 1] === 255) {
    trnsLength--;
  }

  const chunks = [PNG_SIGNATURE, ihdr(width, height, 3), chunk("PLTE", palette.rgb)];
  if (trnsLength > 0) {
    chunks.push(chunk("tRNS", Buffer.from(palette.alpha.slice(0, trnsLength))));
  }
  chunks.push(chunk("IDAT", deflate(raw, level)), chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

function encodeTruecolor(raster: RgbaRaster, level: number): Buffer {
  const { data, width, height } = raster;
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter: None
    data.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    ihdr(width, height, 6),
    chunk("IDAT", deflate(raw, level)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Encode a straight-alpha RGBA raster as a PNG. Uses an 8-bit palette when the
 * image has <=256 colours (the branded badge always does) and falls back to
 * truecolour RGBA otherwise. Output is lossless in both cases.
 */
export function encodePng(raster: RgbaRaster, options: PngEncodeOptions = {}): Buffer {
  if (!Buffer.isBuffer(raster.data)) {
    throw new Error("raster.data must be a Buffer");
  }
  if (!Number.isInteger(raster.width) || raster.width <= 0) {
    throw new Error("raster.width must be a positive integer");
  }
  if (!Number.isInteger(raster.height) || raster.height <= 0) {
    throw new Error("raster.height must be a positive integer");
  }
  if (raster.data.length !== raster.width * raster.height * 4) {
    throw new Error("raster.data length does not match width * height * 4");
  }
  const level = options.compressionLevel ?? 6;
  if (!Number.isInteger(level) || level < 0 || level > 9) {
    throw new Error("compressionLevel must be an integer between 0 and 9");
  }

  const palette = buildPalette(raster);
  return palette === null ? encodeTruecolor(raster, level) : encodeIndexed(raster, palette, level);
}
