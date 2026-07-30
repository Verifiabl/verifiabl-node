import { SUPPORTED_PNG_PIXEL_WIDTHS } from "../qr/frame.js";
import { createBarcodePng } from "../qr/png.js";
import { createBarcodeSvg } from "../qr/styled.js";

const PARTS = {
  verifiablReference: "AbCdEfGhIjKlMnOpQrStUv",
  encryptedPii: "Zm9vYmFyYmF6cXV4",
};

// The baked frame's pixel height per supported width (755 = 480 * 151/96; the
// half-pixel heights round up, matching the bake renderer).
const EXPECTED_HEIGHTS: Record<number, number> = {
  480: 755,
  720: 1133,
  960: 1510,
  1440: 2265,
};

describe("createBarcodePng", () => {
  it("renders a PNG at each supported pixel width", async () => {
    for (const pixelWidth of SUPPORTED_PNG_PIXEL_WIDTHS) {
      const { png, width, height } = await createBarcodePng(PARTS, {}, pixelWidth);
      // PNG magic bytes
      expect(png.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
      expect(width).toBe(pixelWidth);
      expect(height).toBe(EXPECTED_HEIGHTS[pixelWidth]);
    }
  });

  it("is deterministic byte for byte", async () => {
    const first = await createBarcodePng(PARTS, {}, 720);
    const second = await createBarcodePng(PARTS, {}, 720);
    expect(Buffer.compare(first.png, second.png)).toBe(0);
  });

  it("always emits the palette encoding; the deprecated palette flag is a no-op", async () => {
    // colour type byte: signature(8)+len(4)+"IHDR"(4)+w(4)+h(4)+bitDepth(1) => 25
    const plain = await createBarcodePng(PARTS, {}, 480);
    expect(plain.png[25]).toBe(3); // indexed

    const withFlag = await createBarcodePng(PARTS, { palette: true }, 480);
    expect(Buffer.compare(plain.png, withFlag.png)).toBe(0);
  });

  it("reports the same content and scannability metadata as the SVG renderer", async () => {
    const svg = createBarcodeSvg(PARTS, { width: 720 });
    const png = await createBarcodePng(PARTS, {}, 720);
    expect(png.content).toBe(svg.content);
    expect(png.errorCorrectionLevel).toBe(svg.errorCorrectionLevel);
    expect(png.modulePx).toBe(svg.modulePx);
    expect(png.degraded).toBe(svg.degraded);
  });

  it("rejects unsupported pixel widths", async () => {
    for (const bad of [0, -720, 479, 481, 640, 1920, 720.5]) {
      await expect(createBarcodePng(PARTS, {}, bad)).rejects.toThrow(
        "pixelWidth must be one of 480, 720, 960, 1440",
      );
    }
  });
});
