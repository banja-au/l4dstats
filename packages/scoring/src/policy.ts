import {
  scoreSchemaVersion,
  type ReviewScore,
  type ScoreContribution,
} from "@l4dstats/contracts";
import { calibratedProbability, rawLogit } from "./logistic.js";
import type {
  AggregatedPlayer,
  ModelBundle,
  ScoreContext,
  ScoreResult,
} from "./types.js";

const featureRecord = (
  player: AggregatedPlayer,
): Readonly<Record<string, number>> =>
  Object.fromEntries(player.features.map((f) => [f.id, f.cappedValue]));
const contributionFor = (
  player: AggregatedPlayer,
  bundle: ModelBundle,
): readonly ScoreContribution[] =>
  bundle.logistic.features.map((spec, index) => {
    const feature = player.features.find((f) => f.id === spec.id);
    const raw = feature?.rawValue ?? 0,
      capped = feature?.cappedValue ?? 0,
      coefficient = bundle.logistic.coefficients[index]!;
    return {
      featureId: spec.id,
      rawValue: raw,
      cappedValue: capped,
      coefficient,
      logOddsContribution:
        coefficient *
        ((Math.min(spec.maximum, Math.max(spec.minimum, capped)) - spec.mean) /
          spec.scale),
      evidenceIds: feature?.evidence.map((e) => e.id) ?? [],
      tickRanges: feature?.evidence.map((e) => e.tickRange) ?? [],
      explanation: `Capped ${spec.id} contribution to the review model.`,
      limitations: [
        ...new Set(feature?.evidence.flatMap((e) => e.limitations) ?? []),
      ],
      counterevidence: [
        ...new Set(feature?.evidence.flatMap((e) => e.counterevidence) ?? []),
      ],
    };
  });
export const applyPolicy = (
  player: AggregatedPlayer,
  bundle: ModelBundle,
  context: ScoreContext,
): ScoreResult => {
  const policy = bundle.policy,
    reasons: string[] = [];
  if (player.encounterCount < policy.minimumIndependentEncounters)
    reasons.push(
      `requires at least ${policy.minimumIndependentEncounters} independent encounters`,
    );
  if (player.demoCount < policy.minimumIndependentDemos)
    reasons.push(
      `requires at least ${policy.minimumIndependentDemos} independent demos`,
    );
  if (player.signalFamilyCount < policy.minimumIndependentSignalFamilies)
    reasons.push(
      `requires at least ${policy.minimumIndependentSignalFamilies} independent signal families`,
    );
  if (player.reconstructionQuality < policy.minimumReconstructionQuality)
    reasons.push(
      `reconstruction quality is below ${policy.minimumReconstructionQuality}`,
    );
  const evidenceBundles = [
    ...new Set(player.evidence.map((e) => e.evidenceBundleSha256)),
  ].sort();
  const detectorVersions = Object.fromEntries(
    [
      ...new Map(
        player.evidence.map((e) => [e.detectorId, e.detectorVersion]),
      ).entries(),
    ].sort(([a], [b]) => a.localeCompare(b)),
  );
  const contributions = contributionFor(player, bundle),
    counter = [
      ...new Set(player.evidence.flatMap((e) => e.counterevidence)),
    ].slice(0, 5);
  const common = {
    schemaVersion: scoreSchemaVersion,
    playerKey: player.playerKey,
    model: {
      id: bundle.id,
      version: bundle.version,
      bundleSha256: context.bundleSha256,
    },
    policyVersion: policy.version,
    dataQuality: player.dataQuality,
    reconstructionQuality: player.reconstructionQuality,
    independentEvidence: {
      encounters: player.encounterCount,
      demos: player.demoCount,
      signalFamilies: player.signalFamilyCount,
    },
    contributions,
    strongestCounterevidence: counter,
    limitations: [
      ...new Set([
        ...bundle.limitations,
        ...player.evidence.flatMap((e) => e.limitations),
      ]),
    ],
    provenance: {
      evidenceBundleSha256s: evidenceBundles,
      detectorVersions,
      configSha256: context.configSha256,
      modelBundleSha256: context.bundleSha256,
      datasetManifestSha256: bundle.datasetManifestSha256,
    },
    researchOnly: true as const,
  };
  if (reasons.length)
    return {
      score: {
        ...common,
        status: "insufficient-data",
        label: "insufficient-data",
        reasons,
      },
    };
  const logit = rawLogit(bundle.logistic, featureRecord(player));
  const anomalous =
    player.reconstructionQuality >= policy.minimumReconstructionQuality &&
    (player.demoCount >= policy.highlyAnomalousMinimumDemos ||
      player.signalFamilies.filter((family) =>
        policy.orthogonalSignalFamilies.includes(family),
      ).length >= policy.highlyAnomalousMinimumSignalFamilies);
  const label = anomalous ? ("highly-anomalous" as const) : ("review" as const);
  if (!bundle.calibrationAccepted || !bundle.operatingPointAccepted)
    return {
      rawLogit: logit,
      score: {
        ...common,
        status: "ranked-evidence",
        label,
        uncalibratedEvidenceStrength: logit,
        reasons: [
          "calibration or operating-point gate did not pass; numeric priority withheld",
        ],
      },
    };
  const probability = calibratedProbability(bundle.platt, logit);
  const score: ReviewScore = {
    ...common,
    status: "calibrated-priority",
    label,
    reviewPriority: probability,
    calibration: {
      method: "platt",
      reportSha256: bundle.calibrationReportSha256,
    },
  };
  return { score, rawLogit: logit };
};
