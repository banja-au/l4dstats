import type { PlayerStats } from "./api";

export function playerProfilePath(gameId: string, playerId: string) {
  return `/game/${encodeURIComponent(gameId)}/player/${encodeURIComponent(playerId)}`;
}

export function parsePlayerProfilePath(pathname: string) {
  const match = pathname.match(/^\/game\/([^/]+)\/player\/([^/]+)\/?$/);
  if (!match) return null;
  try {
    return {
      gameId: decodeURIComponent(match[1]!),
      playerId: decodeURIComponent(match[2]!),
    };
  } catch {
    return null;
  }
}

function SteamMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-9.86 8.33l5.3 2.19a2.8 2.8 0 0 1 1.6-.5l2.37-3.43v-.04a3.75 3.75 0 1 1 3.75 3.75h-.08l-3.38 2.42a2.82 2.82 0 0 1-5.56.53L2.5 13.74A10 10 0 1 0 12 2Zm-3.04 14.9-1.32-.55a2.1 2.1 0 0 0 1.16 1.09 2.08 2.08 0 1 0 1.6-3.84 2 2 0 0 0-1.45-.02l1.37.57a1.42 1.42 0 1 1-1.36 2.75Zm6.2-5.86a2.49 2.49 0 1 0 0-4.98 2.49 2.49 0 0 0 0 4.98Zm0-.63a1.86 1.86 0 1 1 0-3.72 1.86 1.86 0 0 1 0 3.72Z" />
    </svg>
  );
}

export function PlayerIdentityLinks({
  gameId,
  player,
  className,
}: {
  gameId: string;
  player: Pick<PlayerStats, "id" | "alias" | "identity">;
  className?: string;
}) {
  return (
    <span className={`player-identity-links ${className ?? ""}`.trim()}>
      <a
        className="player-name-link"
        href={playerProfilePath(gameId, player.id)}
      >
        {player.alias}
      </a>
      {player.identity?.steamProfileUrl && (
        <a
          className="steam-profile-link"
          href={player.identity.steamProfileUrl}
          target="_blank"
          rel="noreferrer"
          title={`Open ${player.alias}'s Steam profile`}
          aria-label={`Open ${player.alias}'s Steam profile`}
        >
          <SteamMark />
        </a>
      )}
    </span>
  );
}
