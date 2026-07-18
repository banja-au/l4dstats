import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { MapVector3 } from "./index.js";

const require = createRequire(import.meta.url);
const parserConfig = {
  schemaVersion: 1,
  parserConfig: "source1-l4d2-2100-v1",
  maxInputBytes: 512 * 1024 * 1024,
  maxObservations: 2_000_000,
  maxIdentityMappings: 16_384,
  maxMatchStates: 100_000,
  maxRawEvents: 2_000_000,
  maxRequiredEvents: 1_000_000,
  maxEventKinds: 4_096,
  maxOutputBytes: 256 * 1024 * 1024,
} as const;

interface NativeBinding {
  bindingMetadata(): unknown;
  projectDemo(
    demoBytes: Buffer,
    pseudonymKey: Buffer,
    configBytes: Buffer,
  ): Promise<Buffer>;
}

export interface NativeDemoAlignmentData {
  readonly mapName: string;
  readonly positions: readonly MapVector3[];
}

export function readNativeAlignmentArtifact(
  value: unknown,
): NativeDemoAlignmentData {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("native demo artifact must be an object");
  const artifact = value as Record<string, unknown>;
  if (artifact.version !== 1)
    throw new RangeError("unsupported artifact version");
  const header = object(artifact.header, "artifact header");
  if (typeof header.mapName !== "string" || header.mapName.length === 0)
    throw new TypeError("artifact header has no mapName");
  const projection = object(artifact.projection, "artifact projection");
  const observations = object(
    projection.observations,
    "artifact compact observations",
  );
  if (!Array.isArray(observations.rows))
    throw new TypeError("artifact observations have no rows");
  const positions: MapVector3[] = [];
  for (const [index, row] of observations.rows.entries()) {
    if (!Array.isArray(row) || row.length !== 10)
      throw new TypeError(`artifact observation row ${index} is invalid`);
    const position = row[3];
    if (position === null) continue;
    if (
      !Array.isArray(position) ||
      position.length !== 3 ||
      !position.every(
        (coordinate) =>
          typeof coordinate === "number" && Number.isFinite(coordinate),
      )
    )
      throw new TypeError(
        `artifact observation row ${index} has invalid position`,
      );
    positions.push({ x: position[0], y: position[1], z: position[2] });
  }
  return { mapName: header.mapName, positions };
}

export async function projectNativeDemoAlignment(
  bytes: Uint8Array,
): Promise<NativeDemoAlignmentData> {
  let binding: NativeBinding;
  try {
    binding = require(
      fileURLToPath(
        new URL(
          "../../../crates/demo-source1-node/dist/demo-source1-node.node",
          import.meta.url,
        ),
      ),
    ) as NativeBinding;
  } catch (error) {
    throw new Error("Required native demo parser addon is unavailable", {
      cause: error,
    });
  }
  if (
    typeof binding.projectDemo !== "function" ||
    typeof binding.bindingMetadata !== "function"
  )
    throw new Error("Native demo parser addon has an invalid API");
  const metadata = object(binding.bindingMetadata(), "native parser metadata");
  if (
    metadata.bindingApiVersion !== 2 ||
    metadata.compactArtifactWireVersion !== 1 ||
    metadata.parserConfigId !== parserConfig.parserConfig
  )
    throw new Error("Native demo parser addon is incompatible");
  const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const output = await binding.projectDemo(
    input,
    Buffer.from("map-source1-alignment-v1"),
    Buffer.from(JSON.stringify(parserConfig), "utf8"),
  );
  try {
    return readNativeAlignmentArtifact(JSON.parse(output.toString("utf8")));
  } catch (error) {
    throw new Error("Native parser returned an invalid alignment artifact", {
      cause: error,
    });
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}
