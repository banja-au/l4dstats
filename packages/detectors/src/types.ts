import {
  evidenceSchemaVersion,
  type ArtifactProvenance,
  type AvailableValue,
  type DetectorEvidence,
  type DetectorSkip,
  type FeatureValue,
} from "@witchwatch/contracts";

export type Field<T> = AvailableValue<T>;

export interface Angles {
  readonly pitch: number;
  readonly yaw: number;
}
export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Sample {
  readonly tick: number;
  readonly timeSeconds: Field<number>;
  readonly eyeAngles: Field<Angles>;
  readonly playerPosition: Field<Vector3>;
  readonly targetPosition: Field<Vector3>;
  readonly shot: Field<boolean>;
  readonly targetVisible: Field<boolean>;
  readonly targetAudible: Field<boolean>;
  readonly targetPreviouslyKnown: Field<boolean>;
}

export type Provenance = ArtifactProvenance;
export type RawFeature = FeatureValue;
export type EvidenceWindow = DetectorEvidence;
export { evidenceSchemaVersion };

export type SkipReason = DetectorSkip;

export interface DetectorResult {
  readonly evidence: readonly EvidenceWindow[];
  readonly skipped: readonly SkipReason[];
}

export interface DetectorContext {
  readonly playerEpochId: string;
  readonly provenance: Omit<Provenance, "detectorId" | "detectorVersion">;
}

export interface DetectorCard {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly kind: EvidenceWindow["kind"];
  readonly prerequisites: readonly string[];
  readonly failureModes: readonly string[];
  readonly interpretation: string;
}

export interface Detector<Input> {
  readonly card: DetectorCard;
  run(input: Input, context: DetectorContext): DetectorResult;
}

export const present = <T>(
  field: Field<T>,
): field is Field<T> & { readonly value: T } =>
  field.availability !== "unavailable" && field.value !== undefined;

export const skipped = (
  detectorId: string,
  code: SkipReason["code"],
  explanation: string,
  fields: readonly string[] = [],
): DetectorResult => ({
  evidence: [],
  skipped: [{ detectorId, code, explanation, unavailableFields: fields }],
});

export const provenanceFor = (
  context: DetectorContext,
  card: DetectorCard,
): Provenance => ({
  ...context.provenance,
  detectorId: card.id,
  detectorVersion: card.version,
});
