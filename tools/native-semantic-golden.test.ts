import { describe, expect, it } from "vitest";
import {
  parseManifest,
  preparedSemanticSha256,
} from "./native-semantic-golden";

describe("native semantic golden", () => {
  it("normalizes parser lineage and append-only compact-wire-v2 fields", () => {
    const base = {
      parser: { buildSha256: "a" },
      parserVersion: "a",
      demoSha256: "b",
    };
    expect(preparedSemanticSha256(base as never)).toBe(
      preparedSemanticSha256({
        ...base,
        parser: { buildSha256: "c" },
        parserVersion: "c",
      } as never),
    );
    expect(preparedSemanticSha256(base as never)).toBe(
      preparedSemanticSha256({
        ...base,
        sourcePerspective: "source-tv",
        recorderCommands: [],
        recorderCommandCoverage: { availability: "unavailable" },
      } as never),
    );
  });
  it("rejects incomplete and unknown-field manifests", () => {
    expect(() => parseManifest({ schemaVersion: 1 })).toThrow("fields");
    expect(() =>
      parseManifest({
        schemaVersion: 1,
        semanticContract: "x",
        provenance: {},
        demos: [],
        extra: true,
      }),
    ).toThrow("fields");
  });
});
