/**
 * Raw RGBA raster helpers for the PNG path.
 *
 * resvg's `render().pixels` are **premultiplied** 8-bit RGBA (verified: a 50%
 * red renders as [128,0,0,128], not [255,0,0,128]). Compositing is therefore
 * done in premultiplied space — the standard, division-free "over" operator —
 * and the result is unpremultiplied once before PNG encoding, because PNG
 * stores straight (non-premultiplied) alpha. This is exactly what resvg's own
 * `asPng()` does, so the composited output matches a single-document render.
 */

/** Decoded straight-alpha RGBA image: `data` is `width * height * 4` bytes. */
export interface RgbaRaster {
  data: Buffer;
  width: number;
  height: number;
}

function assertRaster(raster: RgbaRaster, name: string): void {
  if (!Buffer.isBuffer(raster.data)) {
    throw new Error(`${name}.data must be a Buffer`);
  }
  if (!Number.isInteger(raster.width) || raster.width <= 0) {
    throw new Error(`${name}.width must be a positive integer`);
  }
  if (!Number.isInteger(raster.height) || raster.height <= 0) {
    throw new Error(`${name}.height must be a positive integer`);
  }
  if (raster.data.length !== raster.width * raster.height * 4) {
    throw new Error(
      `${name}.data length ${raster.data.length} does not match ${raster.width}x${raster.height} RGBA`,
    );
  }
}

/**
 * Composite the premultiplied QR layer over the premultiplied frame, in place,
 * and return the frame raster.
 *
 * Premultiplied "source over": out = src + dst * (1 - srcAlpha). Where the QR
 * is transparent the frame shows through; where opaque the QR wins; finder
 * edges blend. Both layers must share dimensions (rendered from the same SVG
 * coordinate system at the same fitTo width) and both must be premultiplied
 * (resvg `.pixels`).
 *
 * The `frame` buffer is mutated. Callers pass a clone of the cached frame so the
 * cache itself is never modified. The result is still premultiplied; call
 * {@link unpremultiplyInPlace} before encoding to PNG.
 */
export function compositeQrOverFrame(frame: RgbaRaster, qr: RgbaRaster): RgbaRaster {
  assertRaster(frame, "frame");
  assertRaster(qr, "qr");
  if (frame.width !== qr.width || frame.height !== qr.height) {
    throw new Error(
      `frame (${frame.width}x${frame.height}) and qr (${qr.width}x${qr.height}) must match`,
    );
  }

  const f = frame.data;
  const q = qr.data;
  // `?? 0` only satisfies noUncheckedIndexedAccess; i is always in range here.
  for (let i = 0; i < q.length; i += 4) {
    const sa = q[i + 3] ?? 0;
    if (sa === 0) {
      continue; // QR fully transparent here: keep the frame pixel.
    }
    if (sa === 255) {
      f[i] = q[i] ?? 0;
      f[i + 1] = q[i + 1] ?? 0;
      f[i + 2] = q[i + 2] ?? 0;
      f[i + 3] = 255;
      continue;
    }
    // Partial coverage (finder anti-aliasing). Premultiplied source-over.
    const keep = 1 - sa / 255;
    f[i] = Math.round((q[i] ?? 0) + (f[i] ?? 0) * keep);
    f[i + 1] = Math.round((q[i + 1] ?? 0) + (f[i + 1] ?? 0) * keep);
    f[i + 2] = Math.round((q[i + 2] ?? 0) + (f[i + 2] ?? 0) * keep);
    f[i + 3] = Math.round(sa + (f[i + 3] ?? 0) * keep);
  }
  return frame;
}

/**
 * Convert a premultiplied RGBA raster to straight (non-premultiplied) alpha in
 * place, as PNG requires. Fully-opaque and fully-transparent pixels are
 * unchanged in practice (transparent collapses to 0,0,0,0); only anti-aliased
 * edges are scaled back up. Matches resvg's own `asPng()` conversion.
 */
export function unpremultiplyInPlace(raster: RgbaRaster): RgbaRaster {
  assertRaster(raster, "raster");
  const d = raster.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] ?? 0;
    if (a === 0) {
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
      continue;
    }
    if (a === 255) {
      continue;
    }
    d[i] = Math.min(255, Math.round(((d[i] ?? 0) * 255) / a));
    d[i + 1] = Math.min(255, Math.round(((d[i + 1] ?? 0) * 255) / a));
    d[i + 2] = Math.min(255, Math.round(((d[i + 2] ?? 0) * 255) / a));
  }
  return raster;
}
