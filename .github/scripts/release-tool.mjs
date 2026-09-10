#!/usr/bin/env node

import { appendFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const configPath = new URL("../release-target.json", import.meta.url);
const config = JSON.parse(readFileSync(configPath, "utf8"));
const targets = config.targets;
const releaseVersionPattern = new RegExp(config.versionPolicy.pattern);

function fail(message) {
  throw new Error(message);
}

function xmlElement(contents, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return contents.match(new RegExp(`<${escaped}>([^<]+)</${escaped}>`))?.[1];
}

function packageMetadata(package_) {
  const source = package_.versionSource;
  const contents = readFileSync(source.path, "utf8");
  if (source.kind === "json") {
    const value = JSON.parse(contents);
    return { id: value[source.packageIdProperty], version: value[source.versionProperty] };
  }
  if (source.kind === "xml") {
    return {
      id: xmlElement(contents, source.packageIdElement),
      version: xmlElement(contents, source.versionElement),
    };
  }
  return fail(`Unsupported version source kind: ${source.kind}`);
}

function validate(tag) {
  const target = targets.find((entry) => tag?.startsWith(entry.tags.publicPrefix));
  if (!target) {
    fail(`Release tag '${tag ?? ""}' does not match a configured release target`);
  }
  const version = tag.slice(target.tags.publicPrefix.length);
  if (!releaseVersionPattern.test(version)) fail(`Release tag '${tag}' does not contain a valid release SemVer version`);

  const versions = new Map();
  for (const package_ of target.packages) {
    const metadata = packageMetadata(package_);
    if (metadata.id !== package_.id) {
      fail(`${package_.versionSource.path} has package id '${metadata.id ?? ""}'; expected '${package_.id}'`);
    }
    if (metadata.version !== version) {
      fail(`${package_.versionSource.path} has version '${metadata.version ?? ""}'; tag requests '${version}'`);
    }
    versions.set(package_.id, metadata.version);
  }

  for (const group of target.coupledVersionGroups) {
    const values = new Set(group.map((packageId) => versions.get(packageId)));
    if (values.size !== 1) fail(`Coupled packages do not share one version: ${group.join(", ")}`);
  }

  if (process.env.GITHUB_ENV) {
    appendFileSync(process.env.GITHUB_ENV, `RELEASE_TARGET_ID=${target.id}\nVERSION=${version}\n`);
  }
  console.log(`Validated ${target.id} ${version} (${target.packages.map((entry) => entry.id).join(", ")})`);
  return version;
}

function pack(targetId, version) {
  const target = targets.find((entry) => entry.id === targetId);
  if (!target) fail(`Unknown release target: ${targetId ?? ""}`);
  if (!releaseVersionPattern.test(version ?? "")) fail("pack requires a validated release version");
  for (const command of target.packCommands) {
    const [executable, ...arguments_] = command.map((part) => part.replaceAll("{version}", version));
    console.log(`> ${[executable, ...arguments_].join(" ")}`);
    const result = spawnSync(executable, arguments_, { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

const [command, value, version] = process.argv.slice(2);
try {
  if (command === "validate") validate(value);
  else if (command === "pack") pack(value, version);
  else fail("Usage: release-tool.mjs <validate TAG|pack TARGET_ID VERSION>");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
