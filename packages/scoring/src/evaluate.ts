import {
  brierScore,
  falsePositivesPer1000,
  logLoss,
  playerBootstrap,
  precisionRecallCurve,
  prevalenceAwarePpv,
  reliability,
  type Prediction,
} from "./metrics.js";
import {
  calibratedProbability,
  fitLogistic,
  fitPlatt,
  rawLogit,
} from "./logistic.js";
import { canonicalJson, hashBundle, hashBytes } from "./bundle.js";
import {
  mandatoryLimitations,
  type AggregationCaps,
  type FeatureSpec,
  type ModelBundle,
  type ModelRow,
  type OperatingPolicy,
  type TrainingConfig,
} from "./types.js";
import { validateSplitIsolation } from "./validate.js";

export interface EvaluationReport {
  readonly controlledFixtureOnly: true;
  readonly rows: number;
  readonly splitComposition: Readonly<
    Record<
      "train" | "calibration" | "test",
      {
        readonly players: number;
        readonly routine: number;
        readonly reviewWorthyControlledAnomaly: number;
      }
    >
  >;
  readonly brier: number;
  readonly constantPrevalenceBrier: number;
  readonly logLoss: number;
  readonly ece: number;
  readonly maximumCalibrationGap: number;
  readonly reliability: ReturnType<typeof reliability>;
  readonly precisionRecall: ReturnType<typeof precisionRecallCurve>;
  readonly brierInterval: {
    readonly lower: number;
    readonly upper: number;
    readonly level: number;
    readonly method: "player-bootstrap";
  };
  readonly falsePositivePer1000: number;
  readonly falsePositivePer1000Interval: EvaluationInterval;
  readonly recall: number;
  readonly recallInterval: EvaluationInterval;
  readonly precision: number;
  readonly averagePrecision: number;
  readonly confusion: {
    readonly truePositive: number;
    readonly falsePositive: number;
    readonly trueNegative: number;
    readonly falseNegative: number;
  };
  readonly prevalenceSensitivity: readonly {
    readonly assumedPrevalence: number;
    readonly positivePredictiveValue: number | null;
  }[];
  readonly usefulOperatingPoint: boolean;
  readonly calibrationAccepted: boolean;
  readonly unevaluatedSlices: readonly string[];
  readonly limitations: readonly string[];
}
interface EvaluationInterval {
  readonly lower: number;
  readonly upper: number;
  readonly level: number;
  readonly method: "player-bootstrap";
}
export interface TrainingResult {
  readonly bundle: ModelBundle;
  readonly bundleSha256: string;
  readonly report: EvaluationReport;
}

