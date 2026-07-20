import { useEffect, useState } from "react";
import { ArrowUpRight, Skull, Users } from "lucide-react";
import { workbenchApi, type ApiPublicStats } from "./api";
import EvidenceLoader from "./EvidenceLoader";
import { useI18n } from "./i18n";
import "./stats-page.css";

const number = new Intl.NumberFormat();
const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const when = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

function PlayerRows({
  rows,
  value,
}: {
  rows: Array<{
    displayName: string;
    lookup: string;
    games: number;
    demos?: number;
    signals?: number;
  }>;
  value: "games" | "signals";
}) {
  const { tx } = useI18n();
  if (!rows.length)
    return (
      <p className="stats-empty">
        {tx("No eligible players yet.", "Aún no hay jugadores elegibles.")}
      </p>
    );
  return (
    <ol className="stats-ranking">
      {rows.map((row, index) => (
        <li key={row.lookup}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <a href={`/player/${encodeURIComponent(row.lookup)}`}>
            {row.displayName}
          </a>
          <strong>
            {number.format(value === "games" ? row.games : (row.signals ?? 0))}
          </strong>
          <small>
            {value === "games"
              ? tx("{count} demos", "{count} demos", {
                  count: number.format(row.demos ?? 0),
                })
              : tx("{count} games", "{count} partidas", {
                  count: number.format(row.games),
                })}
          </small>
        </li>
      ))}
    </ol>
  );
}

