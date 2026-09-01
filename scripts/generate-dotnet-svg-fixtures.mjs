// Generates the SVG parity fixtures consumed by verifiabl-dotnet's
// NodeSdkParityTests. The .NET SDK string-compares its rendered SVG against
// these, so the fixtures are the cross-SDK contract for SVG output.
//
//   npm run build && node scripts/generate-dotnet-svg-fixtures.mjs <fixturesDir>
//
// Companion to generate-dotnet-png-fixtures.mjs, which covers the raster side.
// Same reference/ciphertext as the PNG parity fixtures.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { createBarcodeSvg } from "../dist/index.js";

const outDir = process.argv[2];
if (!outDir) {
  throw new Error("usage: node scripts/generate-dotnet-svg-fixtures.mjs <fixturesDir>");
}

const PARTS = {
  verifiablReference: "u0FE9WLIS7GYKQnpJPygBw",
  encryptedPii: "Ab3".repeat(80) + "Zz19-w",
};

const CASES = [
  { name: "default-480", options: { format: "v2" } },
  {
    name: "sandbox-q-720",
    options: { format: "v2", environment: "sandbox", maxErrorCorrection: "Q", width: 720 },
  },
  { name: "v1-default-480", options: { format: "v1" } },
];

const meta = {};
for (const { name, options } of CASES) {
  const result = createBarcodeSvg(PARTS, options);
  writeFileSync(join(outDir, `node-svg-${name}.svg`), result.svg);
  meta[name] = {
    width: result.width,
    height: result.height,
    content: result.content,
    errorCorrectionLevel: result.errorCorrectionLevel,
    modulePx: result.modulePx,
    degraded: result.degraded,
  };
}

// No trailing newline: the .NET parity test reads these with ReadAllText and
// compares exactly, so the committed shape is the contract.
writeFileSync(join(outDir, "node-svg-meta.json"), JSON.stringify(meta, null, 2));
console.log(`wrote ${CASES.length} SVG fixtures + meta to ${outDir}`);
