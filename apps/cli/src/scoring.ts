import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  canonicalJson,
  hashBundle,
  hashBytes,
  trainAndEvaluate,
  type ModelRow,
} from "@l4dstats/scoring";

interface ControlledDataset {
  readonly schemaVersion: 1;
  readonly metadata: {
    readonly id: string;
    readonly limitations: readonly string[];
    readonly identityPolicy: string;
  };
  readonly rows: readonly ModelRow[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseControlledDataset = (value: unknown): ControlledDataset => {
  if (!isRecord(value) || value.schemaVersion !== 1)
    throw new TypeError("controlled dataset must use schemaVersion 1");
  if (!isRecord(value.metadata) || !Array.isArray(value.rows))
    throw new TypeError("controlled dataset requires metadata and rows");
  if (
    typeof value.metadata.id !== "string" ||
    typeof value.metadata.identityPolicy !== "string" ||
    !Array.isArray(value.metadata.limitations) ||
    !value.metadata.limitations.includes("research-only") ||
    !value.metadata.limitations.includes("reference-validation-pending")
  )
    throw new TypeError(
      "controlled dataset is missing mandatory governance metadata",
    );
  return value as unknown as ControlledDataset;
};

export const evaluateControlledDataset = (dataset: ControlledDataset) => {
  const datasetManifestSha256 = hashBytes(canonicalJson(dataset));
  return trainAndEvaluate({
    id: "l4dstats-controlled-review-priority",
    version: "1.0.0",
    rows: dataset.rows,
    features: [
      {
        id: "family:aim",
        mean: 1.25,
        scale: 1.25,
        minimum: 0,
        maximum: 3,
        required: true,
      },
      {
        id: "independent-encounters",
        mean: 2.5,
        scale: 1.5,
        minimum: 0,
        maximum: 10,
        required: true,
      },
    ],
    training: { iterations: 2_000, learningRate: 0.1, l2: 0.01 },
    calibration: { iterations: 2_000, learningRate: 0.1, l2: 0 },
    policy: {
      version: "controlled-policy-v1",
      minimumIndependentEncounters: 2,
      minimumIndependentDemos: 1,
      minimumIndependentSignalFamilies: 1,
      minimumReconstructionQuality: 0.8,
      highlyAnomalousMinimumDemos: 2,
      highlyAnomalousMinimumSignalFamilies: 2,
      orthogonalSignalFamilies: ["aim", "awareness", "movement", "invariant"],
      falsePositiveBudgetPer1000: 50,
      minimumRecall: 0.6,
      maximumBrier: 0.25,
      maximumEce: 0.1,
      maximumCalibrationGap: 0.2,
      minimumCalibrationRows: 2,
      minimumEvaluationRowsPerLabel: 20,
      decisionThreshold: 0.5,
    },
    caps: {
      detectorPerEncounter: 1,
      familyPerEncounter: 1.5,
      encounter: 2,
      familyPerDemo: 2,
      familyPerPlayer: 3,
    },
    datasetManifestSha256,
  });
};

const publish = async (path: string, contents: string): Promise<void> => {
  try {
    await writeFile(path, contents, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
      throw error;
    if ((await readFile(path, "utf8")) !== contents)
      throw new Error(
        `refusing to replace non-identical immutable artifact ${path}`,
      );
  }
};

export const writeCalibrationArtifacts = async (
  dataset: ControlledDataset,
  outputDirectory: string,
) => {
  const result = evaluateControlledDataset(dataset);
  const hashed = hashBundle(result.bundle);
  const reportJson = canonicalJson(result.report);
  const reportSha256 = hashBytes(reportJson);
  if (
    hashed.sha256 !== result.bundleSha256 ||
    reportSha256 !== result.bundle.calibrationReportSha256
  )
    throw new Error("artifact hash changed during publication");
  await mkdir(outputDirectory, { recursive: true });
  const modelPath = join(outputDirectory, `${hashed.sha256}.model.json`);
  const reportPath = join(outputDirectory, `${reportSha256}.calibration.json`);
  await publish(modelPath, hashed.json);
  await publish(reportPath, reportJson);
  return {
    schemaVersion: 1 as const,
    controlledFixtureOnly: true as const,
    modelPath,
    modelSha256: hashed.sha256,
    reportPath,
    reportSha256,
    usefulOperatingPoint: result.report.usefulOperatingPoint,
    calibrationAccepted: result.report.calibrationAccepted,
    limitations: result.report.limitations,
  };
};
