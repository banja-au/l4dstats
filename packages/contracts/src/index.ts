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
