import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Resvg } from "@resvg/resvg-js";

import jsQR = require("jsqr");

import { PNG } from "pngjs";
import type { BarcodeParts } from "../payload.js";
import { frameRaster, SUPPORTED_PNG_PIXEL_WIDTHS } from "../qr/frame.js";
import { createBarcodePng } from "../qr/png.js";
import { unpremultiplyInPlace } from "../qr/pngEncode.js";
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
  // The compositor is deterministic by construction (integer arithmetic only),
  // so the committed baseline must match byte for byte: zero tolerance, so a
  // snapping or coverage regression cannot hide behind a threshold. The .NET
  // SDK holds the same rasters, so a deliberate change here means regenerating
  // both baselines together.
  it("output matches the committed baseline exactly", async () => {
    const baseline = decode(readFileSync(join(__dirname, "fixtures", "badge-baseline-480.png")));
    const { png } = await createBarcodePng(PARTS, {}, 480);
    const current = decode(png);

    expect(current.width).toBe(baseline.width);
    expect(current.height).toBe(baseline.height);
    const { maxChannelDelta, differingPixels } = comparePixels(baseline.data, current.data);
    expect(maxChannelDelta).toBe(0);
    expect(differingPixels).toBe(0);
  });

  it("the rendered SVG has no <text>, so the font-less frame bake is safe", () => {
    // The frame bake renders with loadSystemFonts:false. That is only safe
    // because every glyph is a vector path; a stray <text>/<tspan> would be
    // silently dropped or substituted. Fail loudly here if one is ever added.
    const { svg } = createBarcodeSvg(PARTS, { width: 720 });
    expect(svg).not.toMatch(/<text[\s>]|<tspan[\s>]/);
  });
});

describe("frame asset freshness", () => {
  /** The badge SVG minus its QR content, exactly as scripts/bake-frames.mjs strips it. */
  function frameOnlySvg(width: number): string {
    const { svg } = createBarcodeSvg(PARTS, { width });
    const crispIndex = svg.indexOf('<g shape-rendering="crispEdges">');
    const qrGroupStart = svg.lastIndexOf("<g transform=", crispIndex);
    expect(qrGroupStart).toBeGreaterThan(0);
    return `${svg.slice(0, qrGroupStart)}</svg>`;
  }

  // A frame change in styled.ts without re-running scripts/bake-frames.mjs
  // would silently drift the PNG output from the SVG. Re-render the frame from
  // the live SVG renderer and demand the committed asset matches it exactly.
  it.each([
    ...SUPPORTED_PNG_PIXEL_WIDTHS,
  ])("committed frame at width %d matches the live SVG", (width) => {
    const rendered = new Resvg(frameOnlySvg(width), {
      fitTo: { mode: "width", value: width },
      font: { loadSystemFonts: false },
    }).render();
    const fresh = unpremultiplyInPlace({
      data: Buffer.from(rendered.pixels),
      width: rendered.width,
      height: rendered.height,
    });

    const committed = frameRaster(width);
    expect(committed.width).toBe(fresh.width);
    expect(committed.height).toBe(fresh.height);
    const { maxChannelDelta, differingPixels } = comparePixels(fresh.data, committed.data);
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
  // A long ciphertext forces a dense, high-version QR, exercising the
  // compositor on the hardest-to-scan codes, not just sparse ones.
  const DENSE: BarcodeParts = {
    verifiablReference: "AbCdEfGhIjKlMnOpQrStUv",
    encryptedPii: "A".repeat(220),
  };

  function scan(png: Buffer): string | null {
    const img = decode(png);
    return jsQR.default(new Uint8ClampedArray(img.data), img.width, img.height)?.data ?? null;
  }

  it.each(payloads)("decodes back to the scan URL (%s)", async (ref) => {
    const parts: BarcodeParts = { verifiablReference: ref, encryptedPii: PARTS.encryptedPii };
    const { png, content } = await createBarcodePng(parts, {}, 720);
    expect(scan(png)).toBe(content);
    expect(content).toBe(createBarcodeSvg(parts).content);
  });

  it.each([...SUPPORTED_PNG_PIXEL_WIDTHS])("decodes at width %d", async (width) => {
    const { png, content } = await createBarcodePng(PARTS, {}, width);
    expect(scan(png)).toBe(content);
  });

  it("decodes a dense (long-PII) code", async () => {
    const { png, content } = await createBarcodePng(DENSE, {}, 720);
    expect(scan(png)).toBe(content);
  });

  it("keeps the QR data region strictly black and white", async () => {
    // The scannability-critical region must never gain anti-aliased greys;
    // only the rounded finders and the frame carry blended colours.
    const { png, modulePx } = await createBarcodePng(PARTS, {}, 720);
    const img = decode(png);
    const scale = 720 / 96;
    const x0 = Math.ceil(8 * scale);
    const x1 = Math.floor(88 * scale);
    const y0 = Math.ceil(59 * scale);
    const y1 = Math.floor(139 * scale);
    // Carve out the three finder corners (7 modules plus inset headroom).
    const skip = Math.ceil(16 * modulePx);

    const seen = new Set<number>();
    const census = (xa: number, xb: number, ya: number, yb: number): void => {
      for (let y = ya; y < yb; y++) {
        for (let x = xa; x < xb; x++) {
          seen.add(img.data.readUInt32BE((y * img.width + x) * 4));
        }
      }
    };
    census(x0, x1, y0 + skip, y1 - skip);
    census(x1 - skip, x1, y0 + skip, y1);

    expect([...seen].sort()).toEqual([0x000000ff, 0xffffffff].sort());
  });
});
