#!/usr/bin/env node
import { createCipheriv, createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import jsQR from "jsqr";
import {
  buildBarcodePayload,
  createBarcodePng,
  createBarcodeSvg,
  formatPii,
  PiiValidationError,
} from "../dist/index.js";

const DEFAULT_OUT = "artifacts/qr-stress";
const ENVIRONMENT = "sandbox";
const SYNTHETIC_KEY = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
const BADGE_MM = [19, 22, 25, 28];
const DEFAULT_DIGITAL_DPI = [300];
const FULL_DIGITAL_DPI = [150, 200, 300, 600];
const ADDRESS_LENGTHS = [0, 32, 80, 120, 160, 200, 240, 280, 320, 321];
const ADDRESS_SCRIPTS = ["ascii", "latin", "cjk", "mixed"];
const DENSITY_PROFILES = ["minimal", "representative", "long-fields", "dense-fields"];
const PNG_PIXEL_WIDTH = 720;

const args = parseArgs(process.argv.slice(2));
const outputDirectory = path.resolve(args.out ?? DEFAULT_OUT);
const digitalDpi = args.full ? FULL_DIGITAL_DPI : DEFAULT_DIGITAL_DPI;
const eccCeilings = args.includeQ ? ["M", "Q"] : ["M"];
const sdkVersion = await packageVersion();

if (!args.force) {
  await assertMissing(outputDirectory);
}
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(path.join(outputDirectory, "representative"), { recursive: true });

const startedAt = new Date().toISOString();
const fixtures = buildFixtures();
const results = [];
const decodeRows = [];
const failures = [];
const representativeAssets = [];

for (const fixture of fixtures) {
  const row = await runFixture(fixture);
  results.push(row);
  if (row.status !== "rendered") failures.push(row);
}

await writeOutputs();
console.log(`Wrote ${results.length} QR stress fixture results to ${outputDirectory}`);
console.log(`Rendered: ${results.filter((row) => row.status === "rendered").length}`);
console.log(`Expected oversized rejects: ${results.filter((row) => row.status === "expected-reject").length}`);
console.log(`Render failures: ${results.filter((row) => row.status === "render-failed").length}`);
console.log(`Decode failures: ${decodeRows.filter((row) => !row.decoded).length}/${decodeRows.length}`);

function parseArgs(argv) {
  const parsed = { force: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--force") {
      parsed.force = true;
    } else if (arg === "--full") {
      parsed.full = true;
    } else if (arg === "--include-q") {
      parsed.includeQ = true;
    } else if (arg === "--out") {
      const value = argv[++index];
      if (!value) throw new Error("--out requires a directory");
      parsed.out = value;
    } else if (arg === "--help" || arg === "-h") {
      printHelpAndExit();
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function printHelpAndExit() {
  console.log(`Usage: npm run qr-stress -- [--out artifacts/qr-stress] [--force]\n\nGenerates a synthetic QR stress corpus, digitally decodes each rendered QR at\n19/22/25/28mm and 300 DPI, and writes manifest/results/summary files. Pass\n--full to add 150/200/600 DPI and --include-q to add an ECC Q ceiling run.\nRun npm run build first if invoking this script directly.`);
  process.exit(0);
}

async function assertMissing(directory) {
  try {
    await mkdir(directory, { recursive: false });
    await rm(directory, { recursive: true, force: true });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`Output path already exists: ${directory}. Pass --force to replace it.`);
    }
    throw error;
  }
}

function buildFixtures() {
  const fixtures = [];
  for (const addressBytes of ADDRESS_LENGTHS) {
    const scripts = addressBytes === 0 ? ["none"] : ADDRESS_SCRIPTS;
    for (const addressScript of scripts) {
      for (const density of DENSITY_PROFILES) {
        for (const maxErrorCorrection of eccCeilings) {
          fixtures.push({
            id: ["p2", density, addressScript, `addr-${addressBytes}`, `ecc-${maxErrorCorrection}`].join("-"),
            format: "v2",
            density,
            addressScript,
            addressBytes,
            maxErrorCorrection,
            fields: fieldsFor(density, addressBytes, addressScript),
          });
        }
      }
    }
  }
  return fixtures;
}

function fieldsFor(density, addressBytes, addressScript) {
  const address = addressBytes === 0 ? undefined : exactUtf8String(addressBytes, addressScript);
  if (density === "minimal") {
    return { employeeName: "Ava Example", address };
  }
  if (density === "representative") {
    return {
      employeeName: "Zoë Nguyễn",
      position: "Senior Registered Nurse",
      department: "Emergency Department",
      employerAbn: "53-004-085-616",
      bsb: "062-000",
      accountNumber: "12345678",
      accountName: "Zoe Nguyen",
      address,
    };
  }
  if (density === "long-fields") {
    return {
      employeeName: "Dr Alexandra Catherine Example-Synthetic",
      position: "Principal International Payroll Systems Engineer",
      department: "Global Payroll Operations and Compliance",
      employerAbn: "53-004-085-616",
      bsb: "062-000",
      accountNumber: "12345678901234567890",
      accountName: "Alexandra Catherine Example Synthetic",
      address,
    };
  }
  if (density === "dense-fields") {
    return {
      employeeName: repeatToLength("Alexandra Example ", 128),
      position: repeatToLength("Principal Payroll Systems Engineer ", 180),
      department: repeatToLength("International Payroll Compliance Operations ", 180),
      employerAbn: "53-004-085-616",
      bsb: "062-000",
      accountNumber: repeatToLength("1234567890", 80),
      accountName: repeatToLength("Alexandra Catherine Example Synthetic ", 180),
      address,
    };
  }
  throw new Error(`Unknown density profile: ${density}`);
}

function repeatToLength(seed, length) {
  return seed.repeat(Math.ceil(length / seed.length)).slice(0, length);
}

function exactUtf8String(bytes, script) {
  const chunks = {
    ascii: ["A"],
    latin: ["é", "ø", "A"],
    cjk: ["東", "京", "A"],
    mixed: ["é", "東", "A", "ø", "京", "Ж", "한"],
  }[script];
  if (!chunks) throw new Error(`Unknown address script: ${script}`);

  let remaining = bytes;
  let output = "";
  while (remaining > 0) {
    const next = chunks.find((chunk) => Buffer.byteLength(chunk, "utf8") <= remaining);
    if (!next) throw new Error(`Cannot generate ${bytes} bytes for ${script}`);
    output += next;
    remaining -= Buffer.byteLength(next, "utf8");
  }
  if (Buffer.byteLength(output, "utf8") !== bytes) {
    throw new Error(`Address byte mismatch for ${script}/${bytes}`);
  }
  return output;
}

async function runFixture(fixture) {
  const base = {
    fixtureId: fixture.id,
    sdk: "node",
    sdkVersion,
    environment: ENVIRONMENT,
    format: fixture.format,
    density: fixture.density,
    addressScript: fixture.addressScript,
    addressUtf8Bytes: fixture.addressBytes,
    maxErrorCorrection: fixture.maxErrorCorrection,
  };

  let plaintext;
  try {
    plaintext = formatPii(fixture.fields);
  } catch (error) {
    const expectedOversized = fixture.addressBytes > 320 && isPiiValidationError(error);
    return {
      ...base,
      status: expectedOversized ? "expected-reject" : "format-failed",
      expectedFailure: expectedOversized,
      failureStage: "formatPii",
      failureMessage: sanitiseError(error),
    };
  }

  const encrypted = encryptDeterministically(plaintext, fixture.id);
  const parts = {
    verifiablReference: referenceFor(fixture.id),
    encryptedPii: encrypted.encryptedPii,
  };

  try {
    const svgResult = createBarcodeSvg(parts, {
      environment: ENVIRONMENT,
      format: fixture.format,
      maxErrorCorrection: fixture.maxErrorCorrection,
    });
    const pngResult = await createBarcodePng(
      parts,
      {
        environment: ENVIRONMENT,
        format: fixture.format,
        maxErrorCorrection: fixture.maxErrorCorrection,
      },
      PNG_PIXEL_WIDTH,
    );
    const payload = buildBarcodePayload(parts, { format: fixture.format });
    const moduleCount = 17 + svgResult.qrVersion * 4;
    const result = {
      ...base,
      status: "rendered",
      expectedFailure: false,
      verifiablReference: parts.verifiablReference,
      plaintextUtf8Bytes: Buffer.byteLength(plaintext, "utf8"),
      ciphertextByteLength: Buffer.from(encrypted.encryptedPii, "base64url").length,
      ciphertextTextLength: encrypted.encryptedPii.length,
      encodedUrlLength: Buffer.byteLength(svgResult.content, "utf8"),
      xmpPayloadLength: Buffer.byteLength(payload, "utf8"),
      qrVersion: svgResult.qrVersion,
      moduleCount,
      errorCorrectionLevel: svgResult.errorCorrectionLevel,
      degraded: svgResult.degraded,
      svgWidth: svgResult.width,
      svgHeight: svgResult.height,
      svgModulePx: svgResult.modulePx,
      pngWidth: pngResult.width,
      pngHeight: pngResult.height,
      pngQrVersion: pngResult.qrVersion,
      pngModulePx: pngResult.modulePx,
      scanUrl: svgResult.content,
      xmpPayload: payload,
      encryptionMetadata: encrypted.encryptionMetadata,
    };

    await runDecodeMatrix(result, svgResult.svg);
    if (isRepresentative(result)) {
      const basename = safeFilename(result.fixtureId);
      await writeFile(path.join(outputDirectory, "representative", `${basename}.svg`), svgResult.svg);
      await writeFile(path.join(outputDirectory, "representative", `${basename}.png`), pngResult.png);
      representativeAssets.push({ fixtureId: result.fixtureId, svg: `${basename}.svg`, png: `${basename}.png` });
    }
    return result;
  } catch (error) {
    return {
      ...base,
      status: "render-failed",
      expectedFailure: false,
      plaintextUtf8Bytes: Buffer.byteLength(plaintext, "utf8"),
      ciphertextTextLength: encrypted.encryptedPii.length,
      failureStage: "render",
      failureMessage: sanitiseError(error),
    };
  }
}

async function packageVersion() {
  const packageJsonUrl = new URL("../package.json", import.meta.url);
  const packageJson = JSON.parse(await readText(packageJsonUrl));
  return packageJson.version;
}

async function readText(url) {
  const { readFile } = await import("node:fs/promises");
  return readFile(fileURLToPath(url), "utf8");
}

function isPiiValidationError(error) {
  return error instanceof PiiValidationError || error?.name === "PiiValidationError";
}

function encryptDeterministically(plaintext, fixtureId) {
  // Test-only deterministic IV for reproducibility. The fixture id is unique per
  // row, so this corpus never repeats an IV under the synthetic key. Production
  // encryption must use random IVs.
  const iv = createHash("sha256").update(fixtureId).digest().subarray(0, 12);
  const cipher = createCipheriv("aes-256-gcm", SYNTHETIC_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    encryptedPii: ciphertext.toString("base64url"),
    encryptionMetadata: {
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
    },
  };
}

function referenceFor(fixtureId) {
  return createHash("sha256").update(`reference:${fixtureId}`).digest().subarray(0, 16).toString("base64url");
}

async function runDecodeMatrix(result, svg) {
  for (const badgeMm of BADGE_MM) {
    for (const dpi of digitalDpi) {
      const rasterWidth = Math.round((badgeMm / 25.4) * dpi);
      let decoded = false;
      let decodedMatches = false;
      let message = "";
      try {
        const scanned = decodeSvg(svg, rasterWidth);
        decoded = true;
        decodedMatches = scanned === result.scanUrl;
        if (!decodedMatches) message = "decoded text did not match encoded scan URL";
      } catch (error) {
        message = sanitiseError(error);
      }
      decodeRows.push({
        fixtureId: result.fixtureId,
        density: result.density,
        addressScript: result.addressScript,
        addressUtf8Bytes: result.addressUtf8Bytes,
        maxErrorCorrection: result.maxErrorCorrection,
        errorCorrectionLevel: result.errorCorrectionLevel,
        degraded: result.degraded,
        qrVersion: result.qrVersion,
        moduleCount: result.moduleCount,
        encodedUrlLength: result.encodedUrlLength,
        badgeMm,
        dpi,
        rasterWidth,
        physicalModuleMm: round4(badgeMm * (result.svgModulePx / result.svgWidth)),
        decoded,
        decodedMatches,
        message,
      });
    }
  }
}

function decodeSvg(svg, rasterWidth) {
  const rendered = new Resvg(svg, { fitTo: { mode: "width", value: rasterWidth } }).render();
  const result = jsQR(new Uint8ClampedArray(rendered.pixels), rendered.width, rendered.height);
  if (!result) throw new Error(`QR code could not be decoded at ${rasterWidth}px`);
  return result.data;
}

function isRepresentative(result) {
  return (
    result.status === "rendered" &&
    result.maxErrorCorrection === "M" &&
    result.addressScript !== "latin" &&
    [0, 120, 240, 320].includes(result.addressUtf8Bytes) &&
    ["minimal", "representative", "dense-fields"].includes(result.density)
  );
}

function safeFilename(value) {
  return value.replace(/[^A-Za-z0-9._-]/g, "-");
}

function sanitiseError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function writeOutputs() {
  const manifest = {
    format: "verifiabl-qr-stress-v1",
    syntheticDataOnly: true,
    ciphertextDerivativesPersisted: false,
    generatedAt: startedAt,
    sdk: "node",
    environment: ENVIRONMENT,
    fixtureCount: results.length,
    renderedCount: results.filter((row) => row.status === "rendered").length,
    expectedRejectCount: results.filter((row) => row.status === "expected-reject").length,
    renderFailureCount: results.filter((row) => row.status === "render-failed").length,
    decodeAttemptCount: decodeRows.length,
    decodeFailureCount: decodeRows.filter((row) => !row.decodedMatches).length,
    representativeAssets,
    fixtures: results,
    decodeResults: decodeRows,
  };

  await writeFile(path.join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(outputDirectory, "results.csv"), csv(results));
  await writeFile(path.join(outputDirectory, "decode-results.csv"), csv(decodeRows));
  await writeFile(path.join(outputDirectory, "failures.json"), `${JSON.stringify(failures, null, 2)}\n`);
  await writeFile(path.join(outputDirectory, "summary.md"), renderSummary(manifest));
}

function csv(rows) {
  if (rows.length === 0) return "";
  const keys = Array.from(rows.reduce((set, row) => {
    for (const key of Object.keys(row)) set.add(key);
    return set;
  }, new Set()));
  return `${keys.join(",")}\n${rows.map((row) => keys.map((key) => csvCell(row[key])).join(",")).join("\n")}\n`;
}

function csvCell(value) {
  if (value === undefined || value === null) return "";
  const string = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

function renderSummary(manifest) {
  const rendered = results.filter((row) => row.status === "rendered");
  const decodeSummary = summariseDecodeRows();
  const thresholdRows = thresholdTable(decodeSummary);
  const qrRows = rendered
    .filter((row) => row.maxErrorCorrection === "M" && row.addressScript !== "latin")
    .sort((a, b) => a.addressUtf8Bytes - b.addressUtf8Bytes || a.density.localeCompare(b.density))
    .slice(0, 40)
    .map(
      (row) =>
        `| ${row.addressUtf8Bytes} | ${row.addressScript} | ${row.density} | ${row.errorCorrectionLevel} | ${row.qrVersion} | ${row.moduleCount} | ${row.encodedUrlLength} | ${row.degraded ? "yes" : "no"} |`,
    )
    .join("\n");

  const failedDecodeRows = decodeRows
    .filter((row) => !row.decodedMatches)
    .slice(0, 25)
    .map(
      (row) =>
        `| ${row.fixtureId} | ${row.badgeMm} | ${row.dpi} | ${row.rasterWidth} | ${row.physicalModuleMm} | ${row.message} |`,
    )
    .join("\n");

  return `# VER-523 QR stress summary\n\nSynthetic data only. Generated by the Node SDK stress harness. The manifest includes ciphertext-bearing scan URLs for representative/manual comparison; do not use customer data in this corpus. No ciphertext hashes or other derivatives are written.\n\n## Run metadata\n\n- Generated: ${manifest.generatedAt}\n- SDK: ${manifest.sdk} ${results[0]?.sdkVersion ?? "unknown"}\n- Environment: ${manifest.environment}\n- Fixtures: ${manifest.fixtureCount}\n- Rendered: ${manifest.renderedCount}\n- Expected oversized rejects: ${manifest.expectedRejectCount}\n- Render failures: ${manifest.renderFailureCount}\n- Decode attempts: ${manifest.decodeAttemptCount}\n- Decode failures/mismatches: ${manifest.decodeFailureCount}\n\n## Digital decode threshold by badge size\n\n${thresholdRows}\n\n## QR density sample at ECC ceiling M\n\n| Address bytes | Script | Density | ECC used | QR version | Modules | URL bytes | Degraded |\n| ---: | --- | --- | --- | ---: | ---: | ---: | --- |\n${qrRows || "| _none_ | | | | | | | |"}\n\n## First decode failures or mismatches\n\n| Fixture | Badge mm | DPI | Raster px | Module mm | Message |\n| --- | ---: | ---: | ---: | ---: | --- |\n${failedDecodeRows || "| _none_ | | | | | |"}\n\n## Notes for VER-373\n\nUse this output to decide whether the current 320-byte address cap, ECC policy, and physical badge sizes have enough margin. The Node SDK public API supports an M or Q ceiling; Low is only reached by the degradation ladder, not selected directly. A direct Low-vs-M manual matrix should be generated from the .NET ScannerPack or a follow-up SDK option if product wants Low as an explicit setting.\n\n## Representative assets\n\n${representativeAssets.map((asset) => `- ${asset.fixtureId}: representative/${asset.svg}, representative/${asset.png}`).join("\n") || "_none_"}\n`;
}

function summariseDecodeRows() {
  const grouped = new Map();
  for (const row of decodeRows) {
    const key = `${row.badgeMm}|${row.dpi}`;
    const current = grouped.get(key) ?? {
      badgeMm: row.badgeMm,
      dpi: row.dpi,
      attempts: 0,
      passes: 0,
      minModulePassMm: Number.POSITIVE_INFINITY,
      maxUrlPass: 0,
      maxQrVersionPass: 0,
    };
    current.attempts++;
    if (row.decodedMatches) {
      current.passes++;
      current.minModulePassMm = Math.min(current.minModulePassMm, row.physicalModuleMm);
      current.maxUrlPass = Math.max(current.maxUrlPass, row.encodedUrlLength);
      current.maxQrVersionPass = Math.max(current.maxQrVersionPass, row.qrVersion);
    }
    grouped.set(key, current);
  }
  return Array.from(grouped.values()).sort((a, b) => a.badgeMm - b.badgeMm || a.dpi - b.dpi);
}

function thresholdTable(summary) {
  const rows = summary.map((row) => {
    const minModule = Number.isFinite(row.minModulePassMm) ? round4(row.minModulePassMm) : "n/a";
    return `| ${row.badgeMm} | ${row.dpi} | ${row.passes}/${row.attempts} | ${minModule} | ${row.maxUrlPass} | ${row.maxQrVersionPass} |`;
  });
  return `| Badge mm | DPI | Passes | Smallest passing module mm | Largest passing URL bytes | Largest passing QR version |\n| ---: | ---: | ---: | ---: | ---: | ---: |\n${rows.join("\n")}`;
}

function round4(value) {
  return Math.round(value * 10_000) / 10_000;
}
