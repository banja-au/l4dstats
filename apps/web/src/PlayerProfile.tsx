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
import { useI18n } from "./i18n";

const duration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
};
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
  const { locale, t } = useI18n();
  const whole = new Intl.NumberFormat(locale);
  const value = (input: number | undefined) =>
    input === undefined ? t("common.notAvailable") : whole.format(input);
  const rating = rateGamePlayers(stats, players).players.find(
    (candidate) => candidate.playerId === player.id,
  );
  const maps = stats.flatMap((demo, index) => {
    const local = matchingMapPlayer(player, demo, index);
    return local
      ? [
          {
            name:
              analyses[index]?.engineResult.demo.mapName ??
              t("filters.mapNumber", { number: index + 1 }),
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
        <ArrowLeft /> {t("player.back")}
      </a>
      <header className="player-profile-hero">
        <div>
          <span className="eyebrow">{t("player.profile")}</span>
          <h2>{player.alias}</h2>
          <PlayerIdentityLinks
            gameId={gameId}
            player={player}
            className="player-profile-identity"
          />
        </div>
        <div className="player-profile-rating">
          <span>{t("player.rating")}</span>
          <strong>
            {rating?.rating?.toFixed(2) ?? t("common.notAvailable")}
          </strong>
          <small>
            {t("player.survivorRating", {
              rating:
                rating?.survivor.score?.toFixed(2) ?? t("common.notAvailable"),
            })}{" "}
            ·{" "}
            {t("player.infectedRating", {
              rating:
                rating?.infected.score?.toFixed(2) ?? t("common.notAvailable"),
            })}
          </small>
        </div>
      </header>

      <section className="player-profile-kpis" aria-label={t("player.totals")}>
        <article>
          <Crosshair />
          <span>
            {t("player.siKills")}
            <strong>{value(player.specialInfectedKills)}</strong>
          </span>
        </article>
        <article>
          <Skull />
          <span>
            {t("player.survivorDeaths")}
            <strong>{value(player.survivorDeaths)}</strong>
          </span>
        </article>
        <article>
          <Shield />
          <span>
            {t("player.siIncaps")}
            <strong>{value(player.specialIncaps)}</strong>
          </span>
        </article>
        <article>
          <Timer />
          <span>
            {t("player.pinTime")}
            <strong>
              {player.pinSeconds === undefined
                ? t("common.notAvailable")
                : duration(player.pinSeconds)}
            </strong>
          </span>
        </article>
        <article>
          <HeartPulse />
          <span>
            {t("player.revives")}
            <strong>{value(player.revives)}</strong>
          </span>
        </article>
      </section>

      <section className="player-profile-section">
        <header>
          <span className="eyebrow">{t("player.selectedGame")}</span>
          <h3>{t("player.mapByMap")}</h3>
        </header>
        <div
          className="player-profile-map-table"
          role="table"
          aria-label={t("player.mapContributions")}
        >
          <div className="player-profile-map-head" role="row">
            <span role="columnheader">{t("player.map")}</span>
            <span role="columnheader">{t("player.siKills")}</span>
            <span role="columnheader">{t("player.allInfected")}</span>
            <span role="columnheader">{t("player.revives")}</span>
            <span role="columnheader">{t("player.siIncaps")}</span>
            <span role="columnheader">{t("player.pin")}</span>
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
                  ? t("common.notAvailable")
                  : duration(local.pinSeconds)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <div className="player-profile-detail-grid">
        <section className="player-profile-section">
          <header>
            <span className="eyebrow">{t("player.survivorContribution")}</span>
            <h3>{t("player.survivorContributionTitle")}</h3>
          </header>
          <dl>
            <div>
              <dt>{t("player.totalInfectedKills")}</dt>
              <dd>{value(player.checkpointInfectedKills)}</dd>
            </div>
            <div>
              <dt>{t("player.specialInfectedKills")}</dt>
              <dd>{value(player.specialInfectedKills)}</dd>
            </div>
            <div>
              <dt>{t("player.revives")}</dt>
              <dd>{value(player.revives)}</dd>
            </div>
            <div>
              <dt>{t("player.incapsSuffered")}</dt>
              <dd>{value(player.survivorIncaps)}</dd>
            </div>
            <div>
              <dt>{t("player.tankDamage")}</dt>
              <dd>{value(player.counters?.m_checkpointTankDamage)}</dd>
            </div>
            <div>
              <dt>{t("player.witchDamage")}</dt>
              <dd>{value(player.counters?.m_checkpointWitchDamage)}</dd>
            </div>
          </dl>
        </section>
        <section className="player-profile-section">
          <header>
            <span className="eyebrow">{t("player.infectedContribution")}</span>
            <h3>{t("player.infectedContributionTitle")}</h3>
          </header>
          <dl>
            <div>
              <dt>{t("player.siDeaths")}</dt>
              <dd>{value(player.infectedDeaths)}</dd>
            </div>
            <div>
              <dt>{t("player.survivorsIncapped")}</dt>
              <dd>{value(player.specialIncaps)}</dd>
            </div>
            <div>
              <dt>{t("player.pounces")}</dt>
              <dd>{value(player.pounces)}</dd>
            </div>
            <div>
              <dt>{t("player.bestPounce")}</dt>
              <dd>{value(player.highestPounceDamage)}</dd>
            </div>
            <div>
              <dt>{t("player.ghostTime")}</dt>
              <dd>
                {player.ghostSeconds === undefined
                  ? t("common.notAvailable")
                  : duration(player.ghostSeconds)}
              </dd>
            </div>
            <div>
              <dt>{t("player.tankDamageDealt")}</dt>
              <dd>{value(player.counters?.m_checkpointPZTankDamage)}</dd>
            </div>
          </dl>
        </section>
      </div>

      {counterEntries.length > 0 && (
        <details className="player-profile-counters">
          <summary>{t("player.networkCounters")}</summary>
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
