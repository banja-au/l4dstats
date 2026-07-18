#!/usr/bin/env node

import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const SHA256 = /^[a-f0-9]{64}$/;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/;

export async function discoverNativeParser(configuredPath, options = {}) {
  if (!configuredPath)
    throw new Error("native parser path must be configured explicitly");
  if (!isAbsolute(configuredPath))
    throw new Error("native parser path must be absolute");
  const canonical = await realpath(configuredPath).catch(() => {
    throw new Error("native parser executable does not exist");
  });
  const allowedRoot = await realpath(options.allowedRoot ?? "/workspace");
  const relative = canonical.slice(allowedRoot.length);
  if (
    canonical !== allowedRoot &&
    (!canonical.startsWith(allowedRoot) || !relative.startsWith("/"))
  )
    throw new Error(
      "native parser executable resolves outside its allowed root",
    );
  const metadata = await stat(canonical);
  if (!metadata.isFile()) throw new Error("native parser path is not a file");
  await access(canonical, constants.X_OK).catch(() => {
    throw new Error("native parser file is not executable");
  });
  return canonical;
}

export function validateNativeParserVersion(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("native parser returned invalid version metadata");
  const expectedKeys = [
    "artifactSchemaVersion",
    "buildSha256",
    "parser",
    "projectionSchema",
    "protocol",
    "version",
  ];
  if (
    Object.keys(value).sort().join("\n") !== expectedKeys.join("\n") ||
    value.artifactSchemaVersion !== 1 ||
    value.parser !== "witchwatch-demo-source1-native" ||
    !VERSION.test(value.version) ||
    value.protocol !== "source1-l4d2-2100" ||
    value.projectionSchema !== "demo-projection/v1" ||
    !SHA256.test(value.buildSha256)
  )
    throw new Error("native parser returned invalid version metadata");
  return Object.freeze({ ...value });
}

export async function probeNativeParser(configuredPath, options = {}) {
  const executable = await discoverNativeParser(configuredPath, options);
  const result = await execute(executable, ["--version-json"], {
    cwd: options.cwd ?? "/workspace",
    env: {},
    encoding: "utf8",
    timeout: options.timeoutMs ?? 2_000,
    maxBuffer: options.maxOutputBytes ?? 16 * 1024,
  });
  if (result.stderr !== "")
    throw new Error("native parser version probe wrote to stderr");
  let decoded;
  try {
    decoded = JSON.parse(result.stdout);
  } catch {
    throw new Error("native parser version probe returned invalid JSON");
  }
  return { executable, version: validateNativeParserVersion(decoded) };
}

/**
 * Resolve an explicitly configured native artifact for build/test integration.
 * Optional developer builds may omit it; production callers must set required.
 * Deliberately never searches PATH or target/ because those are ambiguous inputs.
 */
export async function resolveNativeParserForBuild(options = {}) {
  const configuredPath = options.configuredPath;
  if (!configuredPath) {
    if (options.required)
      throw new Error("required native parser artifact is not configured");
    return undefined;
  }
  return probeNativeParser(configuredPath, options);
}

export async function probeNativeParserThroughLauncher(
  configuredPath,
  launcherPath,
  options = {},
) {
  const executable = await discoverNativeParser(configuredPath, options);
  const launcher = await discoverNativeParser(launcherPath, {
    allowedRoot: options.launcherAllowedRoot ?? options.allowedRoot,
  });
  const result = await execute(launcher, [executable, "--version-json"], {
    cwd: options.cwd ?? "/workspace",
    env: {},
    encoding: "utf8",
    timeout: options.timeoutMs ?? 2_000,
    maxBuffer: options.maxOutputBytes ?? 16 * 1024,
  });
  if (result.stderr !== "")
    throw new Error("sandboxed native parser version probe wrote to stderr");
  let decoded;
  try {
    decoded = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      "sandboxed native parser version probe returned invalid JSON",
    );
  }
  return {
    executable,
    launcher,
    version: validateNativeParserVersion(decoded),
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  const [command, configuredPath, allowedRoot] = process.argv.slice(2);
  if (command !== "probe" || !configuredPath)
    throw new Error(
      "Usage: native-parser-contract.mjs probe <absolute-executable> [allowed-root]",
    );
  process.stdout.write(
    `${JSON.stringify(
      await probeNativeParser(configuredPath, {
        ...(allowedRoot ? { allowedRoot } : {}),
      }),
    )}\n`,
  );
}
