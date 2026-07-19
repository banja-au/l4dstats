import { useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, ExternalLink, Radio } from "lucide-react";
import { workbenchApi, type ApiPlayerHistory } from "./api";
import { gameCampaignName } from "./campaign-metadata";
import { useI18n } from "./i18n";
import "./global-player.css";

const whole = new Intl.NumberFormat();
const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 });
const duration = (seconds: number) =>
  `${whole.format(Math.floor(seconds / 3600))}h ${Math.floor((seconds % 3600) / 60)}m`;

export default function GlobalPlayerPage({ steamId64 }: { steamId64: string }) {
  const { tx } = useI18n();
  const [history, setHistory] = useState<ApiPlayerHistory | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void workbenchApi
      .playerHistory(steamId64)
      .then(setHistory, (reason) =>
        setError(
          reason instanceof Error
            ? reason.message
            : tx("Player unavailable", "Jugador no disponible"),
        ),
      );
  }, [steamId64]);
  useEffect(() => {
    if (history)
      document.title = `${history.displayName ?? steamId64} | L4DStats`;
  }, [history, steamId64]);
  if (error)
    return (
      <main className="global-player">
        <a href="/stats">
          <ArrowLeft /> {tx("Back to stats", "Volver a estadísticas")}
        </a>
        <p className="global-player-error">{error}</p>
      </main>
    );
  if (!history)
    return (
      <main className="global-player global-player-loading">
        <Radio />{" "}
        {tx("Reconstructing player history…", "Reconstruyendo historial…")}
      </main>
    );
  const stats = history.stats;
  const demos = history.games.reduce((sum, game) => sum + game.demos.length, 0);
  return (
    <main className="global-player">
      <a className="global-player-back" href="/stats">
        <ArrowLeft /> {tx("All stats", "Todas las estadísticas")}
      </a>
      <header className="global-player-hero">
        <div>
          <span>{tx("Retained player history", "Historial conservado")}</span>
          <h1>
            {history.displayName ?? tx("Unknown player", "Jugador desconocido")}
          </h1>
          <p>{steamId64}</p>
        </div>
        <a href={history.profileUrl} target="_blank" rel="noreferrer">
          {tx("Steam profile", "Perfil de Steam")} <ExternalLink />
        </a>
      </header>
      <section className="global-player-counters">
        <article>
          <span>{tx("Games", "Partidas")}</span>
          <strong>{whole.format(stats?.games ?? history.games.length)}</strong>
        </article>
        <article>
          <span>{tx("Demos", "Demos")}</span>
          <strong>{whole.format(stats?.demos ?? demos)}</strong>
        </article>
        <article>
          <span>{tx("Signals", "Señales")}</span>
          <strong>
            {stats?.signals == null ? "—" : whole.format(stats.signals)}
          </strong>
        </article>
        <article>
          <span>{tx("Career rating", "Valoración de carrera")}</span>
          <strong>
            {stats?.rating == null ? "—" : stats.rating.toFixed(2)}
          </strong>
          <small>
            {tx("minimum {count} games", "mínimo {count} partidas", {
              count: stats?.ratingMinimumGames ?? 100,
            })}
          </small>
        </article>
      </section>
      {stats && (
        <section className="global-player-detail">
          <div>
            <span>{tx("Survivor time", "Tiempo como superviviente")}</span>
            <strong>
              {stats.survivorSeconds == null
                ? "—"
                : duration(stats.survivorSeconds)}
            </strong>
          </div>
          <div>
            <span>{tx("Infected lives", "Vidas como infectado")}</span>
            <strong>
              {stats.infectedLives == null
                ? "—"
                : whole.format(stats.infectedLives)}
            </strong>
          </div>
          <div>
            <span>{tx("Stats coverage", "Cobertura estadística")}</span>
            <strong>
              {stats.materializedDemos}/{stats.demos}
            </strong>
          </div>
          <div>
            <span>{tx("Rating model", "Modelo de valoración")}</span>
            <strong>{stats.ratingModelVersion}</strong>
          </div>
        </section>
      )}
      <section className="global-player-section">
        <header>
          <span>01</span>
          <h2>{tx("Observed performance", "Rendimiento observado")}</h2>
          <small>
            {tx(
              "Opportunity-normalized; unavailable inputs omitted",
              "Normalizado por oportunidades; entradas no disponibles omitidas",
            )}
          </small>
        </header>
        {stats?.metrics.length ? (
          <div className="global-player-metrics">
            {stats.metrics.map((metric) => (
              <article key={metric.key}>
                <span>{metric.label}</span>
                <strong>{decimal.format(metric.value)}</strong>
                <small>
                  {tx("exposure {value}", "exposición {value}", {
                    value: decimal.format(metric.exposure),
                  })}
                </small>
              </article>
            ))}
          </div>
        ) : (
          <p className="global-player-empty">
            {tx(
              "No rating inputs are available for this player yet.",
              "Aún no hay entradas de valoración disponibles.",
            )}
          </p>
        )}
      </section>
      <section className="global-player-section">
        <header>
          <span>02</span>
          <h2>{tx("All retained games", "Todas las partidas conservadas")}</h2>
          <small>
            {tx("{count} linked games", "{count} partidas enlazadas", {
              count: history.games.length,
            })}
          </small>
        </header>
        <div className="global-player-games">
          {history.games.map((game) => {
            const campaign = gameCampaignName(
              game.demos.map((demo) => ({
                engineResult: { demo: { mapName: demo.mapName } },
              })) as Parameters<typeof gameCampaignName>[0],
            );
            return (
              <a
                key={game.id}
                href={`/game/${encodeURIComponent(game.id)}/overview`}
              >
                <div>
                  <strong>
                    {campaign ??
                      tx("Unresolved campaign", "Campaña sin resolver")}
                  </strong>
                  <small>
                    {game.demos.map((demo) => demo.mapName).join(" · ")}
                  </small>
                </div>
                <time>
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(game.updatedAt))}
                </time>
                <ArrowUpRight />
              </a>
            );
          })}
        </div>
      </section>
      <footer>
        {tx(
          "Observed demo history only. Absence is not evidence of no play.",
          "Solo historial observado. La ausencia no demuestra que no haya jugado.",
        )}
      </footer>
    </main>
  );
}
