import type { DemoStats, PlayerStats } from "./api";

const sumRecords = (
  left: Record<string, number> | undefined,
  right: Record<string, number> | undefined,
  strictMissing: boolean,
) => {
  if (strictMissing && (left === undefined || right === undefined))
    return undefined;
  if (left === undefined && right === undefined) return undefined;
  const result = { ...(left ?? {}) };
  for (const [name, value] of Object.entries(right ?? {}))
    result[name] = (result[name] ?? 0) + value;
  return result;
};

const sumOptional = (
  left: number | undefined,
  right: number | undefined,
  strictMissing: boolean,
) =>
  strictMissing && (left === undefined || right === undefined)
    ? undefined
    : left === undefined && right === undefined
      ? undefined
      : (left ?? 0) + (right ?? 0);

const maxOptional = (
  left: number | undefined,
  right: number | undefined,
  strictMissing: boolean,
) =>
  strictMissing && (left === undefined || right === undefined)
    ? undefined
    : left === undefined && right === undefined
      ? undefined
      : Math.max(
          left ?? Number.NEGATIVE_INFINITY,
          right ?? Number.NEGATIVE_INFINITY,
        );

export function mergePlayerStats(
  entries: Array<{ key: string; player: PlayerStats }>,
  strictMissing = true,
): PlayerStats[] {
  const merged = new Map<string, PlayerStats>();
  for (const { key, player } of entries) {
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...player, id: key });
      continue;
    }
    const totalSamples = current.sampleCount + player.sampleCount;
    merged.set(key, {
      ...current,
      alias: player.identity?.displayName ?? current.alias,
      identity: current.identity ?? player.identity ?? null,
      team: null,
      playerClass: null,
      sampleCount: totalSamples,
      durationSeconds: current.durationSeconds + player.durationSeconds,
      distanceUnits: current.distanceUnits + player.distanceUnits,
      viewTravelDegrees: current.viewTravelDegrees + player.viewTravelDegrees,
      observedPositionRate:
        (current.observedPositionRate * current.sampleCount +
          player.observedPositionRate * player.sampleCount) /
        Math.max(1, totalSamples),
      observedAnglesRate:
        (current.observedAnglesRate * current.sampleCount +
          player.observedAnglesRate * player.sampleCount) /
        Math.max(1, totalSamples),
      weapons: [...new Set([...current.weapons, ...player.weapons])].sort(),
      evidenceWindows: current.evidenceWindows + (player.evidenceWindows ?? 0),
      survivorDeaths: sumOptional(
        current.survivorDeaths,
        player.survivorDeaths,
        strictMissing,
      ),
      infectedDeaths: sumOptional(
        current.infectedDeaths,
        player.infectedDeaths,
        strictMissing,
      ),
      specialInfectedKills: sumOptional(
        current.specialInfectedKills,
        player.specialInfectedKills,
        strictMissing,
      ),
      headshotKills: sumOptional(
        current.headshotKills,
        player.headshotKills,
        strictMissing,
      ),
      checkpointInfectedKills: sumOptional(
        current.checkpointInfectedKills,
        player.checkpointInfectedKills,
        strictMissing,
      ),
      revives: sumOptional(current.revives, player.revives, strictMissing),
      survivorIncaps: sumOptional(
        current.survivorIncaps,
        player.survivorIncaps,
        strictMissing,
      ),
      specialIncaps: sumOptional(
        current.specialIncaps,
        player.specialIncaps,
        strictMissing,
      ),
      pounces: sumOptional(current.pounces, player.pounces, strictMissing),
      highestPounceDamage: maxOptional(
        current.highestPounceDamage,
        player.highestPounceDamage,
        strictMissing,
      ),
      longestJockeyRide: maxOptional(
        current.longestJockeyRide,
        player.longestJockeyRide,
        strictMissing,
      ),
      pinSeconds: sumOptional(
        current.pinSeconds,
        player.pinSeconds,
        strictMissing,
      ),
      ghostSeconds: sumOptional(
        current.ghostSeconds,
        player.ghostSeconds,
        strictMissing,
      ),
      observedHealthLost: sumOptional(
        current.observedHealthLost,
        player.observedHealthLost,
        strictMissing,
      ),
      killsByWeapon: sumRecords(
        current.killsByWeapon,
        player.killsByWeapon,
        strictMissing,
      ),
      killsByInfectedClass: sumRecords(
        current.killsByInfectedClass,
        player.killsByInfectedClass,
        strictMissing,
      ),
      playedSurvivor: Boolean(current.playedSurvivor || player.playedSurvivor),
      playedInfected: Boolean(current.playedInfected || player.playedInfected),
      infectedClasses: [
        ...new Set([
          ...(current.infectedClasses ?? []),
          ...(player.infectedClasses ?? []),
        ]),
      ].sort(),
      counters: sumRecords(current.counters, player.counters, strictMissing),
    } as PlayerStats);
  }
  return [...merged.values()];
}

export function aggregateGamePlayers(stats: DemoStats[]): PlayerStats[] {
  const perDemo = stats.flatMap((demo, demoIndex) => {
    const entitySlot = (id: string) => {
      const parts = id.split(":");
      return parts.length >= 3 ? parts.at(-2) : undefined;
    };
    const identitiesBySlot = new Map<string, PlayerStats["identity"][]>();
    for (const player of demo.players) {
      const slot = entitySlot(player.id);
      if (!slot || !player.identity?.steamId64) continue;
      const identities = identitiesBySlot.get(slot) ?? [];
      identities.push(player.identity);
      identitiesBySlot.set(slot, identities);
    }
    return mergePlayerStats(
      demo.players.map((player) => {
        if (player.identity?.steamId64)
          return { key: player.identity.steamId64, player };
        const slot = entitySlot(player.id);
        const candidates = new Map(
          (slot ? (identitiesBySlot.get(slot) ?? []) : [])
            .filter((identity) => identity?.steamId64)
            .map((identity) => [identity!.steamId64!, identity!] as const),
        );
        if (candidates.size !== 1)
          return { key: `${demoIndex}:${player.id}`, player };
        const identity = [...candidates.values()][0]!;
        return {
          key: identity.steamId64!,
          player: {
            ...player,
            alias: identity.displayName,
            identity: { ...identity, inference: "unique-slot-v1" as const },
          },
        };
      }),
      false,
    ).map((player) => ({ key: player.id, player }));
  });
  return mergePlayerStats(perDemo, true);
}
