import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import type { SourceMapArtifact } from "./artifact.js";

export interface MapArtifactValidation {
  readonly map: string;
  readonly sourceBspSha256: string;
  readonly sourceBytes: number;
  readonly vertices: number;
  readonly triangles: number;
}

function invalid(message: string): never {
  throw new RangeError(`invalid map artifact: ${message}`);
}

export async function validateMapArtifact(
  sourceBspPath: string,
  artifactPath: string,
  expectedMap?: string,
): Promise<MapArtifactValidation> {
  const [source, artifactBytes, metadata] = await Promise.all([
    readFile(sourceBspPath),
    readFile(artifactPath),
    stat(sourceBspPath),
  ]);
  if (!metadata.isFile()) invalid("source BSP is not a regular file");
  let artifact: SourceMapArtifact;
  try {
    artifact = JSON.parse(artifactBytes.toString("utf8")) as SourceMapArtifact;
  } catch {
    invalid("JSON cannot be decoded");
  }
  if (artifact.format !== "l4dstats-map-mesh-v1")
    invalid("format is unsupported");
  if (expectedMap && artifact.provenance.map !== expectedMap)
    invalid("canonical map name does not match the source selection");
  const sourceBspSha256 = createHash("sha256").update(source).digest("hex");
  if (artifact.provenance.sourceBspSha256 !== sourceBspSha256)
    invalid("source BSP SHA-256 does not match");
  if (artifact.provenance.sourceBytes !== source.byteLength)
    invalid("source BSP byte length does not match");
  if (
    artifact.positions.length % 3 !== 0 ||
    artifact.indices.length % 3 !== 0 ||
    artifact.triangleZ.length !== artifact.indices.length / 3
  )
    invalid("mesh array dimensions disagree");
  if (
    artifact.coverage.emittedTriangles !== artifact.indices.length / 3 ||
    artifact.positions.length === 0
  )
    invalid("coverage disagrees with mesh arrays");
  if (!artifact.positions.every(Number.isFinite))
    invalid("positions contain a non-finite number");
  if (!artifact.triangleZ.every(Number.isFinite))
    invalid("triangle heights contain a non-finite number");
  const vertices = artifact.positions.length / 3;
  if (
    !artifact.indices.every(
      (index) => Number.isInteger(index) && index >= 0 && index < vertices,
    )
  )
    invalid("triangle index is outside the vertex array");
  const axes = ["x", "y", "z"] as const;
  const observedMin = [Infinity, Infinity, Infinity];
  const observedMax = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < artifact.positions.length; index++) {
    const axis = index % 3;
    const value = artifact.positions[index]!;
    observedMin[axis] = Math.min(observedMin[axis]!, value);
    observedMax[axis] = Math.max(observedMax[axis]!, value);
  }
  for (const [axisIndex, axis] of axes.entries()) {
    if (
      observedMin[axisIndex] !== artifact.bounds.min[axis] ||
      observedMax[axisIndex] !== artifact.bounds.max[axis]
    )
      invalid(`${axis} bounds disagree with positions`);
  }
  return {
    map: artifact.provenance.map,
    sourceBspSha256,
    sourceBytes: source.byteLength,
    vertices,
    triangles: artifact.indices.length / 3,
  };
}
