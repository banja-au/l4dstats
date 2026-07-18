import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

type ContractModule = {
  probeNativeParser(
    path: string,
    options: { allowedRoot: string },
  ): Promise<{ version: Record<string, unknown> }>;
};
const contract = (await import(
  pathToFileURL(resolve("../../scripts/native-parser-contract.mjs")).href
)) as ContractModule;

// An explicit path marks a native build as integration-ready. Merely finding a
// developer's partial target artifact must not silently opt it into this gate.
const configuredStage = process.env.WITCHWATCH_NATIVE_STAGE;

describe("built Rust stage metadata", () => {
  it.skipIf(!configuredStage)(
    "matches the accepted ADR 0009 parser boundary",
    async () => {
      expect(existsSync(configuredStage!)).toBe(true);
      const result = await contract.probeNativeParser(configuredStage!, {
        allowedRoot: process.env.WITCHWATCH_NATIVE_ALLOWED_ROOT ?? "/workspace",
      });
      expect(result.version).toMatchObject({
        artifactSchemaVersion: 1,
        parser: "witchwatch-demo-source1-native",
        projectionSchema: "demo-projection/v1",
        protocol: "source1-l4d2-2100",
      });
    },
  );
});
