import { Resvg } from "@resvg/resvg-js";

import jsQR = require("jsqr");

import { type BarcodeSvgOptions, createBarcodeSvg } from "../qr/styled.js";

/**
 * End-to-end scannability: rasterise the styled SVG and decode it with an
 * independent QR reader. This is the SDK's core promise: styling must
 * never break machine readability.
 */

const PARTS = {
  linkingToken: "AbCdEfGhIjKlMnOpQrStUv",
  encryptedPii:
    "Zm9vYmFyYmF6cXV4XzEyMzQ1Njc4OTBhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ekFCQ0RFRkdISUpLTE1OT1A",
};

function decode(parts: typeof PARTS, options: BarcodeSvgOptions = {}, rasterWidth = 900): string {
  const { svg } = createBarcodeSvg(parts, options);
  const rendered = new Resvg(svg, { fitTo: { mode: "width", value: rasterWidth } }).render();
  const result = jsQR.default(
    new Uint8ClampedArray(rendered.pixels),
    rendered.width,
    rendered.height,
  );
  if (!result) throw new Error(`QR code could not be decoded at ${rasterWidth}px`);
  return result.data;
}

describe("styled QR scannability", () => {
  it("decodes the framed badge back to the scan URL", () => {
    expect(decode(PARTS)).toBe(createBarcodeSvg(PARTS).content);
  });

  it("decoded URL contains the encoded barcode payload", () => {
    const decoded = decode(PARTS);
    expect(decoded).toContain(encodeURIComponent(`1|${PARTS.linkingToken}|${PARTS.encryptedPii}`));
  });

  it("decodes the frameless variant", () => {
    expect(decode(PARTS, { frame: false })).toBe(createBarcodeSvg(PARTS, { frame: false }).content);
  });

  it("decodes bare-payload encoding", () => {
    expect(decode(PARTS, { encode: "payload" })).toBe(
      `1|${PARTS.linkingToken}|${PARTS.encryptedPii}`,
    );
  });

  it("decodes the framed badge across raster scales", () => {
    const { content } = createBarcodeSvg(PARTS);
    for (const rasterWidth of [500, 900, 1600]) {
      expect(decode(PARTS, {}, rasterWidth)).toBe(content);
    }
  });

  it("decodes at high error correction with a long ciphertext", () => {
    const longParts = {
      linkingToken: PARTS.linkingToken,
      encryptedPii: "A".repeat(600),
    };
    expect(decode(longParts, { errorCorrectionLevel: "H" })).toBe(
      createBarcodeSvg(longParts, { errorCorrectionLevel: "H" }).content,
    );
  });
});
