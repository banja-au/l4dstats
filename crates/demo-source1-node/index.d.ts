export interface BindingMetadata {
  bindingApiVersion: 2;
  framingSummaryVersion: 1;
  projectConfigVersion: 2;
  compactArtifactWireVersion: 2;
  parserConfigId: "source1-l4d2-2100-v2";
  buildSha256: string;
  bindingCrateVersion: string;
  coreCrateVersion: string;
  nodeApiVersion: 8;
}

export interface FramingSummary {
  schemaVersion: 1;
  demoProtocol: number;
  networkProtocol: number;
  playbackTicks: number;
  playbackFrames: number;
  playbackTimeSeconds: number;
  stamp: "HL2DEMO";
  serverName: string;
  clientName: string;
  mapName: string;
  gameDirectory: string;
  signonLength: number;
  commandSequenceSha256: string;
  frameCount: number;
  commandCounts: Array<{ kind: string; count: number }>;
  issues: Array<{ code: string; offset: number; command?: number }>;
  stopped: boolean;
  bytesConsumed: number;
}

export function bindingMetadata(): BindingMetadata;
export function decodeFramingSummary(bytes: Buffer): Promise<FramingSummary>;

/** Canonical UTF-8 JSON bytes in this exact field order, without whitespace. */
export interface ProjectConfigV2 {
  schemaVersion: 2;
  parserConfig: "source1-l4d2-2100-v2";
  maxInputBytes: number;
  maxObservations: number;
  maxIdentityMappings: number;
  maxMatchStates: number;
  maxRawEvents: number;
  maxRequiredEvents: number;
  maxEventKinds: number;
  maxOutputBytes: number;
}

export function projectDemo(
  demoBytes: Buffer,
  pseudonymKey: Buffer,
  configBytes: Buffer,
): Promise<Buffer>;
