import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { mapExtractorVersion, type SourceMapArtifact } from "./artifact.js";
import { validateMapArtifact } from "./validate.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "witchwatch-map-validate-"));
  roots.push(root);
  const bsp = join(root, "c4m1_milltown_a.bsp");
  const json = join(root, "c4m1_milltown_a.json");
  const source = Buffer.from("fixture BSP bytes");
  const artifact: SourceMapArtifact = {
    format: "witchwatch-map-mesh-v1",
    bspVersion: 21,
    mapRevision: 1,
    positions: [0, 0, -1, 2, 0, 3, 0, 4, 1],
    indices: [0, 1, 2],
    triangleZ: [1],
    bounds: { min: { x: 0, y: 0, z: -1 }, max: { x: 2, y: 4, z: 3 } },
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
      sourceBspSha256: createHash("sha256").update(source).digest("hex"),
      sourceBytes: source.length,
      sourceKind: "local-bsp",
      extractor: mapExtractorVersion,
    },
  };
  await writeFile(bsp, source);
  await writeFile(json, JSON.stringify(artifact));
  return { bsp, json, artifact };
}

describe("map artifact validation", () => {
  it("verifies source provenance and mesh integrity", async () => {
    const value = await fixture();
    await expect(
      validateMapArtifact(value.bsp, value.json, "c4m1_milltown_a"),
    ).resolves.toMatchObject({ vertices: 3, triangles: 1 });
  });

  it("rejects changed source bytes and invalid indices", async () => {
    const value = await fixture();
    await writeFile(value.bsp, "different");
    await expect(validateMapArtifact(value.bsp, value.json)).rejects.toThrow(
      "SHA-256",
    );
    await writeFile(value.bsp, "fixture BSP bytes");
    await writeFile(
      value.json,
      JSON.stringify({ ...value.artifact, indices: [0, 1, 99] }),
    );
    await expect(validateMapArtifact(value.bsp, value.json)).rejects.toThrow(
      "outside",
    );
  });
});
