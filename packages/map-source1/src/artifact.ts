import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  defaultBspParseLimits,
  parseSourceBspWorldMesh,
  type SourceMapMesh,
} from "./index.js";

export const mapArtifactFormat = "witchwatch-map-mesh-v1" as const;
export const mapExtractorVersion = "@witchwatch/map-source1@0.1.0";

export interface MapArtifactProvenance {
  readonly map: string;
  readonly sourceBspSha256: string;
  readonly sourceBytes: number;
  readonly sourceKind: "steam-dedicated-server" | "local-bsp";
  readonly steamAppId?: 222860;
  readonly steamBuildId?: string;
  readonly contentRoot?: string;
  readonly extractor: string;
}

export interface SourceMapArtifact extends SourceMapMesh {
  readonly provenance: MapArtifactProvenance;
}

export interface MapCatalog {
  readonly format: "witchwatch-map-catalog-v1";
  readonly sourceKind: "steam-dedicated-server" | "local-bsp";
  readonly steamAppId?: 222860;
  readonly steamBuildId?: string;
  readonly extractor: string;
  readonly maps: readonly {
    readonly map: string;
    readonly sourceBspSha256: string;
    readonly sourceBytes: number;
    readonly bspVersion: number;
    readonly mapRevision: number;
    readonly emittedTriangles: number;
    readonly contentRoot?: string;
  }[];
}

export function steamBuildIdFromManifest(manifest: string): string {
  const buildId = /^\s*"buildid"\s+"([0-9]+)"\s*$/im.exec(manifest)?.[1];
  if (!buildId)
    throw new RangeError("Steam app manifest has no numeric buildid");
  return buildId;
}

export function createMapCatalog(
  artifacts: readonly SourceMapArtifact[],
): MapCatalog {
  const kinds = new Set(
    artifacts.map((artifact) => artifact.provenance.sourceKind),
  );
  if (kinds.size !== 1)
    throw new RangeError("map catalog cannot mix BSP source kinds");
  const sourceKind = artifacts[0]?.provenance.sourceKind ?? "local-bsp";
  const steamBuildIds = new Set(
    artifacts.flatMap((artifact) =>
      artifact.provenance.steamBuildId
        ? [artifact.provenance.steamBuildId]
        : [],
    ),
  );
  if (steamBuildIds.size > 1)
    throw new RangeError("map catalog cannot mix Steam build IDs");
  const steamBuildId = [...steamBuildIds][0];
  return {
    format: "witchwatch-map-catalog-v1",
    sourceKind,
    ...(sourceKind === "steam-dedicated-server"
      ? { steamAppId: 222860 as const }
      : {}),
    ...(steamBuildId ? { steamBuildId } : {}),
    extractor: mapExtractorVersion,
    maps: artifacts.map((artifact) => ({
      map: artifact.provenance.map,
      sourceBspSha256: artifact.provenance.sourceBspSha256,
      sourceBytes: artifact.provenance.sourceBytes,
      bspVersion: artifact.bspVersion,
      mapRevision: artifact.mapRevision,
      emittedTriangles: artifact.coverage.emittedTriangles,
      ...(artifact.provenance.contentRoot
        ? { contentRoot: artifact.provenance.contentRoot }
        : {}),
    })),
  };
}

function canonicalMapName(path: string): string {
  const filename = basename(path);
  if (!/^[a-z0-9_]+\.bsp$/i.test(filename))
    throw new RangeError("input must be a canonical .bsp filename");
  return basename(filename, ".bsp").toLowerCase();
}

export async function deriveMapArtifact(
  inputArgument: string,
  sourceOptions: {
    readonly kind: "steam-dedicated-server" | "local-bsp";
    readonly steamBuildId?: string;
    readonly contentRoot?: string;
  } = { kind: "local-bsp" },
): Promise<SourceMapArtifact> {
  const input = resolve(inputArgument);
  const map = canonicalMapName(input);
  const metadata = await stat(input);
  if (!metadata.isFile() || metadata.size > defaultBspParseLimits.maxBytes)
    throw new RangeError("BSP is not a bounded regular file");
  const sourceBytes = await readFile(input);
  const mesh = parseSourceBspWorldMesh(sourceBytes);
  return {
    ...mesh,
    provenance: {
      map,
      sourceBspSha256: createHash("sha256").update(sourceBytes).digest("hex"),
      sourceBytes: sourceBytes.byteLength,
      sourceKind: sourceOptions.kind,
      ...(sourceOptions.kind === "steam-dedicated-server"
        ? { steamAppId: 222860 as const }
        : {}),
      ...(sourceOptions.steamBuildId
        ? { steamBuildId: sourceOptions.steamBuildId }
        : {}),
      ...(sourceOptions.contentRoot
        ? { contentRoot: sourceOptions.contentRoot }
        : {}),
      extractor: mapExtractorVersion,
    },
  };
}

export async function writeMapArtifact(
  outputArgument: string,
  artifact: SourceMapArtifact,
): Promise<void> {
  await writeJsonAtomically(outputArgument, artifact);
}

export async function writeJsonAtomically(
  outputArgument: string,
  value: unknown,
): Promise<void> {
  const output = resolve(outputArgument);
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporary, output);
}
