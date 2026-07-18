import {
  chmod,
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

type ContractModule = {
  discoverNativeParser(
    path: string | undefined,
    options?: { allowedRoot?: string },
  ): Promise<string>;
  probeNativeParser(
    path: string,
    options?: { allowedRoot?: string; cwd?: string },
  ): Promise<{ executable: string; version: Record<string, unknown> }>;
  resolveNativeParserForBuild(options?: {
    configuredPath?: string;
    required?: boolean;
    allowedRoot?: string;
  }): Promise<
    { executable: string; version: Record<string, unknown> } | undefined
  >;
  probeNativeParserThroughLauncher(
    path: string,
    launcher: string,
    options?: {
      allowedRoot?: string;
      launcherAllowedRoot?: string;
      cwd?: string;
    },
  ): Promise<{
    executable: string;
    launcher: string;
    version: Record<string, unknown>;
  }>;
};

const contract = (await import(
  pathToFileURL(resolve("../../scripts/native-parser-contract.mjs")).href
)) as ContractModule;
const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture(body: string) {
  const root = await mkdtemp(join(tmpdir(), "native-parser-contract-"));
  cleanup.push(root);
  const executable = join(root, "witchwatch-demo-source1-native");
  await writeFile(executable, `#!/bin/sh\n${body}\n`);
  await chmod(executable, 0o755);
  return { root, executable };
}

describe("native parser executable contract", () => {
  it("requires explicit absolute discovery beneath the configured root", async () => {
    await expect(contract.discoverNativeParser(undefined)).rejects.toThrow(
      "configured explicitly",
    );
    await expect(
      contract.discoverNativeParser("relative/parser"),
    ).rejects.toThrow("must be absolute");
    const { root, executable } = await fixture("exit 0");
    await expect(
      contract.discoverNativeParser(executable, { allowedRoot: root }),
    ).resolves.toBe(executable);
  });

  it("rejects symlink escapes and non-executable artifacts", async () => {
    const allowed = await mkdtemp(join(tmpdir(), "native-parser-allowed-"));
    cleanup.push(allowed);
    const outside = await fixture("exit 0");
    const link = join(allowed, "parser");
    await symlink(outside.executable, link);
    await expect(
      contract.discoverNativeParser(link, { allowedRoot: allowed }),
    ).rejects.toThrow("outside its allowed root");

    const nested = join(allowed, "bin");
    await mkdir(nested);
    const inert = join(nested, "parser");
    await writeFile(inert, "not executable");
    await expect(
      contract.discoverNativeParser(inert, { allowedRoot: allowed }),
    ).rejects.toThrow("not executable");
  });

  it("accepts strict deterministic version and provenance metadata", async () => {
    const metadata = {
      artifactSchemaVersion: 1,
      buildSha256: "a".repeat(64),
      parser: "witchwatch-demo-source1-native",
      projectionSchema: "demo-projection/v1",
      protocol: "source1-l4d2-2100",
      version: "0.1.0",
    };
    const { root, executable } = await fixture(
      `printf '%s' '${JSON.stringify(metadata)}'`,
    );
    await expect(
      contract.probeNativeParser(executable, { allowedRoot: root, cwd: root }),
    ).resolves.toEqual({ executable, version: metadata });
  });

  it("rejects noisy, malformed, or incomplete provenance", async () => {
    const noisy = await fixture("echo noise >&2; printf '{}'");
    await expect(
      contract.probeNativeParser(noisy.executable, {
        allowedRoot: noisy.root,
        cwd: noisy.root,
      }),
    ).rejects.toThrow("wrote to stderr");
    const malformed = await fixture("printf 'not-json'");
    await expect(
      contract.probeNativeParser(malformed.executable, {
        allowedRoot: malformed.root,
        cwd: malformed.root,
      }),
    ).rejects.toThrow("invalid JSON");
    const incomplete = await fixture("printf '{}'");
    await expect(
      contract.probeNativeParser(incomplete.executable, {
        allowedRoot: incomplete.root,
        cwd: incomplete.root,
      }),
    ).rejects.toThrow("invalid version metadata");
  });

  it("skips only optional non-native builds and fails closed when required", async () => {
    await expect(
      contract.resolveNativeParserForBuild(),
    ).resolves.toBeUndefined();
    await expect(
      contract.resolveNativeParserForBuild({ required: true }),
    ).rejects.toThrow("required native parser artifact is not configured");
  });

  it("validates metadata through an executable sandbox launcher", async () => {
    const metadata = {
      artifactSchemaVersion: 1,
      buildSha256: "b".repeat(64),
      parser: "witchwatch-demo-source1-native",
      projectionSchema: "demo-projection/v1",
      protocol: "source1-l4d2-2100",
      version: "0.1.0",
    };
    const native = await fixture(`printf '%s' '${JSON.stringify(metadata)}'`);
    const launcher = join(native.root, "sandbox-launcher");
    await writeFile(launcher, '#!/bin/sh\nexec "$@"\n');
    await chmod(launcher, 0o755);
    await expect(
      contract.probeNativeParserThroughLauncher(native.executable, launcher, {
        allowedRoot: native.root,
        launcherAllowedRoot: native.root,
        cwd: native.root,
      }),
    ).resolves.toEqual({
      executable: native.executable,
      launcher,
      version: metadata,
    });
  });
});
