import { Resvg } from "@resvg/resvg-js";

import jsQR = require("jsqr");

import { extractPayloadFromScan } from "../payload.js";
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

function decode(parts: typeof PARTS, options: BarcodeSvgOptions = {}): string {
  const { svg } = createBarcodeSvg(parts, options);
  const rendered = new Resvg(svg, { fitTo: { mode: "width", value: 900 } }).render();
  const result = jsQR.default(
    new Uint8ClampedArray(rendered.pixels),
    rendered.width,
    rendered.height,
  );
  if (!result) throw new Error("QR code could not be decoded");
  return result.data;
}

describe("styled QR scannability", () => {
  it("decodes the framed badge back to the scan URL", () => {
    expect(decode(PARTS)).toBe(createBarcodeSvg(PARTS).content);
  });

  it("decoded URL round-trips to the original payload", () => {
    const payload = extractPayloadFromScan(decode(PARTS));
    expect(payload).toBe(`1|${PARTS.linkingToken}|${PARTS.encryptedPii}`);
  });

  it("decodes the frameless variant", () => {
    expect(decode(PARTS, { frame: false })).toBe(createBarcodeSvg(PARTS, { frame: false }).content);
  });

  it("decodes bare-payload encoding", () => {
    expect(decode(PARTS, { encode: "payload" })).toBe(
      `1|${PARTS.linkingToken}|${PARTS.encryptedPii}`,
    );
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
