export const l4dStatsRatingVersion = "l4dstats-match-rating-v0.2" as const;

export type RatingRole = "survivor" | "infected";
export type RatingDirection = "higher" | "lower";

export type RatingMetricKey =
  | "survivor_si_kill_rate"
  | "survivor_revive_rate"
  | "survivor_clear_rate"
  | "survivor_death_rate"
  | "survivor_incap_rate"
  | "survivor_damage_taken_rate"
  | "survivor_tank_damage_rate"
  | "survivor_witch_damage_rate"
  | "infected_damage_per_life"
  | "infected_incaps_per_life"
  | "infected_kills_per_life"
  | "infected_controls_per_life"
  | "infected_pin_seconds_per_control"
  | "infected_booms_per_life"
  | "infected_pulls_per_life"
  | "infected_charges_per_life"
  | "infected_pounces_per_life"
  | "tank_punches_per_life"
  | "tank_throws_per_life";

export interface RatingObservation {
  /** Opportunity-normalized value, such as events per minute or per SI life. */
  value: number;
  /** Relevant exposure used only for shrinkage, never as performance points. */
  exposure: number;
}

export interface RatingPlayerInput {
  playerId: string;
  playerAlias: string;
  maps: number;
  survivorSeconds: number;
  infectedLives: number;
  metrics: Partial<Record<RatingMetricKey, RatingObservation>>;
}

interface MetricDefinition {
  key: RatingMetricKey;
  label: string;
  role: RatingRole;
  pillar: string;
  pillarWeight: number;
  metricWeight: number;
  direction: RatingDirection;
  shrinkageHalfLife: number;
  source: "engine-counter" | "game-event" | "sampled" | "derived";
}

export const ratingMetricDefinitions: readonly MetricDefinition[] = [
  {
    key: "survivor_si_kill_rate",
    label: "SI kill rate",
    role: "survivor",
    pillar: "Threat removal",
    pillarWeight: 0.45,
    metricWeight: 1,
    direction: "higher",
    shrinkageHalfLife: 300,
    source: "game-event",
  },
  {
    key: "survivor_revive_rate",
    label: "Revive rate",
    role: "survivor",
    pillar: "Rescue",
    pillarWeight: 0.2,
    metricWeight: 0.7,
    direction: "higher",
    shrinkageHalfLife: 300,
    source: "engine-counter",
  },
  {
    key: "survivor_clear_rate",
    label: "Death-correlated clear rate",
    role: "survivor",
    pillar: "Rescue",
    pillarWeight: 0.2,
    metricWeight: 0.3,
    direction: "higher",
    shrinkageHalfLife: 300,
    source: "derived",
  },
  {
    key: "survivor_death_rate",
    label: "Death rate",
    role: "survivor",
    pillar: "Durability",
    pillarWeight: 0.2,
    metricWeight: 0.35,
    direction: "lower",
    shrinkageHalfLife: 300,
    source: "game-event",
  },
  {
    key: "survivor_incap_rate",
    label: "Incap rate",
    role: "survivor",
    pillar: "Durability",
    pillarWeight: 0.2,
    metricWeight: 0.3,
    direction: "lower",
    shrinkageHalfLife: 300,
    source: "engine-counter",
  },
  {
    key: "survivor_damage_taken_rate",
    label: "Damage taken rate",
    role: "survivor",
    pillar: "Durability",
    pillarWeight: 0.2,
    metricWeight: 0.35,
    direction: "lower",
    shrinkageHalfLife: 300,
    source: "engine-counter",
  },
  {
    key: "survivor_tank_damage_rate",
    label: "Tank damage rate",
    role: "survivor",
    pillar: "Boss output",
    pillarWeight: 0.15,
    metricWeight: 0.8,
    direction: "higher",
    shrinkageHalfLife: 300,
    source: "engine-counter",
  },
  {
    key: "survivor_witch_damage_rate",
    label: "Witch damage rate",
    role: "survivor",
    pillar: "Boss output",
    pillarWeight: 0.15,
    metricWeight: 0.2,
    direction: "higher",
    shrinkageHalfLife: 300,
    source: "engine-counter",
  },
  {
    key: "infected_damage_per_life",
    label: "Damage per life",
    role: "infected",
    pillar: "Conversion",
    pillarWeight: 0.45,
    metricWeight: 0.5,
    direction: "higher",
    shrinkageHalfLife: 4,
    source: "engine-counter",
  },
  {
    key: "infected_incaps_per_life",
    label: "Incaps per life",
    role: "infected",
    pillar: "Conversion",
    pillarWeight: 0.45,
    metricWeight: 0.3,
    direction: "higher",
    shrinkageHalfLife: 4,
    source: "engine-counter",
  },
  {
    key: "infected_kills_per_life",
    label: "Kills per life",
    role: "infected",
    pillar: "Conversion",
    pillarWeight: 0.45,
    metricWeight: 0.2,
    direction: "higher",
    shrinkageHalfLife: 4,
    source: "engine-counter",
  },
  {
    key: "infected_controls_per_life",
    label: "Controls per life",
    role: "infected",
    pillar: "Control",
    pillarWeight: 0.3,
    metricWeight: 0.6,
    direction: "higher",
    shrinkageHalfLife: 4,
    source: "derived",
  },
  {
    key: "infected_pin_seconds_per_control",
    label: "Pin seconds per control",
    role: "infected",
    pillar: "Control",
    pillarWeight: 0.3,
    metricWeight: 0.4,
    direction: "higher",
    shrinkageHalfLife: 4,
    source: "sampled",
  },
  {
    key: "infected_booms_per_life",
    label: "Booms per life",
    role: "infected",
    pillar: "Setup",
    pillarWeight: 0.15,
    metricWeight: 0.35,
    direction: "higher",
    shrinkageHalfLife: 4,
    source: "engine-counter",
  },
  {
    key: "infected_pulls_per_life",
    label: "Pulls per life",
    role: "infected",
    pillar: "Setup",
    pillarWeight: 0.15,
    metricWeight: 0.25,
    direction: "higher",
    shrinkageHalfLife: 4,
    source: "engine-counter",
  },
  {
    key: "infected_charges_per_life",
    label: "Charge victims per life",
    role: "infected",
    pillar: "Setup",
    pillarWeight: 0.15,
    metricWeight: 0.25,
    direction: "higher",
    shrinkageHalfLife: 4,
    source: "engine-counter",
  },
  {
    key: "infected_pounces_per_life",
    label: "Pounces per life",
    role: "infected",
    pillar: "Setup",
    pillarWeight: 0.15,
    metricWeight: 0.15,
    direction: "higher",
    shrinkageHalfLife: 4,
    source: "engine-counter",
  },
  {
    key: "tank_punches_per_life",
    label: "Tank punches per life",
    role: "infected",
    pillar: "Tank",
    pillarWeight: 0.1,
    metricWeight: 0.7,
    direction: "higher",
    shrinkageHalfLife: 1,
    source: "engine-counter",
  },
  {
    key: "tank_throws_per_life",
    label: "Registered Tank throws per life",
    role: "infected",
    pillar: "Tank",
    pillarWeight: 0.1,
    metricWeight: 0.3,
    direction: "higher",
    shrinkageHalfLife: 1,
    source: "engine-counter",
  },
] as const;

