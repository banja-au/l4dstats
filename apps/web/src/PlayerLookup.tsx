import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, Search, UserRoundSearch } from "lucide-react";
import { type ApiPlayerHistory, workbenchApi } from "./api";
import { gameCampaignName } from "./campaign-metadata";
import { useI18n } from "./i18n";

function campaignForMaps(mapNames: string[]): string | null {
  return gameCampaignName(
    mapNames.map((mapName) => ({
      engineResult: { demo: { mapName } },
    })) as Parameters<typeof gameCampaignName>[0],
  );
}

export function PlayerLookup() {
  const { t } = useI18n();
  const initial =
    new URLSearchParams(window.location.search).get("player") ?? "";
  const [query, setQuery] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<ApiPlayerHistory | null>(null);

  async function lookup(value: string) {
    const normalized = value.trim();
    if (!normalized) return;
    setLoading(true);
    setError("");
    setHistory(null);
    try {
      const result = await workbenchApi.playerHistory(normalized);
      setHistory(result);
      const parameters = new URLSearchParams(window.location.search);
      parameters.set("player", result.steamId64);
      window.history.replaceState({}, "", `/?${parameters.toString()}`);
    } catch (lookupError) {
      setError(
        lookupError instanceof Error
          ? lookupError.message
          : t("playerSearch.failed"),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initial) void lookup(initial);
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    void lookup(query);
  }

  return (
    <section className="player-lookup" aria-labelledby="player-lookup-title">
      <div className="player-lookup-heading">
        <UserRoundSearch aria-hidden="true" />
        <div>
          <strong id="player-lookup-title">{t("playerSearch.title")}</strong>
          <span>{t("playerSearch.subtitle")}</span>
        </div>
      </div>
      <form onSubmit={submit}>
        <label className="sr-only" htmlFor="steam-player-query">
          {t("playerSearch.label")}
        </label>
        <input
          id="steam-player-query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("playerSearch.placeholder")}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" disabled={loading || !query.trim()}>
          <Search aria-hidden="true" />
          {loading ? t("playerSearch.searching") : t("playerSearch.search")}
        </button>
      </form>
      {error && (
        <p className="player-lookup-error" role="alert">
          {error}
        </p>
      )}
      {history && (
        <div className="player-history" aria-live="polite">
          <header>
            <div>
              <strong>
                {history.displayName ?? t("playerSearch.unknownName")}
              </strong>
              <span>{history.steamId64}</span>
            </div>
            <a href={history.profileUrl} target="_blank" rel="noreferrer">
              {t("playerSearch.steamProfile")}
            </a>
          </header>
          <div className="player-game-list">
            {history.games.map((game) => {
              const campaign = campaignForMaps(
                game.demos.map((demo) => demo.mapName),
              );
              return (
                <a
                  key={game.id}
                  href={`/game/${encodeURIComponent(game.id)}/overview`}
                >
                  <span>
                    <strong>{campaign ?? t("playerSearch.game")}</strong>
                    <small>
                      {t(
                        game.demos.length === 1
                          ? "playerSearch.demoCount"
                          : "playerSearch.demoCountPlural",
                        { count: game.demos.length },
                      )}
                    </small>
                  </span>
                  <span className="player-game-maps">
                    {game.demos.map((demo) => demo.mapName).join(" · ")}
                  </span>
                  <ArrowRight aria-hidden="true" />
                </a>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