export const trainAndEvaluate = (input: {
  readonly id: string;
  readonly version: string;
  readonly rows: readonly ModelRow[];
  readonly features: readonly FeatureSpec[];
  readonly training: TrainingConfig;
  readonly calibration: TrainingConfig;
  readonly policy: OperatingPolicy;
  readonly caps: AggregationCaps;
  readonly datasetManifestSha256: string;
}): TrainingResult => {
  validateSplitIsolation(input.rows);
  const train = input.rows.filter((r) => r.split === "train"),
    calibration = input.rows.filter((r) => r.split === "calibration"),
    test = input.rows.filter((r) => r.split === "test");
  if (!train.length || !calibration.length || !test.length)
    throw new RangeError("train, calibration, and test splits are required");
  for (const [name, splitRows] of [
    ["train", train],
    ["calibration", calibration],
    ["test", test],
  ] as const)
    if (
      !splitRows.some((row) => row.label === 0) ||
      !splitRows.some((row) => row.label === 1)
    )
      throw new RangeError(`${name} split must contain both controlled labels`);
  const logistic = fitLogistic(train, input.features, input.training);
  const calLogits = calibration.map((r) => rawLogit(logistic, r.features));
  const platt = fitPlatt(
    calLogits,
    calibration.map((r) => r.label),
    input.calibration,
  );
  const predictions: Prediction[] = test.map((r) => ({
    playerKey: r.playerKey,
    probability: calibratedProbability(platt, rawLogit(logistic, r.features)),
    label: r.label,
  }));
  const rel = reliability(predictions);
  const pr = precisionRecallCurve(predictions);
  const brierBootstrap = playerBootstrap(predictions, brierScore, {
    replicates: 200,
    seed: 0x57574348,
    level: 0.95,
  });
  const brier = brierScore(predictions),
    ll = logLoss(predictions),
    fp = falsePositivesPer1000(predictions, input.policy.decisionThreshold);
  const selected = pr
    .filter((p) => p.threshold >= input.policy.decisionThreshold)
    .at(-1);
  const recall = selected?.recall ?? 0,
    precision = selected?.precision ?? 0;
  const positives = predictions.filter((row) => row.label === 1).length,
    negatives = predictions.length - positives,
    falsePositive = Math.round((fp / 1000) * negatives),
    truePositive = Math.round(recall * positives),
    specificity = (negatives - falsePositive) / negatives;
  const trainingPrevalence =
    train.reduce((sum, row) => sum + row.label, 0) / train.length;
  const constantPrevalenceBrier = brierScore(
    predictions.map((row) => ({ ...row, probability: trainingPrevalence })),
  );
  const prevalenceSensitivity = [0.001, 0.01, 0.05, 0.1].map(
    (assumedPrevalence) => ({
      assumedPrevalence,
      positivePredictiveValue: prevalenceAwarePpv(
        recall,
        specificity,
        assumedPrevalence,
      ),
    }),
  );
  const evaluationSupport =
    positives >= input.policy.minimumEvaluationRowsPerLabel &&
    negatives >= input.policy.minimumEvaluationRowsPerLabel;
  const intervalOptions = {
    replicates: 200,
    seed: 0x53505233,
    level: 0.95,
  } as const;
  const fpBootstrap = playerBootstrap(
    predictions.filter((row) => row.label === 0),
    (sample) => falsePositivesPer1000(sample, input.policy.decisionThreshold),
    intervalOptions,
  );
  const recallBootstrap = playerBootstrap(
    predictions.filter((row) => row.label === 1),
    (sample) => {
      const positive = sample.filter((row) => row.label === 1);
      if (!positive.length) return 0;
      return (
        positive.filter(
          (row) => row.probability >= input.policy.decisionThreshold,
        ).length / positive.length
      );
    },
    intervalOptions,
  );
  let previousRecall = 0,
    averagePrecision = 0;
  for (const point of pr) {
    if (point.recall > previousRecall)
      averagePrecision += (point.recall - previousRecall) * point.precision;
    previousRecall = Math.max(previousRecall, point.recall);
  }
  const calibrationAccepted =
    calibration.length >= input.policy.minimumCalibrationRows &&
    evaluationSupport &&
    brier < constantPrevalenceBrier &&
    brier <= input.policy.maximumBrier &&
    rel.ece <= input.policy.maximumEce &&
    rel.maximumGap <= input.policy.maximumCalibrationGap;
  const report: EvaluationReport = {
    controlledFixtureOnly: true,
    rows: test.length,
    splitComposition: Object.fromEntries(
      (["train", "calibration", "test"] as const).map((split) => {
        const splitRows = input.rows.filter((row) => row.split === split);
        return [
          split,
          {
            players: splitRows.length,
            routine: splitRows.filter((row) => row.label === 0).length,
            reviewWorthyControlledAnomaly: splitRows.filter(
              (row) => row.label === 1,
            ).length,
          },
        ];
      }),
    ) as EvaluationReport["splitComposition"],
    brier,
    constantPrevalenceBrier,
    logLoss: ll,
    ece: rel.ece,
    maximumCalibrationGap: rel.maximumGap,
    reliability: rel,
    precisionRecall: pr,
    brierInterval: {
      lower: brierBootstrap.lower,
      upper: brierBootstrap.upper,
      level: brierBootstrap.level,
      method: "player-bootstrap",
    },
    falsePositivePer1000: fp,
    falsePositivePer1000Interval: {
      lower: fpBootstrap.lower,
      upper: fpBootstrap.upper,
      level: fpBootstrap.level,
      method: "player-bootstrap",
    },
    recall,
    recallInterval: {
      lower: recallBootstrap.lower,
      upper: recallBootstrap.upper,
      level: recallBootstrap.level,
      method: "player-bootstrap",
    },
    precision,
    averagePrecision,
    confusion: {
      truePositive,
      falsePositive,
      trueNegative: negatives - falsePositive,
      falseNegative: positives - truePositive,
    },
    prevalenceSensitivity,
    usefulOperatingPoint:
      calibrationAccepted &&
      fp <= input.policy.falsePositiveBudgetPer1000 &&
      recall >= input.policy.minimumRecall,
    calibrationAccepted,
    unevaluatedSlices: [
      "high-skill-proxy",
      "latency-ping",
      "sensitivity-input-device",
      "protocol-capture-type",
      "server-modifications",
      "map-game-version",
      "real-telemetry-gaps",
      "independent-demos-encounters",
      "detector-signal-family",
      "smoothed-delayed-randomized-strength-anomalies",
    ],
    limitations: [
      ...mandatoryLimitations,
      "controlled-fixture-results-do-not-establish-population-validity",
    ],
  };
  const reportSha256 = hashBytes(canonicalJson(report));
  const bundle: ModelBundle = {
    schemaVersion: 1,
    id: input.id,
    version: input.version,
    controlledFixtureOnly: true,
    limitations: report.limitations,
    datasetManifestSha256: input.datasetManifestSha256,
    policy: input.policy,
    caps: input.caps,
    logistic,
    platt,
    calibrationAccepted,
    operatingPointAccepted: report.usefulOperatingPoint,
    calibrationReportSha256: reportSha256,
    lineage: {
      scoreContractVersion: 1,
      featureConfigVersion: "controlled-features-v1",
      detectorVersions: {
        "fixture-feature-generator": "1.0.0",
      },
      splitManifestSha256: hashBytes(
        canonicalJson(
          input.rows.map(({ playerKey, fixtureFamilyId, split }) => ({
            playerKey,
            fixtureFamilyId,
            split,
          })),
        ),
      ),
      training: input.training,
      calibration: input.calibration,
      sourceRevision: "90a7067+sprint-3-diff",
      runtime: "node-v24.16.0",
      dependencies: {
        typescript: "5.9.3",
      },
      reproductionCommand: "pnpm scoring:evaluate",
    },
  };
  return { bundle, bundleSha256: hashBundle(bundle).sha256, report };
};
