import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { aggregateEvidence } from "./aggregate.js";
import { canonicalJson, hashBundle, verifyBundle } from "./bundle.js";
import { trainAndEvaluate } from "./evaluate.js";
import {
  calibratedProbability,
  fitLogistic,
  fitPlatt,
  sigmoid,
  stableLogLoss,
} from "./logistic.js";
import {
  brierScore,
  falsePositivesPer1000,
  playerBootstrap,
  precisionRecallCurve,
  prevalenceAwarePpv,
  reliability,
} from "./metrics.js";
import { applyPolicy } from "./policy.js";
import type {
  AggregationCaps,
  FeatureSpec,
  ModelBundle,
  ModelRow,
  OperatingPolicy,
  ScoringEvidence,
} from "./types.js";
import { validateSplitIsolation } from "./validate.js";

const hash = "a".repeat(64),
  hash2 = "b".repeat(64);
const caps: AggregationCaps = {
  detectorPerEncounter: 1,
  familyPerEncounter: 1.5,
  encounter: 2,
  familyPerDemo: 2,
  familyPerPlayer: 3,
};
const evidence = (
  overrides: Partial<ScoringEvidence> = {},
): ScoringEvidence => ({
  id: "e1",
  playerKey: "controlled-player",
  playerEpochId: "epoch",
  demoSha256: hash,
  encounterId: "encounter-1",
  detectorId: "aim-dynamics",
  detectorVersion: "1.0.0",
  signalFamily: "aim",
  tickRange: { start: 10, end: 12 },
  strength: 1,
  quality: 1,
  reconstructionQuality: 0.9,
  explanation: "controlled evidence",
  limitations: [],
  counterevidence: ["human action can resemble this pattern"],
  evidenceBundleSha256: hash2,
  ...overrides,
});
const policy: OperatingPolicy = {
  version: "policy-v1",
  minimumIndependentEncounters: 2,
  minimumIndependentDemos: 1,
  minimumIndependentSignalFamilies: 1,
  minimumReconstructionQuality: 0.8,
  highlyAnomalousMinimumDemos: 2,
  highlyAnomalousMinimumSignalFamilies: 2,
  orthogonalSignalFamilies: ["aim", "awareness"],
  falsePositiveBudgetPer1000: 500,
  minimumRecall: 0.5,
  maximumBrier: 0.3,
  maximumEce: 0.6,
  maximumCalibrationGap: 0.6,
  minimumCalibrationRows: 2,
  minimumEvaluationRowsPerLabel: 1,
  decisionThreshold: 0.5,
};
const specs: readonly FeatureSpec[] = [
  {
    id: "family:aim",
    mean: 0,
    scale: 1,
    minimum: 0,
    maximum: 3,
    required: true,
  },
  {
    id: "independent-encounters",
    mean: 0,
    scale: 1,
    minimum: 0,
    maximum: 10,
    required: true,
  },
];
const rows: ModelRow[] = [
  ["train-a", 0, "train"],
  ["train-b", 1, "train"],
  ["cal-a", 0, "calibration"],
  ["cal-b", 1, "calibration"],
  ["test-a", 0, "test"],
  ["test-b", 1, "test"],
].map(([key, label, split], i) => ({
  playerKey: String(key),
  playerGroupId: String(key),
  fixtureFamilyId: `fixture-${split}`,
  serverId: `server-${split}`,
  timeBucket: `time-${split}`,
  split: split as ModelRow["split"],
  features: {
    "family:aim": Number(label) * 2,
    "independent-encounters": 1 + Number(label) * 2,
  },
  label: Number(label) as 0 | 1,
  labelProvenance: "synthetic-controlled",
  i,
}));
const trained = () =>
  trainAndEvaluate({
    id: "controlled-review-model",
    version: "1.0.0",
    rows,
    features: specs,
    training: { iterations: 500, learningRate: 0.1, l2: 0.01 },
    calibration: { iterations: 500, learningRate: 0.05, l2: 0 },
    policy,
    caps,
    datasetManifestSha256: hash,
  });

