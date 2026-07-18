import type {
  CompetitiveStats,
  DemoStats,
  MatchTimelineEvent,
  PlayerStats,
} from "./api";
import { mergePlayerStats } from "./game-aggregation";

export const halfScopeKey = (demoSha256: string, halfId: string) =>
  `${demoSha256}:${halfId}`;

const inRanges = (
  tick: number,
  ranges: Array<{ start: number; end: number }>,
) => ranges.some((range) => tick >= range.start && tick <= range.end);

const scopeStatePoints = <T extends { tick: number }>(
  points: readonly T[],
  ranges: Array<{ start: number; end: number }>,
): T[] => {
  const selected = ranges.flatMap((range) => {
    const prior = [...points]
      .reverse()
      .find((point) => point.tick < range.start);
    return [
      ...(prior ? [prior] : []),
      ...points.filter(
        (point) => point.tick >= range.start && point.tick <= range.end,
      ),
    ];
  });
  return selected.filter(
    (point, index) =>
      selected.findIndex((candidate) => candidate.tick === point.tick) ===
      index,
  );
};

const rebuildClearStats = (
  timeline: MatchTimelineEvent[],
  tickRate: number | null,
): CompetitiveStats["clearStats"] => {
  const responses = new Map<
    string,
    { alias: string; responseSeconds: number[] }
  >();
  for (const clear of timeline.filter(
    (event) => event.type === "clear" && event.actor,
  )) {
    const playerId = clear.actorPlayerId ?? clear.actor!;
    const pinEnd = [...timeline]
      .reverse()
      .find(
        (event) =>
          event.type === "pin_end" &&
          event.tick === clear.tick &&
          (clear.victimPlayerId
            ? event.victimPlayerId === clear.victimPlayerId
            : event.victim === clear.victim) &&
          event.infectedClass === clear.infectedClass,
      );
    const pinStart = pinEnd
      ? [...timeline]
          .reverse()
          .find(
            (event) =>
              event.type === "pin_start" &&
              event.tick <= pinEnd.tick &&
              (pinEnd.actorPlayerId
                ? event.actorPlayerId === pinEnd.actorPlayerId
                : event.actor === pinEnd.actor) &&
              (pinEnd.victimPlayerId
                ? event.victimPlayerId === pinEnd.victimPlayerId
                : event.victim === pinEnd.victim),
          )
      : undefined;
    if (!pinStart) continue;
    const current = responses.get(playerId) ?? {
      alias: clear.actor!,
      responseSeconds: [],
    };
    current.responseSeconds.push(
      tickRate ? Math.max(0, (clear.tick - pinStart.tick) / tickRate) : 0,
    );
    responses.set(playerId, current);
  }
  return [...responses].map(([playerId, value]) => {
    const sorted = [...value.responseSeconds].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return {
      playerId,
      playerAlias: value.alias,
      deathCorrelatedClears: sorted.length,
      responseSeconds: sorted,
      medianResponseSeconds:
        sorted.length === 0
          ? null
          : sorted.length % 2
            ? sorted[middle]!
            : (sorted[middle - 1]! + sorted[middle]!) / 2,
    };
  });
};

