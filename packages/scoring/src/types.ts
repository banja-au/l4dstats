import type { EvidenceKind, ReviewScore, TickRange } from "@l4dstats/contracts";

export const mandatoryLimitations = [
  "research-only",
  "reference-validation-pending",
] as const;

export interface ScoringEvidence {
  readonly id: string;
  readonly playerKey: string;
  readonly playerEpochId: string;
  readonly demoSha256: string;
  readonly encounterId: string;
  readonly detectorId: string;
  readonly detectorVersion: string;
  readonly signalFamily: EvidenceKind;
  readonly tickRange: TickRange;
  readonly strength: number;
  readonly quality: number;
  readonly reconstructionQuality: number;
  readonly explanation: string;
  readonly limitations: readonly string[];
  readonly counterevidence: readonly string[];
  readonly evidenceBundleSha256: string;
}

export interface AggregationCaps {
  readonly detectorPerEncounter: number;
  readonly familyPerEncounter: number;
  readonly encounter: number;
  readonly familyPerDemo: number;
  readonly familyPerPlayer: number;
}

export interface FeatureValue {
  readonly id: string;
  readonly rawValue: number;
  readonly cappedValue: number;
  readonly evidence: readonly ScoringEvidence[];
}

export interface AggregatedPlayer {
  readonly playerKey: string;
  readonly features: readonly FeatureValue[];
  readonly encounterCount: number;
  readonly demoCount: number;
  readonly signalFamilyCount: number;
  readonly signalFamilies: readonly EvidenceKind[];
  readonly dataQuality: number;
  readonly reconstructionQuality: number;
  readonly evidence: readonly ScoringEvidence[];
}

export interface FeatureSpec {
  readonly id: string;
  readonly mean: number;
  readonly scale: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly required: boolean;
}

export interface LogisticModel {
  readonly intercept: number;
  readonly coefficients: readonly number[];
  readonly features: readonly FeatureSpec[];
}

export interface PlattModel {
  readonly slope: number;
  readonly intercept: number;
}

export interface ModelRow {
  readonly playerKey: string;
  readonly playerGroupId: string;
  readonly fixtureFamilyId: string;
  readonly serverId: string;
  readonly timeBucket: string;
  readonly split: "train" | "calibration" | "test";
  readonly features: Readonly<Record<string, number>>;
  readonly label: 0 | 1;
  readonly labelProvenance:
    | "controlled-configuration"
    | "consented-clean"
    | "blinded-review"
    | "synthetic-controlled";
}

export interface TrainingConfig {
  readonly iterations: number;
  readonly learningRate: number;
  readonly l2: number;
}

export interface OperatingPolicy {
  readonly version: string;
  readonly minimumIndependentEncounters: number;
  readonly minimumIndependentDemos: number;
  readonly minimumIndependentSignalFamilies: number;
  readonly minimumReconstructionQuality: number;
  readonly highlyAnomalousMinimumDemos: number;
  readonly highlyAnomalousMinimumSignalFamilies: number;
  readonly orthogonalSignalFamilies: readonly EvidenceKind[];
  readonly falsePositiveBudgetPer1000: number;
  readonly minimumRecall: number;
  readonly maximumBrier: number;
  readonly maximumEce: number;
  readonly maximumCalibrationGap: number;
  readonly minimumCalibrationRows: number;
  readonly minimumEvaluationRowsPerLabel: number;
  readonly decisionThreshold: number;
}

export interface ModelBundle {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly version: string;
  readonly controlledFixtureOnly: true;
  readonly limitations: readonly string[];
  readonly datasetManifestSha256: string;
  readonly policy: OperatingPolicy;
  readonly caps: AggregationCaps;
  readonly logistic: LogisticModel;
  readonly platt: PlattModel;
  readonly calibrationAccepted: boolean;
  readonly operatingPointAccepted: boolean;
  readonly calibrationReportSha256: string;
  readonly lineage: {
    readonly scoreContractVersion: 1;
    readonly featureConfigVersion: string;
    readonly detectorVersions: Readonly<Record<string, string>>;
    readonly splitManifestSha256: string;
    readonly training: TrainingConfig;
    readonly calibration: TrainingConfig;
    readonly sourceRevision: string;
    readonly runtime: string;
    readonly dependencies: Readonly<Record<string, string>>;
    readonly reproductionCommand: string;
  };
}

export interface HashedBundle {
  readonly sha256: string;
  readonly json: string;
  readonly bundle: ModelBundle;
}

export interface ScoreContext {
  readonly bundleSha256: string;
  readonly configSha256: string;
}

export interface ScoreResult {
  readonly score: ReviewScore;
  readonly rawLogit?: number;
}
