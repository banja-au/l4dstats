import {
  ArrowLeft,
  Crosshair,
  HeartPulse,
  Shield,
  Skull,
  Timer,
} from "lucide-react";
import type { DemoStats, JobAnalysis, PlayerStats } from "./api";
import { rateGamePlayers } from "./player-rating";
import { PlayerIdentityLinks } from "./player-links";

const whole = new Intl.NumberFormat("en");
const duration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
};
const value = (input: number | undefined) =>
  input === undefined ? "N/A" : whole.format(input);

function matchingMapPlayer(
  player: PlayerStats,
  stats: DemoStats,
  demoIndex: number,
) {
  return stats.players.find((candidate) =>
    player.identity?.steamId64
      ? candidate.identity?.steamId64 === player.identity.steamId64
      : player.id === `${demoIndex}:${candidate.id}`,
  );
}

export function PlayerProfile({
  gameId,
  player,
  players,
  stats,
  analyses,
}: {
  gameId: string;
  player: PlayerStats;
  players: PlayerStats[];
  stats: DemoStats[];
  analyses: JobAnalysis[];
}) {
  const rating = rateGamePlayers(stats, players).players.find(
    (candidate) => candidate.playerId === player.id,
  );
  const maps = stats.flatMap((demo, index) => {
    const local = matchingMapPlayer(player, demo, index);
    return local
      ? [
          {
            name:
              analyses[index]?.engineResult.demo.mapName ?? `Map ${index + 1}`,
            player: local,
          },
        ]
      : [];
  });
  const counterEntries = Object.entries(player.counters ?? {}).filter(
    ([, count]) => count !== 0,
  );

  return (
    <div className="player-profile-page">
      <a
        className="player-profile-back"
        href={`/game/${encodeURIComponent(gameId)}/players`}
      >
        <ArrowLeft /> Back to players
      </a>
      <header className="player-profile-hero">
        <div>
          <span className="eyebrow">Game player profile</span>
          <h2>{player.alias}</h2>
          <PlayerIdentityLinks
            gameId={gameId}
            player={player}
            className="player-profile-identity"
          />
        </div>
        <div className="player-profile-rating">
          <span>L4DStats Rating</span>
          <strong>{rating?.rating?.toFixed(2) ?? "N/A"}</strong>
          <small>
            Survivor {rating?.survivor.score?.toFixed(2) ?? "N/A"} · Infected{" "}
            {rating?.infected.score?.toFixed(2) ?? "N/A"}
          </small>
        </div>
      </header>

      <section className="player-profile-kpis" aria-label="Player totals">
        <article>
          <Crosshair />
          <span>
            SI kills<strong>{value(player.specialInfectedKills)}</strong>
          </span>
        </article>
        <article>
          <Skull />
          <span>
            Survivor deaths<strong>{value(player.survivorDeaths)}</strong>
          </span>
        </article>
        <article>
          <Shield />
          <span>
            SI incaps<strong>{value(player.specialIncaps)}</strong>
          </span>
        </article>
        <article>
          <Timer />
          <span>
            Pin time
            <strong>
              {player.pinSeconds === undefined
                ? "N/A"
                : duration(player.pinSeconds)}
            </strong>
          </span>
        </article>
        <article>
          <HeartPulse />
          <span>
            Revives<strong>{value(player.revives)}</strong>
          </span>
        </article>
      </section>

      <section className="player-profile-section">
        <header>
          <span className="eyebrow">Selected game</span>
          <h3>Map by map</h3>
        </header>
        <div
          className="player-profile-map-table"
          role="table"
          aria-label="Map contributions"
        >
          <div className="player-profile-map-head" role="row">
            <span role="columnheader">Map</span>
            <span role="columnheader">SI kills</span>
            <span role="columnheader">All infected</span>
            <span role="columnheader">Revives</span>
            <span role="columnheader">SI incaps</span>
            <span role="columnheader">Pin</span>
          </div>
          {maps.map(({ name, player: local }) => (
            <div role="row" key={name}>
              <strong role="cell">{name}</strong>
              <span role="cell">{value(local.specialInfectedKills)}</span>
              <span role="cell">{value(local.checkpointInfectedKills)}</span>
              <span role="cell">{value(local.revives)}</span>
              <span role="cell">{value(local.specialIncaps)}</span>
              <span role="cell">
                {local.pinSeconds === undefined
                  ? "N/A"
                  : duration(local.pinSeconds)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <div className="player-profile-detail-grid">
        <section className="player-profile-section">
          <header>
            <span className="eyebrow">Survivor contribution</span>
            <h3>Threat removal and support</h3>
          </header>
          <dl>
            <div>
              <dt>Total infected kills</dt>
              <dd>{value(player.checkpointInfectedKills)}</dd>
            </div>
            <div>
              <dt>Special Infected kills</dt>
              <dd>{value(player.specialInfectedKills)}</dd>
            </div>
            <div>
              <dt>Revives</dt>
              <dd>{value(player.revives)}</dd>
            </div>
            <div>
              <dt>Incaps suffered</dt>
              <dd>{value(player.survivorIncaps)}</dd>
            </div>
            <div>
              <dt>Tank damage</dt>
              <dd>{value(player.counters?.m_checkpointTankDamage)}</dd>
            </div>
            <div>
              <dt>Witch damage</dt>
              <dd>{value(player.counters?.m_checkpointWitchDamage)}</dd>
            </div>
          </dl>
        </section>
        <section className="player-profile-section">
          <header>
            <span className="eyebrow">Infected contribution</span>
            <h3>Control and conversion</h3>
          </header>
          <dl>
            <div>
              <dt>SI deaths</dt>
              <dd>{value(player.infectedDeaths)}</dd>
            </div>
            <div>
              <dt>Survivors incapped</dt>
              <dd>{value(player.specialIncaps)}</dd>
            </div>
            <div>
              <dt>Pounces</dt>
              <dd>{value(player.pounces)}</dd>
            </div>
            <div>
              <dt>Best pounce</dt>
              <dd>{value(player.highestPounceDamage)}</dd>
            </div>
            <div>
              <dt>Ghost time</dt>
              <dd>
                {player.ghostSeconds === undefined
                  ? "N/A"
                  : duration(player.ghostSeconds)}
              </dd>
            </div>
            <div>
              <dt>Tank damage dealt</dt>
              <dd>{value(player.counters?.m_checkpointPZTankDamage)}</dd>
            </div>
          </dl>
        </section>
      </div>

      {counterEntries.length > 0 && (
        <details className="player-profile-counters">
          <summary>Networked checkpoint counters</summary>
          <div>
            {counterEntries.map(([name, count]) => (
              <span key={name}>
                <small>{name}</small>
                <strong>{whole.format(count)}</strong>
              </span>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
