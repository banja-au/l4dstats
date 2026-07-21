import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type {
  DemoProjectionProvider,
  PreparedDemoProjection,
} from "./evidence-bundle.js";
import { rehydrateNativeProjection } from "./native-projection.js";

const require = createRequire(import.meta.url);
const parserConfig = {
  schemaVersion: 2,
  parserConfig: "source1-l4d2-2100-v2",
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
  decodeFramingSummary(bytes: Buffer): Promise<NativeFramingSummary>;
}

export interface NativeFramingSummary {
  schemaVersion: 1;
  stamp: "HL2DEMO";
  demoProtocol: number;
  networkProtocol: number;
  serverName: string;
  clientName: string;
  mapName: string;
  gameDirectory: string;
  playbackTicks: number;
  playbackFrames: number;
  playbackTimeSeconds: number;
  signonLength: number;
  frameCount: number;
  commandCounts: Array<{ kind: string; count: number }>;
  commandSequenceSha256: string;
  issues: Array<{ code: string; offset: number; command?: number }>;
  stopped: boolean;
  bytesConsumed: number;
}

interface NativeMetadata {
  bindingApiVersion: 2;
  framingSummaryVersion: 1;
  projectConfigVersion: 2;
  compactArtifactWireVersion: 3;
  parserConfigId: "source1-l4d2-2100-v2";
  buildSha256: string;
  bindingCrateVersion: string;
  coreCrateVersion: string;
  nodeApiVersion: 8;
}

function readMetadata(value: unknown): NativeMetadata {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Native parser metadata is not an object");
  const metadata = value as Record<string, unknown>;
  const expectedKeys = [
    "bindingApiVersion",
    "bindingCrateVersion",
    "buildSha256",
    "compactArtifactWireVersion",
    "coreCrateVersion",
    "framingSummaryVersion",
    "nodeApiVersion",
    "parserConfigId",
    "projectConfigVersion",
  ];
  if (
    Object.keys(metadata).sort().join("\0") !==
      expectedKeys.sort().join("\0") ||
    metadata.bindingApiVersion !== 2 ||
    metadata.framingSummaryVersion !== 1 ||
    metadata.projectConfigVersion !== 2 ||
    metadata.compactArtifactWireVersion !== 3 ||
    metadata.parserConfigId !== parserConfig.parserConfig ||
    typeof metadata.buildSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(metadata.buildSha256) ||
    (process.env.NODE_ENV === "production" &&
      /^0{64}$/.test(metadata.buildSha256)) ||
    metadata.nodeApiVersion !== 8 ||
    typeof metadata.bindingCrateVersion !== "string" ||
    !/^\d+\.\d+\.\d+/.test(metadata.bindingCrateVersion) ||
    typeof metadata.coreCrateVersion !== "string" ||
    !/^\d+\.\d+\.\d+/.test(metadata.coreCrateVersion)
  )
    throw new Error("Native parser metadata is incompatible");
  return metadata as unknown as NativeMetadata;
}

function loadBinding(): { binding: NativeBinding; metadata: NativeMetadata } {
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
    typeof binding.bindingMetadata !== "function" ||
    typeof binding.projectDemo !== "function" ||
    typeof binding.decodeFramingSummary !== "function"
  )
    throw new Error("Native demo parser addon has an invalid API");
  return { binding, metadata: readMetadata(binding.bindingMetadata()) };
}

export const prepareNativeDemoProjection: DemoProjectionProvider = async (
  bytes,
  options,
): Promise<PreparedDemoProjection> => {
  options.onProgress?.(0.04, "Projecting demo with native Source 1 parser");
  const { binding, metadata } = loadBinding();
  const key = Buffer.from(options.pseudonymKey);
  if (key.byteLength < 16 || key.byteLength > 64)
    throw new Error("pseudonymKey must contain between 16 and 64 bytes");
  const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const artifactBytes = await binding.projectDemo(
    input,
    key,
    Buffer.from(JSON.stringify(parserConfig), "utf8"),
  );
  let artifact: unknown;
  try {
    artifact = JSON.parse(artifactBytes.toString("utf8"));
  } catch (error) {
    throw new Error("Native parser returned invalid JSON", { cause: error });
  }
  const demoSha256 = createHash("sha256").update(input).digest("hex");
  const prepared = rehydrateNativeProjection(artifact, {
    demoSha256,
    bytes: input.byteLength,
  });
  options.onProgress?.(0.6, "Validated native demo projection");
  return {
    ...prepared,
    parserVersion: `demo-source1-native@${metadata.coreCrateVersion}+node-${metadata.bindingCrateVersion}/config-${parserConfig.schemaVersion}/build-${metadata.buildSha256}`,
    parser: {
      engine: "rust-native",
      coreVersion: metadata.coreCrateVersion,
      bindingVersion: metadata.bindingCrateVersion,
      bindingApiVersion: metadata.bindingApiVersion,
      configVersion: metadata.projectConfigVersion,
      wireVersion: metadata.compactArtifactWireVersion,
      parserConfigId: metadata.parserConfigId,
      buildSha256: metadata.buildSha256,
    },
  };
};

export async function inspectNativeDemo(bytes: Uint8Array): Promise<{
  demoSha256: string;
  bytes: number;
  framing: NativeFramingSummary;
}> {
  const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { binding } = loadBinding();
  const framing = await binding.decodeFramingSummary(input);
  if (
    framing.schemaVersion !== 1 ||
    framing.stamp !== "HL2DEMO" ||
    !/^[a-f0-9]{64}$/.test(framing.commandSequenceSha256)
  )
    throw new Error("Native framing summary is incompatible");
  return {
    demoSha256: createHash("sha256").update(input).digest("hex"),
    bytes: input.byteLength,
    framing,
  };
}
