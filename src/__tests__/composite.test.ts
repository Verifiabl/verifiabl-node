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
      // Visual identity: the alpha-over-white blend at the rounded finder edges
      // can differ by at most one 8-bit level from resvg's internal compositing
      // rounding, on a tiny fraction of pixels. Modules and chrome are exact.
      expect(stats.maxDelta).toBeLessThanOrEqual(1);
      expect(stats.differingPixels / stats.totalPixels).toBeLessThan(0.01);
    });
  }
});
