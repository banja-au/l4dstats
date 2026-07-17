export const evidenceKinds = [
  "aim",
  "awareness",
  "movement",
  "invariant",
] as const;
export type EvidenceKind = (typeof evidenceKinds)[number];

export interface TickRange {
  readonly start: number;
  readonly end: number;
}

export interface EvidenceEvent {
  readonly id: string;
  readonly demoSha256: string;
  readonly playerId: string;
  readonly tickRange: TickRange;
  readonly kind: EvidenceKind;
  readonly detectorVersion: string;
  readonly quality: number;
  readonly contribution: number;
  readonly explanation: string;
  readonly counterevidence: readonly string[];
}

export const evidenceSchemaVersion = 1 as const;

export type FeatureValue = boolean | number | string | null;

export interface ArtifactProvenance {
  readonly demoSha256: string;
  readonly observationArtifactSha256: string;
  readonly observationSchemaVersion: number;
  readonly detectorId: string;
  readonly detectorVersion: string;
  readonly configSha256: string;
  readonly mapAssetSha256?: string;
}

export interface EvidenceEffect {
  readonly value: number;
  readonly unit: string;
  readonly baseline: string;
}

export interface EvidenceQuality {
  readonly value: number;
  readonly basis: readonly string[];
}

export interface DetectorEvidence {
  readonly schemaVersion: typeof evidenceSchemaVersion;
  readonly id: string;
  readonly playerEpochId: string;
  readonly kind: EvidenceKind;
  readonly tickRange: TickRange;
  readonly rawFeatures: Readonly<Record<string, FeatureValue>>;
  readonly effect: EvidenceEffect;
  readonly contributionPlaceholder: null;
  readonly quality: EvidenceQuality;
  readonly explanation: string;
  readonly limitations: readonly string[];
  readonly counterevidence: readonly string[];
  readonly provenance: ArtifactProvenance;
}

export interface DetectorSkip {
  readonly detectorId: string;
  readonly code:
    | "empty-input"
    | "missing-prerequisite"
    | "insufficient-samples"
    | "no-candidate";
  readonly explanation: string;
  readonly unavailableFields: readonly string[];
}

export interface EvidenceBundle {
  readonly schemaVersion: typeof evidenceSchemaVersion;
  readonly demoSha256: string;
  readonly configSha256: string;
  readonly findings: readonly DetectorEvidence[];
  readonly skipped: readonly DetectorSkip[];
}

export const scoreSchemaVersion = 1 as const;
export type ScoreStatus =
  | "insufficient-data"
  | "ranked-evidence"
  | "calibrated-priority";

export interface ScoreModelIdentity {
  readonly id: string;
  readonly version: string;
  readonly bundleSha256: string;
}

export interface IndependentEvidenceCount {
  readonly encounters: number;
  readonly demos: number;
  readonly signalFamilies: number;
}

export interface ScoreContribution {
  readonly featureId: string;
  readonly rawValue: number;
  readonly cappedValue: number;
  readonly coefficient: number;
  readonly logOddsContribution: number;
  readonly evidenceIds: readonly string[];
  readonly tickRanges: readonly TickRange[];
  readonly explanation: string;
  readonly limitations: readonly string[];
  readonly counterevidence: readonly string[];
}

export interface ScoreProvenance {
  readonly evidenceBundleSha256s: readonly string[];
  readonly detectorVersions: Readonly<Record<string, string>>;
  readonly configSha256: string;
  readonly modelBundleSha256: string;
  readonly datasetManifestSha256: string;
}

interface ScoreCommon {
  readonly schemaVersion: typeof scoreSchemaVersion;
  readonly playerKey: string;
  readonly model: ScoreModelIdentity;
  readonly policyVersion: string;
  readonly dataQuality: number;
  readonly reconstructionQuality: number;
  readonly independentEvidence: IndependentEvidenceCount;
  readonly contributions: readonly ScoreContribution[];
  readonly strongestCounterevidence: readonly string[];
  readonly limitations: readonly string[];
  readonly provenance: ScoreProvenance;
  readonly researchOnly: true;
}

export interface InsufficientDataScore extends ScoreCommon {
  readonly status: "insufficient-data";
  readonly label: "insufficient-data";
  readonly reasons: readonly string[];
}

export interface RankedEvidenceScore extends ScoreCommon {
  readonly status: "ranked-evidence";
  readonly label: "review" | "highly-anomalous";
  readonly uncalibratedEvidenceStrength: number;
  readonly reasons: readonly string[];
}

export interface CalibratedPriorityScore extends ScoreCommon {
  readonly status: "calibrated-priority";
  readonly label: "review" | "highly-anomalous";
  readonly reviewPriority: number;
  readonly calibration: {
    readonly method: "platt";
    readonly reportSha256: string;
  };
}

/** Review-priority output. Only the calibrated variant can contain a numeric priority. */
export type ReviewScore =
  | InsufficientDataScore
  | RankedEvidenceScore
  | CalibratedPriorityScore;

export const observationSchemaVersion = 1 as const;
export type Availability = "observed" | "derived" | "unavailable";

export interface AvailableValue<T> {
  readonly availability: Availability;
  readonly value?: T;
  readonly reason?: string;
}

export interface DemoIdentity {
  readonly sha256: string;
  readonly demoProtocol: number;
  readonly networkProtocol: number;
  readonly mapName: string;
  readonly gameDirectory: string;
  readonly playbackTicks: number;
  readonly playbackTimeSeconds: number;
}

export interface PlayerEpoch {
  readonly id: string;
  readonly demoSha256: string;
  readonly entitySlot: number;
  readonly userId: AvailableValue<number>;
  readonly steamId: AvailableValue<string>;
  readonly connectedAtTick: number;
  readonly disconnectedAtTick: AvailableValue<number>;
}

export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ViewAngles {
  readonly pitch: number;
  readonly yaw: number;
  readonly roll: number;
}

export interface PlayerObservation {
  readonly schemaVersion: typeof observationSchemaVersion;
  readonly demoSha256: string;
  readonly playerEpochId: string;
  readonly tick: number;
  readonly demoTimeSeconds: AvailableValue<number>;
  readonly position: AvailableValue<Vector3>;
  readonly eyeAngles: AvailableValue<ViewAngles>;
  readonly team: AvailableValue<number>;
  readonly playerClass: AvailableValue<string>;
  readonly weapon: AvailableValue<string>;
  readonly buttons: AvailableValue<number>;
}

export interface GameEventObservation {
  readonly schemaVersion: typeof observationSchemaVersion;
  readonly demoSha256: string;
  readonly tick: number;
  readonly name: string;
  readonly fields: Readonly<Record<string, boolean | number | string>>;
}

export interface ProtocolCoverage {
  readonly demoSha256: string;
  readonly decodedCommandCounts: Readonly<Record<string, number>>;
  readonly unknownCommandCounts: Readonly<Record<string, number>>;
  readonly unknownMessageCounts: Readonly<Record<string, number>>;
  readonly unavailableFields: Readonly<Record<string, string>>;
  readonly warnings: readonly string[];
}

export interface CanonicalDemo {
  readonly schemaVersion: typeof observationSchemaVersion;
  readonly identity: DemoIdentity;
  readonly playerEpochs: readonly PlayerEpoch[];
  readonly observations: readonly PlayerObservation[];
  readonly events: readonly GameEventObservation[];
  readonly coverage: ProtocolCoverage;
}
