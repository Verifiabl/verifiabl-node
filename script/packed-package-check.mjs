#!/usr/bin/env node

import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const artifactDirectory = resolve(process.argv[2] ?? "package");
const tarballs = readdirSync(artifactDirectory).filter((name) => name.endsWith(".tgz"));
if (tarballs.length !== 1) {
  throw new Error(`Expected one package tarball in ${artifactDirectory}, found ${tarballs.length}`);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const consumer = mkdtempSync(join(tmpdir(), "verifiabl-node-package-"));
try {
  writeFileSync(join(consumer, "package.json"), '{"private":true}\n');
  run("pnpm", ["add", join(artifactDirectory, tarballs[0])], consumer);
  run(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      'import { generateVerifiablReference, australianPayFrequencies, australianEarningsTypes, newZealandLeaveBalanceUnits } from "@verifiabl/issuer"; if (generateVerifiablReference().length !== 22 || !australianPayFrequencies.includes("monthly") || !australianEarningsTypes.includes("paid_leave") || !newZealandLeaveBalanceUnits.includes("hours")) process.exit(1)',
    ],
    consumer,
  );
  run(
    process.execPath,
    [
      "--eval",
      'const { generateVerifiablReference, australianPayFrequencies, australianEarningsTypes, newZealandLeaveBalanceUnits } = require("@verifiabl/issuer"); if (generateVerifiablReference().length !== 22 || !australianPayFrequencies.includes("monthly") || !australianEarningsTypes.includes("paid_leave") || !newZealandLeaveBalanceUnits.includes("hours")) process.exit(1)',
    ],
    consumer,
  );

  const example = join(consumer, "self-managed-issuer");
  cpSync(new URL("../examples/self-managed-issuer", import.meta.url), example, { recursive: true });
  run("pnpm", ["install", "--frozen-lockfile", "--ignore-workspace"], example);
  run("pnpm", ["add", "--ignore-workspace", join(artifactDirectory, tarballs[0])], example);
  run("pnpm", ["build"], example);
  run(process.execPath, ["dist/app.js", "offline"], example);
  const [runDirectory] = readdirSync(join(example, "output"));
  assert.ok(runDirectory, "Offline example must produce a run directory");
  const manifest = (group, id) => JSON.parse(readFileSync(
    join(example, "output", runDirectory, group, id, "manifest.json"), "utf8"));
  for (const [id, schema, currency, gross, taxField, tax, net] of [
    ["PAY-1001", "au.payslip.v2", "AUD", "9000.00", "paygw", "2250.00", "6750.00"],
    ["PAY-1002", "nz.payslip.v2", "NZD", "7600.00", "paye", "1710.00", "5890.00"],
  ]) {
    const record = manifest("batch", id);
    const request = record.registrationRequest;
    assert.equal(record.verifiablReference, request.verifiablReference);
    assert.equal(readFileSync(
      join(example, "output", runDirectory, "batch", id, "xmp-payload.txt"), "utf8",
    ).startsWith(`2|${record.verifiablReference}|`), true);
    assert.ok(!JSON.stringify(record).includes(id === "PAY-1001" ? "Jane A. Doe" : "Zoë Nguyễn"));
    assert.equal(request.schema, schema);
    assert.deepEqual(request.payslipNonPii, {
      periodEnd: "2026-08-31",
      paymentDate: "2026-09-04",
      currency,
      gross,
      [taxField]: tax,
      net,
    });
  }
  const single = manifest("single", "PAY-1001").registrationRequest;
  assert.equal(single.schema, "au.payslip.v2");
  assert.deepEqual(single.payslipNonPii, manifest("batch", "PAY-1001").registrationRequest.payslipNonPii);
  assert.notEqual(single.encryptionMetadata.iv, manifest("batch", "PAY-1001").registrationRequest.encryptionMetadata.iv);
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
