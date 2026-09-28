#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "generated", "api", "node.json");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with status ${result.status}`);
  }
}

function stableSymbolKey(symbol) {
  return JSON.stringify(symbol);
}

function stabilizeReflectionIds(reference) {
  if (!existsSync(output)) return reference;

  const baseline = JSON.parse(readFileSync(output, "utf8"));
  const baselineIdsBySymbol = new Map();
  for (const [id, symbol] of Object.entries(baseline.symbolIdMap ?? {})) {
    const key = stableSymbolKey(symbol);
    const ids = baselineIdsBySymbol.get(key) ?? [];
    ids.push(Number(id));
    baselineIdsBySymbol.set(key, ids);
  }

  const baselineIds = Object.keys(baseline.symbolIdMap ?? {}).map(Number);
  let nextId = baselineIds.length > 0 ? Math.max(...baselineIds) + 1 : 0;
  const symbolOccurrences = new Map();
  const remappedIds = new Map();
  for (const [id, symbol] of Object.entries(reference.symbolIdMap ?? {})) {
    const key = stableSymbolKey(symbol);
    const occurrence = symbolOccurrences.get(key) ?? 0;
    const baselineId = baselineIdsBySymbol.get(key)?.[occurrence];
    remappedIds.set(Number(id), baselineId ?? nextId++);
    symbolOccurrences.set(key, occurrence + 1);
  }

  function remapReferences(value) {
    if (Array.isArray(value)) {
      value.forEach(remapReferences);
      return;
    }
    if (value === null || typeof value !== "object") return;

    for (const [key, nested] of Object.entries(value)) {
      if ((key === "id" || key === "target") && Number.isInteger(nested) && remappedIds.has(nested)) {
        value[key] = remappedIds.get(nested);
      } else if (key === "children" && Array.isArray(nested) && nested.every(Number.isInteger)) {
        value[key] = nested.map((id) => remappedIds.get(id) ?? id);
      } else {
        remapReferences(nested);
      }
    }
  }

  remapReferences(reference);
  reference.symbolIdMap = Object.fromEntries(
    Object.entries(reference.symbolIdMap ?? {}).map(([id, symbol]) => [remappedIds.get(Number(id)), symbol]),
  );
  return reference;
}

function generate(destination) {
  run("pnpm", ["--dir", "docs", "exec", "typedoc", "--json", destination]);
  const reference = stabilizeReflectionIds(JSON.parse(readFileSync(destination, "utf8")));
  const names = (reference.children ?? []).map(({ name }) => name);

  const required = ["VerifiablClient", "createBarcodeSvg", "PiiValidationError"];
  const missing = required.filter((name) => !names.includes(name));
  if (missing.length > 0) {
    throw new Error(`Generated Node API reference is missing: ${missing.join(", ")}`);
  }

  const nonPublic = [
    "ciphertextSchema",
    "encodeBase32",
    "encryptPiiWithIv",
    "getBase32EncodedLength",
    "PII_FIELD_ORDER",
    "PII_PAYLOAD_MAX_BYTES",
    "PII_TEXT_PROFILE_ID",
    "PII_TEXT_PROFILE_UNICODE_VERSION",
    "piiFieldsSchema",
    "resolveEnvironment",
    "SCHEMA_RE",
    "verifiablReferenceSchema",
    "buildScanUrlParts",
    "parseFrameContainer",
    "FRAME_ASSETS_V1",
  ].filter((name) => names.includes(name));
  if (nonPublic.length > 0) {
    throw new Error(`Generated Node API reference exposes non-public APIs: ${nonPublic.join(", ")}`);
  }

  writeFileSync(destination, `${JSON.stringify(reference, null, "\t")}\n`);
}

const check = process.argv[2] === "--check";
if (process.argv.length > (check ? 3 : 2)) {
  console.error(`Usage: ${process.argv[1]} [--check]`);
  process.exit(2);
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), "verifiabl-node-api-"));
try {
  const freshOutput = join(temporaryDirectory, "node.json");
  generate(freshOutput);
  const reference = readFileSync(freshOutput);

  if (check) {
    if (!existsSync(output) || !readFileSync(output).equals(reference)) {
      console.error("Generated Node API reference is stale. Run: node script/api-reference.mjs");
      process.exitCode = 1;
    } else {
      console.log("Generated Node API reference is current.");
    }
  } else {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, reference);
    const count = JSON.parse(reference).children?.length ?? 0;
    console.log(`Generated Node API reference with ${count} public exports.`);
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
