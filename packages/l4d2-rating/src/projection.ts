import {
  rateL4d2Match,
  type RatingMetricKey,
  type RatingPlayerInput,
} from "./rating.js";

export interface RatingProjectionPlayer {
  id: string;
  alias: string;
}

export interface RatingProjectionStats {
  players: RatingProjectionPlayer[];
  timeline?: Array<{ type: string; actorPlayerId?: string; tick: number }>;
  competitive?: {
    halves: Array<{
      tickRange: { start: number; end: number };
      players: Array<{
        playerId: string;
        side: "Survivor" | "Infected";
        observedCounters?: string[];
        counterDeltas: Record<string, number>;
        summary?: {
          durationSeconds: number;
          specialInfectedKills: number;
          revives?: number;
          survivorDeaths: number;
          survivorIncaps?: number;
          specialIncaps?: number;
          pounces?: number;
        };
      }>;
    }>;
    infectedLives: Array<{
      playerId: string;
      infectedClass: string;
      tickRange: { start: number; end: number };
      controls: number;
      pinSeconds: number;
    }>;
  };
}

interface Accumulator {
  input: RatingPlayerInput;
  mapIndexes: Set<number>;
  metricTotals: Partial<
    Record<RatingMetricKey, { numerator: number; exposure: number }>
  >;
}

const infectedDamageCounters = [
  "m_checkpointPZTankDamage",
  "m_checkpointPZHunterDamage",
  "m_checkpointPZSmokerDamage",
  "m_checkpointPZBoomerDamage",
  "m_checkpointPZJockeyDamage",
  "m_checkpointPZSpitterDamage",
  "m_checkpointPZChargerDamage",
] as const;

const add = (
  accumulator: Accumulator,
  key: RatingMetricKey,
  numerator: number | undefined,
  exposure: number,
) => {
  if (numerator === undefined || !Number.isFinite(numerator) || exposure <= 0)
    return;
  const current = accumulator.metricTotals[key] ?? {
    numerator: 0,
    exposure: 0,
  };
  current.numerator += numerator;
  current.exposure += exposure;
  accumulator.metricTotals[key] = current;
};

const observedCounter = (
  row: NonNullable<
    RatingProjectionStats["competitive"]
  >["halves"][number]["players"][number],
  names: readonly string[],
) => {
  const observed = row.observedCounters ?? [];
  if (!names.every((name) => observed.includes(name))) return undefined;
  return names.reduce((sum, name) => sum + (row.counterDeltas[name] ?? 0), 0);
};

