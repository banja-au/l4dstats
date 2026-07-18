import { describe, expect, it } from "vitest";
import {
  createMapCatalog,
  mapExtractorVersion,
  steamBuildIdFromManifest,
  type SourceMapArtifact,
} from "./artifact.js";

const artifact: SourceMapArtifact = {
  format: "witchwatch-map-mesh-v1",
  bspVersion: 21,
  mapRevision: 12,
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  indices: [0, 1, 2],
  triangleZ: [0],
  bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 } },
  coverage: {
    worldFaces: 1,
    emittedFaces: 1,
    emittedTriangles: 1,
    skippedToolFaces: 0,
    skippedDisplacements: 0,
    emittedDisplacements: 0,
    rejectedFaces: 0,
    staticProps: "unavailable",
    dynamicState: "unavailable",
    compression: {
      codec: "valve-source-lzma1",
      decoder: "@napi-rs/lzma@1.5.1",
      decodedLumps: [],
      decodedBytes: 0,
    },
  },
  provenance: {
    map: "c4m1_milltown_a",
    sourceBspSha256: "a".repeat(64),
    sourceBytes: 4096,
    sourceKind: "steam-dedicated-server",
    steamAppId: 222860,
    steamBuildId: "12345678",
    extractor: mapExtractorVersion,
  },
};

describe("map artifact provenance", () => {
  it("reads the numeric build ID from a Steam app manifest", () => {
    expect(
      steamBuildIdFromManifest('"AppState"\n{\n  "buildid"  "12345678"\n}'),
    ).toBe("12345678");
    expect(() => steamBuildIdFromManifest('"buildid" "local"')).toThrow(
      "numeric buildid",
    );
  });

  it("creates a compact deterministic inventory without mesh payloads", () => {
    const catalog = createMapCatalog([artifact]);
    expect(catalog).toEqual({
      format: "witchwatch-map-catalog-v1",
      sourceKind: "steam-dedicated-server",
      steamAppId: 222860,
      steamBuildId: "12345678",
      extractor: mapExtractorVersion,
      maps: [
        {
          map: "c4m1_milltown_a",
          sourceBspSha256: "a".repeat(64),
          sourceBytes: 4096,
          bspVersion: 21,
          mapRevision: 12,
          emittedTriangles: 1,
        },
      ],
    });
    expect(JSON.stringify(catalog)).not.toContain("positions");
  });
});
