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

/**
 * Compare two equal-size RGBA buffers: the largest single-channel difference,
 * and how many pixels differ in any channel.
 */
function comparePixels(
  expected: Buffer,
  actual: Buffer,
): { maxChannelDelta: number; differingPixels: number } {
  if (expected.length !== actual.length) {
    throw new Error(`size mismatch: ${expected.length} vs ${actual.length}`);
  }
  let maxChannelDelta = 0;
  let differingPixels = 0;
  for (let pixel = 0; pixel < expected.length; pixel += 4) {
    let pixelDelta = 0;
    for (let channel = 0; channel < 4; channel++) {
      const delta = Math.abs((expected[pixel + channel] ?? 0) - (actual[pixel + channel] ?? 0));
      pixelDelta = Math.max(pixelDelta, delta);
    }
    if (pixelDelta > 0) {
      differingPixels++;
    }
    maxChannelDelta = Math.max(maxChannelDelta, pixelDelta);
  }
  return { maxChannelDelta, differingPixels };
}

describe("PNG pipeline visual identity", () => {
  // Both the default (truecolour) and palette encoders must reproduce the
  // committed baseline (the original single-document render) byte-for-byte.
  // resvg's CPU rasteriser is deterministic with system fonts disabled, so the
  // diff is exact: zero tolerance, so an alpha-rounding regression in the
  // palette path cannot hide behind a threshold.
  it.each([
    ["truecolour (default)", {}],
    ["palette", { palette: true }],
  ])("%s output matches the committed baseline", async (_label, options) => {
    const baseline = decode(readFileSync(join(__dirname, "fixtures", "badge-baseline-480.png")));
    const { png } = await createBarcodePng(PARTS, options, 480);
    const current = decode(png);

    expect(current.width).toBe(baseline.width);
    expect(current.height).toBe(baseline.height);
    const { maxChannelDelta, differingPixels } = comparePixels(baseline.data, current.data);
    expect(maxChannelDelta).toBe(0);
    expect(differingPixels).toBe(0);
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