export function scopeDemoStats(
  stats: DemoStats,
  demoSha256: string,
  disabledHalfKeys: readonly string[],
): DemoStats {
  const competitive = stats.competitive;
  if (!competitive || disabledHalfKeys.length === 0) return stats;
  const selectedHalves = competitive.halves.filter(
    (half) => !disabledHalfKeys.includes(halfScopeKey(demoSha256, half.id)),
  );
  if (
    selectedHalves.length === competitive.halves.length ||
    selectedHalves.some((half) =>
      half.players.some((player) => !player.summary),
    )
  )
    return stats;

  const ranges = selectedHalves.map((half) => half.tickRange);
  const timeline = (stats.timeline ?? []).filter((event) =>
    inRanges(event.tick, ranges),
  );
  const originalPlayers = new Map(
    stats.players.map((player) => [player.id, player]),
  );
  const players = mergePlayerStats(
    selectedHalves.flatMap((half) =>
      half.players.flatMap((halfPlayer) => {
        const source = originalPlayers.get(halfPlayer.playerId);
        const summary = halfPlayer.summary;
        if (!source || !summary) return [];
        const player: PlayerStats = {
          ...source,
          ...summary,
          team: halfPlayer.side === "Survivor" ? 2 : 3,
          playerClass: null,
          evidenceWindows: 0,
          playedSurvivor: halfPlayer.side === "Survivor",
          playedInfected: halfPlayer.side === "Infected",
          counters: halfPlayer.counterDeltas,
        };
        return [{ key: halfPlayer.playerId, player }];
      }),
    ),
  );
  const selectedTicks = ranges.reduce(
    (sum, range) => sum + Math.max(0, range.end - range.start + 1),
    0,
  );
  const scoreTimeline = stats.match?.scoreTimeline?.filter((point) =>
    inRanges(point.tick, ranges),
  );
  const finalScore = scoreTimeline?.at(-1);
  const specialDeaths = timeline.filter(
    (event) => event.type === "death" && event.infectedClass,
  );
  const countBy = (values: readonly (string | undefined)[]) => {
    const result: Record<string, number> = {};
    for (const value of values)
      if (value) result[value] = (result[value] ?? 0) + 1;
    return result;
  };
  const summaryRows = selectedHalves.flatMap((half) =>
    half.players.flatMap((player) => (player.summary ? [player.summary] : [])),
  );
  const samples = summaryRows.reduce((sum, row) => sum + row.sampleCount, 0);
  const weightedRate = (
    select: (row: (typeof summaryRows)[number]) => number,
  ) =>
    samples
      ? summaryRows.reduce(
          (sum, row) => sum + select(row) * row.sampleCount,
          0,
        ) / samples
      : 0;
  return {
    ...stats,
    durationSeconds: stats.tickRate
      ? selectedTicks / stats.tickRate
      : stats.durationSeconds,
    observationCount: players.reduce(
      (sum, player) => sum + player.sampleCount,
      0,
    ),
    eventCount: timeline.length,
    availability: {
      position: weightedRate((row) => row.observedPositionRate),
      eyeAngles: weightedRate((row) => row.observedAnglesRate),
      team: weightedRate((row) => row.observedTeamRate),
      playerClass: weightedRate((row) => row.observedClassRate),
      weapon: weightedRate((row) => row.observedWeaponRate),
    },
    timeline,
    players,
    ...(stats.match
      ? {
          match: {
            ...stats.match,
            roundStarts: timeline.filter(
              (event) => event.type === "round_start",
            ).length,
            roundEnds: timeline.filter((event) => event.type === "round_end")
              .length,
            survivorDeaths: timeline.filter(
              (event) => event.type === "death" && !event.infectedClass,
            ).length,
            specialInfectedDeaths: specialDeaths.length,
            tankDeaths: specialDeaths.filter(
              (event) => event.infectedClass === "Tank",
            ).length,
            witchDeaths: specialDeaths.filter(
              (event) => event.infectedClass === "Witch",
            ).length,
            specialKillsByClass: countBy(
              specialDeaths.map((event) => event.infectedClass),
            ),
            killsByWeapon: countBy(
              timeline
                .filter((event) => event.type === "death")
                .map((event) => event.weapon),
            ),
            ...(finalScore
              ? {
                  campaignScores: finalScore.campaignScores,
                  chapterScores: finalScore.chapterScores,
                  survivorScores: finalScore.survivorScores,
                  survivorDistances: finalScore.survivorDistances,
                  teamsFlipped: finalScore.teamsFlipped,
                  secondHalf: finalScore.secondHalf,
                }
              : {}),
            ...(scoreTimeline ? { scoreTimeline } : {}),
          },
        }
      : {}),
    competitive: {
      ...competitive,
      halves: selectedHalves,
      rosters: (competitive.rosters ?? []).map((roster) => ({
        ...roster,
        sides: roster.sides.filter((side) =>
          selectedHalves.some((half) => half.id === side.halfId),
        ),
      })),
      infectedLives: competitive.infectedLives.filter((life) =>
        inRanges(life.tickRange.start, ranges),
      ),
      hits: competitive.hits.filter((hit) =>
        inRanges(hit.tickRange.start, ranges),
      ),
      clearStats: rebuildClearStats(timeline, stats.tickRate),
      tankEncounters: competitive.tankEncounters.filter((encounter) =>
        inRanges(encounter.tickRange.start, ranges),
      ),
    },
    ...(stats.witchEncounters
      ? {
          witchEncounters: stats.witchEncounters.filter((encounter) =>
            inRanges(encounter.tickRange.start, ranges),
          ),
        }
      : {}),
    ...(stats.survivorHealthTraces
      ? {
          survivorHealthTraces: stats.survivorHealthTraces
            .map((trace) => ({
              ...trace,
              points: scopeStatePoints(trace.points, ranges),
            }))
            .filter((trace) => trace.points.length > 0),
        }
      : {}),
    ...(stats.survivorLoadoutTraces
      ? {
          survivorLoadoutTraces: stats.survivorLoadoutTraces
            .map((trace) => ({
              ...trace,
              points: scopeStatePoints(trace.points, ranges),
            }))
            .filter((trace) => trace.points.length > 0),
        }
      : {}),
    ...(stats.survivorAmmoTraces
      ? {
          survivorAmmoTraces: stats.survivorAmmoTraces
            .map((trace) => ({
              ...trace,
              points: scopeStatePoints(trace.points, ranges),
            }))
            .filter((trace) => trace.points.length > 0),
        }
      : {}),
  };
}
