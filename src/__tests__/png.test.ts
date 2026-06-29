import { createBarcodePng } from "../qr/png.js";

const PARTS = {
  verifiablReference: "AbCdEfGhIjKlMnOpQrStUv",
  encryptedPii: "Zm9vYmFyYmF6cXV4",
};

describe("createBarcodePng", () => {
  it("renders a PNG at the requested pixel width", async () => {
    const { png, width, height } = await createBarcodePng(PARTS, {}, 480);
    // PNG magic bytes
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(width).toBe(480);
    expect(height).toBe(Math.round((480 * 151) / 96));
  });

  it("defaults to a truecolour PNG and uses a palette PNG when asked", async () => {
    // colour type byte: signature(8)+len(4)+"IHDR"(4)+w(4)+h(4)+bitDepth(1) => 25
    const truecolour = await createBarcodePng(PARTS, {}, 480);
    expect(truecolour.png[25]).toBe(6); // RGBA

    const palette = await createBarcodePng(PARTS, { palette: true }, 480);
    expect(palette.png[25]).toBe(3); // indexed
    // Palette encoding is the smaller artifact.
    expect(palette.png.length).toBeLessThan(truecolour.png.length);
  });

  it("rejects invalid pixel widths", async () => {
    await expect(createBarcodePng(PARTS, {}, 0)).rejects.toThrow("pixelWidth");
    await expect(createBarcodePng(PARTS, {}, 479)).rejects.toThrow("at least 480");
  });
});
