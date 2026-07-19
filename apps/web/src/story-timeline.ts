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

export interface PinPairEvent {
  type: string;
  actor?: string;
  victim?: string;
  actorPlayerId?: string;
  victimPlayerId?: string;
  infectedClass?: string;
}

/** Pairs retained pin starts in one chronological pass. */
export function pairObservedPins(
  events: readonly PinPairEvent[],
): Array<{ startIndex: number; endIndex: number }> {
  const active: number[] = [];
  const pairs: Array<{ startIndex: number; endIndex: number }> = [];
  for (let endIndex = 0; endIndex < events.length; endIndex += 1) {
    const end = events[endIndex]!;
    if (end.type === "pin_start") {
      active.push(endIndex);
      continue;
    }
    if (end.type !== "pin_end" && end.type !== "death") continue;
    const activeIndex = active.findIndex((startIndex) => {
      const start = events[startIndex]!;
      const endActorId =
        end.type === "death" ? end.victimPlayerId : end.actorPlayerId;
      const endActor = end.type === "death" ? end.victim : end.actor;
      const sameActor =
        start.actorPlayerId && endActorId
          ? start.actorPlayerId === endActorId
          : start.actor === endActor;
      if (!sameActor || start.infectedClass !== end.infectedClass) return false;
      if (end.type === "death") return true;
      return start.victimPlayerId && end.victimPlayerId
        ? start.victimPlayerId === end.victimPlayerId
        : start.victim === end.victim;
    });
    if (activeIndex < 0) continue;
    pairs.push({ startIndex: active[activeIndex]!, endIndex });
    active.splice(activeIndex, 1);
  }
  return pairs;
}
