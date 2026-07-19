export interface StoryHitAnchor {
  id: string;
  startTick: number;
}

export interface StoryHitNumber {
  hit: number;
  round: number;
  observedBoundary: boolean;
}

/** Numbers hits within observed round-start boundaries without inventing one. */
export function numberHitsByObservedRounds(
  hits: readonly StoryHitAnchor[],
  observedRoundStarts: readonly number[],
): Map<string, StoryHitNumber> {
  const starts = [...observedRoundStarts].sort((left, right) => left - right);
  const counters = new Map<number, number>();
  const result = new Map<string, StoryHitNumber>();
  for (const hit of [...hits].sort(
    (left, right) => left.startTick - right.startTick,
  )) {
    const observedRound = starts.reduce(
      (found, tick, index) => (tick <= hit.startTick ? index : found),
      -1,
    );
    const round = observedRound + 1;
    const ordinal = (counters.get(round) ?? 0) + 1;
    counters.set(round, ordinal);
    result.set(hit.id, {
      hit: ordinal,
      round,
      observedBoundary: observedRound >= 0,
    });
  }
  return result;
}
