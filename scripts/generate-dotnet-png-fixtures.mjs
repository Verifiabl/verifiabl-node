// Generates the PNG raster parity fixtures consumed by verifiabl-dotnet's
// NodeSdkParityTests. The .NET SDK byte-compares its composited raster against
// these, so the fixtures are the cross-SDK contract for PNG output.
//
//   npm run build && node scripts/generate-dotnet-png-fixtures.mjs <fixturesDir>
//
// Fixture format: raw-deflated straight-alpha RGBA, row-major; metadata in
// node-png-meta.json. Same reference/ciphertext as the SVG parity fixtures.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";

import { PNG } from "pngjs";

import { createBarcodePng } from "../dist/index.js";

const outDir = process.argv[2];
if (!outDir) {
  throw new Error("usage: node scripts/generate-dotnet-png-fixtures.mjs <fixturesDir>");
}

const PARTS = {
  verifiablReference: "u0FE9WLIS7GYKQnpJPygBw",
  encryptedPii: "Ab3".repeat(80) + "Zz19-_",
};

const CASES = [
  { name: "png-default-720", options: {}, pixelWidth: 720 },
  {
    name: "png-sandbox-q-480",
    options: { environment: "sandbox", maxErrorCorrection: "Q" },
    pixelWidth: 480,
  },
  { name: "png-default-1440", options: {}, pixelWidth: 1440 },
];

const meta = {};
for (const { name, options, pixelWidth } of CASES) {
  const result = await createBarcodePng(PARTS, options, pixelWidth);
  // The palette PNG is lossless, so decoding recovers the exact raster the
  // compositor produced.
  const raster = PNG.sync.read(result.png);
  if (raster.width !== result.width || raster.height !== result.height) {
    throw new Error(`decode mismatch for ${name}`);
  }
  writeFileSync(join(outDir, `node-${name}.rgba.deflate`), deflateRawSync(raster.data, { level: 9 }));
  meta[name] = {
    width: result.width,
    height: result.height,
    content: result.content,
    errorCorrectionLevel: result.errorCorrectionLevel,
    modulePx: result.modulePx,
    degraded: result.degraded,
  };
  console.log(`wrote node-${name}.rgba.deflate (${raster.width}x${raster.height})`);
}

writeFileSync(join(outDir, "node-png-meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
console.log("wrote node-png-meta.json");