export interface RatingMetricContribution {
  key: RatingMetricKey;
  label: string;
  source: MetricDefinition["source"];
  rawValue: number;
  peerIndex: number;
  reliability: number;
  adjustedIndex: number;
  contribution: number;
}

export interface RatingPillarResult {
  name: string;
  score: number;
  coverage: number;
  plannedWeight: number;
  realizedWeight: number;
  metrics: RatingMetricContribution[];
}

export interface RatingRoleResult {
  role: RatingRole;
  score: number | null;
  coverage: number;
  eligible: boolean;
  pillars: RatingPillarResult[];
  missingMetrics: RatingMetricKey[];
}

export interface PlayerRatingResult {
  playerId: string;
  playerAlias: string;
  rating: number | null;
  survivor: RatingRoleResult;
  infected: RatingRoleResult;
  coverage: number;
  confidence: "low" | "medium";
  eligibleForMvp: boolean;
}

export interface MatchRatingResult {
  modelVersion: typeof l4dStatsRatingVersion;
  scale: "1.00-neutral-game-relative";
  status: "experimental";
  players: PlayerRatingResult[];
  mvp: {
    status: "leader" | "shared" | "unavailable";
    playerIds: string[];
    resolution: number;
  };
  limitations: string[];
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

const finiteObservation = (value: RatingObservation | undefined) =>
  value &&
  Number.isFinite(value.value) &&
  value.value >= 0 &&
  Number.isFinite(value.exposure) &&
  value.exposure > 0
    ? value
    : undefined;

export function rateL4d2Match(
  inputs: readonly RatingPlayerInput[],
): MatchRatingResult {
  const peerIndex = new Map<string, number>();
  for (const definition of ratingMetricDefinitions) {
    const observed = inputs.flatMap((input) => {
      const value = finiteObservation(input.metrics[definition.key]);
      return value ? [{ id: input.playerId, value: value.value }] : [];
    });
    const total = observed.reduce((sum, item) => sum + item.value, 0);
    if (observed.length < 4) continue;
    if (total <= 0) {
      for (const item of observed)
        peerIndex.set(`${item.id}:${definition.key}`, 1);
      continue;
    }
    for (const item of observed) {
      const positive = (observed.length * item.value) / total;
      const directed =
        definition.direction === "higher" ? positive : 2 - positive;
      peerIndex.set(`${item.id}:${definition.key}`, clamp(directed, 0.6, 1.4));
    }
  }

  const players = inputs.map((input): PlayerRatingResult => {
    const role = (roleName: RatingRole): RatingRoleResult => {
      const definitions = ratingMetricDefinitions.filter(
        (item) => item.role === roleName,
      );
      const pillarNames = [...new Set(definitions.map((item) => item.pillar))];
      const pillars = pillarNames.flatMap((name): RatingPillarResult[] => {
        const members = definitions.filter((item) => item.pillar === name);
        const metrics = members.flatMap(
          (definition): RatingMetricContribution[] => {
            const observation = finiteObservation(
              input.metrics[definition.key],
            );
            const index = peerIndex.get(`${input.playerId}:${definition.key}`);
            if (!observation || index === undefined) return [];
            const reliability =
              observation.exposure /
              (observation.exposure + definition.shrinkageHalfLife);
            const adjustedIndex = 1 + reliability * (index - 1);
            return [
              {
                key: definition.key,
                label: definition.label,
                source: definition.source,
                rawValue: observation.value,
                peerIndex: index,
                reliability,
                adjustedIndex,
                contribution: definition.metricWeight * (adjustedIndex - 1),
              },
            ];
          },
        );
        if (!metrics.length) return [];
        const observedWeight = metrics.reduce(
          (sum, metric) =>
            sum +
            (members.find((item) => item.key === metric.key)?.metricWeight ??
              0),
          0,
        );
        const plannedMetricWeight = members.reduce(
          (sum, member) => sum + member.metricWeight,
          0,
        );
        const score = clamp(
          1 +
            metrics.reduce((sum, metric) => sum + metric.contribution, 0) /
              observedWeight,
          0.6,
          1.4,
        );
        return [
          {
            name,
            score,
            coverage: observedWeight / plannedMetricWeight,
            plannedWeight: members[0]!.pillarWeight,
            realizedWeight: 0,
            metrics,
          },
        ];
      });
      const plannedPillars = [
        ...new Map(
          definitions.map((item) => [item.pillar, item.pillarWeight]),
        ).values(),
      ].reduce((sum, weight) => sum + weight, 0);
      const observedPillarWeight = pillars.reduce(
        (sum, pillar) => sum + pillar.plannedWeight * pillar.coverage,
        0,
      );
      const coverage = plannedPillars
        ? observedPillarWeight / plannedPillars
        : 0;
      for (const pillar of pillars)
        pillar.realizedWeight = observedPillarWeight
          ? (pillar.plannedWeight * pillar.coverage) / observedPillarWeight
          : 0;
      const opportunity =
        roleName === "survivor"
          ? input.survivorSeconds >= 120
          : input.infectedLives >= 3;
      const eligible = opportunity && coverage >= 0.7 && pillars.length >= 2;
      return {
        role: roleName,
        score: eligible
          ? pillars.reduce(
              (sum, pillar) => sum + pillar.score * pillar.realizedWeight,
              0,
            )
          : null,
        coverage,
        eligible,
        pillars,
        missingMetrics: definitions
          .filter(
            (definition) => !finiteObservation(input.metrics[definition.key]),
          )
          .map((definition) => definition.key),
      };
    };
    const survivor = role("survivor");
    const infected = role("infected");
    const coverage = (survivor.coverage + infected.coverage) / 2;
    const eligibleForMvp =
      input.maps >= 2 && survivor.eligible && infected.eligible;
    const rating = eligibleForMvp
      ? (survivor.score! + infected.score!) / 2
      : null;
    return {
      playerId: input.playerId,
      playerAlias: input.playerAlias,
      rating,
      survivor,
      infected,
      coverage,
      confidence: input.maps >= 3 && coverage >= 0.8 ? "medium" : "low",
      eligibleForMvp,
    };
  });
  const ranked = players
    .filter((player) => player.rating !== null)
    .sort(
      (left, right) =>
        right.rating! - left.rating! ||
        right.coverage - left.coverage ||
        left.playerId.localeCompare(right.playerId),
    );
  const resolution = 0.02;
  const leaders = ranked.length
    ? ranked.filter(
        (player) => ranked[0]!.rating! - player.rating! <= resolution,
      )
    : [];
  return {
    modelVersion: l4dStatsRatingVersion,
    scale: "1.00-neutral-game-relative",
    status: "experimental",
    players,
    mvp: {
      status:
        leaders.length === 0
          ? "unavailable"
          : leaders.length === 1
            ? "leader"
            : "shared",
      playerIds: leaders.map((player) => player.playerId),
      resolution,
    },
    limitations: [
      "This is a selected-game performance index, not latent skill or win probability.",
      "The v0.2 fallback baseline is game-relative because a representative frozen reference corpus does not yet exist.",
      "Engine damage counters are aggregate checkpoint values and do not provide event-level attacker attribution.",
      "Unavailable telemetry is omitted rather than imputed as zero; realized weights and coverage therefore vary.",
    ],
  };
}
