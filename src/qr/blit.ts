import type { RgbaRaster } from "./pngEncode.js";
import {
  FINDER_SIZE,
  FRAME_QR_BOX_X,
  FRAME_QR_BOX_Y,
  FRAME_VIEWBOX_WIDTH,
  isFinderModule,
} from "./styled.js";

/**
 * Deterministic QR compositor: draws the payload-dependent QR content (data
 * modules and rounded finder patterns) onto a pre-rasterised frame.
 *
 * Everything here is integer arithmetic on exact rational coordinates. Module
 * geometry is rational by construction (`modulePx = 80W / (96(n + 2i))`), so
 * the same inputs produce the identical raster in every implementation of this
 * spec; the .NET SDK mirrors this file and byte-compares rasters in CI. Do not
 * introduce floating point here: cross-runtime float differences (e.g. x87 on
 * .NET Framework x86) would silently break that parity.
 *
 * Magnitude bound, so plain JS numbers stay exact (< 2^53) and C# fits long:
 * coordinates in Q units (1/(2S*D) px) stay under ~7e8, and squared distances
 * are only taken of values bounded by the largest corner radius
 * (112*W*2S <= ~2.6e6), so sums stay under ~2e13.
 */

/** Subsamples per axis for finder anti-aliasing coverage. */
const SUBSAMPLES = 8;
const SUBSAMPLE_COUNT = SUBSAMPLES * SUBSAMPLES;
const S2 = 2 * SUBSAMPLES;

/** Finder corner radii in eightieths of a module: 1.4m, 1.0m, 0.65m. */
const OUTER_RADIUS_80THS = 112;
const INNER_RADIUS_80THS = 80;
const DOT_RADIUS_80THS = 52;

export interface QrBlitGeometry {
  /** Row-major dark-module flags, `size * size` entries. */
  matrixData: Uint8Array;
  size: number;
  insetModules: number;
}