describe("hierarchical aggregation", () => {
  it("is order invariant, collapses duplicate detector windows, and applies every cap", () => {
    const items = [
      evidence(),
      evidence({ id: "duplicate", strength: 99 }),
      evidence({
        id: "aware",
        detectorId: "hidden",
        signalFamily: "awareness",
        strength: 2,
      }),
      evidence({ id: "second", encounterId: "encounter-2", strength: 2 }),
      evidence({
        id: "other-demo",
        demoSha256: hash2,
        encounterId: "encounter-3",
        strength: 2,
      }),
    ];
    const a = aggregateEvidence(items, caps),
      b = aggregateEvidence([...items].reverse(), caps);
    expect(a).toEqual(b);
    expect(a.encounterCount).toBe(3);
    expect(a.demoCount).toBe(2);
    expect(a.signalFamilyCount).toBe(2);
    expect(a.features.find((f) => f.id === "family:aim")?.cappedValue).toBe(3);
  });
  it("rejects mixed players, invalid ticks, NaN, and out-of-range quality", () => {
    expect(() =>
      aggregateEvidence([evidence(), evidence({ playerKey: "other" })], caps),
    ).toThrow(/multiple players/);
    expect(() =>
      aggregateEvidence([evidence({ strength: Number.NaN })], caps),
    ).toThrow(/finite/);
    expect(() => aggregateEvidence([evidence({ quality: 1.1 })], caps)).toThrow(
      /\[0,1\]/,
    );
    expect(() =>
      aggregateEvidence([evidence({ tickRange: { start: 2, end: 1 } })], caps),
    ).toThrow(/tick range/);
    expect(() =>
      aggregateEvidence(
        [
          evidence(),
          evidence({
            id: "v2",
            encounterId: "encounter-2",
            detectorVersion: "2.0.0",
          }),
        ],
        caps,
      ),
    ).toThrow(/mixed detector versions/);
  });
});

describe("deterministic model and evaluation", () => {
  it("keeps sigmoid and log loss finite at extreme logits", () => {
    expect(sigmoid(1000)).toBe(1);
    expect(sigmoid(-1000)).toBe(0);
    expect(stableLogLoss(1000, 1)).toBe(0);
    expect(Number.isFinite(stableLogLoss(1000, 0))).toBe(true);
  });
  it("fits logistic and Platt deterministically and monotonically", () => {
    const a = fitLogistic(rows.slice(0, 2), specs, {
        iterations: 100,
        learningRate: 0.1,
        l2: 0.01,
      }),
      b = fitLogistic(rows.slice(0, 2), specs, {
        iterations: 100,
        learningRate: 0.1,
        l2: 0.01,
      });
    expect(a).toEqual(b);
    const p = fitPlatt([-2, 2], [0, 1], {
      iterations: 100,
      learningRate: 0.1,
      l2: 0,
    });
    expect(calibratedProbability(p, -2)).toBeLessThan(
      calibratedProbability(p, 2),
    );
  });
  it("rejects player and server/time leakage", () => {
    expect(() =>
      validateSplitIsolation([
        ...rows,
        {
          ...rows[0]!,
          playerKey: "same-group-other-player",
          split: "test",
          serverId: "isolated",
          timeBucket: "isolated",
        },
      ]),
    ).toThrow(/player split leakage/);
    expect(() =>
      validateSplitIsolation([
        ...rows,
        {
          ...rows[0]!,
          playerKey: "x",
          playerGroupId: "x",
          fixtureFamilyId: "isolated-fixture",
          serverId: "server-train",
          timeBucket: "time-train",
          split: "test",
        },
      ]),
    ).toThrow(/server\/time split leakage/);
    expect(() =>
      validateSplitIsolation([
        ...rows,
        {
          ...rows[0]!,
          playerKey: "fixture-leak-player",
          playerGroupId: "fixture-leak-group",
          serverId: "fixture-leak-server",
          timeBucket: "fixture-leak-time",
          split: "test",
        },
      ]),
    ).toThrow(/fixture-family split leakage/);
    expect(() => validateSplitIsolation([...rows, rows[0]!])).toThrow(
      /duplicate player row/,
    );
  });
  it("produces byte-identical controlled-fixture results", () => {
    expect(trained()).toEqual(trained());
    expect(trained().bundle.limitations).toContain(
      "reference-validation-pending",
    );
    expect(trained().report.brierInterval.method).toBe("player-bootstrap");
    expect(trained().report.precisionRecall.length).toBeGreaterThan(0);
  });
  it("keeps committed fixtures synthetic, player-level, and split-isolated", () => {
    for (const name of ["controlled-v1.json", "poor-calibration-v1.json"]) {
      const fixture = JSON.parse(
        readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"),
      ) as {
        metadata: { limitations: string[]; identityPolicy: string };
        rows: ModelRow[];
      };
      expect(fixture.metadata.identityPolicy).toContain(
        "no real player identity",
      );
      expect(fixture.metadata.limitations).toContain(
        "reference-validation-pending",
      );
      expect(
        fixture.rows.every(
          (row) => row.labelProvenance === "synthetic-controlled",
        ),
      ).toBe(true);
      validateSplitIsolation(fixture.rows);
    }
  });
});

