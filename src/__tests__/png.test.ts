import { createBarcodePng } from "../qr/png.js";

const PARTS = {
  linkingToken: "AbCdEfGhIjKlMnOpQrStUv",
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

  it("rejects invalid pixel widths", async () => {
    await expect(createBarcodePng(PARTS, {}, 0)).rejects.toThrow("pixelWidth");
    await expect(createBarcodePng(PARTS, {}, 479)).rejects.toThrow("at least 480");
  });
});
