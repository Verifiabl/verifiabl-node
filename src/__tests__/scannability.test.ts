import { Resvg } from "@resvg/resvg-js";
import type { QRCode as DecodedQr, Options } from "jsqr";
import * as jsqrModule from "jsqr";

// jsqr publishes ESM-flavoured types over a CJS UMD build, which NodeNext
// cannot model: the callable lives on `.default` at runtime but the types
// resolve to the namespace. Dev-only test dependency, so resolve manually.
type JsQrFn = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: Options,
) => DecodedQr | null;

const jsqrNamespace = jsqrModule as unknown as Record<string, unknown>;
const jsQR = (jsqrNamespace.default ?? jsqrModule) as JsQrFn;

import { extractPayloadFromScan } from "../payload.js";
import { createVerificationQr, type VerificationQrOptions } from "../qr/styled.js";

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

function decode(parts: typeof PARTS, options: VerificationQrOptions = {}): string {
  const { svg } = createVerificationQr(parts, options);
  const rendered = new Resvg(svg, { fitTo: { mode: "width", value: 900 } }).render();
  const result = jsQR(new Uint8ClampedArray(rendered.pixels), rendered.width, rendered.height);
  if (!result) throw new Error("QR code could not be decoded");
  return result.data;
}

describe("styled QR scannability", () => {
  it("decodes the framed badge back to the scan URL", () => {
    expect(decode(PARTS)).toBe(createVerificationQr(PARTS).content);
  });

  it("decoded URL round-trips to the original payload", () => {
    const payload = extractPayloadFromScan(decode(PARTS));
    expect(payload).toBe(`1|${PARTS.linkingToken}|${PARTS.encryptedPii}`);
  });

  it("decodes the frameless variant", () => {
    expect(decode(PARTS, { frame: false })).toBe(
      createVerificationQr(PARTS, { frame: false }).content,
    );
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
      createVerificationQr(longParts, { errorCorrectionLevel: "H" }).content,
    );
  });
});
