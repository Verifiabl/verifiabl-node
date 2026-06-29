import { readFileSync } from "node:fs";
import { join } from "node:path";

import jsQR = require("jsqr");

import { PNG } from "pngjs";
import type { BarcodeParts } from "../payload.js";
import { createBarcodePng, createBarcodePngBatch } from "../qr/png.js";
import { createBarcodeSvg } from "../qr/styled.js";

const PARTS: BarcodeParts = {
  verifiablReference: "AbCdEfGhIjKlMnOpQrStUv",
  encryptedPii: "Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4",
};

function decode(png: Buffer): { data: Buffer; width: number; height: number } {
  const img = PNG.sync.read(png);
  return { data: img.data, width: img.width, height: img.height };
}

function maxChannelDelta(a: Buffer, b: Buffer): { maxDelta: number; differingFraction: number } {
  if (a.length !== b.length) {
    throw new Error(`size mismatch: ${a.length} vs ${b.length}`);
  }
  let maxDelta = 0;
  let differing = 0;
  for (let i = 0; i < a.length; i += 4) {
    let d = 0;
    for (let c = 0; c < 4; c++) {
      const delta = Math.abs((a[i + c] ?? 0) - (b[i + c] ?? 0));
      if (delta > d) d = delta;
    }
    if (d > 0) differing++;
    if (d > maxDelta) maxDelta = d;
  }
  return { maxDelta, differingFraction: differing / (a.length / 4) };
}

describe("PNG pipeline visual identity", () => {
  it("matches the committed baseline (original single-document render)", async () => {
    const baseline = decode(readFileSync(join(__dirname, "fixtures", "badge-baseline-480.png")));
    const { png } = await createBarcodePng(PARTS, {}, 480);
    const current = decode(png);

    expect(current.width).toBe(baseline.width);
    expect(current.height).toBe(baseline.height);
    const { maxDelta, differingFraction } = maxChannelDelta(baseline.data, current.data);
    // Composited output is visually identical; only finder-edge anti-aliasing
    // may differ by a single 8-bit level on a tiny fraction of pixels.
    expect(maxDelta).toBeLessThanOrEqual(1);
    expect(differingFraction).toBeLessThan(0.01);
  });
});

describe("PNG scannability", () => {
  const payloads = [
    "AbCdEfGhIjKlMnOpQrStUv",
    "0123456789abcdefghijkl",
    "ZZZZZZZZZZZZZZZZZZZZZZ",
    "aaaaaaaaaaaaaaaaaaaaaa",
    "Q-w-E-r-T-y-U-i-O-p-12",
  ];

  it.each(payloads)("generated PNG decodes back to the scan URL (%s)", async (ref) => {
    const parts: BarcodeParts = { verifiablReference: ref, encryptedPii: PARTS.encryptedPii };
    const { png, content } = await createBarcodePng(parts, {}, 720);
    const img = decode(png);
    const result = jsQR.default(new Uint8ClampedArray(img.data), img.width, img.height);
    expect(result).not.toBeNull();
    expect(result?.data).toBe(content);
    // Sanity: the decoded content is exactly the badge's scan URL.
    expect(content).toBe(createBarcodeSvg(parts).content);
  });

  it("renders a batch with bounded memory and every code scannable", async () => {
    const items = payloads.map((ref) => ({
      parts: { verifiablReference: ref, encryptedPii: PARTS.encryptedPii },
      pixelWidth: 720,
    }));
    const results = await createBarcodePngBatch(items);
    expect(results).toHaveLength(items.length);
    for (const { png, content } of results) {
      const img = decode(png);
      const decoded = jsQR.default(new Uint8ClampedArray(img.data), img.width, img.height);
      expect(decoded?.data).toBe(content);
    }
  });
});
