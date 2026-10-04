import { Resvg } from "@resvg/resvg-js";

import { PNG } from "pngjs";
import type { BarcodeParts } from "../payload.js";
import {
  frameRaster,
  SUPPORTED_HORIZONTAL_PNG_PIXEL_WIDTHS,
  SUPPORTED_PNG_PIXEL_WIDTHS,
} from "../qr/frame.js";
import { createBarcodePng } from "../qr/png.js";
import { unpremultiplyInPlace } from "../qr/pngEncode.js";
import { type BarcodeLayout, createBarcodeSvg } from "../qr/styled.js";
import { decodeQrImage } from "../test/decodeQr.js";

const PARTS: BarcodeParts = {
  verifiablReference: "AbCdEfGhIjKlMnOpQrStUv",
  encryptedPii: Buffer.from("Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4", "base64url"),
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
  it.each(["vertical", "horizontal"] as const)(
    "the rendered %s SVG has no <text>, so the font-less frame bake is safe",
    (layout) => {
      // The frame bake renders with loadSystemFonts:false. That is only safe
      // because every glyph is a vector path; a stray <text>/<tspan> would be
      // silently dropped or substituted. Fail loudly here if one is ever added.
      const { svg } = createBarcodeSvg(PARTS, { layout });
      expect(svg).not.toMatch(/<text[\s>]|<tspan[\s>]/);
    },
  );
});