export function projectRatingInputs(
  stats: readonly RatingProjectionStats[],
  resolvePlayer: (
    player: RatingProjectionPlayer,
    demoIndex: number,
  ) => { id: string; alias: string } | undefined,
): RatingPlayerInput[] {
  const accumulators = new Map<string, Accumulator>();
  for (const [demoIndex, demo] of stats.entries()) {
    const competitive = demo.competitive;
    if (!competitive) continue;
    for (const half of competitive.halves) {
      for (const row of half.players) {
        const local = demo.players.find(
          (candidate) => candidate.id === row.playerId,
        );
        const global = local && resolvePlayer(local, demoIndex);
        const summary = row.summary;
        if (!local || !global || !summary) continue;
        const accumulator = accumulators.get(global.id) ?? {
          input: {
            playerId: global.id,
            playerAlias: global.alias,
            maps: 0,
            survivorSeconds: 0,
            infectedLives: 0,
            metrics: {},
          },
          mapIndexes: new Set<number>(),
          metricTotals: {},
        };
        accumulators.set(global.id, accumulator);
        accumulator.mapIndexes.add(demoIndex);
        if (row.side === "Survivor") {
          const exposure = summary.durationSeconds;
          accumulator.input.survivorSeconds += exposure;
          add(
            accumulator,
            "survivor_si_kill_rate",
            summary.specialInfectedKills,
            exposure,
          );
          add(accumulator, "survivor_revive_rate", summary.revives, exposure);
          add(
            accumulator,
            "survivor_death_rate",
            summary.survivorDeaths,
            exposure,
          );
          add(
            accumulator,
            "survivor_incap_rate",
            summary.survivorIncaps,
            exposure,
          );
          add(
            accumulator,
            "survivor_damage_taken_rate",
            observedCounter(row, ["m_checkpointDamageTaken"]),
            exposure,
          );
          add(
            accumulator,
            "survivor_tank_damage_rate",
            observedCounter(row, ["m_checkpointDamageToTank"]),
            exposure,
          );
          add(
            accumulator,
            "survivor_witch_damage_rate",
            observedCounter(row, ["m_checkpointDamageToWitch"]),
            exposure,
          );
          const clears = demo.timeline?.filter(
            (event) =>
              event.type === "clear" &&
              event.actorPlayerId === row.playerId &&
              event.tick >= half.tickRange.start &&
              event.tick <= half.tickRange.end,
          ).length;
          add(accumulator, "survivor_clear_rate", clears, exposure);
          continue;
        }
        const lives = competitive.infectedLives.filter(
          (life) =>
            life.playerId === row.playerId &&
            life.tickRange.start >= half.tickRange.start &&
            life.tickRange.start <= half.tickRange.end,
        );
        const ordinaryLives = lives.filter(
          (life) => life.infectedClass !== "Tank",
        );
        const lifeCount = ordinaryLives.length;
        accumulator.input.infectedLives += lifeCount;
        add(
          accumulator,
          "infected_damage_per_life",
          observedCounter(
            row,
            infectedDamageCounters.filter(
              (name) => name !== "m_checkpointPZTankDamage",
            ),
          ),
          lifeCount,
        );
        add(
          accumulator,
          "infected_incaps_per_life",
          summary.specialIncaps,
          lifeCount,
        );
        add(
          accumulator,
          "infected_kills_per_life",
          observedCounter(row, ["m_checkpointPZKills"]),
          lifeCount,
        );
        const controls = ordinaryLives.reduce(
          (sum, life) => sum + life.controls,
          0,
        );
        add(accumulator, "infected_controls_per_life", controls, lifeCount);
        add(
          accumulator,
          "infected_pin_seconds_per_control",
          ordinaryLives.reduce((sum, life) => sum + life.pinSeconds, 0),
          controls,
        );
        add(
          accumulator,
          "infected_booms_per_life",
          observedCounter(row, [
            "m_checkpointPZBombed",
            "m_checkpointPZVomited",
          ]),
          lifeCount,
        );
        add(
          accumulator,
          "infected_pulls_per_life",
          observedCounter(row, ["m_checkpointPZPulled", "m_checkpointPZHung"]),
          lifeCount,
        );
        add(
          accumulator,
          "infected_charges_per_life",
          observedCounter(row, ["m_checkpointPZNumChargeVictims"]),
          lifeCount,
        );
        add(
          accumulator,
          "infected_pounces_per_life",
          summary.pounces,
          lifeCount,
        );
        const tankLives = lives.filter(
          (life) => life.infectedClass === "Tank",
        ).length;
        add(
          accumulator,
          "tank_punches_per_life",
          observedCounter(row, ["m_checkpointPZTankPunches"]),
          tankLives,
        );
        add(
          accumulator,
          "tank_throws_per_life",
          observedCounter(row, ["m_checkpointPZTankThrows"]),
          tankLives,
        );
      }
    }
  }
  for (const accumulator of accumulators.values()) {
    accumulator.input.maps = accumulator.mapIndexes.size;
    for (const [key, value] of Object.entries(accumulator.metricTotals)) {
      if (!value || value.exposure <= 0) continue;
      accumulator.input.metrics[key as RatingMetricKey] = {
        value: value.numerator / value.exposure,
        exposure: value.exposure,
      };
    }
  }
  return [...accumulators.values()].map((value) => value.input);
}

export function mergeRatingInputs(
  values: readonly RatingPlayerInput[],
): RatingPlayerInput {
  if (!values.length) throw new Error("at least one rating input is required");
  const first = values[0]!;
  const merged: RatingPlayerInput = {
    playerId: first.playerId,
    playerAlias: values.at(-1)?.playerAlias ?? first.playerAlias,
    maps: values.reduce((sum, value) => sum + value.maps, 0),
    survivorSeconds: values.reduce(
      (sum, value) => sum + value.survivorSeconds,
      0,
    ),
    infectedLives: values.reduce((sum, value) => sum + value.infectedLives, 0),
    metrics: {},
  };
  for (const key of new Set(
    values.flatMap((value) => Object.keys(value.metrics) as RatingMetricKey[]),
  )) {
    const observations = values.flatMap((value) =>
      value.metrics[key] ? [value.metrics[key]!] : [],
    );
    const exposure = observations.reduce(
      (sum, value) => sum + value.exposure,
      0,
    );
    if (exposure > 0)
      merged.metrics[key] = {
        exposure,
        value:
          observations.reduce(
            (sum, value) => sum + value.value * value.exposure,
            0,
          ) / exposure,
      };
  }
  return merged;
}

export function rateProjectedPlayers(
  stats: readonly RatingProjectionStats[],
  resolvePlayer: Parameters<typeof projectRatingInputs>[1],
) {
  return rateL4d2Match(projectRatingInputs(stats, resolvePlayer));
}
