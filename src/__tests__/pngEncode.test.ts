import { PNG } from "pngjs";
import { encodePng } from "../qr/pngEncode.js";
import type { RgbaRaster } from "../qr/raster.js";

function colorTypeOf(png: Buffer): number {
  // signature(8) + len(4) + "IHDR"(4) + width(4) + height(4) + bitDepth(1) => colorType at 25
  return png[25] ?? -1;
}

function decode(png: Buffer): RgbaRaster {
  const decoded = PNG.sync.read(png);
  return { data: decoded.data, width: decoded.width, height: decoded.height };
}

describe("encodePng", () => {
  it("round-trips a low-colour RGBA image as a palette PNG", () => {
    const width = 8;
    const height = 8;
    const data = Buffer.alloc(width * height * 4);
    // A handful of distinct colours, including a partial-alpha one.
    const colors: ReadonlyArray<readonly [number, number, number, number]> = [
      [1, 10, 79, 255], // navy
      [255, 255, 255, 255], // white
      [0, 0, 0, 255], // black
      [0, 0, 0, 128], // half-alpha black (rounded-corner style)
    ];
    for (let p = 0; p < width * height; p++) {
      const i = p * 4;
      const [r, g, b, a] = colors[p % 4] ?? ([0, 0, 0, 0] as const);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }

    const png = encodePng({ data, width, height });
    expect(colorTypeOf(png)).toBe(3); // palette

    const back = decode(png);
    expect(back.width).toBe(width);
    expect(back.height).toBe(height);
    expect(Buffer.compare(back.data, data)).toBe(0);
  });

  it("falls back to truecolour RGBA above 256 colours, still lossless", () => {
    const width = 300;
    const height = 1;
    const data = Buffer.alloc(width * height * 4);
    for (let p = 0; p < width; p++) {
      const i = p * 4;
      data[i] = p % 256;
      data[i + 1] = Math.floor(p / 256);
      data[i + 2] = 0;
      data[i + 3] = 255;
    }

    const png = encodePng({ data, width, height });
    expect(colorTypeOf(png)).toBe(6); // truecolour RGBA

    const back = decode(png);
    expect(Buffer.compare(back.data, data)).toBe(0);
  });

  it("rejects malformed rasters and compression levels", () => {
    const ok: RgbaRaster = { data: Buffer.alloc(4), width: 1, height: 1 };
    expect(() => encodePng({ data: Buffer.alloc(3), width: 1, height: 1 })).toThrow("length");
    expect(() => encodePng({ data: Buffer.alloc(4), width: 0, height: 1 })).toThrow("width");
    expect(() => encodePng(ok, { compressionLevel: 12 })).toThrow("compressionLevel");
  });
});
