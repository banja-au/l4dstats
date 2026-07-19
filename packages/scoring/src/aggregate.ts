import { evidenceKinds } from "@l4dstats/contracts";
import type {
  AggregatedPlayer,
  AggregationCaps,
  FeatureValue,
  ScoringEvidence,
} from "./types.js";
import { finite, validateEvidence } from "./validate.js";

const clipped = (value: number, cap: number): number => Math.min(value, cap);
const average = (xs: readonly number[]): number =>
  xs.reduce((a, b) => a + b, 0) / xs.length;

export const aggregateEvidence = (
  input: readonly ScoringEvidence[],
  caps: AggregationCaps,
): AggregatedPlayer => {
  validateEvidence(input);
  if (input.length === 0)
    throw new RangeError("cannot aggregate empty evidence");
  for (const [name, cap] of Object.entries(caps))
    if (!(finite(cap, name) > 0))
      throw new RangeError(`${name} must be positive`);
  const playerKey = input[0]!.playerKey;
  if (input.some((item) => item.playerKey !== playerKey))
    throw new Error("evidence belongs to multiple players");
  const sorted = [...input].sort(
    (a, b) =>
      a.demoSha256.localeCompare(b.demoSha256) ||
      a.encounterId.localeCompare(b.encounterId) ||
      a.signalFamily.localeCompare(b.signalFamily) ||
      a.detectorId.localeCompare(b.detectorId) ||
      a.id.localeCompare(b.id),
  );
  const qualifying = sorted.filter(
    (item) => item.strength > 0 && item.quality > 0,
  );
  const demos = new Map<string, Map<string, ScoringEvidence[]>>();
  for (const item of qualifying) {
    const encounters =
      demos.get(item.demoSha256) ?? new Map<string, ScoringEvidence[]>();
    const prior = encounters.get(item.encounterId) ?? [];
    encounters.set(item.encounterId, [...prior, item]);
    demos.set(item.demoSha256, encounters);
  }
  const familyRaw = new Map<string, number>();
  const familyDemo = new Map<string, number>();
  for (const encounters of demos.values()) {
    const demoFamily = new Map<string, number>();
    for (const evidence of encounters.values()) {
      const byFamily = new Map<string, ScoringEvidence[]>();
      for (const item of evidence)
        byFamily.set(item.signalFamily, [
          ...(byFamily.get(item.signalFamily) ?? []),
          item,
        ]);
      let encounterTotal = 0;
      const encounterParts = new Map<string, number>();
      for (const [family, members] of byFamily) {
        const strongestByDetector = new Map<string, number>();
        for (const item of members) {
          const value = clipped(
            item.strength * item.quality,
            caps.detectorPerEncounter,
          );
          strongestByDetector.set(
            item.detectorId,
            Math.max(strongestByDetector.get(item.detectorId) ?? 0, value),
          );
        }
        const raw = [...strongestByDetector.values()].reduce(
          (a, b) => a + b,
          0,
        );
        const value = clipped(raw, caps.familyPerEncounter);
        encounterParts.set(family, value);
        encounterTotal += value;
      }
      const encounterScale =
        encounterTotal > caps.encounter ? caps.encounter / encounterTotal : 1;
      for (const [family, value] of encounterParts)
        demoFamily.set(
          family,
          (demoFamily.get(family) ?? 0) + value * encounterScale,
        );
    }
    for (const [family, raw] of demoFamily) {
      familyRaw.set(family, (familyRaw.get(family) ?? 0) + raw);
      familyDemo.set(
        family,
        (familyDemo.get(family) ?? 0) + clipped(raw, caps.familyPerDemo),
      );
    }
  }
  const features: FeatureValue[] = evidenceKinds.map((family) => ({
    id: `family:${family}`,
    rawValue: familyRaw.get(family) ?? 0,
    cappedValue: clipped(familyDemo.get(family) ?? 0, caps.familyPerPlayer),
    evidence: qualifying.filter((item) => item.signalFamily === family),
  }));
  features.push(
    {
      id: "independent-encounters",
      rawValue: [...demos.values()].reduce((n, m) => n + m.size, 0),
      cappedValue: [...demos.values()].reduce((n, m) => n + m.size, 0),
      evidence: qualifying,
    },
    {
      id: "demo-persistence",
      rawValue: demos.size,
      cappedValue: demos.size,
      evidence: qualifying,
    },
  );
  return {
    playerKey,
    features,
    encounterCount: [...demos.values()].reduce((n, m) => n + m.size, 0),
    demoCount: demos.size,
    signalFamilyCount: new Set(qualifying.map((item) => item.signalFamily))
      .size,
    signalFamilies: [
      ...new Set(qualifying.map((item) => item.signalFamily)),
    ].sort(),
    dataQuality: average(sorted.map((item) => item.quality)),
    reconstructionQuality: Math.min(
      ...sorted.map((item) => item.reconstructionQuality),
    ),
    evidence: qualifying,
  };
};
