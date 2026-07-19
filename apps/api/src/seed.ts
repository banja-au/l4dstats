import type { WorkbenchRepository } from "@l4dstats/storage";

/**
 * Seeds an explicitly controlled, invented case for local UI evaluation.
 * It is never enabled by default and contains no real demo or player identity.
 */
export function seedControlledWorkbench(repo: WorkbenchRepository): void {
  repo.upsertCase({
    id: "case-echo",
    playerKey: "controlled-fixture-player-04",
    status: "in-review",
    score: {
      schemaVersion: 1,
      status: "ranked-evidence",
      label: "highly-anomalous",
      researchOnly: true,
      reasons: ["Controlled UI fixture; population calibration is unavailable"],
      strongestCounterevidence: [
        "A teammate fired before the first target acquisition",
        "The occluded target may have been audible",
      ],
      limitations: [
        "Invented evidence for workflow evaluation only",
        "No real player or demo is represented",
      ],
      provenance: {
        fixture: "controlled-workbench-v1",
        referenceValidation: "pending",
      },
    },
  });
  repo.putWindow("case-echo", 21_586, 22_098, {
    schemaVersion: 1,
    startTick: 21_586,
    endTick: 22_098,
    bounded: true,
    poses: [
      { tick: 21_842, subject: [151, 142], target: [238, 118] },
      { tick: 22_018, subject: [159, 139], target: [246, 112] },
    ],
  });
  repo.setCaseLineage("case-echo", {
    fixture: "controlled-workbench-v1",
    source: { demoSha256: "0".repeat(64), origin: "controlled-fixture" },
    artifacts: { engineResultSha256: "1".repeat(64) },
    versions: {
      parser: "demo-source1-native@controlled-fixture",
      schema: "observations/v1",
      detectors: ["controlled-ui-fixture@1"],
      model: "none-controlled-fixture",
    },
    config: { id: "controlled-ui-fixture/v1" },
    map: { name: "controlled-grid", assetVersion: "not-applicable" },
    derivation: ["controlled fixture", "bounded telemetry window"],
    limitations: ["Invented workflow fixture; no real demo or player"],
  });
  repo.setCasePresentation("case-echo", {
    schemaVersion: 1,
    id: "case-echo",
    alias: "Controlled player 04",
    identityLabel: "Controlled identity · epoch 2",
    provenance: {
      controlledFixture: true,
      label: "Invented workflow fixture; no real demo or player",
    },
    demos: [
      {
        id: "controlled-demo-a",
        sha256: "0".repeat(64),
        mapName: "controlled_grid_a",
        sourceLabel: "controlled fixture",
        quality: { value: 0.96, basis: ["invented complete telemetry"] },
        corroboration: "same-stable-player",
      },
      {
        id: "controlled-demo-b",
        sha256: "2".repeat(64),
        mapName: "controlled_grid_b",
        sourceLabel: "controlled fixture",
        quality: { value: 0.82, basis: ["invented partial telemetry"] },
        corroboration: "same-stable-player",
      },
    ],
    evidence: [
      {
        id: "controlled-aim-21842",
        family: "aim",
        title: "Controlled abrupt target acquisition",
        tick: 21_842,
        tickRange: { start: 21_840, end: 21_844 },
        quality: { value: 0.96, basis: ["invented workflow evidence"] },
        contribution: null,
        explanation:
          "Invented aim window used only to exercise reviewer workflow.",
        counterevidence: ["A teammate fired before target acquisition."],
        limitations: ["No real demo or player is represented."],
        demoSha256: "0".repeat(64),
        window: { startTick: 21_586, endTick: 22_098, contextSeconds: 8 },
      },
      {
        id: "controlled-awareness-22018",
        family: "awareness",
        title: "Controlled occluded alignment",
        tick: 22_018,
        tickRange: { start: 22_016, end: 22_020 },
        quality: { value: 0.82, basis: ["invented workflow evidence"] },
        contribution: null,
        explanation:
          "Invented awareness window used only to exercise reviewer workflow.",
        counterevidence: ["The controlled target may have been audible."],
        limitations: ["No real visibility reconstruction is represented."],
        demoSha256: "2".repeat(64),
        window: { startTick: 21_586, endTick: 22_098, contextSeconds: 8 },
      },
    ],
    association: {
      kind: "stable-privacy-token",
      stableToken: "controlled-stable-player-04",
      corroboratingDemoCount: 1,
      explanation:
        "Controlled fixture explicitly assigns the same invented stable token across two invented demos.",
    },
    summary: {
      encounterCount: 2,
      independentSignalFamilies: ["aim", "awareness"],
    },
  });
}
