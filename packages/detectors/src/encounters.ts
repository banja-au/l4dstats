import type { EvidenceWindow } from "./types.js";

export interface Encounter {
  readonly id: string;
  readonly playerEpochId: string;
  readonly tickRange: { readonly start: number; readonly end: number };
  readonly evidence: readonly EvidenceWindow[];
  readonly strongestEffect: EvidenceWindow["effect"];
}

/** Collapses nearby outputs from the same detector/provenance into causal review units. */
export const segmentEncounters = (
  windows: readonly EvidenceWindow[],
  maximumTickGap: number,
): readonly Encounter[] => {
  if (!Number.isInteger(maximumTickGap) || maximumTickGap < 0)
    throw new RangeError("maximumTickGap must be a non-negative integer");
  const sorted = [...windows].sort(
    (a, b) =>
      a.playerEpochId.localeCompare(b.playerEpochId) ||
      a.provenance.detectorId.localeCompare(b.provenance.detectorId) ||
      a.tickRange.start - b.tickRange.start ||
      a.id.localeCompare(b.id),
  );
  const groups: EvidenceWindow[][] = [];
  for (const item of sorted) {
    if (item.tickRange.end < item.tickRange.start)
      throw new RangeError(`invalid tick range for ${item.id}`);
    const group = groups.at(-1),
      previous = group?.at(-1);
    const groupEnd = group
      ? Math.max(...group.map((evidence) => evidence.tickRange.end))
      : -Infinity;
    const sameCause =
      previous &&
      previous.playerEpochId === item.playerEpochId &&
      previous.provenance.detectorId === item.provenance.detectorId &&
      previous.provenance.detectorVersion === item.provenance.detectorVersion &&
      previous.provenance.configSha256 === item.provenance.configSha256 &&
      item.tickRange.start <= groupEnd + maximumTickGap;
    if (sameCause) group!.push(item);
    else groups.push([item]);
  }
  return groups.map((group) => {
    const first = group[0]!,
      last = group.at(-1)!;
    const strongest = group.reduce(
      (best, item) => (item.effect.value > best.effect.value ? item : best),
      first,
    );
    return {
      id: `encounter:${first.playerEpochId}:${first.provenance.detectorId}:${first.tickRange.start}`,
      playerEpochId: first.playerEpochId,
      tickRange: {
        start: first.tickRange.start,
        end: Math.max(...group.map((e) => e.tickRange.end)),
      },
      evidence: group,
      strongestEffect: strongest.effect,
    };
  });
};
