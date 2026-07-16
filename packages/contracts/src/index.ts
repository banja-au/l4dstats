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

export interface ReviewScore {
  readonly playerId: string;
  readonly modelVersion: string;
  readonly reviewPriority: number | null;
  readonly dataQuality: number;
  readonly independentEncounterCount: number;
  readonly label: "insufficient-data" | "review" | "highly-anomalous";
}

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