describe("frame asset freshness", () => {
  /** The badge SVG minus its QR content, exactly as the artifact generator strips it. */
  function frameOnlySvg(width: number, layout: BarcodeLayout): string {
    const { svg } = createBarcodeSvg(PARTS, { layout, width });
    const crispIndex = svg.indexOf('<g shape-rendering="crispEdges">');
    const qrGroupStart = svg.lastIndexOf("<g transform=", crispIndex);
    expect(qrGroupStart).toBeGreaterThan(0);
    return `${svg.slice(0, qrGroupStart)}</svg>`;
  }

  // A frame change in styled.ts without regenerating the committed artifacts
  // would silently drift the PNG output from the SVG. Re-render the frame from
  // the live SVG renderer and demand the committed asset matches it exactly.
  it.each([
    ...SUPPORTED_PNG_PIXEL_WIDTHS.map((width) => ["vertical", width] as const),
    ...SUPPORTED_HORIZONTAL_PNG_PIXEL_WIDTHS.map((width) => ["horizontal", width] as const),
  ])("committed %s frame at width %d matches the live SVG", (layout, width) => {
    const rendered = new Resvg(frameOnlySvg(width, layout), {
      fitTo: { mode: "width", value: width },
      font: { loadSystemFonts: false },
    }).render();
    const fresh = unpremultiplyInPlace({
      data: Buffer.from(rendered.pixels),
      width: rendered.width,
      height: rendered.height,
    });

    const committed = frameRaster(width, layout);
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
    encryptedPii: Buffer.from("A".repeat(220), "base64url"),
  };

  function scan(png: Buffer): Promise<string | null> {
    return decodeQrImage(png);
  }

  it.each(payloads)("decodes back to the scan URL (%s)", async (ref) => {
    const parts: BarcodeParts = { verifiablReference: ref, encryptedPii: PARTS.encryptedPii };
    const { png, content } = await createBarcodePng(parts, {}, 720);
    expect(await scan(png)).toBe(content);
    expect(content).toBe(createBarcodeSvg(parts).content);
  });

  it.each([...SUPPORTED_PNG_PIXEL_WIDTHS])("decodes at width %d", async (width) => {
    const { png, content } = await createBarcodePng(PARTS, {}, width);
    expect(await scan(png)).toBe(content);
  });

  it("decodes a dense (long-PII) code", async () => {
    const { png, content } = await createBarcodePng(DENSE, {}, 720);
    expect(await scan(png)).toBe(content);
  });

  it("keeps the QR data region strictly black and white", async () => {
    // The scannability-critical region must never gain anti-aliased greys;
    // only the rounded finders and the header carry blended colours.
    const { png, modulePx } = await createBarcodePng(PARTS, {}, 720);
    const img = decode(png);
    const scale = 720 / 96;
    const x0 = 0;
    const x1 = Math.floor(96 * scale);
    const y0 = Math.ceil(54 * scale);
    const y1 = Math.floor(150 * scale);
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

  it.each([...SUPPORTED_HORIZONTAL_PNG_PIXEL_WIDTHS])(
    "decodes the horizontal layout at width %d",
    async (width) => {
      const { png, content } = await createBarcodePng(PARTS, { layout: "horizontal" }, width);
      expect(await scan(png)).toBe(content);
    },
  );

  it("decodes a dense (long-PII) code in the horizontal layout", async () => {
    const { png, content } = await createBarcodePng(DENSE, { layout: "horizontal" }, 1410);
    expect(await scan(png)).toBe(content);
  });

  it("keeps the horizontal QR box and gap black and white and the frame light", async () => {
    const { png, modulePx } = await createBarcodePng(PARTS, { layout: "horizontal" }, 1410);
    const img = decode(png);
    // 7.5 px per unit: the QR box is 0-720 px square, the white gap runs to
    // 772.5 px, and the frame's first whole pixel is 773.
    const box = 720;
    const gapEnd = 772;
    const frameX = 773;
    const skip = Math.ceil(16 * modulePx);
    const seen = new Set<number>();
    for (let y = skip; y < box - skip; y++) {
      for (let x = 0; x < box; x++) {
        seen.add(img.data.readUInt32BE((y * img.width + x) * 4));
      }
    }
    expect([...seen].sort()).toEqual([0x000000ff, 0xffffffff].sort());

    // The gap is white across the full height, and the tint before the frame
    // text is a uniform, opaque light colour, so together they are the QR's
    // right quiet zone on any page.
    const gap = new Set<number>();
    const tint = new Set<number>();
    for (const y of [0, 10, 360, 709, 719]) {
      for (let x = box; x < gapEnd; x++) {
        gap.add(img.data.readUInt32BE((y * img.width + x) * 4));
      }
    }
    for (const y of [10, 360, 709]) {
      for (let x = frameX; x < frameX + 10 * 7.5 - 2; x++) {
        tint.add(img.data.readUInt32BE((y * img.width + x) * 4));
      }
    }
    expect([...gap]).toEqual([0xffffffff]);
    expect([...tint]).toEqual([0xedefffff]);
  });

  it("decodes the horizontal layout with its alpha ignored or flattened onto black", async () => {
    // Some document pipelines drop or mishandle PNG alpha. Only the frame's
    // rounded outer corners are transparent, so neither affects scanning.
    const { png, content } = await createBarcodePng(PARTS, { layout: "horizontal" }, 1410);
    const img = PNG.sync.read(png);
    for (let offset = 0; offset < img.data.length; offset += 4) {
      const alpha = img.data[offset + 3] ?? 0;
      for (let channel = 0; channel < 3; channel++) {
        img.data[offset + channel] = Math.round(((img.data[offset + channel] ?? 0) * alpha) / 255);
      }
      img.data[offset + 3] = 255;
    }
    expect(await scan(PNG.sync.write(img))).toBe(content);
  });

  it("paints the gap between the header and the QR white across the full width", async () => {
    const { png } = await createBarcodePng(PARTS, {}, 720);
    const img = decode(png);
    const scale = 720 / 96;
    // Just below the header (47u) and just above the QR box (54u).
    for (const yUnits of [48, 50.5, 53]) {
      const y = Math.round(yUnits * scale);
      for (const x of [0, 360, 719]) {
        expect(img.data.readUInt32BE((y * img.width + x) * 4)).toBe(0xffffffff);
      }
    }
  });
});
