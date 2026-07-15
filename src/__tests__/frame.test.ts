import { deflateRawSync } from "node:zlib";

import { parseFrameContainer } from "../qr/frame.js";

/** Build a VFR1 container from a palette (RGBA entries) and pixel indices. */
function container(paletteCount: number, indices: number[]): Buffer {
  const header = Buffer.alloc(10);
  header.write("VFR1", 0, "ascii");
  header.writeUInt16BE(indices.length, 4); // width
  header.writeUInt16BE(1, 6); // height
  header.writeUInt16BE(paletteCount, 8);
  const palette = Buffer.alloc(paletteCount * 4);
  const deflated = deflateRawSync(Buffer.from(indices));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(deflated.length, 0);
  return Buffer.concat([header, palette, length, deflated]);
}

describe("parseFrameContainer", () => {
  it("accepts a well-formed container", () => {
    const parsed = parseFrameContainer(container(2, [0, 1, 0]));
    expect(parsed.width).toBe(3);
    expect(parsed.height).toBe(1);
    expect(parsed.indices).toEqual(Buffer.from([0, 1, 0]));
  });

  it("rejects a bad magic", () => {
    const bytes = container(1, [0]);
    bytes.write("XXXX", 0, "ascii");
    expect(() => parseFrameContainer(bytes)).toThrow("bad magic");
  });

  it("rejects a palette index past the palette", () => {
    // index 2 with only 2 palette entries (valid 0..1) must fail fast, not
    // silently render a black pixel.
    expect(() => parseFrameContainer(container(2, [0, 2]))).toThrow("palette index out of range");
  });

  it("rejects an index/dimension mismatch", () => {
    const bytes = container(1, [0, 0]);
    bytes.writeUInt16BE(5, 4); // claim width 5 for a 2-pixel payload
    expect(() => parseFrameContainer(bytes)).toThrow("pixel count mismatch");
  });
});