function StatsPage() {
  const { tx } = useI18n();
  const [stats, setStats] = useState<ApiPublicStats | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    document.title = "Stats | L4DStats";
    void workbenchApi
      .stats()
      .then(setStats, (reason) =>
        setError(
          reason instanceof Error ? reason.message : "Stats unavailable",
        ),
      );
  }, []);
  if (error)
    return (
      <main className="public-stats">
        <a className="stats-wordmark" href="/">
          L4D<span>STATS</span>
        </a>
        <div className="stats-error">{error}</div>
      </main>
    );
  if (!stats)
    return (
      <EvidenceLoader label={tx("Reading the archive", "Leyendo el archivo")} />
    );
  const cards = [
    [tx("Demos processed", "Demos procesadas"), stats.totals.demosProcessed],
    [tx("Last 24 hours", "Últimas 24 horas"), stats.totals.demosLast24Hours],
    [tx("Last 30 days", "Últimos 30 días"), stats.totals.demosLast30Days],
    [
      tx("Games reconstructed", "Partidas reconstruidas"),
      stats.totals.gamesProcessed,
    ],
    [
      tx("Signals identified", "Señales identificadas"),
      stats.totals.signalsIdentified,
    ],
    [
      tx("Signals / demo", "Señales / demo"),
      stats.totals.averageSignalsPerDemo,
    ],
  ] as const;
  return (
    <main className="public-stats">
      <div className="stats-poster-type" aria-hidden="true">
        {tx("ARCHIVE", "ARCHIVO")}
      </div>
      <header className="stats-masthead">
        <a className="stats-wordmark" href="/">
          L4D<span>STATS</span>
        </a>
        <div>
          <span className="stats-kicker">
            <i /> {tx("Live archive", "Archivo en vivo")}
          </span>
          <h1>{tx("STATS", "ESTADÍSTICAS")}</h1>
          <p>
            {tx(
              "Aggregate processing and review workload across retained L4DStats analyses. Signals are reasons to inspect evidence—not verdicts.",
              "Procesamiento agregado y carga de revisión de los análisis conservados. Las señales son motivos para revisar evidencia, no veredictos.",
            )}
          </p>
        </div>
        <div className="stats-stamp" aria-hidden="true">
          <Skull />
          <span>{tx("EST. 2026", "EST. 2026")}</span>
        </div>
      </header>
      <section
        className="stats-counters"
        aria-label={tx("Processing totals", "Totales de procesamiento")}
      >
        {cards.map(([label, value], index) => (
          <article key={label}>
            <span>{label}</span>
            <strong>
              {value === null
                ? "—"
                : index === 5
                  ? decimal.format(value)
                  : number.format(value)}
            </strong>
          </article>
        ))}
      </section>
      <div className="stats-grid">
        <section className="stats-panel stats-panel-games">
          <header>
            <div>
              <span className="stats-section-no">01</span>
              <h2>{tx("Most seen", "Más vistos")}</h2>
            </div>
            <small>
              {tx("ranked by distinct games", "por partidas distintas")}
            </small>
          </header>
          <PlayerRows rows={stats.players.byGames} value="games" />
        </section>
        <section className="stats-panel stats-panel-signals">
          <header>
            <div>
              <span className="stats-section-no">02</span>
              <h2>{tx("Signal volume", "Volumen de señales")}</h2>
            </div>
            <small>
              {tx(
                "review signals, not labels",
                "señales de revisión, no etiquetas",
              )}
            </small>
          </header>
          <PlayerRows rows={stats.players.bySignals} value="signals" />
        </section>
        <section className="stats-panel stats-panel-rating">
          <header>
            <div>
              <span className="stats-section-no">03</span>
              <h2>{tx("Top rated", "Mejor valorados")}</h2>
            </div>
            <small>
              {tx("minimum {count} games", "mínimo {count} partidas", {
                count: stats.players.ratingMinimumGames,
              })}
            </small>
          </header>
          {stats.players.ratingAvailability === "unavailable" ? (
            <div className="stats-method-note">
              <strong>
                {tx(
                  "Not enough defensible data yet.",
                  "Aún no hay suficientes datos defendibles.",
                )}
              </strong>
              <p>
                {tx(
                  "Career ratings are withheld until the stored methodology can aggregate at least 100 distinct games per player. Missing is not zero.",
                  "Las valoraciones de carrera se ocultan hasta que la metodología pueda agregar al menos 100 partidas distintas por jugador. Ausente no equivale a cero.",
                )}
              </p>
            </div>
          ) : (
            <ol className="stats-ranking">
              {stats.players.byRating.map((row, i) => (
                <li key={row.lookup}>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <a href={`/player/${encodeURIComponent(row.lookup)}`}>
                    {row.displayName}
                  </a>
                  <strong>{row.rating.toFixed(2)}</strong>
                  <small>
                    {tx("{count} games", "{count} partidas", {
                      count: row.games,
                    })}
                  </small>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
      <section className="stats-recent">
        <header>
          <div>
            <span className="stats-section-no">04</span>
            <h2>{tx("Fresh off the server", "Recién salidas del servidor")}</h2>
          </div>
          <span>
            <Users />{" "}
            {tx("Last 20 processed games", "Últimas 20 partidas procesadas")}
          </span>
        </header>
        <div className="stats-game-list">
          {stats.recentGames.map((game, index) => (
            <a
              href={`/game/${encodeURIComponent(game.id)}/overview`}
              key={game.id}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>
                  {game.campaign ??
                    tx("Unresolved campaign", "Campaña sin resolver")}
                </strong>
                <small>
                  {tx(
                    "{maps} maps · {players} players · {signals} signals",
                    "{maps} mapas · {players} jugadores · {signals} señales",
                    {
                      maps: game.mapCount,
                      players: game.playerCount,
                      signals:
                        game.signals ?? tx("unavailable", "no disponible"),
                    },
                  )}
                </small>
              </div>
              <time dateTime={game.processedAt}>{when(game.processedAt)}</time>
              <ArrowUpRight />
            </a>
          ))}
        </div>
      </section>
      <footer>
        {tx(
          "Generated {date} · retained analyses only · unknown telemetry stays unknown",
          "Generado {date} · solo análisis conservados · la telemetría desconocida permanece desconocida",
          { date: when(stats.generatedAt) },
        )}
      </footer>
    </main>
  );
}

export default StatsPage;
