import { Resvg } from "@resvg/resvg-js";
import type { BarcodeParts } from "../payload.js";
import { compositeQrOverFrame } from "../qr/raster.js";
import { buildBarcodeLayers } from "../qr/styled.js";

const PARTS: BarcodeParts = {
  verifiablReference: "AbCdEfGhIjKlMnOpQrStUv",
  encryptedPii: "Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4",
};

function renderRgba(svg: string, width: number): { data: Buffer; width: number; height: number } {
  const r = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: false },
  }).render();
  return { data: r.pixels, width: r.width, height: r.height };
}

interface DiffStats {
  maxDelta: number;
  differingPixels: number;
  totalPixels: number;
}

function diff(a: Buffer, b: Buffer): DiffStats {
  if (a.length !== b.length) {
    throw new Error(`buffer length mismatch: ${a.length} vs ${b.length}`);
  }
  let maxDelta = 0;
  let differingPixels = 0;
  for (let i = 0; i < a.length; i += 4) {
    let pixelDiff = 0;
    for (let c = 0; c < 4; c++) {
      const d = Math.abs((a[i + c] ?? 0) - (b[i + c] ?? 0));
      if (d > pixelDiff) pixelDiff = d;
    }
    if (pixelDiff > 0) differingPixels++;
    if (pixelDiff > maxDelta) maxDelta = pixelDiff;
  }
  return { maxDelta, differingPixels, totalPixels: a.length / 4 };
}

describe("frame + QR composite vs combined render", () => {
  for (const width of [480, 720]) {
    it(`is pixel-identical to the single-document render at ${width}px`, () => {
      const layers = buildBarcodeLayers(PARTS, { width });
      const combined = renderRgba(layers.svg, width);
      const frame = renderRgba(layers.frameSvg, width);
      const qr = renderRgba(layers.qrSvg, width);

      const composited = compositeQrOverFrame(
        { data: Buffer.from(frame.data), width: frame.width, height: frame.height },
        { data: qr.data, width: qr.width, height: qr.height },
      );

      const stats = diff(combined.data, composited.data);
      // Exact: premultiplied source-over reproduces resvg's own compositing
      // byte-for-byte, including the anti-aliased finder edges. Both sides are
      // rendered in this same process, so this is a zero-tolerance guard against
      // any future alpha-rounding drift, independent of platform.
      expect(stats.maxDelta).toBe(0);
      expect(stats.differingPixels).toBe(0);
    });
  }
});

describe("frame cache key completeness", () => {
  // The frame raster is cached by pixel width alone, so the frame markup must
  // depend on nothing else. If a future option changes the chrome but not the
  // cache key, this fails before a stale frame can be served.
  it("frameSvg is invariant to payload and non-frame options at a given width", () => {
    const base = buildBarcodeLayers(PARTS, { width: 720 }).frameSvg;
    const variants = [
      buildBarcodeLayers(
        { verifiablReference: "ZZZZZZZZZZZZZZZZZZZZZZ", encryptedPii: "A".repeat(200) },
        { width: 720 },
      ).frameSvg,
      buildBarcodeLayers(PARTS, { width: 720, maxErrorCorrection: "Q" }).frameSvg,
      buildBarcodeLayers(PARTS, { width: 720, environment: "sandbox" }).frameSvg,
    ];
    for (const v of variants) {
      expect(v).toBe(base);
    }
    // ...but it must change with width, or the cache would serve the wrong size.
    expect(buildBarcodeLayers(PARTS, { width: 480 }).frameSvg).not.toBe(base);
  });
});