describe("metrics", () => {
  const predictions = [
    { playerKey: "a", probability: 0.1, label: 0 as const },
    { playerKey: "b", probability: 0.9, label: 1 as const },
    { playerKey: "c", probability: 0.9, label: 0 as const },
  ];
  it("computes Brier, reliability, tied PR thresholds and FP/1000", () => {
    expect(brierScore(predictions)).toBeCloseTo(0.2766667);
    expect(
      reliability(predictions, 2).bins.reduce((s, b) => s + b.count, 0),
    ).toBe(3);
    expect(precisionRecallCurve(predictions)).toHaveLength(2);
    expect(falsePositivesPer1000(predictions, 0.5)).toBe(500);
  });
  it("computes prevalence PPV and handles a zero denominator", () => {
    expect(prevalenceAwarePpv(0.8, 0.9, 0.1)).toBeCloseTo(0.470588);
    expect(prevalenceAwarePpv(0, 1, 0)).toBeNull();
  });
  it("bootstraps whole players deterministically", () => {
    const a = playerBootstrap(predictions, brierScore, {
        replicates: 20,
        seed: 42,
        level: 0.9,
      }),
      b = playerBootstrap(predictions, brierScore, {
        replicates: 20,
        seed: 42,
        level: 0.9,
      });
    expect(a).toEqual(b);
    expect(a.values).toHaveLength(20);
  });
});

describe("policy and immutable bundles", () => {
  const player = (items: ScoringEvidence[]) => aggregateEvidence(items, caps);
  const context = {
    bundleSha256: hash,
    configSha256: hash2,
  };
  it("withholds every numeric score below independent evidence", () => {
    const result = applyPolicy(
      player([evidence()]),
      trained().bundle,
      context,
    ).score;
    expect(result.status).toBe("insufficient-data");
    expect("reviewPriority" in result).toBe(false);
    expect("uncalibratedEvidenceStrength" in result).toBe(false);
  });
  it("requires reconstruction plus demo persistence or orthogonal families", () => {
    const oneFamily = player([
      evidence(),
      evidence({ id: "e2", encounterId: "encounter-2" }),
    ]);
    expect(applyPolicy(oneFamily, trained().bundle, context).score.label).toBe(
      "review",
    );
    const orthogonal = player([
      evidence(),
      evidence({
        id: "e2",
        encounterId: "encounter-2",
        signalFamily: "awareness",
        detectorId: "hidden",
      }),
    ]);
    expect(applyPolicy(orthogonal, trained().bundle, context).score.label).toBe(
      "highly-anomalous",
    );
    const low = player([
      evidence({ reconstructionQuality: 0.5 }),
      evidence({
        id: "e2",
        encounterId: "encounter-2",
        demoSha256: hash2,
        reconstructionQuality: 0.5,
      }),
    ]);
    expect(applyPolicy(low, trained().bundle, context).score.status).toBe(
      "insufficient-data",
    );
  });
  it("ships probability-free ranked evidence when calibration fails", () => {
    const bad: ModelBundle = {
      ...trained().bundle,
      calibrationAccepted: false,
    };
    const score = applyPolicy(
      player([evidence(), evidence({ id: "e2", encounterId: "encounter-2" })]),
      bad,
      context,
    ).score;
    expect(score.status).toBe("ranked-evidence");
    expect("reviewPriority" in score).toBe(false);
  });
  it("withholds numeric output when the operating budget fails", () => {
    const bad: ModelBundle = {
      ...trained().bundle,
      calibrationAccepted: true,
      operatingPointAccepted: false,
    };
    const score = applyPolicy(
      player([evidence(), evidence({ id: "e2", encounterId: "encounter-2" })]),
      bad,
      context,
    ).score;
    expect(score.status).toBe("ranked-evidence");
    expect("reviewPriority" in score).toBe(false);
  });
  it("does not count zero-strength evidence as corroboration", () => {
    const score = applyPolicy(
      player([
        evidence(),
        evidence({
          id: "zero",
          encounterId: "encounter-2",
          signalFamily: "awareness",
          detectorId: "hidden",
          strength: 0,
        }),
      ]),
      trained().bundle,
      context,
    ).score;
    expect(score.status).toBe("insufficient-data");
  });
  it("canonicalizes keys and detects mutated bundles", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    const result = hashBundle(trained().bundle);
    expect(verifyBundle(result.sha256, result.json)).toEqual(result.bundle);
    expect(() =>
      verifyBundle(
        result.sha256,
        result.json.replace("research-only", "other"),
      ),
    ).toThrow(/hash mismatch/);
  });
});