/** Draw the QR modules and finders onto `frame` in place. */
export function blitQrOntoFrame(frame: RgbaRaster, qr: QrBlitGeometry, pixelWidth: number): void {
  const { matrixData, size, insetModules } = qr;
  // Common denominator for all module-grid coordinates, in pixels.
  const denom = FRAME_VIEWBOX_WIDTH * (size + 2 * insetModules);
  const numX = (k: number): number =>
    pixelWidth * (FRAME_QR_BOX_X * (size + 2 * insetModules) + 80 * (insetModules + k));
  const numY = (k: number): number =>
    pixelWidth * (FRAME_QR_BOX_Y * (size + 2 * insetModules) + 80 * (insetModules + k));
  // Round half up; edges are >= 2px apart (modulePx >= 3), so never degenerate.
  const snap = (num: number): number => Math.floor((2 * num + denom) / (2 * denom));

  const edgesX: number[] = [];
  const edgesY: number[] = [];
  for (let k = 0; k <= size; k++) {
    edgesX.push(snap(numX(k)));
    edgesY.push(snap(numY(k)));
  }

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (isFinderModule(row, col, size)) continue;
      if (!matrixData[row * size + col]) continue;
      fillBlack(
        frame,
        edgesX[col] ?? 0,
        edgesY[row] ?? 0,
        edgesX[col + 1] ?? 0,
        edgesY[row + 1] ?? 0,
      );
    }
  }

  const lastFinderOrigin = size - FINDER_SIZE;
  renderFinder(frame, 0, 0);
  renderFinder(frame, lastFinderOrigin, 0);
  renderFinder(frame, 0, lastFinderOrigin);

  function renderFinder(raster: RgbaRaster, moduleX: number, moduleY: number): void {
    // Q units: 1/(S2 * denom) of a pixel. All geometry below is integer in Q.
    const qPerPixel = S2 * denom;
    const moduleQ = 80 * pixelWidth * S2;
    const outer = {
      x0: numX(moduleX) * S2,
      y0: numY(moduleY) * S2,
      size: FINDER_SIZE * moduleQ,
      radius: OUTER_RADIUS_80THS * pixelWidth * S2,
    };
    const inner = {
      x0: outer.x0 + moduleQ,
      y0: outer.y0 + moduleQ,
      size: (FINDER_SIZE - 2) * moduleQ,
      radius: INNER_RADIUS_80THS * pixelWidth * S2,
    };
    const dot = {
      x0: outer.x0 + 2 * moduleQ,
      y0: outer.y0 + 2 * moduleQ,
      size: (FINDER_SIZE - 4) * moduleQ,
      radius: DOT_RADIUS_80THS * pixelWidth * S2,
    };

    const blackAt = (xQ: number, yQ: number): boolean => {
      if (!insideRoundedRect(xQ, yQ, outer)) return false;
      if (!insideRoundedRect(xQ, yQ, inner)) return true; // the ring
      return insideRoundedRect(xQ, yQ, dot);
    };

    const pxLo = Math.floor(outer.x0 / qPerPixel);
    const pxHi = Math.ceil((outer.x0 + outer.size) / qPerPixel);
    const pyLo = Math.floor(outer.y0 / qPerPixel);
    const pyHi = Math.ceil((outer.y0 + outer.size) / qPerPixel);

    for (let py = pyLo; py < pyHi; py++) {
      for (let px = pxLo; px < pxHi; px++) {
        const left = px * qPerPixel;
        const right = (px + 1) * qPerPixel;
        const top = py * qPerPixel;
        const bottom = (py + 1) * qPerPixel;
        const corner = blackAt(left, top);
        let count: number;
        if (
          blackAt(right, top) === corner &&
          blackAt(left, bottom) === corner &&
          blackAt(right, bottom) === corner
        ) {
          // Uniform pixel: features are >= modulePx (>= 3px) thick, so a pixel
          // whose four corners agree is interior, not a boundary sliver.
          count = corner ? SUBSAMPLE_COUNT : 0;
        } else {
          count = 0;
          for (let sy = 0; sy < SUBSAMPLES; sy++) {
            const yQ = (py * S2 + 2 * sy + 1) * denom;
            for (let sx = 0; sx < SUBSAMPLES; sx++) {
              if (blackAt((px * S2 + 2 * sx + 1) * denom, yQ)) count++;
            }
          }
        }
        if (count === 0) continue;
        // Black coverage over the white frame, rounded half up.
        const grey = Math.floor(
          (510 * (SUBSAMPLE_COUNT - count) + SUBSAMPLE_COUNT) / (2 * SUBSAMPLE_COUNT),
        );
        const offset = (py * raster.width + px) * 4;
        raster.data[offset] = grey;
        raster.data[offset + 1] = grey;
        raster.data[offset + 2] = grey;
        raster.data[offset + 3] = 255;
      }
    }
  }
}

interface RoundedRect {
  x0: number;
  y0: number;
  size: number;
  radius: number;
}

/** Inclusive point-in-rounded-square test; every argument is in Q units. */
function insideRoundedRect(xQ: number, yQ: number, rect: RoundedRect): boolean {
  const { x0, y0, size, radius } = rect;
  if (xQ < x0 || xQ > x0 + size || yQ < y0 || yQ > y0 + size) {
    return false;
  }
  let dx = 0;
  if (xQ < x0 + radius) dx = x0 + radius - xQ;
  else if (xQ > x0 + size - radius) dx = xQ - (x0 + size - radius);
  let dy = 0;
  if (yQ < y0 + radius) dy = y0 + radius - yQ;
  else if (yQ > y0 + size - radius) dy = yQ - (y0 + size - radius);
  if (dx === 0 || dy === 0) {
    return true;
  }
  return dx * dx + dy * dy <= radius * radius;
}

function fillBlack(frame: RgbaRaster, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y < y1; y++) {
    let offset = (y * frame.width + x0) * 4;
    for (let x = x0; x < x1; x++) {
      frame.data[offset] = 0;
      frame.data[offset + 1] = 0;
      frame.data[offset + 2] = 0;
      frame.data[offset + 3] = 255;
      offset += 4;
    }
  }
}
