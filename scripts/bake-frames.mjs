// Bakes the payload-independent badge frame (border, header, wordmarks) into
// src/qr/frameAssets.generated.ts for the frame-blit PNG compositor.
//
// Rerun after any frame change in src/qr/styled.ts:
//
//   npm run build && node scripts/bake-frames.mjs
//
// The committed assets are covered by a freshness test, so a frame change
// without a re-bake fails CI rather than silently drifting the PNG output.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

import { Resvg } from "@resvg/resvg-js";

import { createBarcodeSvg } from "../dist/index.js";

const WIDTHS = [480, 720, 960, 1440];

// Any valid parts work: the frame is payload-independent, and this script
// verifies that by baking with two payloads and comparing the results.
const PARTS_A = {
  verifiablReference: "AbCdEfGhIjKlMnOpQrStUv",
  encryptedPii: "Ab3".repeat(80) + "Zz19-_",
};
const PARTS_B = {
  verifiablReference: "u0FE9WLIS7GYKQnpJPygBw",
  encryptedPii: "Xy9".repeat(40) + "Qq28-_",
};

/** The badge SVG minus its QR content: the two groups after the header. */
function frameOnlySvg(parts, width) {
  const { svg } = createBarcodeSvg(parts, { width });
  const crispIndex = svg.indexOf('<g shape-rendering="crispEdges">');
  if (crispIndex < 0) {
    throw new Error("badge SVG no longer contains the crispEdges QR group");
  }
  const qrGroupStart = svg.lastIndexOf("<g transform=", crispIndex);
  if (qrGroupStart < 0) {
    throw new Error("badge SVG no longer wraps the QR content in a translate group");
  }
  return `${svg.slice(0, qrGroupStart)}</svg>`;
}

/** resvg pixels are premultiplied; PNG and the compositor use straight alpha. */
function unpremultiply(data) {
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3];
    if (alpha === 255 || alpha === 0) {
      if (alpha === 0) {
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 0;
      }
      continue;
    }
    for (let channel = 0; channel < 3; channel++) {
      data[offset + channel] = Math.min(255, Math.round((data[offset + channel] * 255) / alpha));
    }
  }
  return data;
}

function renderFrame(parts, width) {
  const rendered = new Resvg(frameOnlySvg(parts, width), {
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: false },
  }).render();
  return {
    width: rendered.width,
    height: rendered.height,
    data: unpremultiply(Buffer.from(rendered.pixels)),
  };
}

/** The QR box must be uniform white: the compositor blits onto it directly. */
function assertQrBoxWhite(frame, badgeWidth) {
  const x0 = Math.ceil((8 * badgeWidth) / 96);
  const x1 = Math.floor((88 * badgeWidth) / 96);
  const y0 = Math.ceil((59 * badgeWidth) / 96);
  const y1 = Math.floor((139 * badgeWidth) / 96);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * frame.width + x) * 4;
      if (frame.data.readUInt32BE(i) !== 0xffffffff) {
        throw new Error(`frame at width ${badgeWidth} is not white at ${x},${y}`);
      }
    }
  }
}

/** VFR1: magic, u16 width/height/paletteCount, RGBA palette, u32 + raw-deflated indices. */
function encodeContainer(frame) {
  const pixelCount = frame.width * frame.height;
  const paletteMap = new Map();
  const paletteRgba = [];
  const indices = Buffer.alloc(pixelCount);
  for (let p = 0; p < pixelCount; p++) {
    const key = frame.data.readUInt32BE(p * 4);
    let index = paletteMap.get(key);
    if (index === undefined) {
      index = paletteMap.size;
      if (index > 255) {
        throw new Error("frame exceeds 256 colours; the palette container cannot hold it");
      }
      paletteMap.set(key, index);
      paletteRgba.push(
        frame.data[p * 4],
        frame.data[p * 4 + 1],
        frame.data[p * 4 + 2],
        frame.data[p * 4 + 3],
      );
    }
    indices[p] = index;
  }

  const deflated = deflateRawSync(indices, { level: 9 });
  const header = Buffer.alloc(4 + 2 + 2 + 2);
  header.write("VFR1", 0, "ascii");
  header.writeUInt16BE(frame.width, 4);
  header.writeUInt16BE(frame.height, 6);
  header.writeUInt16BE(paletteMap.size, 8);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(deflated.length, 0);
  return Buffer.concat([header, Buffer.from(paletteRgba), length, deflated]);
}

const entries = [];
for (const width of WIDTHS) {
  const frame = renderFrame(PARTS_A, width);
  assertQrBoxWhite(frame, width);
  const container = encodeContainer(frame);

  const check = encodeContainer(renderFrame(PARTS_B, width));
  if (Buffer.compare(container, check) !== 0) {
    throw new Error(`frame at width ${width} is not payload-independent`);
  }

  entries.push({ width, height: frame.height, base64: container.toString("base64") });
  console.log(
    `baked ${width}x${frame.height}: ${(container.length / 1024).toFixed(1)} KB, ` +
      `${new Set(entries.map((e) => e.width)).size}/${WIDTHS.length}`,
  );
}

const widthsUnion = WIDTHS.join(" | ");
const body = entries.map((e) => `  ${e.width}: "${e.base64}",`).join("\n");
const source = `// Generated by scripts/bake-frames.mjs - do not edit by hand.
// Payload-independent badge frame rasters (VFR1 containers: RGBA palette plus
// raw-deflated indices), baked from the SVG renderer via resvg at each
// supported PNG pixel width. Covered by a freshness test against the live SVG.
export const FRAME_ASSETS_V1: Readonly<Record<${widthsUnion}, string>> = {
${body}
};
`;

const outPath = join(dirname(fileURLToPath(import.meta.url)), "../src/qr/frameAssets.generated.ts");
writeFileSync(outPath, source);
console.log(`wrote ${outPath}`);
