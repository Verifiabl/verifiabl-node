#!/usr/bin/env node

import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
      'import { encodeBase32 } from "@verifiabl/issuer"; if (encodeBase32(Buffer.from("f")) !== "MY") process.exit(1)',
    ],
    consumer,
  );
  run(
    process.execPath,
    [
      "--eval",
      'const { encodeBase32 } = require("@verifiabl/issuer"); if (encodeBase32(Buffer.from("f")) !== "MY") process.exit(1)',
    ],
    consumer,
  );

  const example = join(consumer, "self-managed-issuer");
  cpSync(new URL("../examples/self-managed-issuer", import.meta.url), example, { recursive: true });
  run("pnpm", ["install", "--frozen-lockfile", "--ignore-workspace"], example);
  run("pnpm", ["add", "--ignore-workspace", join(artifactDirectory, tarballs[0])], example);
  run("pnpm", ["build"], example);
  run(process.execPath, ["dist/app.js", "offline"], example);
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
