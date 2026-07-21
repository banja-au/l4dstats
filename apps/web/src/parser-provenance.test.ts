import { describe, expect, it } from "vitest";
import type { JobAnalysis } from "./api";
import { parserProvenanceLabel } from "./parser-provenance";

function analysis(
  parser: JobAnalysis["engineResult"]["demo"]["parser"],
): JobAnalysis {
  return {
    jobId: "job",
    demoSha256: "a".repeat(64),
    engineResultSha256: "b".repeat(64),
    engineResult: {
      schemaVersion: 1,
      demo: {
        sha256: "a".repeat(64),
        mapName: "map",
        bytes: 1,
        ...(parser ? { parser } : {}),
      },
      cases: [],
    },
  };
}

describe("analysis parser provenance", () => {
  it("labels zero-case native analyses", () => {
    expect(
      parserProvenanceLabel([
        analysis({
          engine: "rust-native",
          coreVersion: "0.1.0",
          bindingVersion: "0.1.0",
          bindingApiVersion: 2,
          configVersion: 2,
          wireVersion: 2,
          parserConfigId: "source1-l4d2-2100-v2",
          buildSha256: "abcdef12" + "0".repeat(56),
        }),
      ]),
    ).toBe("Rust native 0.1.0 · build abcdef12");
  });

  it("labels legacy and mixed analyses explicitly", () => {
    const legacy = analysis(undefined);
    expect(parserProvenanceLabel([legacy])).toContain("Legacy");
    expect(
      parserProvenanceLabel([
        legacy,
        analysis({
          engine: "rust-native",
          coreVersion: "0.1.0",
          bindingVersion: "0.1.0",
          bindingApiVersion: 2,
          configVersion: 2,
          wireVersion: 2,
          parserConfigId: "source1-l4d2-2100-v2",
          buildSha256: "abcdef12" + "0".repeat(56),
        }),
      ]),
    ).toContain("Mixed");
  });
});
