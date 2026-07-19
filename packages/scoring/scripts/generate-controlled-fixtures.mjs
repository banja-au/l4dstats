import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

const splitConfig = [
  ["train", 40, 7, 11, "grid-7-11"],
  ["calibration", 40, 13, 17, "grid-13-17"],
  ["test", 40, 19, 23, "grid-19-23"],
];

const rows = (invertedTest = false) =>
  splitConfig.flatMap(
    ([split, count, routineStep, anomalyStep, scenarioLibrary], splitIndex) =>
      Array.from({ length: count }, (_, index) => {
        const label = index % 2;
        const controlledStrength =
          label === 0
            ? 0.1 + ((index * routineStep + splitIndex * 3) % 8) * 0.055
            : 1.8 + ((index * anomalyStep + splitIndex * 5) % 10) * 0.07;
        const controlledEncounters =
          label === 0 ? 1 + (index % 2) : 3 + (index % 3);
        const observedLabel =
          invertedTest && split === "test" ? 1 - label : label;
        return {
          playerKey: `fixture-${invertedTest ? "poor-" : ""}${split}-${String(index).padStart(2, "0")}`,
          playerGroupId: `group-${invertedTest ? "poor-" : ""}${split}-${String(index).padStart(2, "0")}`,
          // Family identity derives from the independently versioned scenario
          // library, not from the requested split. Accidental library reuse across
          // splits therefore trips the evaluator's leakage check.
          fixtureFamilyId: `fixture-family-${invertedTest ? "poor-" : ""}${scenarioLibrary}-${label}-${index % 4}`,
          serverId: `controlled-server-${invertedTest ? "poor-" : ""}${split}`,
          timeBucket: `controlled-time-${invertedTest ? "poor-" : ""}${split}`,
          split,
          features: {
            "family:aim": controlledStrength,
            "independent-encounters": controlledEncounters,
          },
          label: observedLabel,
          labelProvenance: "synthetic-controlled",
        };
      }),
  );

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]),
    );
  return value;
};

const sha256 = (value) =>
  createHash("sha256")
    .update(`${JSON.stringify(canonical(value), null, 2)}\n`)
    .digest("hex");

const fixture = (poor) => {
  const generatedRows = rows(poor);
  const splitManifest = generatedRows.map(
    ({ playerKey, fixtureFamilyId, split }) => ({
      playerKey,
      fixtureFamilyId,
      split,
    }),
  );
  const composition = Object.fromEntries(
    ["train", "calibration", "test"].map((split) => [
      split,
      Object.fromEntries(
        [0, 1].map((label) => {
          const matching = generatedRows.filter(
            (row) => row.split === split && row.label === label,
          );
          return [
            label === 0 ? "routine" : "reviewWorthyControlledAnomaly",
            {
              players: matching.length,
              encounters: matching.reduce(
                (total, row) => total + row.features["independent-encounters"],
                0,
              ),
              fixtureFamilies: new Set(
                matching.map((row) => row.fixtureFamilyId),
              ).size,
            },
          ];
        }),
      ),
    ]),
  );
  return {
    schemaVersion: 1,
    metadata: {
      id: poor
        ? "l4dstats-synthetic-poor-calibration-v1"
        : "l4dstats-synthetic-controlled-v1",
      generator: "generate-controlled-fixtures.mjs@1.0.0",
      seed: "closed-form-v1",
      scenarioLibraryVersion: "controlled-scenarios-v1",
      labelPolicyVersion: "controlled-label-policy-v1",
      splitLibraries: {
        train: { template: "grid-7-11", seed: "train-v1" },
        calibration: { template: "grid-13-17", seed: "calibration-v1" },
        test: { template: "grid-19-23", seed: "test-v1" },
      },
      createdAt: "2026-07-17T00:00:00.000Z",
      owner: "L4DStats maintainers",
      retention: "tracked synthetic fixture; no personal data",
      artifactDigests: {
        splitManifestSha256: sha256(splitManifest),
      },
      exclusions: [],
      exclusionReasonSchema: "controlled-exclusion-reasons-v1",
      missingness: {
        featureCellsMissing: 0,
        featureCellsTotal: generatedRows.length * 2,
        rate: 0,
        reason: "none by construction",
      },
      reconstructionQuality: {
        status: "not-applicable",
        reason: "fixture starts from synthetic player-level feature rows",
      },
      demos: {
        status: "not-applicable",
        reason: "fixture starts from synthetic player-level feature rows",
      },
      composition,
      lineage: "closed-form feature rows -> player-level controlled labels",
      redistribution: "CC0-1.0",
      semantics: poor
        ? "Synthetic player-level rows deliberately invert held-out controlled labels to force numeric withholding."
        : "Synthetic player-level rows exercise calibration machinery only. Labels mean controlled review condition, never a real-player verdict.",
      limitations: [
        "research-only",
        "reference-validation-pending",
        poor ? "deliberately-miscalibrated" : "not-population-representative",
      ],
      identityPolicy:
        "Invented fixture identifiers only; no real player identity.",
    },
    rows: generatedRows,
  };
};

for (const [name, poor] of [
  ["controlled-v1.json", false],
  ["poor-calibration-v1.json", true],
])
  await writeFile(
    new URL(`../fixtures/${name}`, import.meta.url),
    `${JSON.stringify(fixture(poor), null, 2)}\n`,
    "utf8",
  );
