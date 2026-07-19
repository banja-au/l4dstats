import { rateProjectedPlayers } from "@l4dstats/l4d2-rating";
import type { DemoStats, PlayerStats } from "./api";

export function rateGamePlayers(
  stats: readonly DemoStats[],
  players: PlayerStats[],
) {
  return rateProjectedPlayers(stats, (demoPlayer, demoIndex) => {
    const player = players.find((candidate) =>
      (demoPlayer as PlayerStats).identity?.steamId64
        ? candidate.identity?.steamId64 ===
          (demoPlayer as PlayerStats).identity?.steamId64
        : candidate.id === `${demoIndex}:${demoPlayer.id}`,
    );
    return player ? { id: player.id, alias: player.alias } : undefined;
  });
}
