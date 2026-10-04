import { SUPPORTED_HORIZONTAL_PNG_PIXEL_WIDTHS, SUPPORTED_PNG_PIXEL_WIDTHS } from "../qr/frame.js";
import { createBarcodePng } from "../qr/png.js";
import { createBarcodeSvg, QrCapacityError } from "../qr/styled.js";

const PARTS = {
  verifiablReference: "AbCdEfGhIjKlMnOpQrStUv",
  encryptedPii: Buffer.from("Zm9vYmFyYmF6cXV4", "base64url"),
};

// The baked frame's pixel height per supported width (750 = 480 * 150/96).
const EXPECTED_HEIGHTS: Record<number, number> = {
  480: 750,
  720: 1125,
  960: 1500,
  1440: 2250,
};

describe("createBarcodePng", () => {
  it("rejects a removed format option before rendering", async () => {
    await expect(createBarcodePng(PARTS, { format: "v1" } as never)).rejects.toThrow(
      "only issues v2",
    );
  });

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

  it("rejects with the typed QrCapacityError when the PII is too long", async () => {
    const parts = { ...PARTS, encryptedPii: Buffer.alloc(4_500) };
    await expect(createBarcodePng(parts, {}, 480)).rejects.toBeInstanceOf(QrCapacityError);
    await expect(createBarcodePng(parts, {}, 480)).rejects.toMatchObject({
      reason: "qr-capacity",
      badgeWidth: 480,
    });
  });

  it("rejects unsupported pixel widths", async () => {
    for (const bad of [0, -720, 479, 481, 640, 1920, 720.5, 940]) {
      await expect(createBarcodePng(PARTS, {}, bad)).rejects.toThrow(
        "pixelWidth must be one of 480, 720, 960, 1440 for the vertical layout",
      );
    }
  });
});

describe("createBarcodePng horizontal layout", () => {
  // Each horizontal width renders the QR box at the matching vertical width.
  const MATCHING_VERTICAL_WIDTHS: Record<number, number> = {
    940: 480,
    1410: 720,
    1880: 960,
    2820: 1440,
  };

  it("renders at each supported pixel width, as tall as the QR box", async () => {
    for (const pixelWidth of SUPPORTED_HORIZONTAL_PNG_PIXEL_WIDTHS) {
      const { width, height } = await createBarcodePng(PARTS, { layout: "horizontal" }, pixelWidth);
      expect(width).toBe(pixelWidth);
      expect(height).toBe(MATCHING_VERTICAL_WIDTHS[pixelWidth]);
    }
  });

  it("defaults to 1410, the QR size of the vertical default", async () => {
    const horizontal = await createBarcodePng(PARTS, { layout: "horizontal" });
    const vertical = await createBarcodePng(PARTS);
    expect(horizontal.width).toBe(1410);
    expect(vertical.width).toBe(720);
    expect(horizontal.modulePx).toBe(vertical.modulePx);
    expect(horizontal.qrVersion).toBe(vertical.qrVersion);
  });

  it("reports the same metadata as the horizontal SVG", async () => {
    const svg = createBarcodeSvg(PARTS, { layout: "horizontal", width: 1410 });
    const png = await createBarcodePng(PARTS, { layout: "horizontal" }, 1410);
    expect(png.content).toBe(svg.content);
    expect(png.errorCorrectionLevel).toBe(svg.errorCorrectionLevel);
    expect(png.modulePx).toBe(svg.modulePx);
    expect(png.degraded).toBe(svg.degraded);
  });

  it("rejects vertical widths", async () => {
    for (const bad of [480, 720, 1440, 950, 939]) {
      await expect(createBarcodePng(PARTS, { layout: "horizontal" }, bad)).rejects.toThrow(
        "pixelWidth must be one of 940, 1410, 1880, 2820 for the horizontal layout",
      );
    }
  });

  it("rejects an unknown layout", async () => {
    await expect(createBarcodePng(PARTS, { layout: "diagonal" } as never)).rejects.toThrow(
      'layout must be "vertical" or "horizontal"',
    );
  });
});
