import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  AlertCircle,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  Crosshair,
  ExternalLink,
  Layers3,
  LoaderCircle,
  Maximize2,
  Minimize2,
  RefreshCw,
  ShieldAlert,
  UploadCloud,
  Users,
} from "lucide-react";
import {
  workbenchApi,
  type ApiJob,
  type CompetitiveStats,
  type DemoStats,
  type JobAnalysis,
  type MapGeometry,
  type MatchTimelineEvent,
  type PlayerStats,
} from "./api";
import { parserProvenanceLabel } from "./parser-provenance";
import { aggregateGamePlayers } from "./game-aggregation";
import { halfScopeKey, scopeDemoStats } from "./demo-scope";
import { rateGamePlayers } from "./player-rating";
import { gameCampaignName, orderGameAnalyses } from "./campaign-metadata";
import { reconstructVersusScores } from "./score-reconstruction";
import { PlayerProfile } from "./PlayerProfile";
import { parsePlayerProfilePath, PlayerIdentityLinks } from "./player-links";
import { InfectedIcon } from "./visual";

type UploadItem = {
  key: string;
  file: { name: string; size: number };
  source?: File;
  state: "uploading" | "queued" | "running" | "succeeded" | "failed";
  progress: number;
  message: string;
  job?: ApiJob;
  analysis?: JobAnalysis;
};
type Tab =
  | "overview"
  | "players"
  | "combat"
  | "timeline"
  | "signals"
  | "quality";
const TABS: Tab[] = [
  "overview",
  "players",
  "combat",
  "timeline",
  "signals",
  "quality",
];
const analysisRouteParts = () =>
  window.location.pathname.match(/^\/analysis\/([^/]+)(?:\/([^/]+))?\/?$/);
const gameRouteParts = () =>
  window.location.pathname.match(
    /^\/game\/([^/]+)(?:\/(overview|players|combat|timeline|signals|quality))?\/?$/,
  );
const routeTab = (): Tab => {
  const candidate = gameRouteParts()?.[2] ?? analysisRouteParts()?.[2];
  return TABS.includes(candidate as Tab) ? (candidate as Tab) : "overview";
};

const MAX_DEMOS = 10;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const whole = new Intl.NumberFormat("en");
const pct = (value: number) => `${Math.round(value * 100)}%`;
const duration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = Math.floor(seconds % 60);
  return hours
    ? `${hours}h ${minutes}m`
    : `${minutes}:${remaining.toString().padStart(2, "0")}`;
};
const bytes = (value: number) =>
  value >= 1024 ** 2
    ? `${(value / 1024 ** 2).toFixed(1)} MB`
    : `${Math.round(value / 1024)} KB`;
const counterLabel = (value: string) =>
  value
    .replace(/^m_(checkpoint|mission)/, "")
    .replace(/^PZ/, "SI ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ");

function BrandMark() {
  return <img src="/art/infected-mark.webp" alt="" aria-hidden="true" />;
}

function MvpMark() {
  return (
    <svg className="mvp-mark" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M4 5h24l-2 20-10 4L6 25 4 5Z" />
      <path d="m10 10 2 12m4-13v14m6-13-2 12" />
      <path d="M8 17h16" />
    </svg>
  );
}

function Ring({ value, label }: { value: number; label: string }) {
  const radius = 34;
  const circumference = Math.PI * 2 * radius;
  return (
    <div className="ring-stat">
      <svg viewBox="0 0 84 84" aria-hidden="true">
        <circle cx="42" cy="42" r={radius} className="ring-track" />
        <circle
          cx="42"
          cy="42"
          r={radius}
          className="ring-value"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - value)}
        />
      </svg>
      <strong>{pct(value)}</strong>
      <span>{label}</span>
    </div>
  );
}

function App() {
  const requestedPlayerProfile = parsePlayerProfilePath(
    window.location.pathname,
  );
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [tab, setTab] = useState<Tab>(routeTab);
  const [selectedGame, setSelectedGame] = useState<string | null>(
    parsePlayerProfilePath(window.location.pathname)?.gameId ??
      (gameRouteParts()?.[1]
        ? decodeURIComponent(gameRouteParts()![1]!)
        : null),
  );
  const [gameConfidence, setGameConfidence] = useState<
    "provisional" | "high" | "unassociated" | null
  >(null);
  const [disabledDemos, setDisabledDemos] = useState<string[]>([]);
  const [disabledHalves, setDisabledHalves] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState("");
  const refreshedGames = useRef(false);

  const update = (key: string, patch: Partial<UploadItem>) =>
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );

  async function watchJob(key: string, id: string, updateUrl: boolean) {
    for (;;) {
      const job = await workbenchApi.job(id);
      update(key, {
        state: job.state === "cancelled" ? "failed" : job.state,
        progress: job.progress,
        message:
          job.message ??
          (job.state === "succeeded" ? "Analysis complete" : "Analyzing demo"),
        job,
        ...(job.analysis ? { analysis: job.analysis } : {}),
      });
      if (
        job.state === "succeeded" ||
        job.state === "failed" ||
        job.state === "cancelled"
      ) {
        if (job.state === "succeeded" && job.analysis && updateUrl)
          window.history.replaceState(
            {},
            "",
            job.analysis.gameId
              ? `/game/${encodeURIComponent(job.analysis.gameId)}/${tab}`
              : `/analysis/${job.id}/${tab}`,
          );
        break;
      }
      await wait(500);
    }
  }

  async function process(item: UploadItem, updateUrl: boolean) {
    try {
      if (!item.source) throw new Error("Demo source is unavailable");
      const uploaded = await workbenchApi.uploadDemo(item.source);
      update(item.key, {
        state: "queued",
        progress: 0.05,
        message: "Queued for analysis",
        job: uploaded.job,
      });
      await watchJob(item.key, uploaded.job.id, updateUrl);
    } catch (error) {
      update(item.key, {
        state: "failed",
        message: error instanceof Error ? error.message : "Upload failed",
      });
    }
  }

  async function reanalyzeLegacy() {
    const targets = completed.flatMap((item) => {
      const id = item.job?.id ?? item.analysis?.jobId;
      return id ? [{ item, id }] : [];
    });
    if (!targets.length) return;
    try {
      await Promise.all(
        targets.map(async ({ item, id }) => {
          const job = await workbenchApi.reanalyzeJob(id);
          update(item.key, {
            state: "queued",
            progress: 0,
            message: "Reanalyzing with the current engine",
            job,
          });
          await watchJob(item.key, job.id, false);
        }),
      );
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "Reanalysis failed",
      );
    }
  }

  function addFiles(files: File[]) {
    const demos = files.filter((file) =>
      file.name.toLowerCase().endsWith(".dem"),
    );
    if (!demos.length) {
      setUploadError("Choose one or more .dem files.");
      return;
    }
    if (items.length + demos.length > MAX_DEMOS) {
      setUploadError(`You can analyze up to ${MAX_DEMOS} demos at once.`);
      return;
    }
    setUploadError("");
    const next = demos.map((source) => ({
      key: `${source.name}:${source.size}:${source.lastModified}:${crypto.randomUUID()}`,
      file: { name: source.name, size: source.size },
      source,
      state: "uploading" as const,
      progress: 0,
      message: "Uploading demo",
    }));
    setItems((current) => [...current, ...next]);
    const updateUrl = items.length === 0 && next.length === 1;
    for (const item of next) void process(item, updateUrl);
  }

  useEffect(() => {
    const playerMatch = parsePlayerProfilePath(window.location.pathname);
    const gameMatch = gameRouteParts();
    if (gameMatch || playerMatch) {
      const id = playerMatch?.gameId ?? decodeURIComponent(gameMatch![1]!);
      if (!TABS.includes(gameMatch?.[2] as Tab))
        if (!playerMatch)
          window.history.replaceState(
            {},
            "",
            `/game/${encodeURIComponent(id)}/overview`,
          );
      void workbenchApi.game(id).then(
        (game) => {
          setSelectedGame(game.id);
          setGameConfidence(game.confidence);
          setItems(
            game.analyses.map((analysis) => ({
              key: `game:${game.id}:${analysis.jobId}`,
              file: {
                name: `${analysis.engineResult.demo.mapName}.dem`,
                size: analysis.engineResult.demo.bytes,
              },
              state: "succeeded" as const,
              progress: 1,
              message: "Analysis complete",
              analysis,
            })),
          );
        },
        (error) => {
          setItems([
            {
              key: `game:${id}:error`,
              file: { name: "Saved game", size: 0 },
              state: "failed",
              progress: 0,
              message:
                error instanceof Error ? error.message : "Game not found",
            },
          ]);
        },
      );
      return;
    }
    const match = analysisRouteParts();
    if (!match) return;
    const id = decodeURIComponent(match[1]!);
    if (!TABS.includes(match[2] as Tab))
      window.history.replaceState(
        {},
        "",
        `/analysis/${encodeURIComponent(id)}/overview`,
      );
    const key = `route:${id}`;
    setItems([
      {
        key,
        file: { name: "Saved analysis", size: 0 },
        state: "running",
        progress: 0,
        message: "Loading analysis",
      },
    ]);
    void (async () => {
      try {
        const job = await workbenchApi.job(id);
        if (job.state === "succeeded" && job.analysis) {
          setItems([
            {
              key,
              file: {
                name: `${job.analysis.engineResult.demo.mapName}.dem`,
                size: job.analysis.engineResult.demo.bytes,
              },
              state: "succeeded",
              progress: 1,
              message: "Analysis complete",
              job,
              analysis: job.analysis,
            },
          ]);
        } else {
          await watchJob(key, id, false);
        }
      } catch (error) {
        setItems((current) =>
          current.map((item) =>
            item.key === key
              ? {
                  ...item,
                  state: "failed",
                  message:
                    error instanceof Error
                      ? error.message
                      : "Analysis not found",
                }
              : item,
          ),
        );
      }
    })();
  }, []);

  const isWorking = items.some((item) =>
    ["uploading", "queued", "running"].includes(item.state),
  );
  const completed = items.filter(
    (item) => item.state === "succeeded" && item.analysis,
  );
  const analyses = completed.map((item) => item.analysis!).filter(Boolean);
  useEffect(() => {
    if (isWorking || refreshedGames.current || !completed.length) return;
    refreshedGames.current = true;
    void Promise.all(
      completed.map((item) =>
        item.job?.id ? workbenchApi.job(item.job.id) : Promise.resolve(null),
      ),
    ).then((jobs) => {
      for (const [index, job] of jobs.entries())
        if (job?.analysis)
          update(completed[index]!.key, { job, analysis: job.analysis });
    });
  }, [isWorking, completed.length]);
  const gameGroups = [
    ...new Set(
      analyses
        .map((analysis) => analysis.gameId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  useEffect(() => {
    if (selectedGame || !gameGroups[0]) return;
    setSelectedGame(gameGroups[0]);
    window.history.replaceState(
      {},
      "",
      `/game/${encodeURIComponent(gameGroups[0])}/${tab}`,
    );
    void workbenchApi
      .game(gameGroups[0])
      .then((game) => setGameConfidence(game.confidence));
  }, [gameGroups.join("|"), selectedGame, tab]);
  const gameAnalyses = orderGameAnalyses(
    selectedGame
      ? analyses.filter((analysis) => analysis.gameId === selectedGame)
      : analyses,
  );
  const selectedCampaignName = gameCampaignName(gameAnalyses);
  const canonicalScoreEntries = gameAnalyses.flatMap((analysis) =>
    analysis.engineResult.demo.stats
      ? [{ analysis, stats: analysis.engineResult.demo.stats }]
      : [],
  );
  useEffect(() => {
    if (!gameAnalyses.length) {
      document.title = isWorking ? "Analyzing demos | L4DStats" : "L4DStats";
      return;
    }
    const campaign =
      selectedCampaignName ?? gameAnalyses[0]!.engineResult.demo.mapName;
    const finalScore = reconstructVersusScores(
      canonicalScoreEntries.map((entry) => entry.stats),
      canonicalScoreEntries.map((entry) => entry.analysis),
    ).at(-1);
    document.title = finalScore?.complete
      ? `${campaign}: ${whole.format(finalScore.teamA)} - ${whole.format(finalScore.teamB ?? 0)} | L4DStats`
      : `${campaign} analysis | L4DStats`;
  }, [gameAnalyses, selectedCampaignName, canonicalScoreEntries, isWorking]);
  const visible = gameAnalyses.filter(
    (analysis) => !disabledDemos.includes(analysis.demoSha256),
  );
  const roundScopes = visible.flatMap((analysis) =>
    (analysis.engineResult.demo.stats?.competitive?.halves ?? [])
      .filter((half) => half.players.every((player) => player.summary))
      .map((half) => ({
        analysis,
        half,
        key: halfScopeKey(analysis.demoSha256, half.id),
      })),
  );
  const enabledRoundCount = roundScopes.filter(
    (scope) => !disabledHalves.includes(scope.key),
  ).length;
  const scopedEntries = visible.flatMap((analysis) => {
    const value = analysis.engineResult.demo.stats;
    if (!value) return [];
    return [
      {
        analysis,
        stats: scopeDemoStats(value, analysis.demoSha256, disabledHalves),
      },
    ];
  });
  const activeEntries = scopedEntries.filter(
    ({ stats: value }) =>
      !value.competitive || value.competitive.halves.length > 0,
  );
  const scopedAnalyses = activeEntries.map((entry) => entry.analysis);
  const stats = activeEntries.map((entry) => entry.stats);
  const players = aggregateGamePlayers(stats);
  const playerProfileRoute = requestedPlayerProfile;
  const profilePlayer = playerProfileRoute
    ? players.find((player) => player.id === playerProfileRoute.playerId)
    : undefined;
  useEffect(() => {
    if (profilePlayer && selectedCampaignName)
      document.title = `${profilePlayer.alias} · ${selectedCampaignName} | L4DStats`;
  }, [profilePlayer, selectedCampaignName]);
  const scopedRanges = new Map(
    activeEntries.flatMap(({ analysis, stats: value }) => {
      const ranges = value.competitive?.halves.map((half) => half.tickRange);
      return ranges ? [[analysis.demoSha256, ranges] as const] : [];
    }),
  );
  const tickIsVisible = (demoSha256: string, tick: number) => {
    const ranges = scopedRanges.get(demoSha256);
    return (
      !ranges ||
      ranges.some((range) => tick >= range.start && tick <= range.end)
    );
  };
  const totals = useMemo(
    () => ({
      demos: stats.length,
      duration: stats.reduce((sum, value) => sum + value.durationSeconds, 0),
      observations: stats.reduce(
        (sum, value) => sum + value.observationCount,
        0,
      ),
      events: stats.reduce((sum, value) => sum + value.eventCount, 0),
      players: new Set(players.map((player) => player.id)).size,
      evidence: scopedAnalyses.reduce(
        (sum, analysis) =>
          sum +
          analysis.engineResult.cases.reduce((caseSum, item) => {
            const presented = item.presentation?.evidence;
            if (presented)
              return (
                caseSum +
                presented.filter((evidence) =>
                  tickIsVisible(analysis.demoSha256, evidence.tick),
                ).length
              );
            return (
              caseSum + (disabledHalves.length === 0 ? item.evidence.length : 0)
            );
          }, 0),
        0,
      ),
    }),
    [stats, players, scopedAnalyses],
  );
  const hasResults = analyses.length > 0;
  const routedId = analysisRouteParts()?.[1];
  const analysisId = routedId
    ? decodeURIComponent(routedId)
    : analyses.length === 1
      ? analyses[0]?.jobId
      : undefined;
  const selectTab = (next: Tab) => {
    setTab(next);
    if (selectedGame)
      window.history.replaceState(
        {},
        "",
        `/game/${encodeURIComponent(selectedGame)}/${next}`,
      );
    else if (analysisId)
      window.history.replaceState(
        {},
        "",
        `/analysis/${encodeURIComponent(analysisId)}/${next}`,
      );
  };
  const openTimeline = (demoSha256: string, tick: number) => {
    const analysis = visible.find((item) => item.demoSha256 === demoSha256);
    if (!analysis) return;
    setTab("timeline");
    const routeRoot = selectedGame
      ? `/game/${encodeURIComponent(selectedGame)}`
      : `/analysis/${encodeURIComponent(analysis.jobId)}`;
    window.history.replaceState(
      {},
      "",
      `${routeRoot}/timeline?demo=${encodeURIComponent(demoSha256)}&tick=${tick}`,
    );
  };
  const hasLegacyAnalysis = analyses.some(
    (analysis) =>
      analysis.engineResult.demo.stats &&
      !analysis.engineResult.demo.stats.match,
  );
  const hasOutdatedCompetitive = analyses.some(
    (analysis) =>
      (analysis.engineResult.demo.stats?.competitive?.derivationVersion ?? 0) <
      6,
  );
  const parserProvenance = parserProvenanceLabel(analyses);
  const phase =
    items.length === 0
      ? "landing"
      : isWorking || !hasResults
        ? "loading"
        : "results";
  const overallProgress = items.length
    ? items.reduce((sum, item) => sum + item.progress, 0) / items.length
    : 0;

  const picker = (
    <input
      ref={input}
      hidden
      type="file"
      aria-label="Choose demo files"
      accept=".dem"
      multiple
      onChange={(event) => {
        addFiles([...(event.target.files ?? [])]);
        event.target.value = "";
      }}
    />
  );

  return (
    <div className={`stats-app phase-${phase}`}>
      {phase === "landing" && (
        <main className="landing-screen">
          <h1 className="sr-only">L4DStats demo analyzer</h1>
          <img
            className="landing-infected"
            src="/art/boomer-trace.webp"
            alt="Illustrated bloated infected"
          />
          <div className="poster-brand" aria-hidden="true">
            <BrandMark />
            <span>L4D</span>
            <b>STATS</b>
          </div>
          <button
            className={`dropzone ${dragging ? "is-dragging" : ""}`}
            onClick={() => input.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node))
                setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              addFiles([...event.dataTransfer.files]);
            }}
          >
            {picker}
            <UploadCloud />
            <span>DROP DEMOS</span>
            <small>or choose .dem files · maximum {MAX_DEMOS}</small>
            {uploadError && (
              <em className="upload-error" role="alert">
                {uploadError}
              </em>
            )}
          </button>
        </main>
      )}

      {phase === "loading" && (
        <main className="loading-screen" aria-live="polite">
          {picker}
          <img
            className="loading-infected"
            src="/art/boomer-trace.webp"
            alt=""
          />
          <div className="scanline" />
          <div className="loading-copy">
            <span>RECONSTRUCTING THE VERSUS ROUND</span>
            <h1>
              THE HORDE
              <br />
              LEAVES EVIDENCE<span>.</span>
            </h1>
            <div className="loading-progress-meta">
              <strong>{Math.round(overallProgress * 100)}%</strong>
              <span>
                {items.find((item) => item.state !== "succeeded")?.message ??
                  "Safe room reached"}
              </span>
            </div>
            <div className="master-progress">
              <i
                style={{
                  width: `${overallProgress * 100}%`,
                }}
              />
            </div>
            <div className="queue-list">
              {items.map((item) => (
                <div className="queue-item" key={item.key}>
                  <div className={`file-state ${item.state}`}>
                    {item.state === "succeeded" ? (
                      <Check />
                    ) : item.state === "failed" ? (
                      <AlertCircle />
                    ) : (
                      <LoaderCircle />
                    )}
                  </div>
                  <div className="file-info">
                    <strong>{item.file.name}</strong>
                    <span>
                      {bytes(item.file.size)} · {item.message}
                    </span>
                  </div>
                  <div className="progress-track">
                    <span
                      style={{
                        width: `${Math.max(item.progress * 100, item.state === "uploading" ? 2 : 0)}%`,
                      }}
                    />
                  </div>
                  <span className={`state-label ${item.state}`}>
                    {item.state}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </main>
      )}

      {phase === "results" && (
        <main className="results-screen">
          {picker}
          <div className="results-head">
            <a className="grunge-wordmark" href="/" aria-label="L4DStats home">
              <BrandMark />
              <span>
                L4D<b>STATS</b>
              </span>
            </a>
            <div>
              <span>ANALYSIS COMPLETE</span>
              <h1>
                {selectedGame
                  ? (selectedCampaignName ??
                    gameAnalyses[0]?.engineResult.demo.session?.campaign?.toUpperCase() ??
                    "L4D2 GAME")
                  : (analyses[0]?.engineResult.demo.mapName ?? "MATCH RESULTS")}
              </h1>
            </div>
            <button
              className="add-demos"
              disabled={items.length >= MAX_DEMOS}
              onClick={() => input.current?.click()}
            >
              <UploadCloud />{" "}
              {items.length >= MAX_DEMOS ? "10 / 10 DEMOS" : "ADD DEMOS"}
            </button>
          </div>
          <section className="results">
            <aside className="legacy-analysis" aria-label="Parser provenance">
              <div>
                <strong>Parser provenance</strong>
                <span>{parserProvenance}</span>
              </div>
            </aside>
            {(hasLegacyAnalysis || hasOutdatedCompetitive) && (
              <aside className="legacy-analysis" role="status">
                <div>
                  <strong>Analysis update available</strong>
                  <span>
                    Re-run the selected demos to apply corrected hit HP,
                    infected-kill semantics, and the latest competitive
                    derivations.
                  </span>
                </div>
                <button onClick={() => void reanalyzeLegacy()}>
                  <RefreshCw /> Reanalyze
                </button>
              </aside>
            )}
            <div className="results-toolbar">
              <nav aria-label="Statistics sections">
                {TABS.map((value) => (
                  <button
                    key={value}
                    className={tab === value ? "active" : ""}
                    onClick={() => selectTab(value)}
                  >
                    {value === "quality" ? "data coverage" : value}
                  </button>
                ))}
              </nav>
              <div className="scope-filters">
                {gameGroups.length > 1 && (
                  <label className="game-filter">
                    <span>Game</span>
                    <select
                      value={selectedGame ?? ""}
                      onChange={(event) => {
                        const gameId = event.target.value;
                        setSelectedGame(gameId);
                        setGameConfidence(null);
                        setDisabledDemos([]);
                        setDisabledHalves([]);
                        window.history.replaceState(
                          {},
                          "",
                          `/game/${encodeURIComponent(gameId)}/${tab}`,
                        );
                        void workbenchApi
                          .game(gameId)
                          .then((game) => setGameConfidence(game.confidence));
                      }}
                    >
                      {gameGroups.map((gameId, index) => {
                        const maps = orderGameAnalyses(
                          analyses.filter(
                            (analysis) => analysis.gameId === gameId,
                          ),
                        );
                        const campaignName = gameCampaignName(maps);
                        return (
                          <option key={gameId} value={gameId}>
                            {campaignName ?? `Game ${index + 1}`} ·{" "}
                            {maps.length} map
                            {maps.length === 1 ? "" : "s"}
                          </option>
                        );
                      })}
                    </select>
                    <ChevronDown />
                  </label>
                )}
                <details className="map-toggle">
                  <summary>
                    <Layers3 /> Maps {visible.length} / {gameAnalyses.length}
                    <ChevronDown />
                  </summary>
                  <div>
                    {gameAnalyses.map((analysis) => {
                      const enabled = !disabledDemos.includes(
                        analysis.demoSha256,
                      );
                      return (
                        <label key={analysis.demoSha256}>
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={(event) => {
                              if (enabled && visible.length <= 1) return;
                              setDisabledDemos((current) =>
                                enabled
                                  ? [...current, analysis.demoSha256]
                                  : current.filter(
                                      (hash) => hash !== analysis.demoSha256,
                                    ),
                              );
                              event.currentTarget
                                .closest("details")
                                ?.removeAttribute("open");
                            }}
                          />
                          <span>
                            <strong>
                              {analysis.engineResult.demo.mapName}
                            </strong>
                            <small>
                              chapter{" "}
                              {analysis.engineResult.demo.session?.chapter ??
                                "N/A"}{" "}
                              · {analysis.demoSha256.slice(0, 8)}
                            </small>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </details>
                {roundScopes.length > 1 && (
                  <details className="map-toggle half-toggle">
                    <summary>
                      <Layers3 /> Rounds {enabledRoundCount} /{" "}
                      {roundScopes.length}
                      <ChevronDown />
                    </summary>
                    <div>
                      {roundScopes.map(({ analysis, half, key }) => {
                        const enabled = !disabledHalves.includes(key);
                        return (
                          <label key={key}>
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={() => {
                                if (enabled && enabledRoundCount <= 1) return;
                                setDisabledHalves((current) =>
                                  enabled
                                    ? [...current, key]
                                    : current.filter((value) => value !== key),
                                );
                              }}
                            />
                            <span>
                              <strong>
                                {half.id === "unknown"
                                  ? "Observed round"
                                  : `${half.id} half`}
                              </strong>
                              <small>
                                {analysis.engineResult.demo.mapName} · ticks{" "}
                                {whole.format(half.tickRange.start)} to{" "}
                                {whole.format(half.tickRange.end)}
                              </small>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </details>
                )}
              </div>
            </div>

            {playerProfileRoute && selectedGame && profilePlayer && (
              <PlayerProfile
                gameId={selectedGame}
                player={profilePlayer}
                players={players}
                stats={stats}
                analyses={scopedAnalyses}
              />
            )}
            {playerProfileRoute && !profilePlayer && (
              <section className="player-profile-missing" role="alert">
                <h2>Player not found</h2>
                <p>This identity is not present in the selected game data.</p>
                <a
                  href={`/game/${encodeURIComponent(selectedGame ?? playerProfileRoute.gameId)}/players`}
                >
                  Back to players
                </a>
              </section>
            )}

            {!playerProfileRoute && selectedGame && (
              <aside className="game-grouping-note">
                <strong>
                  {gameAnalyses.length} maps grouped as one game
                  {gameConfidence === "high"
                    ? " · high confidence"
                    : gameConfidence === "provisional"
                      ? " · provisional"
                      : gameConfidence === "unassociated"
                        ? " · unassociated"
                        : ""}
                </strong>
                <span>
                  {gameConfidence === "unassociated"
                    ? "This map lacks enough compatible session evidence to merge safely."
                    : gameConfidence === "provisional"
                      ? "One map has strong session evidence. An adjacent compatible chapter is needed to confirm the game."
                      : "Embedded server continuity, stable roster, campaign sequence, and Source server counters agree."}{" "}
                  Disable a map or round above to recalculate every tab.
                </span>
              </aside>
            )}

            {!playerProfileRoute && tab === "overview" && (
              <Overview
                gameId={selectedGame}
                stats={stats}
                totals={totals}
                players={players}
                analyses={scopedAnalyses}
                scoreStats={canonicalScoreEntries.map((entry) => entry.stats)}
                scoreAnalyses={canonicalScoreEntries.map(
                  (entry) => entry.analysis,
                )}
              />
            )}
            {!playerProfileRoute && tab === "players" && (
              <Players
                gameId={selectedGame}
                players={players}
                stats={stats}
                analyses={scopedAnalyses}
                onOpenTimeline={openTimeline}
              />
            )}
            {!playerProfileRoute && tab === "combat" && (
              <Combat
                stats={stats}
                analyses={scopedAnalyses}
                onOpenTimeline={openTimeline}
              />
            )}
            {!playerProfileRoute && tab === "timeline" && (
              <Timeline stats={stats} analyses={scopedAnalyses} />
            )}
            {!playerProfileRoute && tab === "signals" && (
              <Signals
                analyses={scopedAnalyses}
                stats={stats}
                onOpenTimeline={(jobId, demoSha256, tick) => {
                  void jobId;
                  openTimeline(demoSha256, tick);
                }}
              />
            )}
            {!playerProfileRoute && tab === "quality" && (
              <Quality stats={stats} analyses={scopedAnalyses} />
            )}
          </section>
        </main>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="stat-card">
      <span className="stat-icon">
        <Icon />
      </span>
      <span className="stat-label">{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function Overview({
  gameId,
  stats,
  totals,
  players,
  analyses,
  scoreStats,
  scoreAnalyses,
}: {
  gameId: string | null;
  stats: DemoStats[];
  totals: {
    demos: number;
    duration: number;
    observations: number;
    events: number;
    players: number;
    evidence: number;
  };
  players: PlayerStats[];
  analyses: JobAnalysis[];
  scoreStats: DemoStats[];
  scoreAnalyses: JobAnalysis[];
}) {
  const ratings = rateGamePlayers(stats, players);
  const rankedRatings = [...ratings.players].sort(
    (left, right) =>
      (right.rating ?? Number.NEGATIVE_INFINITY) -
        (left.rating ?? Number.NEGATIVE_INFINITY) ||
      right.coverage - left.coverage ||
      left.playerAlias.localeCompare(right.playerAlias),
  );
  const mvpPlayers = rankedRatings.filter((player) =>
    ratings.mvp.playerIds.includes(player.playerId),
  );
  const clearTotals = new Map<string, number>();
  stats.forEach((demo, demoIndex) => {
    for (const clear of demo.competitive?.clearStats ?? []) {
      const local = demo.players.find((player) => player.id === clear.playerId);
      if (!local) continue;
      const key = local.identity?.steamId64 ?? `${demoIndex}:${local.id}`;
      clearTotals.set(
        key,
        (clearTotals.get(key) ?? 0) + clear.deathCorrelatedClears,
      );
    }
  });
  const awardDefinitions: Array<{
    label: string;
    unit: string;
    description: string;
    value: (player: PlayerStats) => number | null;
    format?: (value: number) => string;
  }> = [
    {
      label: "Most infected kills",
      unit: "kills",
      description:
        "Total infected kills from the networked checkpoint counter. It includes Common and Special Infected and has no weapon attribution.",
      value: (player: PlayerStats) => player.checkpointInfectedKills ?? null,
    },
    {
      label: "Most SI kills",
      unit: "SI",
      description: "Attributed Special Infected death events.",
      value: (player: PlayerStats) => player.specialInfectedKills ?? null,
    },
    {
      label: "Most Hunter kills",
      unit: "Hunters",
      description:
        "Hunter death events. These are not claimed as airborne skeets.",
      value: (player: PlayerStats) =>
        player.killsByInfectedClass?.Hunter ?? null,
    },
    {
      label: "Most SI damage",
      unit: "damage",
      description:
        "Engine checkpoint damage dealt while controlling non-Tank Special Infected.",
      value: (player: PlayerStats) => {
        const counters = [
          "m_checkpointPZHunterDamage",
          "m_checkpointPZSmokerDamage",
          "m_checkpointPZBoomerDamage",
          "m_checkpointPZJockeyDamage",
          "m_checkpointPZSpitterDamage",
          "m_checkpointPZChargerDamage",
        ];
        if (
          !counters.every((counter) => player.counters?.[counter] !== undefined)
        )
          return null;
        return counters.reduce(
          (sum, counter) => sum + player.counters![counter]!,
          0,
        );
      },
    },
    {
      label: "Most clears",
      unit: "clears",
      description:
        "Death-correlated teammate clears reconstructed from pin endings.",
      value: (player: PlayerStats) => clearTotals.get(player.id) ?? null,
    },
    {
      label: "Most pin time",
      unit: "seconds",
      description: "Observed active SI control time across selected maps.",
      value: (player: PlayerStats) => player.pinSeconds ?? null,
      format: (value: number) => duration(value),
    },
    {
      label: "Most revives",
      unit: "revives",
      description: "Networked checkpoint teammate revives.",
      value: (player: PlayerStats) => player.revives ?? null,
    },
    {
      label: "Best pounce",
      unit: "damage",
      description: "Highest networked Hunter pounce-damage value.",
      value: (player: PlayerStats) => player.highestPounceDamage ?? null,
    },
    {
      label: "Most SI incaps",
      unit: "incaps",
      description: "Networked checkpoint Survivor incaps by SI.",
      value: (player: PlayerStats) => player.specialIncaps ?? null,
    },
    {
      label: "Most Tank damage dealt",
      unit: "damage",
      description: "Engine checkpoint damage credited while controlling Tank.",
      value: (player: PlayerStats) =>
        player.counters?.m_checkpointPZTankDamage ?? null,
    },
  ];
  const competitiveAwards = awardDefinitions.map((award) => ({
    ...award,
    observed: players.some((player) => award.value(player) !== null),
    leaders: [...players]
      .flatMap((player) => {
        const value = award.value(player);
        return value !== null && value > 0 ? [{ player, value }] : [];
      })
      .sort(
        (left, right) =>
          right.value - left.value ||
          left.player.alias.localeCompare(right.player.alias),
      )
      .slice(0, 3),
  }));
  const siKilled = stats.reduce(
    (sum, value) => sum + (value.match?.specialInfectedDeaths ?? 0),
    0,
  );
  const survivorDeaths = stats.reduce(
    (sum, value) => sum + (value.match?.survivorDeaths ?? 0),
    0,
  );
  const restartMaps = stats.filter((value) =>
    value.match?.scoreTimeline?.some((point) => point.voteRestarting),
  ).length;
  const participantSteamIds = new Set(
    players.flatMap((player) =>
      player.identity?.steamId64 ? [player.identity.steamId64] : [],
    ),
  );
  const participantNames = new Set(
    players.map((player) => player.alias.trim().toLocaleLowerCase()),
  );
  const spectators = [
    ...new Map(
      stats
        .flatMap((value) => value.spectators ?? [])
        .map((spectator) => [
          spectator.steamId64 ?? spectator.displayName,
          spectator,
        ]),
    ).values(),
  ]
    .filter(
      (spectator) =>
        !(
          spectator.steamId64 && participantSteamIds.has(spectator.steamId64)
        ) &&
        !participantNames.has(spectator.displayName.trim().toLocaleLowerCase()),
    )
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
  const selectedDemoHashes = new Set(
    analyses.map((analysis) => analysis.demoSha256),
  );
  const scoreRows = reconstructVersusScores(scoreStats, scoreAnalyses).filter(
    (row) => selectedDemoHashes.has(row.demoSha256),
  );
  const terminalScore = scoreRows.at(-1);
  const latestConfirmedScore = [...scoreRows]
    .reverse()
    .find((row) => row.complete);
  const displayedScore = terminalScore?.complete
    ? terminalScore
    : latestConfirmedScore;
  const winningTeam = terminalScore?.complete
    ? terminalScore.teamA === terminalScore.teamB
      ? "Draw"
      : terminalScore.teamA > (terminalScore.teamB ?? 0)
        ? "Team A"
        : "Team B"
    : null;
  const winningScoreIndex =
    winningTeam === "Team A" ? 0 : winningTeam === "Team B" ? 1 : null;
  const winningPlayerIds = new Set(
    winningScoreIndex !== null
      ? stats.flatMap((demo, demoIndex) => {
          const firstHalfPoint = demo.match?.scoreTimeline?.find(
            (point) => point.secondHalf === false,
          );
          if (
            !firstHalfPoint ||
            typeof firstHalfPoint.teamsFlipped !== "boolean"
          )
            return [];
          const firstSurvivorScoreIndex = firstHalfPoint.teamsFlipped ? 1 : 0;
          const winningRosterId =
            winningScoreIndex === firstSurvivorScoreIndex ? "A" : "B";
          const roster = demo.competitive?.rosters?.find(
            (candidate) =>
              candidate.id === winningRosterId &&
              candidate.confidence === "high",
          );
          return (roster?.playerIds ?? []).map((id) => {
            const player = demo.players.find(
              (candidate) => candidate.id === id,
            );
            return player?.identity?.steamId64 ?? `${demoIndex}:${id}`;
          });
        })
      : [],
  );
  const winningPlayers = rankedRatings.filter((player) =>
    winningPlayerIds.has(player.playerId),
  );
  const playersPath = analyses[0]?.jobId
    ? `/analysis/${encodeURIComponent(analyses[0].jobId)}/players`
    : "/";
  return (
    <div className="tab-panel">
      {restartMaps > 0 && (
        <aside className="legacy-analysis restart-warning" role="status">
          <div>
            <strong>Versus restart state observed</strong>
            <span>
              {restartMaps} selected map{restartMaps === 1 ? "" : "s"} entered
              the networked vote-restart state. Counter decreases remain reset
              boundaries and are never subtracted from player output.
            </span>
          </div>
          <SourceBadge kind="observed" />
        </aside>
      )}
      <section className="rating-mvp overview-mvp" aria-label="Game MVP">
        <div className="rating-crown">
          <MvpMark />
          <span>
            {ratings.mvp.status === "unavailable"
              ? "MVP unavailable"
              : ratings.mvp.status === "shared"
                ? "MVP edge unresolved"
                : "Game MVP"}
          </span>
        </div>
        <strong>
          {ratings.mvp.status === "unavailable"
            ? "Not enough eligible two-role data"
            : mvpPlayers.map((player) => player.playerAlias).join(" · ")}
        </strong>
        {mvpPlayers.length > 0 && (
          <div className="overview-mvp-scores">
            {mvpPlayers.map((player) => (
              <span key={player.playerId}>
                {gameId &&
                  (() => {
                    const statsPlayer = players.find(
                      (candidate) => candidate.id === player.playerId,
                    );
                    return statsPlayer ? (
                      <PlayerIdentityLinks
                        gameId={gameId}
                        player={statsPlayer}
                      />
                    ) : null;
                  })()}
                <b>{player.rating?.toFixed(2) ?? "N/A"}</b>
                <small>
                  Survivor {player.survivor.score?.toFixed(2) ?? "N/A"} ·
                  Infected {player.infected.score?.toFixed(2) ?? "N/A"} ·
                  {pct(player.coverage)} coverage
                </small>
              </span>
            ))}
          </div>
        )}
        <small>
          {ratings.mvp.status === "shared"
            ? `Leaders are within the declared ${ratings.mvp.resolution.toFixed(2)} resolution.`
            : "Experimental L4DStats Rating v0.2 across the selected maps and rounds."}
        </small>
      </section>
      {spectators.length > 0 && (
        <details className="spectator-summary">
          <summary>
            <Users />
            {spectators.length} spectator{spectators.length === 1 ? "" : "s"}
            <span>excluded from player stats and ratings</span>
            <ChevronDown />
          </summary>
          <div>
            {spectators.map((spectator) =>
              spectator.steamProfileUrl ? (
                <a
                  href={spectator.steamProfileUrl}
                  key={spectator.steamId64 ?? spectator.displayName}
                  target="_blank"
                  rel="noreferrer"
                >
                  {spectator.displayName}
                </a>
              ) : (
                <span key={spectator.displayName}>{spectator.displayName}</span>
              ),
            )}
          </div>
        </details>
      )}
      {displayedScore && (
        <article className="game-result" aria-label="Final Versus score">
          <div className="game-result-final">
            <span className="eyebrow">
              {terminalScore?.complete
                ? "Final score"
                : "Latest confirmed score"}{" "}
              · neutral team index
            </span>
            <strong>
              <b>{whole.format(displayedScore.teamA)}</b>
              <i>:</i>
              <b>{whole.format(displayedScore.teamB ?? 0)}</b>
            </strong>
            <span className={`game-winner ${winningTeam ? "" : "incomplete"}`}>
              {winningTeam ?? "Final result unavailable"}
            </span>
            <small>
              {!terminalScore?.complete
                ? "The last demo ends after one side's score commits. A following map or second-half artifact is required before declaring the final result."
                : winningTeam === "Draw"
                  ? "The selected maps finish level."
                  : `${winningTeam} wins. Roster-to-score naming remains unverified.`}
            </small>
          </div>
          <div className="map-score-strip" aria-label="Score after each map">
            {scoreRows.map((row, index) => (
              <div key={`${row.mapName}-${index}`}>
                <span>{index + 1}</span>
                <strong>{row.mapName}</strong>
                <b>
                  {whole.format(row.teamA)} :{" "}
                  {row.teamB === null ? "pending" : whole.format(row.teamB)}
                </b>
                <small>
                  chapter {whole.format(row.chapterA)} :{" "}
                  {row.chapterB === null
                    ? "pending"
                    : whole.format(row.chapterB)}
                </small>
              </div>
            ))}
          </div>
        </article>
      )}
      <details className="round-progression-detail">
        <summary>
          <span>
            <strong>Round progression and side detail</strong>
            <small>
              Score curves, Survivor distance and reconstructed halves
            </small>
          </span>
          <ChevronDown />
        </summary>
        <div>
          {stats.map((value, index) =>
            value.match?.scoreTimeline?.length ? (
              <ScoreProgression
                key={`progress-${index}`}
                points={value.match.scoreTimeline}
              />
            ) : null,
          )}
          {stats.map((value, index) =>
            value.match?.scoreTimeline?.some((point) =>
              point.survivorDistances.some(
                (distance) => distance !== null && distance > 0,
              ),
            ) ? (
              <DistanceProgression
                key={`distance-${index}`}
                points={value.match.scoreTimeline}
              />
            ) : null,
          )}
          <VersusHalves stats={stats} />
        </div>
      </details>
      <div className="metric-grid overview-metrics compact-mobile-metrics">
        <StatCard
          icon={Activity}
          label="Play time"
          value={duration(totals.duration)}
          detail={`across ${totals.demos} demo${totals.demos === 1 ? "" : "s"}`}
        />
        <StatCard
          icon={Users}
          label="Players"
          value={whole.format(totals.players)}
          detail="unique competitive participants"
        />
        <StatCard
          icon={Activity}
          label="Special Infected killed"
          value={whole.format(siKilled)}
          detail="attributed death events"
        />
        <StatCard
          icon={ShieldAlert}
          label="Survivor deaths"
          value={whole.format(survivorDeaths)}
          detail="across selected rounds"
        />
      </div>
      <div className="overview-summary-grid">
        <article className="panel winning-team-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Final result</span>
              <h3>Winning team</h3>
            </div>
            <Users />
          </div>
          {winningPlayers.length ? (
            <div className="winning-team-list">
              {winningPlayers.map((player, index) => {
                const statsPlayer = players.find(
                  (candidate) => candidate.id === player.playerId,
                );
                return (
                  <div className="winning-player-row" key={player.playerId}>
                    <i>{index + 1}</i>
                    {gameId && statsPlayer ? (
                      <PlayerIdentityLinks
                        gameId={gameId}
                        player={statsPlayer}
                      />
                    ) : (
                      <a href={playersPath}>{player.playerAlias}</a>
                    )}
                    <span>
                      {player.rating?.toFixed(2) ?? "N/A"}
                      <small>L4DStats</small>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="muted">
              {winningTeam === "Draw"
                ? "The final score is tied."
                : "A complete score and high-confidence side swap are required."}
            </p>
          )}
        </article>
        <article className="panel map-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Demo set</span>
              <h3>Maps analyzed</h3>
            </div>
            <Layers3 />
          </div>
          <div className="map-stack">
            {stats.map((value, index) => (
              <div className="map-row" key={`${value.playbackTicks}-${index}`}>
                <span className="map-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <strong>
                    {analyses[index]?.engineResult.demo.mapName ??
                      "Unknown map"}
                  </strong>
                  <span>
                    {duration(value.durationSeconds)} ·{" "}
                    {compact.format(value.observationCount)} observations
                  </span>
                </div>
                <b>
                  {value.tickRate?.toFixed(0) ?? "N/A"}
                  <small> tick</small>
                </b>
                {analyses[index]?.jobId && (
                  <a
                    className="analysis-link"
                    href={`/analysis/${encodeURIComponent(analyses[index].jobId)}/overview`}
                    aria-label={`Open analysis for ${analyses[index].engineResult.demo.mapName}`}
                  >
                    Open <ExternalLink />
                  </a>
                )}
              </div>
            ))}
          </div>
        </article>
      </div>
      <article className="panel leaderboard-panel awards-panel overview-awards">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Competitive leaders</span>
            <h3>Match awards</h3>
          </div>
          <Crosshair />
        </div>
        <div className="award-grid">
          {competitiveAwards.map((award) => (
            <article key={award.label}>
              <header>
                <span>{award.label}</span>
                <HeaderHelp label="About" description={award.description} />
              </header>
              {award.leaders.length ? (
                award.leaders.map(({ player, value }, index) => (
                  <div key={player.id}>
                    <i>{index + 1}</i>
                    {gameId ? (
                      <PlayerIdentityLinks gameId={gameId} player={player} />
                    ) : (
                      <strong>{player.alias}</strong>
                    )}
                    <b>
                      {award.format?.(value) ?? whole.format(value)}
                      <small>{award.unit}</small>
                    </b>
                  </div>
                ))
              ) : (
                <small>
                  {award.label === "Most Tank damage dealt" && !award.observed
                    ? "Reanalyze these demos to extract Tank damage"
                    : award.observed
                      ? "No positive value in selected data"
                      : "Unavailable in selected data"}
                </small>
              )}
            </article>
          ))}
        </div>
      </article>
    </div>
  );
}

function VersusHalves({ stats }: { stats: DemoStats[] }) {
  const halves = stats.flatMap((demo, demoIndex) =>
    (demo.competitive?.halves ?? []).map((half) => ({ demo, demoIndex, half })),
  );
  if (!halves.length) return null;
  return (
    <div className="halves-grid">
      {halves.map(({ demo, demoIndex, half }) => {
        const alias = (id: string) =>
          demo.players.find((player) => player.id === id)?.alias ??
          id.slice(0, 8);
        return (
          <article className="panel half-card" key={`${demoIndex}-${half.id}`}>
            <div>
              <span className="eyebrow">
                {half.id} half · neutral roster labels
              </span>
              <b>
                ticks {whole.format(half.tickRange.start)}–
                {whole.format(half.tickRange.end)}
              </b>
            </div>
            <section>
              <h3>Survivor side</h3>
              {half.survivorPlayerIds.map((id) => (
                <span key={id}>{alias(id)}</span>
              ))}
            </section>
            <section>
              <h3>Infected side</h3>
              {half.infectedPlayerIds.map((id) => (
                <span key={id}>{alias(id)}</span>
              ))}
            </section>
          </article>
        );
      })}
    </div>
  );
}

function ScoreProgression({
  points,
}: {
  points: NonNullable<NonNullable<DemoStats["match"]>["scoreTimeline"]>;
}) {
  const width = 900;
  const height = 150;
  const maxTime = Math.max(1, ...points.map((point) => point.timeSeconds));
  const scoreAt = (point: (typeof points)[number], team: number) =>
    point.campaignScores[team] ?? 0;
  const maxScore = Math.max(
    1,
    ...points.flatMap((point) => [scoreAt(point, 0), scoreAt(point, 1)]),
  );
  const path = (team: number) =>
    points
      .map((point, index) => {
        const x = 12 + (point.timeSeconds / maxTime) * (width - 24);
        const y =
          height - 12 - (scoreAt(point, team) / maxScore) * (height - 24);
        return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  return (
    <article className="panel score-progress">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Round progression</span>
          <h3>Cumulative campaign score</h3>
        </div>
        <span className="score-legend">
          <i /> Team A <i /> Team B
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Versus score over demo time"
      >
        <path className="score-a" d={path(0)} />
        <path className="score-b" d={path(1)} />
      </svg>
      <small>
        Tick-stamped cumulative game-rules values. Chapter score is already
        included. Team indices are not inferred roster names.
      </small>
    </article>
  );
}

function DistanceProgression({
  points,
}: {
  points: NonNullable<NonNullable<DemoStats["match"]>["scoreTimeline"]>;
}) {
  const width = 900;
  const height = 150;
  const maxTime = Math.max(1, ...points.map((point) => point.timeSeconds));
  const distanceAt = (point: (typeof points)[number]) =>
    Math.max(
      0,
      ...point.survivorDistances.filter(
        (distance): distance is number => distance !== null,
      ),
    );
  const maxDistance = Math.max(1, ...points.map(distanceAt));
  const path = points
    .map((point, index) => {
      const x = 12 + (point.timeSeconds / maxTime) * (width - 24);
      const y = height - 12 - (distanceAt(point) / maxDistance) * (height - 24);
      return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <article className="panel score-progress distance-progress">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Survivor progression</span>
          <h3>Furthest engine-reported distance</h3>
        </div>
        <strong>{whole.format(maxDistance)} units</strong>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Furthest Survivor distance over demo time"
      >
        <path d={path} />
      </svg>
      <small>
        Direct game-rules distance, not nav-flow percentage. Roster-to-score
        team attribution remains unavailable.
      </small>
    </article>
  );
}

function Players({
  gameId,
  players: gamePlayers,
  stats,
  analyses,
  onOpenTimeline,
}: {
  gameId: string | null;
  players: PlayerStats[];
  stats: DemoStats[];
  analyses: JobAnalysis[];
  onOpenTimeline: (demoSha256: string, tick: number) => void;
}) {
  const [roleScope, setRoleScope] = useState<
    "overall" | "survivor" | "infected"
  >("overall");
  const [mapScope, setMapScope] = useState("all");
  const selectedIndexes = analyses.flatMap((analysis, index) =>
    mapScope === "all" || analysis.demoSha256 === mapScope ? [index] : [],
  );
  const displayStats = selectedIndexes.map((index) => stats[index]!);
  const displayAnalyses = selectedIndexes.map((index) => analyses[index]!);
  const players =
    mapScope === "all" ? gamePlayers : aggregateGamePlayers(displayStats);
  const sorted = [...players].sort(
    (a, b) =>
      (b.specialInfectedKills ?? 0) - (a.specialInfectedKills ?? 0) ||
      b.sampleCount - a.sampleCount,
  );
  const ratings = useMemo(
    () => rateGamePlayers(displayStats, players),
    [displayStats, players],
  );
  const ratingByPlayer = new Map(
    ratings.players.map((rating) => [rating.playerId, rating]),
  );
  const statColumns: Array<{
    roles: Array<typeof roleScope>;
    label: string;
    description: string;
    value: (player: PlayerStats) => string | number;
  }> = [
    {
      roles: ["overall", "survivor"],
      label: "SI kills",
      description: "Special Infected you killed while playing Survivor.",
      value: (player) => player.specialInfectedKills ?? "N/A",
    },
    {
      roles: ["overall", "survivor"],
      label: "All infected kills",
      description:
        "Total Common and Special Infected kills from the networked checkpoint counter. This is not a Common Infected total.",
      value: (player) => player.checkpointInfectedKills ?? "N/A",
    },
    {
      roles: ["overall", "survivor"],
      label: "Surv deaths",
      description:
        "Deaths recorded while this player was on the Survivor side.",
      value: (player) => player.survivorDeaths ?? "N/A",
    },
    {
      roles: ["overall", "survivor"],
      label: "Revives",
      description:
        "Incapacitated teammates this player helped back onto their feet.",
      value: (player) => player.revives ?? "N/A",
    },
    {
      roles: ["overall", "infected"],
      label: "SI incaps",
      description:
        "Survivors this player incapacitated while controlling Special Infected.",
      value: (player) => player.specialIncaps ?? "N/A",
    },
    {
      roles: ["overall", "infected"],
      label: "Pin time",
      description:
        "Observed time actively controlling a Survivor with a tongue, pounce, ride, carry, or pummel.",
      value: (player) =>
        player.pinSeconds === undefined ? "N/A" : duration(player.pinSeconds),
    },
    {
      roles: ["overall", "infected"],
      label: "SI deaths",
      description:
        "Deaths recorded across this player's Special Infected lives.",
      value: (player) => player.infectedDeaths ?? "N/A",
    },
    {
      roles: ["overall", "infected"],
      label: "Best pounce",
      description:
        "Highest networked Hunter pounce-damage value observed in the demo.",
      value: (player) => player.highestPounceDamage ?? "N/A",
    },
    {
      roles: ["overall"],
      label: "Tracked",
      description:
        "How long this player epoch was reconstructed from network snapshots.",
      value: (player) => duration(player.durationSeconds),
    },
    {
      roles: ["overall"],
      label: "Signals",
      description:
        "Detector windows marked for human review. Signals are not cheating verdicts.",
      value: (player) => player.evidenceWindows || "N/A",
    },
  ];
  const visibleColumns = statColumns.filter((column) =>
    column.roles.includes(roleScope),
  );
  return (
    <div className="tab-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Player breakdown</span>
          <h2>
            {players.length} player{players.length === 1 ? "" : "s"}
          </h2>
        </div>
        <span className="muted">
          Embedded Steam identities when available, aliases otherwise
        </span>
      </div>
      <div className="player-scope-bar">
        <div>
          <span>Role</span>
          {(["overall", "survivor", "infected"] as const).map((role) => (
            <button
              type="button"
              key={role}
              className={roleScope === role ? "active" : ""}
              aria-pressed={roleScope === role}
              onClick={() => setRoleScope(role)}
            >
              {role}
            </button>
          ))}
        </div>
        <div>
          <span>Map</span>
          <button
            type="button"
            className={mapScope === "all" ? "active" : ""}
            aria-pressed={mapScope === "all"}
            onClick={() => setMapScope("all")}
          >
            All maps
          </button>
          {analyses.map((analysis) => (
            <button
              type="button"
              key={analysis.demoSha256}
              className={mapScope === analysis.demoSha256 ? "active" : ""}
              aria-pressed={mapScope === analysis.demoSha256}
              onClick={() => setMapScope(analysis.demoSha256)}
            >
              {analysis.engineResult.demo.mapName}
            </button>
          ))}
        </div>
      </div>
      <PlayerRatings ratings={ratings} gameId={gameId} players={players} />
      <div className="table-wrap consolidated-player-table">
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>
                <HeaderHelp
                  label="Rating"
                  description="Experimental selected-game L4DStats Match Rating. Overall requires eligible Survivor and Infected role scores."
                />
              </th>
              {visibleColumns.map((column) => (
                <th key={column.label}>
                  <HeaderHelp
                    label={column.label}
                    description={column.description}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((player, index) => (
              <tr key={`${player.id}-${index}`}>
                <td>
                  <span className="player-cell">
                    <i>{String(index + 1).padStart(2, "0")}</i>
                    <span>
                      {gameId ? (
                        <PlayerIdentityLinks gameId={gameId} player={player} />
                      ) : (
                        <strong>{player.alias}</strong>
                      )}
                      {player.identity?.inference === "unique-slot-v1" && (
                        <small title="The entity slot exposed one unique human identity later in this demo.">
                          identity inferred from unique demo slot
                        </small>
                      )}
                    </span>
                  </span>
                </td>
                <td>
                  <strong className="table-rating">
                    {(() => {
                      const rating = ratingByPlayer.get(player.id);
                      const value =
                        roleScope === "survivor"
                          ? rating?.survivor.score
                          : roleScope === "infected"
                            ? rating?.infected.score
                            : rating?.rating;
                      return value == null ? "N/A" : value.toFixed(2);
                    })()}
                  </strong>
                </td>
                {visibleColumns.map((column) => (
                  <td key={column.label}>{column.value(player)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="advanced-player-data">
        <summary>
          <span>
            <strong>Map and round detail</strong>
            <small>
              Rosters, per-half scoreboards, loadouts, ammo and health traces
            </small>
          </span>
          <ChevronDown />
        </summary>
        <div>
          <VersusRosters stats={displayStats} analyses={displayAnalyses} />
          <HalfScoreboards stats={displayStats} analyses={displayAnalyses} />
          <SurvivorLoadouts stats={displayStats} analyses={displayAnalyses} />
          <SurvivorHealthTraces
            stats={displayStats}
            analyses={displayAnalyses}
            onOpenTimeline={onOpenTimeline}
          />
        </div>
      </details>
    </div>
  );
}

function PlayerRatings({
  ratings,
  gameId,
  players,
}: {
  ratings: ReturnType<typeof rateGamePlayers>;
  gameId: string | null;
  players: PlayerStats[];
}) {
  const ranked = [...ratings.players].sort(
    (left, right) =>
      (right.rating ?? Number.NEGATIVE_INFINITY) -
        (left.rating ?? Number.NEGATIVE_INFINITY) ||
      right.coverage - left.coverage ||
      left.playerAlias.localeCompare(right.playerAlias),
  );
  const score = (value: number | null) =>
    value === null ? "N/A" : value.toFixed(2);
  return (
    <section className="rating-section" aria-label="L4DStats player ratings">
      <div className="rating-intro">
        <div>
          <span className="eyebrow">Experimental match model v0.2</span>
          <h3>
            L4DStats Rating <SourceBadge kind="derived" />
          </h3>
        </div>
        <p>
          A 1.00-neutral, selected-game performance index. Survivor and Infected
          contribution are rated separately, opportunity-normalized, shrunk
          toward neutral for short samples, then combined 50/50 only when both
          roles qualify. It is not career skill or win probability.
        </p>
      </div>
      <div className="rating-grid">
        {ranked.map((player, index) => (
          <details key={player.playerId}>
            <summary>
              <i>{String(index + 1).padStart(2, "0")}</i>
              <span>
                {(() => {
                  const statsPlayer = players.find(
                    (candidate) => candidate.id === player.playerId,
                  );
                  return gameId && statsPlayer ? (
                    <PlayerIdentityLinks gameId={gameId} player={statsPlayer} />
                  ) : (
                    <strong>{player.playerAlias}</strong>
                  );
                })()}
                <small>
                  {player.confidence} confidence · {pct(player.coverage)} model
                  coverage
                </small>
              </span>
              <b>{score(player.rating)}</b>
              <ChevronDown />
            </summary>
            <div className="rating-detail">
              {[player.survivor, player.infected].map((role) => (
                <section key={role.role}>
                  <header>
                    <span>{role.role}</span>
                    <b>{score(role.score)}</b>
                    <small>{pct(role.coverage)} coverage</small>
                  </header>
                  {role.pillars.map((pillar) => (
                    <div className="rating-pillar" key={pillar.name}>
                      <span>
                        {pillar.name}
                        <b>
                          {pillar.score.toFixed(2)} · {pct(pillar.coverage)}
                        </b>
                      </span>
                      <ul>
                        {pillar.metrics.map((metric) => (
                          <li key={metric.key}>
                            <span>
                              {metric.label}
                              <small>{metric.source}</small>
                            </span>
                            <b>
                              {metric.contribution >= 0 ? "+" : ""}
                              {metric.contribution.toFixed(3)}
                            </b>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  {!role.eligible && (
                    <p>
                      Role rating withheld: requires sufficient opportunity, at
                      least two pillars and 70% planned coverage.
                    </p>
                  )}
                </section>
              ))}
            </div>
          </details>
        ))}
      </div>
      <details className="rating-method">
        <summary>
          Formula, scientific status and limitations <ChevronDown />
        </summary>
        <div>
          <p>
            Every metric is expressed per relevant opportunity, compared with
            observed peers, capped to limit outliers, and shrunk by exposure.
            Missing telemetry is omitted and weights are renormalized visibly.
            This experimental game-relative baseline will be replaced by a
            frozen external cohort only after enough comparable games exist.
          </p>
          <ul>
            {ratings.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </div>
      </details>
    </section>
  );
}

function VersusRosters({
  stats,
  analyses,
}: {
  stats: DemoStats[];
  analyses: JobAnalysis[];
}) {
  const demos = stats.flatMap((demo, index) =>
    demo.competitive?.rosters?.length
      ? [
          {
            demo,
            index,
            rosters: demo.competitive.rosters,
            mapName:
              analyses[index]?.engineResult.demo.mapName ?? `Map ${index + 1}`,
          },
        ]
      : [],
  );
  if (!demos.length) return null;
  return (
    <section className="roster-reconstruction">
      <div className="scoreboard-explainer">
        <div>
          <span className="eyebrow">Neutral rosters</span>
          <h3>
            Side-swap reconstruction <SourceBadge kind="derived" />
          </h3>
        </div>
        <p>
          Roster A starts from the earliest observed Survivor side and Roster B
          from the opposing side. Membership is followed through the swap. These
          neutral labels are not engine Team A or Team B score indices.
        </p>
      </div>
      <div className="roster-grid">
        {demos.map(({ demo, index, rosters, mapName }) => (
          <article className="panel" key={index}>
            <span className="eyebrow">{mapName}</span>
            <div>
              {rosters.map((roster) => (
                <section key={roster.id}>
                  <h4>
                    Roster {roster.id}
                    <small>{roster.confidence}</small>
                  </h4>
                  <p>
                    {roster.playerIds
                      .map(
                        (id) =>
                          demo.players.find((player) => player.id === id)
                            ?.alias ?? id.slice(0, 8),
                      )
                      .join(" · ") || "Membership unavailable"}
                  </p>
                  <span>
                    {roster.sides
                      .map(
                        (side) => `${side.halfId} ${side.side.toLowerCase()}`,
                      )
                      .join(" → ")}
                  </span>
                </section>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function SurvivorLoadouts({
  stats,
  analyses,
}: {
  stats: DemoStats[];
  analyses: JobAnalysis[];
}) {
  const maps = stats.flatMap((demo, demoIndex) => {
    const traces = demo.survivorLoadoutTraces ?? [];
    const ammoTraces = demo.survivorAmmoTraces ?? [];
    return traces.length || ammoTraces.length
      ? [
          {
            mapName:
              analyses[demoIndex]?.engineResult.demo.mapName ??
              `Map ${demoIndex + 1}`,
            traces,
            ammoTraces,
          },
        ]
      : [];
  });
  if (!maps.length) return null;
  const itemName = (
    value:
      | NonNullable<
          (typeof maps)[number]["traces"][number]["points"][number]["primaryWeapon"]
        >
      | null
      | undefined,
  ) =>
    value === undefined ? "Unavailable" : value === null ? "Empty" : value.name;
  return (
    <section className="loadout-section">
      <div className="scoreboard-explainer">
        <div>
          <span className="eyebrow">Survivor resources</span>
          <h3>
            Networked loadouts <SourceBadge kind="sampled" />
          </h3>
        </div>
        <p>
          Primary, first-aid and temporary-health slots come directly from the
          player-resource entity. A change proves observed possession changed,
          but does not prove who supplied an item or why it disappeared.
        </p>
      </div>
      <div className="loadout-maps">
        {maps.map((map, mapIndex) => (
          <article key={`${map.mapName}-${mapIndex}`}>
            <header>
              <div>
                <span className="eyebrow">Map {mapIndex + 1}</span>
                <h3>{map.mapName}</h3>
              </div>
              <span>{map.traces.length} Survivor loadouts</span>
            </header>
            <div className="loadout-grid">
              {map.traces.map((trace) => {
                const first = trace.points[0];
                const last = trace.points.at(-1);
                const ammo = map.ammoTraces.find(
                  (candidate) => candidate.playerId === trace.playerId,
                );
                const latestAmmo = ammo?.points.at(-1);
                const ammoValues =
                  ammo?.points.flatMap((point) =>
                    point.clip === undefined && point.reserve === undefined
                      ? []
                      : [(point.clip ?? 0) + (point.reserve ?? 0)],
                  ) ?? [];
                const ammoMaximum = Math.max(1, ...ammoValues);
                return (
                  <section key={trace.playerId}>
                    <div className="loadout-player">
                      <strong>{trace.playerAlias}</strong>
                      <small>
                        {trace.points.length} observed state
                        {trace.points.length === 1 ? "" : "s"}
                      </small>
                    </div>
                    <dl>
                      <div>
                        <dt>Primary</dt>
                        <dd>{itemName(last?.primaryWeapon)}</dd>
                      </div>
                      <div>
                        <dt>First aid</dt>
                        <dd>{itemName(last?.firstAid)}</dd>
                      </div>
                      <div>
                        <dt>Temp health</dt>
                        <dd>{itemName(last?.temporaryHealth)}</dd>
                      </div>
                    </dl>
                    <div className="loadout-coverage">
                      <span>{pct(trace.coverage.primaryWeapon)} primary</span>
                      <span>{pct(trace.coverage.firstAid)} aid</span>
                      <span>{pct(trace.coverage.temporaryHealth)} temp</span>
                    </div>
                    {ammo && latestAmmo && (
                      <div className="ammo-state">
                        <div>
                          <span>Sampled active ammo</span>
                          <strong>
                            {latestAmmo.clip ?? "?"} /{" "}
                            {latestAmmo.reserve ?? "?"}
                          </strong>
                          <small>{pct(ammo.coverage)} coverage</small>
                        </div>
                        <svg
                          viewBox={`0 0 ${Math.max(1, ammoValues.length - 1)} 24`}
                          preserveAspectRatio="none"
                          role="img"
                          aria-label="Sampled total clip and reserve ammo over time"
                        >
                          <polyline
                            points={ammoValues
                              .map(
                                (value, index) =>
                                  `${index},${24 - (value / ammoMaximum) * 22}`,
                              )
                              .join(" ")}
                          />
                        </svg>
                      </div>
                    )}
                    {trace.points.length > 1 && (
                      <details>
                        <summary>
                          {itemName(first?.primaryWeapon)} to{" "}
                          {itemName(last?.primaryWeapon)}
                          <ChevronDown />
                        </summary>
                        <ol>
                          {trace.points.map((point) => (
                            <li key={point.tick}>
                              <time>{duration(point.timeSeconds)}</time>
                              <span>
                                {itemName(point.primaryWeapon)} ·{" "}
                                {itemName(point.firstAid)} ·{" "}
                                {itemName(point.temporaryHealth)}
                              </span>
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}
                  </section>
                );
              })}
            </div>
          </article>
        ))}
      </div>
      <p className="data-caveat">
        Ammo is sampled network state. Drops can include firing, reloads, weapon
        swaps or discarded weapons, so this view does not infer shots, hits or
        accuracy.
      </p>
    </section>
  );
}

function SurvivorHealthTraces({
  stats,
  analyses,
  onOpenTimeline,
}: {
  stats: DemoStats[];
  analyses: JobAnalysis[];
  onOpenTimeline: (demoSha256: string, tick: number) => void;
}) {
  const demos = stats.flatMap((demo, index) =>
    demo.survivorHealthTraces?.length
      ? [
          {
            index,
            duration: Math.max(1, demo.durationSeconds),
            traces: demo.survivorHealthTraces,
            mapName:
              analyses[index]?.engineResult.demo.mapName ?? `Demo ${index + 1}`,
            demoSha256: analyses[index]?.demoSha256,
          },
        ]
      : [],
  );
  if (!demos.length) return null;
  const width = 1000;
  const rowHeight = 82;
  const left = 132;
  const right = 18;
  const x = (time: number, maximum: number) =>
    left +
    (Math.max(0, Math.min(time, maximum)) / maximum) * (width - left - right);
  const y = (value: number, row: number) =>
    row * rowHeight + 66 - (Math.max(0, Math.min(value, 100)) / 100) * 50;
  const line = (
    points: NonNullable<DemoStats["survivorHealthTraces"]>[number]["points"],
    row: number,
    maximum: number,
    value: (point: (typeof points)[number]) => number | undefined,
  ) =>
    points
      .flatMap((point) => {
        const amount = value(point);
        return amount === undefined
          ? []
          : [
              `${x(point.timeSeconds, maximum).toFixed(1)},${y(amount, row).toFixed(1)}`,
            ];
      })
      .join(" ");
  return (
    <section className="health-traces" aria-label="Sampled Survivor health">
      <div className="scoreboard-explainer">
        <div>
          <span className="eyebrow">Survivor state</span>
          <h3>
            Sampled health traces <SourceBadge kind="sampled" />
          </h3>
        </div>
        <p>
          Green is permanent health. Blue is the raw networked temporary-health
          buffer, not calculated effective health. Sampling can miss changes, so
          these traces are lower-bound review evidence, not damage attribution.
        </p>
      </div>
      {demos.map((demo) => (
        <article className="panel health-trace-card" key={demo.index}>
          <header>
            <div>
              <span className="eyebrow">Map {demo.index + 1}</span>
              <h3>{demo.mapName}</h3>
            </div>
            <span>
              <i className="health-key permanent" /> permanent
              <i className="health-key buffer" /> raw buffer
              <i className="health-key incap" /> incap
            </span>
          </header>
          <div className="health-trace-scroll">
            <svg
              viewBox={`0 0 ${width} ${demo.traces.length * rowHeight}`}
              role="img"
              aria-label={`Sampled Survivor health on ${demo.mapName}`}
            >
              {demo.traces.map((trace, row) => (
                <g key={trace.playerId}>
                  <text x="0" y={row * rowHeight + 34}>
                    {trace.playerAlias.slice(0, 20)}
                  </text>
                  <line
                    x1={left}
                    x2={width - right}
                    y1={y(0, row)}
                    y2={y(0, row)}
                    className="health-baseline"
                  />
                  <polyline
                    points={line(
                      trace.points,
                      row,
                      demo.duration,
                      (point) => point.health,
                    )}
                    className="health-line permanent"
                  />
                  <polyline
                    points={line(
                      trace.points,
                      row,
                      demo.duration,
                      (point) => point.healthBuffer,
                    )}
                    className="health-line buffer"
                  />
                  {trace.points
                    .filter((point) => point.incapacitated)
                    .map((point) => (
                      <circle
                        key={point.tick}
                        cx={x(point.timeSeconds, demo.duration)}
                        cy={y(point.health, row)}
                        r="4"
                        className="health-incap"
                        role="button"
                        tabIndex={0}
                        aria-label={`View ${trace.playerAlias} incap at tick ${point.tick} on timeline`}
                        onClick={() => {
                          if (demo.demoSha256)
                            onOpenTimeline(demo.demoSha256, point.tick);
                        }}
                        onKeyDown={(event) => {
                          if (
                            demo.demoSha256 &&
                            (event.key === "Enter" || event.key === " ")
                          ) {
                            event.preventDefault();
                            onOpenTimeline(demo.demoSha256, point.tick);
                          }
                        }}
                      >
                        <title>
                          {trace.playerAlias}, incap at tick{" "}
                          {whole.format(point.tick)}
                        </title>
                      </circle>
                    ))}
                  <title>
                    {trace.playerAlias}: {pct(trace.healthCoverage)} health
                    coverage, {pct(trace.bufferCoverage)} buffer coverage,{" "}
                    {whole.format(trace.sourceSamples)} source samples
                  </title>
                </g>
              ))}
            </svg>
          </div>
        </article>
      ))}
    </section>
  );
}

const counterValue = (
  row: CompetitiveStats["halves"][number]["players"][number],
  ...names: string[]
) =>
  names.some((name) => row.observedCounters?.includes(name))
    ? names.reduce((total, name) => total + (row.counterDeltas[name] ?? 0), 0)
    : "N/A";

const counterShare = (
  rows: CompetitiveStats["halves"][number]["players"],
  row: CompetitiveStats["halves"][number]["players"][number],
  ...names: string[]
) => {
  if (
    rows.length !== 4 ||
    rows.some((candidate) =>
      names.every((name) => !candidate.observedCounters?.includes(name)),
    )
  )
    return "N/A";
  const value = names.reduce(
    (total, name) => total + (row.counterDeltas[name] ?? 0),
    0,
  );
  const teamTotal = rows.reduce(
    (total, candidate) =>
      total +
      names.reduce(
        (subtotal, name) => subtotal + (candidate.counterDeltas[name] ?? 0),
        0,
      ),
    0,
  );
  return teamTotal > 0 ? pct(value / teamTotal) : "0%";
};

function HalfScoreboards({
  stats,
  analyses,
}: {
  stats: DemoStats[];
  analyses: JobAnalysis[];
}) {
  const records = stats.flatMap((demo, demoIndex) =>
    (demo.competitive?.halves ?? []).map((half) => ({
      demo,
      demoIndex,
      half,
      mapName:
        analyses[demoIndex]?.engineResult.demo.mapName ??
        `Map ${demoIndex + 1}`,
    })),
  );
  if (!records.length) return null;
  return (
    <section className="half-scoreboards" aria-label="Per-half scoreboards">
      <div className="scoreboard-explainer">
        <div>
          <span className="eyebrow">Competitive split</span>
          <h3>Reset-aware half scoreboards</h3>
        </div>
        <p>
          Values are positive deltas from networked engine counters inside each
          half. They do not carry across a side swap or counter reset.
        </p>
      </div>
      {records.map(({ demo, demoIndex, half, mapName }) => {
        const name = (id: string) =>
          demo.players.find((player) => player.id === id)?.alias ??
          id.slice(0, 8);
        const survivorRows = half.players.filter(
          (row) => row.side === "Survivor",
        );
        const infectedRows = half.players.filter(
          (row) => row.side === "Infected",
        );
        const competitive = demo.competitive;
        return (
          <article className="half-scoreboard" key={`${demoIndex}-${half.id}`}>
            <header>
              <div>
                <span className="eyebrow">
                  {mapName} ·{" "}
                  {half.secondHalf === true
                    ? "recorded second half"
                    : half.secondHalf === false
                      ? "recorded first half"
                      : "half unknown"}
                </span>
                <h3>
                  {half.id === "unknown"
                    ? "Observed segment"
                    : `${half.id[0]?.toUpperCase()}${half.id.slice(1)} half`}
                </h3>
              </div>
              <span>
                ticks {whole.format(half.tickRange.start)} to{" "}
                {whole.format(half.tickRange.end)}
              </span>
            </header>
            {survivorRows.length > 0 && (
              <div className="side-scoreboard">
                <h4>Survivor output</h4>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th>
                          <HeaderHelp
                            label="Tank damage"
                            description="Damage to Tank reported by the engine checkpoint counter during this half."
                          />
                        </th>
                        <th>
                          <HeaderHelp
                            label="Tank share"
                            description="This player's share of the four-person Tank-damage total. Hidden when roster coverage is incomplete."
                          />
                        </th>
                        <th>
                          <HeaderHelp
                            label="Witch damage"
                            description="Damage to Witch reported by the engine checkpoint counter during this half."
                          />
                        </th>
                        <th>
                          <HeaderHelp
                            label="Damage taken"
                            description="Damage received reported by the engine checkpoint counter. This is distinct from sampled health loss."
                          />
                        </th>
                        <th>
                          <HeaderHelp
                            label="Medkits"
                            description="First-aid kits used during this half."
                          />
                        </th>
                        <th>
                          <HeaderHelp
                            label="Pills + adren"
                            description="Pain pills and adrenaline used during this half."
                          />
                        </th>
                        <th>
                          <HeaderHelp
                            label="Throws"
                            description="Molotovs, pipe bombs, and Boomer bile jars used during this half."
                          />
                        </th>
                        <th>
                          <HeaderHelp
                            label="Defibs"
                            description="Defibrillators used according to the engine checkpoint counter."
                          />
                        </th>
                        <th>
                          <HeaderHelp
                            label="Aid shared"
                            description="First-aid items shared according to the engine checkpoint counter."
                          />
                        </th>
                        <th>
                          <HeaderHelp
                            label="Melee kills"
                            description="Melee kills reported by the engine checkpoint counter."
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {survivorRows.map((row) => (
                        <tr key={row.playerId}>
                          <td>
                            <strong>{name(row.playerId)}</strong>
                          </td>
                          <td>
                            {counterValue(row, "m_checkpointDamageToTank")}
                          </td>
                          <td>
                            {counterShare(
                              survivorRows,
                              row,
                              "m_checkpointDamageToTank",
                            )}
                          </td>
                          <td>
                            {counterValue(row, "m_checkpointDamageToWitch")}
                          </td>
                          <td>
                            {counterValue(row, "m_checkpointDamageTaken")}
                          </td>
                          <td>
                            {counterValue(row, "m_checkpointMedkitsUsed")}
                          </td>
                          <td>
                            {counterValue(
                              row,
                              "m_checkpointPillsUsed",
                              "m_checkpointAdrenalinesUsed",
                            )}
                          </td>
                          <td>
                            {counterValue(
                              row,
                              "m_checkpointDefibrillatorsUsed",
                            )}
                          </td>
                          <td>
                            {counterValue(row, "m_checkpointFirstAidShared")}
                          </td>
                          <td>{counterValue(row, "m_checkpointMeleeKills")}</td>
                          <td>
                            {counterValue(
                              row,
                              "m_checkpointMolotovsUsed",
                              "m_checkpointPipebombsUsed",
                              "m_checkpointBoomerBilesUsed",
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {infectedRows.length > 0 && (
              <div className="side-scoreboard infected-board">
                <h4>Infected output</h4>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th>
                          <HeaderHelp
                            label="Damage"
                            description="Sum of positive class-specific infected damage-counter deltas during this half."
                          />
                        </th>
                        <th>
                          <HeaderHelp
                            label="Incaps"
                            description="Survivor incapacitations reported by the infected checkpoint counter during this half."
                          />
                        </th>
                        <th>
                          <HeaderHelp
                            label="Controls"
                            description="Observed pin controls across reconstructed Special Infected lives in this half."
                          />
                        </th>
                        <th>
                          <HeaderHelp
                            label="Lives"
                            description="Reconstructed spawned Special Infected lives whose start falls inside this half."
                          />
                        </th>
                        <th>
                          <HeaderHelp
                            label="Pin time"
                            description="Observed seconds spent actively controlling a Survivor across those lives."
                          />
                        </th>
                        <th>
                          <HeaderHelp
                            label="Tank actions"
                            description="Registered Tank punches and rock throws. A registered throw does not prove a rock hit."
                          />
                        </th>
                        <th>
                          <HeaderHelp
                            label="Pulls"
                            description="Smoker pull and hang actions reported by engine checkpoint counters."
                          />
                        </th>
                        <th>
                          <HeaderHelp
                            label="Booms"
                            description="Boomer bomb and vomit actions reported by engine checkpoint counters."
                          />
                        </th>
                        <th>
                          <HeaderHelp
                            label="Charges"
                            description="Charge victims reported by the engine checkpoint counter."
                          />
                        </th>
                        <th>
                          <HeaderHelp
                            label="Pushes"
                            description="Survivor pushes received while infected, as reported by the engine checkpoint counter."
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {infectedRows.map((row) => {
                        const lives = (competitive?.infectedLives ?? []).filter(
                          (life) =>
                            life.playerId === row.playerId &&
                            life.tickRange.start >= half.tickRange.start &&
                            life.tickRange.start <= half.tickRange.end,
                        );
                        return (
                          <tr key={row.playerId}>
                            <td>
                              <strong>{name(row.playerId)}</strong>
                              <small>
                                {[
                                  ...new Set(
                                    lives.map((life) => life.infectedClass),
                                  ),
                                ].join(", ") || "No reconstructed life"}
                              </small>
                            </td>
                            <td>
                              {counterValue(
                                row,
                                "m_checkpointPZHunterDamage",
                                "m_checkpointPZSmokerDamage",
                                "m_checkpointPZBoomerDamage",
                                "m_checkpointPZJockeyDamage",
                                "m_checkpointPZSpitterDamage",
                                "m_checkpointPZChargerDamage",
                                "m_checkpointPZTankDamage",
                              )}
                            </td>
                            <td>{counterValue(row, "m_checkpointPZIncaps")}</td>
                            <td>
                              {lives.reduce(
                                (sum, life) => sum + life.controls,
                                0,
                              )}
                            </td>
                            <td>{lives.length}</td>
                            <td>
                              {duration(
                                lives.reduce(
                                  (sum, life) => sum + life.pinSeconds,
                                  0,
                                ),
                              )}
                            </td>
                            <td>
                              {counterValue(row, "m_checkpointPZTankPunches")} /{" "}
                              {counterValue(row, "m_checkpointPZTankThrows")}
                            </td>
                            <td>
                              {counterValue(
                                row,
                                "m_checkpointPZPulled",
                                "m_checkpointPZHung",
                              )}
                            </td>
                            <td>
                              {counterValue(
                                row,
                                "m_checkpointPZBombed",
                                "m_checkpointPZVomited",
                              )}
                            </td>
                            <td>
                              {counterValue(
                                row,
                                "m_checkpointPZNumChargeVictims",
                              )}
                            </td>
                            <td>{counterValue(row, "m_checkpointPZPushes")}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {!survivorRows.length && !infectedRows.length && (
              <p className="half-scoreboard-empty">
                This older artifact has half boundaries but no per-half player
                counters. Reanalyze the demo to populate this scoreboard.
              </p>
            )}
          </article>
        );
      })}
    </section>
  );
}

function HeaderHelp({
  label,
  description,
}: {
  label: string;
  description: string;
}) {
  const tooltipId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const showTooltip = () => {
    requestAnimationFrame(() => {
      const bounds = trigger.current?.getBoundingClientRect();
      if (!bounds) return;
      const width = Math.min(280, window.innerWidth - 24);
      setTooltipPosition({
        left: Math.max(
          12,
          Math.min(window.innerWidth - width - 12, bounds.right - width),
        ),
        top: Math.min(window.innerHeight - 72, bounds.bottom + 8),
        width,
      });
    });
  };
  useEffect(() => {
    if (!tooltipPosition || !tooltip.current) return;
    const bounds = tooltip.current.getBoundingClientRect();
    const overflow = bounds.bottom - (window.innerHeight - 12);
    if (overflow <= 0) return;
    setTooltipPosition((current) =>
      current
        ? { ...current, top: Math.max(12, current.top - overflow) }
        : current,
    );
  }, [tooltipPosition]);
  const source = (
    {
      "SI kills": "event",
      "All infected kills": "counter",
      "Surv deaths": "event",
      Revives: "counter",
      "SI incaps": "counter",
      "Pin time": "sampled",
      "SI deaths": "event",
      "Best pounce": "counter",
      Tracked: "derived",
      Signals: "derived",
      "SI damage": "counter",
      "SI dmg share": "derived",
      "Tank damage": "counter",
      "Tank share": "derived",
      "Witch damage": "counter",
      "Damage taken": "counter",
      Medkits: "counter",
      "Pills + adren": "counter",
      Throws: "counter",
      Defibs: "counter",
      "Aid shared": "counter",
      "Melee kills": "counter",
      Damage: "counter",
      Incaps: "counter",
      Controls: "derived",
      Lives: "derived",
      "Tank actions": "counter",
      Pulls: "counter",
      Booms: "counter",
      Charges: "counter",
      Pushes: "counter",
    } as Record<string, SourceKind>
  )[label];
  return (
    <span className="header-help">
      <span>
        {label}
        {source && <SourceBadge kind={source} />}
      </span>
      <button
        ref={trigger}
        type="button"
        aria-label={`${label}: ${description}`}
        aria-describedby={tooltipId}
        onMouseEnter={showTooltip}
        onMouseLeave={() => setTooltipPosition(null)}
        onFocus={showTooltip}
        onBlur={() => setTooltipPosition(null)}
      >
        <CircleHelp />
      </button>
      {tooltipPosition &&
        createPortal(
          <span
            ref={tooltip}
            className="header-help-tooltip"
            id={tooltipId}
            role="tooltip"
            style={tooltipPosition}
          >
            {description}
          </span>,
          document.body,
        )}
    </span>
  );
}

type SourceKind =
  | "observed"
  | "event"
  | "counter"
  | "sampled"
  | "derived"
  | "unavailable";

function SourceBadge({ kind, detail }: { kind: SourceKind; detail?: string }) {
  const descriptions: Record<SourceKind, string> = {
    observed: "Direct network property or game-event evidence",
    event: "Direct game-event payload",
    counter: "Direct networked engine counter",
    sampled: "Bounded network-state samples that can miss intermediate changes",
    derived: "Deterministic computation from retained observations",
    unavailable: "Not present or not validated in this demo",
  };
  return (
    <span
      className={`source-badge ${kind}`}
      title={detail ?? descriptions[kind]}
      aria-label={`${kind}: ${detail ?? descriptions[kind]}`}
    >
      {kind}
    </span>
  );
}

function TickLink({
  tick,
  demoSha256,
  onOpenTimeline,
}: {
  tick: number;
  demoSha256: string | undefined;
  onOpenTimeline: (demoSha256: string, tick: number) => void;
}) {
  if (!demoSha256) return null;
  return (
    <button
      type="button"
      className="tick-link"
      onClick={() => onOpenTimeline(demoSha256, tick)}
      aria-label={`View tick ${tick} on timeline`}
    >
      tick {whole.format(tick)} <ExternalLink />
    </button>
  );
}

function Combat({
  stats,
  analyses,
  onOpenTimeline,
}: {
  stats: DemoStats[];
  analyses: JobAnalysis[];
  onOpenTimeline: (demoSha256: string, tick: number) => void;
}) {
  const [encounterDemoIndex, setEncounterDemoIndex] = useState(0);
  const [showAllHits, setShowAllHits] = useState(false);
  const total = (
    field:
      | "survivorDeaths"
      | "specialInfectedDeaths"
      | "tankDeaths"
      | "witchDeaths",
  ) => stats.reduce((sum, demo) => sum + (demo.match?.[field] ?? 0), 0);
  const combine = (field: "specialKillsByClass" | "killsByWeapon") => {
    const result: Record<string, number> = {};
    for (const demo of stats)
      for (const [name, count] of Object.entries(demo.match?.[field] ?? {}))
        result[name] = (result[name] ?? 0) + count;
    return Object.entries(result).sort((a, b) => b[1] - a[1]);
  };
  const classes = combine("specialKillsByClass");
  const weapons = combine("killsByWeapon");
  const competitive = stats.flatMap((demo, demoIndex) =>
    demo.competitive ? [{ value: demo.competitive, demoIndex }] : [],
  );
  const lives = competitive.flatMap(({ value }) => value.infectedLives);
  const allHits = competitive.flatMap(({ value, demoIndex }) =>
    value.hits.map((hit) => ({
      hit,
      demoIndex,
      derivationVersion: value.derivationVersion,
    })),
  );
  const clears = competitive.flatMap(({ value }) => value.clearStats);
  const allTanks = competitive.flatMap(({ value, demoIndex }) =>
    value.tankEncounters.map((tank) => ({ tank, demoIndex })),
  );
  const allWitches = stats.flatMap((demo, demoIndex) =>
    (demo.witchEncounters ?? []).map((witch) => ({ witch, demoIndex })),
  );
  const activeEncounterDemoIndex = stats[encounterDemoIndex]
    ? encounterDemoIndex
    : 0;
  const hits = allHits
    .filter((item) => item.demoIndex === activeEncounterDemoIndex)
    .sort(
      (left, right) =>
        (right.derivationVersion >= 6 && right.hit.survivorHealthSamples >= 2
          ? right.hit.observedSurvivorHealthLoss
          : -1) -
          (left.derivationVersion >= 6 && left.hit.survivorHealthSamples >= 2
            ? left.hit.observedSurvivorHealthLoss
            : -1) || left.hit.tickRange.start - right.hit.tickRange.start,
    );
  const tanks = allTanks.filter(
    (item) => item.demoIndex === activeEncounterDemoIndex,
  );
  const witches = allWitches.filter(
    (item) => item.demoIndex === activeEncounterDemoIndex,
  );
  return (
    <div className="tab-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Combat scoreboard</span>
          <h2>Who killed what, and how</h2>
        </div>
      </div>
      <div className="metric-grid combat-metrics compact-mobile-metrics">
        <StatCard
          icon={Crosshair}
          label="SI killed"
          value={whole.format(total("specialInfectedDeaths"))}
          detail="player_death events"
        />
        <StatCard
          icon={ShieldAlert}
          label="Survivor deaths"
          value={whole.format(total("survivorDeaths"))}
          detail="both Versus halves"
        />
        <StatCard
          icon={Activity}
          label="Tanks killed"
          value={whole.format(total("tankDeaths"))}
          detail="observed deaths"
        />
        <StatCard
          icon={ShieldAlert}
          label="Witches killed"
          value={whole.format(total("witchDeaths"))}
          detail="observed deaths"
        />
      </div>
      <div className="combat-grid">
        <Breakdown title="Special Infected deaths" rows={classes} />
        <Breakdown title="Kill weapons" rows={weapons} />
      </div>
      <SpatialCombat
        stats={stats}
        analyses={analyses}
        selectedMapIndex={activeEncounterDemoIndex}
        onSelectMap={(index) => {
          setEncounterDemoIndex(index);
          setShowAllHits(false);
        }}
        onOpenTimeline={onOpenTimeline}
      />
      {competitive.length > 0 && (
        <>
          <div className="metric-grid competitive-metrics compact-mobile-metrics">
            <StatCard
              icon={Activity}
              label="Inferred SI hits"
              value={whole.format(allHits.length)}
              detail="spawn-gap clusters, not intent"
            />
            <StatCard
              icon={Activity}
              label="SI lives"
              value={whole.format(lives.length)}
              detail={`${lives.reduce((sum, life) => sum + life.controls, 0)} controls`}
            />
            <StatCard
              icon={ShieldAlert}
              label="Narrow clears"
              value={whole.format(
                clears.reduce(
                  (sum, player) => sum + player.deathCorrelatedClears,
                  0,
                ),
              )}
              detail="death-correlated only"
            />
            <StatCard
              icon={Activity}
              label="Tank controls"
              value={whole.format(allTanks.length)}
              detail={`${allTanks.reduce((sum, { tank }) => sum + tank.punches, 0)} punches`}
            />
          </div>
          <div className="competitive-grid">
            <article className="panel hit-board">
              <span className="eyebrow">Infected coordination</span>
              <h3>
                Hit clusters <SourceBadge kind="derived" />
              </h3>
              {hits.map(({ hit, demoIndex, derivationVersion }, index) => (
                <div
                  className={index >= 8 && !showAllHits ? "hit-row-hidden" : ""}
                  key={`${index}:${hit.id}`}
                >
                  <time>
                    ticks {whole.format(hit.tickRange.start)}–
                    {whole.format(hit.tickRange.end)}
                  </time>
                  <strong className="hit-cluster-title">
                    <span>{hit.infectedClasses.join(" + ")}</span>
                    {derivationVersion >= 6 &&
                    hit.survivorHealthSamples >= 2 ? (
                      <b
                        className={`hp-loss-pill hp-loss-${
                          hit.observedSurvivorHealthLoss <= 10
                            ? "low"
                            : hit.observedSurvivorHealthLoss <= 30
                              ? "moderate"
                              : hit.observedSurvivorHealthLoss <= 50
                                ? "high"
                                : hit.observedSurvivorHealthLoss <= 100
                                  ? "severe"
                                  : "critical"
                        }`}
                        title="Maximum observed team permanent-health drawdown in the bounded hit window; damage source is not attributable"
                      >
                        -{whole.format(hit.observedSurvivorHealthLoss)} team HP
                      </b>
                    ) : derivationVersion >= 6 ? (
                      <b className="hp-loss-pill hp-loss-low">HP unavailable</b>
                    ) : (
                      <b className="hp-loss-pill hp-loss-low">
                        reanalyze for HP
                      </b>
                    )}
                  </strong>
                  <span className="hit-cluster-summary">
                    <span>
                      {hit.controls} controls · {hit.peakSimultaneousPins}{" "}
                      simultaneous · {hit.spawnSpreadSeconds.toFixed(1)}s spawn
                      spread
                    </span>
                    <small>
                      {derivationVersion >= 6 && hit.survivorHealthSamples >= 2
                        ? `Maximum contiguous permanent-health drawdown per upright Survivor across ${whole.format(hit.survivorHealthSamples)} state samples in this bounded hit window. Healing is not counted twice and team loss is capped at 400 HP. The demo does not identify the damage source, so commons, friendly fire, falls, and other damage may contribute.`
                        : derivationVersion >= 6
                          ? "No adjacent upright Survivor health samples cover this window."
                          : "Legacy HP could double-count repeated loss or include invalid cluster windows and incap health. Reanalyze before using it."}
                    </small>
                  </span>
                  <TickLink
                    tick={hit.tickRange.start}
                    demoSha256={analyses[demoIndex]?.demoSha256}
                    onOpenTimeline={onOpenTimeline}
                  />
                </div>
              ))}
              {hits.length > 8 && (
                <button
                  type="button"
                  className="show-hit-clusters"
                  aria-expanded={showAllHits}
                  onClick={() => setShowAllHits((value) => !value)}
                >
                  {showAllHits
                    ? "Show highest-impact clusters only"
                    : `Show ${hits.length - 8} more clusters`}
                  <ChevronDown />
                </button>
              )}
            </article>
            <article className="panel tank-board">
              <span className="eyebrow">Tank encounters</span>
              <h3>
                Control and outcome <SourceBadge kind="derived" />
              </h3>
              {tanks.map(({ tank, demoIndex }, index) => (
                <div key={`${index}:${tank.id}`}>
                  <strong>
                    {tank.controllerAlias}
                    <small>
                      {analyses[demoIndex]?.engineResult.demo.mapName ??
                        `Map ${demoIndex + 1}`}
                    </small>
                  </strong>
                  <span>
                    {duration(tank.durationSeconds)} · {tank.punches} punches ·{" "}
                    {tank.registeredRockThrows} throws · {tank.survivorIncaps}{" "}
                    incaps · {tank.survivorDeaths} deaths
                  </span>
                  <span>
                    {tank.damageDealt == null
                      ? "Tank damage unavailable"
                      : `${whole.format(tank.damageDealt)} damage dealt`}{" "}
                    ·{" "}
                    {tank.damageTaken == null
                      ? "damage taken unavailable"
                      : `${whole.format(tank.damageTaken)} damage taken`}
                  </span>
                  {(tank.damageBySurvivor?.length ?? 0) > 0 && (
                    <small>
                      {tank
                        .damageBySurvivor!.map(
                          (player) =>
                            `${player.playerAlias} ${whole.format(player.damage)}`,
                        )
                        .join(" · ")}
                    </small>
                  )}
                  {tank.healthAtTake !== null &&
                    tank.lowestObservedHealth !== null && (
                      <small>
                        {whole.format(
                          Math.max(
                            0,
                            tank.healthAtTake - tank.lowestObservedHealth,
                          ),
                        )}{" "}
                        observed Tank HP lost, attacker unavailable
                      </small>
                    )}
                  <b>
                    {tank.healthAtTake ?? "N/A"} →{" "}
                    {tank.healthAtEnd ?? tank.lowestObservedHealth ?? "N/A"} HP
                  </b>
                  <TickLink
                    tick={tank.tickRange.start}
                    demoSha256={analyses[demoIndex]?.demoSha256}
                    onOpenTimeline={onOpenTimeline}
                  />
                </div>
              ))}
            </article>
          </div>
        </>
      )}
      {witches.length > 0 && (
        <article className="panel witch-board">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Witch encounters</span>
              <h3>
                Rage, fire, and observed outcome <SourceBadge kind="sampled" />
              </h3>
            </div>
            <AlertCircle />
          </div>
          <p className="muted">
            Rage, burning state, and entity lifetime are direct network
            observations. A death outcome is correlated by tick. Crown,
            startler, target, world position, and attacker-attributed damage
            remain unavailable.
          </p>
          <div className="witch-encounter-list">
            {witches.map(({ witch, demoIndex }, index) => (
              <div key={`${index}:${witch.id}`}>
                <span>
                  ticks {whole.format(witch.tickRange.start)} to{" "}
                  {whole.format(witch.tickRange.end)}
                </span>
                <strong>
                  {witch.endReason === "death-correlated"
                    ? "Death correlated"
                    : "Outcome unresolved"}
                </strong>
                <dl>
                  <div>
                    <dt>Peak rage</dt>
                    <dd>
                      {witch.peakRage === null
                        ? "N/A"
                        : witch.peakRage.toFixed(2)}
                    </dd>
                  </div>
                  <div>
                    <dt>Enraged</dt>
                    <dd>
                      {witch.enragedTick === null
                        ? "not observed"
                        : `tick ${whole.format(witch.enragedTick)}`}
                    </dd>
                  </div>
                  <div>
                    <dt>Burning</dt>
                    <dd>
                      {witch.burningTick === null
                        ? "not observed"
                        : `tick ${whole.format(witch.burningTick)}`}
                    </dd>
                  </div>
                  <div>
                    <dt>Samples</dt>
                    <dd>{whole.format(witch.sampleCount)}</dd>
                  </div>
                </dl>
                <TickLink
                  tick={witch.enragedTick ?? witch.tickRange.start}
                  demoSha256={analyses[demoIndex]?.demoSha256}
                  onOpenTimeline={onOpenTimeline}
                />
              </div>
            ))}
          </div>
        </article>
      )}
    </div>
  );
}

function SpatialCombat({
  stats,
  analyses,
  selectedMapIndex,
  onSelectMap,
  onOpenTimeline,
}: {
  stats: DemoStats[];
  analyses: JobAnalysis[];
  selectedMapIndex: number;
  onSelectMap: (index: number) => void;
  onOpenTimeline: (demoSha256: string, tick: number) => void;
}) {
  const maps = stats.map((demo, index) => ({
    demo,
    analysis: analyses[index],
    key: analyses[index]?.demoSha256 ?? `map-${index}`,
    name: analyses[index]?.engineResult.demo.mapName ?? `Map ${index + 1}`,
    positionedEvents: (demo.timeline ?? []).filter((event) => event.position)
      .length,
  }));
  const selected = maps[selectedMapIndex] ?? maps[0];

  if (!selected || maps.every((map) => map.positionedEvents === 0)) return null;
  return (
    <section className="spatial-workspace" aria-label="Spatial combat map">
      <header>
        <div>
          <span className="eyebrow">Spatial combat</span>
          <h3>Where the fight happened</h3>
        </div>
        <span>
          One map at a time · {selected.positionedEvents} positioned moment
          {selected.positionedEvents === 1 ? "" : "s"}
        </span>
      </header>
      <div
        className="spatial-map-selector"
        aria-label="Spatial combat map selector"
      >
        {maps.map((map, index) => (
          <button
            type="button"
            key={map.key}
            className={map.key === selected.key ? "active" : ""}
            aria-pressed={map.key === selected.key}
            aria-label={`Show spatial combat for ${map.name}`}
            onClick={() => onSelectMap(index)}
          >
            <small>Map {index + 1}</small>
            <strong>{map.name}</strong>
            <span>{map.positionedEvents} moments</span>
          </button>
        ))}
      </div>
      <DeathPositions
        key={selected.key}
        events={selected.demo.timeline ?? []}
        mapName={selected.name}
        demoSha256={selected.analysis?.demoSha256}
        onOpenTimeline={onOpenTimeline}
      />
    </section>
  );
}

function DeathPositions({
  events,
  mapName,
  demoSha256,
  onOpenTimeline,
}: {
  events: MatchTimelineEvent[];
  mapName: string | undefined;
  demoSha256: string | undefined;
  onOpenTimeline: (demoSha256: string, tick: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [geometry, setGeometry] = useState<MapGeometry | null | undefined>();
  const [floorMode, setFloorMode] = useState<"events" | "all">("events");
  const [spatialZoom, setSpatialZoom] = useState(1);
  const [selectedSpatialIndex, setSelectedSpatialIndex] = useState<
    number | null
  >(null);
  const canvasPoints = useRef<Array<{ x: number; y: number; index: number }>>(
    [],
  );
  const positioned = events.filter((event) => event.position);
  const selectedSpatialEvent =
    selectedSpatialIndex === null
      ? undefined
      : positioned[selectedSpatialIndex];
  const eventFloor = positioned.length
    ? [...positioned]
        .map((event) => event.position!.z)
        .sort((left, right) => left - right)[Math.floor(positioned.length / 2)]!
    : 0;
  useEffect(() => {
    let active = true;
    setGeometry(undefined);
    if (!mapName) {
      setGeometry(null);
      return () => {
        active = false;
      };
    }
    void workbenchApi.mapGeometry(mapName).then(
      (value) => {
        if (active) setGeometry(value);
      },
      () => {
        if (active) setGeometry(null);
      },
    );
    return () => {
      active = false;
    };
  }, [mapName]);
  useEffect(() => {
    if (!geometry || !canvas.current) return;
    const element = canvas.current;
    const draw = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, element.clientWidth);
      const height = Math.max(1, element.clientHeight);
      element.width = width * ratio;
      element.height = height * ratio;
      const context = element.getContext("2d");
      if (!context) return;
      context.scale(ratio, ratio);
      context.fillStyle = "#080d0a";
      context.fillRect(0, 0, width, height);
      const { min, max } = geometry.bounds;
      const scale =
        Math.min(
          (width - 32) / Math.max(1, max.x - min.x),
          (height - 32) / Math.max(1, max.y - min.y),
        ) * spatialZoom;
      const drawnWidth = (max.x - min.x) * scale;
      const drawnHeight = (max.y - min.y) * scale;
      const point = (x: number, y: number) =>
        [
          (width - drawnWidth) / 2 + (x - min.x) * scale,
          (height + drawnHeight) / 2 - (y - min.y) * scale,
        ] as const;
      context.fillStyle = "rgba(91, 118, 99, .28)";
      context.strokeStyle = "rgba(167, 255, 56, .09)";
      context.lineWidth = 0.5;
      for (let offset = 0; offset < geometry.indices.length; offset += 3) {
        const triangle = offset / 3;
        if (
          floorMode === "events" &&
          geometry.triangleZ &&
          Math.abs((geometry.triangleZ[triangle] ?? eventFloor) - eventFloor) >
            256
        )
          continue;
        context.beginPath();
        for (let corner = 0; corner < 3; corner += 1) {
          const vertex = (geometry.indices[offset + corner] ?? 0) * 3;
          const [x, y] = point(
            geometry.positions[vertex] ?? 0,
            geometry.positions[vertex + 1] ?? 0,
          );
          if (corner === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.closePath();
        context.fill();
        context.stroke();
      }
      canvasPoints.current = [];
      for (const [index, event] of positioned.entries()) {
        const [x, y] = point(event.position!.x, event.position!.y);
        canvasPoints.current.push({ x, y, index });
        context.beginPath();
        context.arc(
          x,
          y,
          event.infectedClass === "Tank" ? 7 : 4,
          0,
          Math.PI * 2,
        );
        context.fillStyle =
          event.type === "pin_start" || event.type === "pin_end"
            ? "#4ac7ff"
            : event.infectedClass === "Witch"
              ? "#d58cff"
              : event.type === "tank_control"
                ? "#ffc15c"
                : event.type === "incap" || event.type === "death"
                  ? "#ff665b"
                  : "#a7ff38";
        context.fill();
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    return () => observer.disconnect();
  }, [geometry, positioned, floorMode, spatialZoom, eventFloor]);
  if (!positioned.length) return null;
  if (geometry)
    return (
      <article className="panel death-map geometry-map">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">
              Spatial combat · actual BSP geometry
            </span>
            <h3>
              {positioned.length} positioned combat moments on {mapName}
            </h3>
          </div>
          <span className="muted">Local official map · top-down</span>
        </div>
        <div className="spatial-controls" aria-label="Spatial map controls">
          {geometry.triangleZ && (
            <span>
              <button
                className={floorMode === "events" ? "active" : ""}
                onClick={() => setFloorMode("events")}
              >
                Event floor ±256u
              </button>
              <button
                className={floorMode === "all" ? "active" : ""}
                onClick={() => setFloorMode("all")}
              >
                All floors
              </button>
            </span>
          )}
          <span>
            {[1, 1.5, 2].map((value) => (
              <button
                key={value}
                className={spatialZoom === value ? "active" : ""}
                onClick={() => setSpatialZoom(value)}
              >
                {value}×
              </button>
            ))}
          </span>
        </div>
        <canvas
          ref={canvas}
          aria-label={`Top-down ${mapName} world geometry with positioned combat events`}
          onPointerDown={(pointerEvent) => {
            const rect = pointerEvent.currentTarget.getBoundingClientRect();
            const x = pointerEvent.clientX - rect.left;
            const y = pointerEvent.clientY - rect.top;
            const nearest = canvasPoints.current
              .map((point) => ({
                ...point,
                distance: Math.hypot(point.x - x, point.y - y),
              }))
              .sort((left, right) => left.distance - right.distance)[0];
            if (nearest && nearest.distance <= 18) {
              setSelectedSpatialIndex(nearest.index);
            }
          }}
        />
        {selectedSpatialEvent && (
          <article className="spatial-selection" aria-live="polite">
            <div>
              <span>
                {duration(selectedSpatialEvent.timeSeconds)} · tick{" "}
                {whole.format(selectedSpatialEvent.tick)}
              </span>
              <strong>{selectedSpatialEvent.detail}</strong>
              <small>
                {selectedSpatialEvent.infectedClass ??
                  selectedSpatialEvent.type.replaceAll("_", " ")}
              </small>
            </div>
            {demoSha256 && (
              <button
                type="button"
                onClick={() =>
                  onOpenTimeline(demoSha256, selectedSpatialEvent.tick)
                }
              >
                Open on timeline
              </button>
            )}
          </article>
        )}
        <div className="death-map-key">
          <span>
            <i /> Attacks and support
          </span>
          <span>
            <i /> Incaps and deaths
          </span>
        </div>
        <SpatialEventLinks
          events={positioned}
          demoSha256={demoSha256}
          onOpenTimeline={onOpenTimeline}
        />
        <small>
          {whole.format(geometry.coverage.emittedTriangles)} world-brush
          triangles · BSP {geometry.provenance.sourceBspSha256.slice(0, 12)} ·{" "}
          {whole.format(geometry.coverage.emittedDisplacements)} displacements
          reconstructed
          {geometry.coverage.skippedDisplacements
            ? ` · ${whole.format(geometry.coverage.skippedDisplacements)} displacements skipped`
            : ""}
          {" · static props unavailable"}
        </small>
      </article>
    );
  const xs = positioned.map((event) => event.position!.x);
  const ys = positioned.map((event) => event.position!.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = (value: number, min: number, max: number) =>
    18 + ((value - min) / Math.max(1, max - min)) * 864;
  return (
    <article className="panel death-map">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Spatial combat</span>
          <h3>{positioned.length} positioned combat moments</h3>
        </div>
        <span className="muted">Normalized event coordinates</span>
      </div>
      <svg
        viewBox="0 0 900 300"
        role="img"
        aria-label="Normalized combat-event positions"
      >
        {positioned.map((event, index) => (
          <circle
            key={`${event.tick}-${index}`}
            className={event.type}
            cx={scale(event.position!.x, minX, maxX)}
            cy={282 - scale(event.position!.y, minY, maxY) * (282 / 900)}
            r={event.infectedClass === "Tank" ? 8 : 4}
          >
            <title>{`${duration(event.timeSeconds)} · ${event.detail}`}</title>
          </circle>
        ))}
      </svg>
      <div className="death-map-key">
        <span>
          <i /> Attacks and support
        </span>
        <span>
          <i /> Incaps and deaths
        </span>
      </div>
      <SpatialEventLinks
        events={positioned}
        demoSha256={demoSha256}
        onOpenTimeline={onOpenTimeline}
      />
      <small>
        This is not map geometry; it preserves relative positions from death
        events. Install the matching local BSP artifact for real map geometry.
      </small>
    </article>
  );
}

function SpatialEventLinks({
  events,
  demoSha256,
  onOpenTimeline,
}: {
  events: MatchTimelineEvent[];
  demoSha256: string | undefined;
  onOpenTimeline: (demoSha256: string, tick: number) => void;
}) {
  if (!demoSha256) return null;
  return (
    <details className="spatial-event-links">
      <summary>
        Inspect {whole.format(events.length)} positioned moments
        <ChevronDown />
      </summary>
      <div>
        {events.map((event, index) => (
          <button
            type="button"
            key={`${event.tick}:${event.type}:${index}`}
            onClick={() => onOpenTimeline(demoSha256, event.tick)}
          >
            <span>
              {event.infectedClass ?? event.type.replaceAll("_", " ")}
            </span>
            <strong>{event.detail}</strong>
            <time>tick {whole.format(event.tick)}</time>
          </button>
        ))}
      </div>
    </details>
  );
}

function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: [string, number][];
}) {
  const max = rows[0]?.[1] ?? 1;
  return (
    <article className="panel breakdown-panel">
      <span className="eyebrow">Distribution</span>
      <h3>{title}</h3>
      {rows.length ? (
        rows.map(([name, count]) => (
          <div className="breakdown-row" key={name}>
            <strong>{name.replace(/^weapon_/, "").replaceAll("_", " ")}</strong>
            <i>
              <span style={{ width: `${(count / max) * 100}%` }} />
            </i>
            <b>{whole.format(count)}</b>
          </div>
        ))
      ) : (
        <p className="muted">This demo did not expose these events.</p>
      )}
    </article>
  );
}

function Timeline({
  stats,
  analyses,
}: {
  stats: DemoStats[];
  analyses: JobAnalysis[];
}) {
  const [filter, setFilter] = useState("all");
  const [mapScope, setMapScope] = useState(analyses[0]?.demoSha256 ?? "");
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<{
    key: string;
    x: number;
    y: number;
  } | null>(null);
  const [zoom, setZoom] = useState(() => (window.innerWidth <= 700 ? 1 : 2));
  const [fullscreen, setFullscreen] = useState(false);
  const typeRank: Record<MatchTimelineEvent["type"], number> = {
    round_start: 0,
    team_change: 1,
    spawn: 2,
    tank_control: 3,
    attack: 4,
    pin_start: 5,
    incap: 6,
    clear: 7,
    pin_end: 8,
    revive: 9,
    death: 10,
    witch_spawn: 11,
    witch_enrage: 12,
    witch_burn: 13,
    witch_end: 14,
    round_end: 15,
  };
  const demos = stats.map((demo, demoIndex) => ({
    demo,
    demoIndex,
    mapName: analyses[demoIndex]?.engineResult.demo.mapName ?? "Unknown map",
    sha256: analyses[demoIndex]?.demoSha256 ?? "unknown",
    events: (demo.timeline ?? [])
      .map((event, eventIndex) => ({
        event,
        key: `${demoIndex}:${event.tick}:${eventIndex}`,
      }))
      .sort(
        (left, right) =>
          left.event.tick - right.event.tick ||
          typeRank[left.event.type] - typeRank[right.event.type] ||
          (left.event.actor ?? left.event.subject ?? "").localeCompare(
            right.event.actor ?? right.event.subject ?? "",
          ) ||
          left.event.detail.localeCompare(right.event.detail),
      ),
  }));
  const scopedDemos = demos.filter((demo) => demo.sha256 === mapScope);
  const eventCount = scopedDemos.reduce(
    (sum, demo) => sum + demo.events.length,
    0,
  );
  const groups: Record<string, MatchTimelineEvent["type"][]> = {
    combat: ["death", "incap", "attack", "clear"],
    pins: ["pin_start", "pin_end", "clear"],
    infected: ["spawn", "tank_control", "attack"],
    bosses: [
      "tank_control",
      "witch_spawn",
      "witch_enrage",
      "witch_burn",
      "witch_end",
    ],
    rounds: ["round_start", "round_end", "team_change"],
    support: ["revive"],
  };
  const visibleDemos = scopedDemos.map((demo) => ({
    ...demo,
    events:
      filter === "all"
        ? demo.events
        : demo.events.filter(({ event }) =>
            groups[filter]?.includes(event.type),
          ),
  }));
  const visible = visibleDemos.flatMap((demo) =>
    demo.events.map((item) => ({ ...item, demo })),
  );
  const active = selected
    ? (visible.find((item) => item.key === selected) ?? null)
    : null;
  useEffect(() => {
    if (!selected) return;
    const frame = window.requestAnimationFrame(() => {
      const marker = document.querySelector<HTMLElement>(
        "[data-timeline-active='true']",
      );
      const scroller = marker?.closest<HTMLElement>(".timeline-scroll");
      if (!marker || !scroller) return;
      const markerRect = marker.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const stickyLabelWidth = Math.min(166, scroller.clientWidth * 0.45);
      const desiredCenter =
        stickyLabelWidth + (scroller.clientWidth - stickyLabelWidth) / 2;
      scroller.scrollTo({
        left:
          scroller.scrollLeft +
          markerRect.left -
          scrollerRect.left +
          markerRect.width / 2 -
          desiredCenter,
        behavior: "auto",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active?.key, filter, zoom, selected]);
  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const requestedTick = Number(parameters.get("tick"));
    const requestedDemo = parameters.get("demo");
    if (!Number.isFinite(requestedTick)) return;
    if (requestedDemo) setMapScope(requestedDemo);
    const target = demos
      .filter((demo) => !requestedDemo || demo.sha256 === requestedDemo)
      .flatMap((demo) => demo.events)
      .sort(
        (left, right) =>
          Math.abs(left.event.tick - requestedTick) -
          Math.abs(right.event.tick - requestedTick),
      )[0];
    if (target) setSelected(target.key);
  }, [eventCount, analyses]);
  useEffect(() => {
    if (!demos.length) return;
    if (!demos.some((demo) => demo.sha256 === mapScope)) {
      setMapScope(demos[0]!.sha256);
      setSelected(null);
    }
  }, [analyses, mapScope]);
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    document.body.classList.add("timeline-fullscreen-open");
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("timeline-fullscreen-open");
      window.removeEventListener("keydown", onKey);
    };
  }, [fullscreen]);
  const lanes: Array<{
    name: string;
    types: MatchTimelineEvent["type"][];
  }> = [
    { name: "Round", types: ["round_start", "round_end", "team_change"] },
    { name: "SI actions", types: ["spawn", "tank_control", "attack"] },
    {
      name: "Bosses",
      types: ["witch_spawn", "witch_enrage", "witch_burn", "witch_end"],
    },
    { name: "Pins + clears", types: ["pin_start", "pin_end", "clear"] },
    { name: "Deaths + incaps", types: ["death", "incap"] },
    { name: "Support", types: ["revive"] },
  ];
  const hasInfectedIcon = (name?: string) =>
    [
      "Smoker",
      "Boomer",
      "Hunter",
      "Spitter",
      "Jockey",
      "Charger",
      "Tank",
      "Witch",
    ].includes(name ?? "");
  return (
    <div
      className={`tab-panel timeline-panel ${fullscreen ? "is-fullscreen" : ""}`}
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">Match story</span>
          <h2>{eventCount} tick-addressed moments</h2>
        </div>
        <div className="timeline-heading-actions">
          <span className="muted">One independent clock per demo</span>
          <button
            type="button"
            className="timeline-fullscreen"
            onClick={() => setFullscreen((value) => !value)}
            aria-label={
              fullscreen
                ? "Exit fullscreen timeline"
                : "Open fullscreen timeline"
            }
          >
            {fullscreen ? <Minimize2 /> : <Maximize2 />}
            {fullscreen ? "Exit" : "Fullscreen"}
          </button>
        </div>
      </div>
      <div className="timeline-filters" aria-label="Timeline filters">
        <span className="timeline-map-filter" aria-label="Timeline map">
          {demos.map((demo) => (
            <button
              type="button"
              key={demo.sha256}
              className={mapScope === demo.sha256 ? "active" : ""}
              aria-pressed={mapScope === demo.sha256}
              onClick={() => {
                setMapScope(demo.sha256);
                setSelected(null);
              }}
            >
              {demo.mapName}
            </button>
          ))}
        </span>
        {["all", ...Object.keys(groups)].map((value) => (
          <button
            className={filter === value ? "active" : ""}
            key={value}
            onClick={() => {
              setFilter(value);
              setSelected(null);
            }}
          >
            {value}
          </button>
        ))}
        <span className="timeline-zoom" aria-label="Timeline zoom">
          {[1, 2, 4].map((value) => (
            <button
              key={value}
              className={zoom === value ? "active" : ""}
              aria-pressed={zoom === value}
              onClick={() => setZoom(value)}
            >
              {value === 1 ? "full match" : value === 2 ? "inspect" : "detail"}
            </button>
          ))}
        </span>
      </div>
      {visible.length ? (
        <div className="timeline-demo-stack">
          <p className="timeline-hint">
            Select a map, then scroll from tick 0 to its playback end. Select a
            marker for full event evidence. Rows expand when moments collide.
          </p>
          {visibleDemos.map((source) => {
            const maximumTick = Math.max(1, source.demo.playbackTicks);
            const baseCanvasWidth = Math.max(
              1260,
              Math.round(source.demo.durationSeconds * 3),
            );
            const canvasWidth = baseCanvasWidth * zoom;
            const guideCount = Math.max(
              2,
              Math.ceil(source.demo.durationSeconds / 60),
            );
            const pinBands = source.events.flatMap((item, index) => {
              if (item.event.type !== "pin_start") return [];
              const end = source.events.slice(index + 1).find((candidate) => {
                if (
                  candidate.event.type !== "pin_end" &&
                  candidate.event.type !== "death"
                )
                  return false;
                const sameActor =
                  item.event.actorPlayerId &&
                  (candidate.event.type === "death"
                    ? candidate.event.victimPlayerId
                    : candidate.event.actorPlayerId)
                    ? item.event.actorPlayerId ===
                      (candidate.event.type === "death"
                        ? candidate.event.victimPlayerId
                        : candidate.event.actorPlayerId)
                    : candidate.event.type === "death"
                      ? item.event.actor === candidate.event.victim
                      : item.event.actor === candidate.event.actor;
                if (candidate.event.type === "death")
                  return (
                    sameActor &&
                    item.event.infectedClass === candidate.event.infectedClass
                  );
                const sameVictim =
                  item.event.victimPlayerId && candidate.event.victimPlayerId
                    ? item.event.victimPlayerId ===
                      candidate.event.victimPlayerId
                    : item.event.victim === candidate.event.victim;
                return (
                  sameActor &&
                  sameVictim &&
                  item.event.infectedClass === candidate.event.infectedClass
                );
              });
              if (!end) return [];
              return [
                {
                  id: `pin:${item.key}`,
                  kind: "pin" as const,
                  start: item.event.tick,
                  end: end.event.tick,
                  label: `${item.event.infectedClass ?? "SI"} pin`,
                  detail: `${item.event.actor ?? "Special Infected"} controlled ${item.event.victim ?? "a Survivor"}`,
                },
              ];
            });
            const hitBands = (source.demo.competitive?.hits ?? []).map(
              (hit) => ({
                id: hit.id,
                kind: "hit" as const,
                start: hit.tickRange.start,
                end: hit.tickRange.end,
                label: `${hit.infectedClasses.join(" + ") || "SI"} hit`,
                detail: `${hit.playerIds.length} players, ${hit.controls} controls, peak ${hit.peakSimultaneousPins} simultaneous pins`,
              }),
            );
            const tankBands = (
              source.demo.competitive?.tankEncounters ?? []
            ).map((tank) => ({
              id: tank.id,
              kind: "tank" as const,
              start: tank.tickRange.start,
              end: tank.tickRange.end,
              label: `Tank · ${tank.controllerAlias}`,
              detail: `${duration(tank.durationSeconds)}, ${tank.punches} punches, ${tank.registeredRockThrows} registered throws`,
            }));
            return (
              <section className="match-timeline" key={source.demoIndex}>
                <header className="timeline-demo-head">
                  <div>
                    <span className="eyebrow">Demo {source.demoIndex + 1}</span>
                    <h3>{source.mapName}</h3>
                  </div>
                  <span>
                    {source.sha256.slice(0, 12)} ·{" "}
                    {whole.format(source.demo.playbackTicks)} ticks ·{" "}
                    {source.demo.tickRate === null
                      ? "time unavailable"
                      : duration(source.demo.durationSeconds)}
                  </span>
                </header>
                <div className="timeline-scroll">
                  <span className="timeline-scroll-cue" aria-hidden="true">
                    Scroll horizontally
                  </span>
                  <div
                    className="timeline-canvas"
                    style={{ width: canvasWidth }}
                  >
                    <div className="timeline-axis">
                      <strong>Playback time</strong>
                      <div>
                        {Array.from({ length: guideCount + 1 }, (_, index) => (
                          <span
                            key={index}
                            style={{ left: `${(index / guideCount) * 100}%` }}
                          >
                            {duration(
                              (source.demo.durationSeconds * index) /
                                guideCount,
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div
                      className="timeline-lanes"
                      aria-label={`Interactive ${source.mapName} timeline`}
                    >
                      {lanes.map((lane) => {
                        const laneEvents = source.events.filter(({ event }) =>
                          lane.types.includes(event.type),
                        );
                        const occupiedRows: number[] = [];
                        const minimumGap = (86 / canvasWidth) * 100;
                        const packed = laneEvents.map((item) => {
                          const position = Math.min(
                            99.5,
                            Math.max(
                              0.5,
                              (item.event.tick / maximumTick) * 100,
                            ),
                          );
                          let row = occupiedRows.findIndex(
                            (last) => position - last >= minimumGap,
                          );
                          if (row < 0) row = occupiedRows.length;
                          occupiedRows[row] = position;
                          return { ...item, position, row };
                        });
                        const laneBands =
                          lane.name === "SI actions"
                            ? hitBands
                            : lane.name === "Pins + clears"
                              ? pinBands
                              : lane.name === "Bosses"
                                ? tankBands
                                : [];
                        const bandRows: number[] = [];
                        const packedBands = laneBands.map((band) => {
                          const left = Math.max(
                            0.2,
                            (band.start / maximumTick) * 100,
                          );
                          const right = Math.min(
                            99.8,
                            (Math.max(band.start + 1, band.end) / maximumTick) *
                              100,
                          );
                          let row = bandRows.findIndex(
                            (lastRight) => left - lastRight >= 0.35,
                          );
                          if (row < 0) row = bandRows.length;
                          bandRows[row] = right;
                          return {
                            ...band,
                            left,
                            width: Math.max(0.55, right - left),
                            row,
                          };
                        });
                        const bandArea = packedBands.length
                          ? 16 + bandRows.length * 26
                          : 0;
                        const laneHeight = Math.max(
                          laneEvents.length === 0 ? 76 : 132,
                          34 + bandArea + occupiedRows.length * 42,
                        );
                        return (
                          <div
                            className="timeline-lane"
                            key={lane.name}
                            style={{ minHeight: laneHeight }}
                          >
                            <strong>
                              <span>{lane.name}</span>
                              <small>{laneEvents.length} events</small>
                            </strong>
                            <div style={{ minHeight: laneHeight }}>
                              <i />
                              {packedBands.map((band) => (
                                <span
                                  key={band.id}
                                  className={`timeline-band ${band.kind}`}
                                  style={{
                                    left: `${band.left}%`,
                                    width: `${band.width}%`,
                                    top: `${12 + band.row * 26}px`,
                                  }}
                                  title={`${band.label}. ${band.detail}`}
                                >
                                  <b>{band.label}</b>
                                </span>
                              ))}
                              {packed.map(({ event, key, position, row }) => {
                                const infectedMarker = hasInfectedIcon(
                                  event.infectedClass,
                                );
                                const time =
                                  source.demo.tickRate === null
                                    ? "time unavailable"
                                    : duration(event.timeSeconds);
                                return (
                                  <button
                                    key={key}
                                    className={`${event.type} ${active?.key === key ? "active" : ""} ${infectedMarker ? "infected-marker" : ""}`}
                                    style={{
                                      left: `${position}%`,
                                      top: `${17 + bandArea + row * 42}px`,
                                    }}
                                    onClick={() => setSelected(key)}
                                    onPointerDown={() => setSelected(key)}
                                    onPointerEnter={(event) => {
                                      const rect =
                                        event.currentTarget.getBoundingClientRect();
                                      const above =
                                        rect.bottom + 170 > window.innerHeight;
                                      setHovered({
                                        key,
                                        x: Math.min(
                                          window.innerWidth - 332,
                                          Math.max(12, rect.left - 24),
                                        ),
                                        y: above
                                          ? Math.max(12, rect.top - 156)
                                          : rect.bottom + 10,
                                      });
                                    }}
                                    onPointerLeave={() => setHovered(null)}
                                    onFocus={(event) => {
                                      const rect =
                                        event.currentTarget.getBoundingClientRect();
                                      setHovered({
                                        key,
                                        x: Math.min(
                                          window.innerWidth - 332,
                                          Math.max(12, rect.left - 24),
                                        ),
                                        y: Math.min(
                                          window.innerHeight - 156,
                                          rect.bottom + 10,
                                        ),
                                      });
                                    }}
                                    onBlur={() => setHovered(null)}
                                    aria-pressed={active?.key === key}
                                    data-timeline-active={
                                      active?.key === key ? "true" : undefined
                                    }
                                    aria-label={`${source.mapName}, tick ${event.tick}, ${event.type.replaceAll("_", " ")}: ${event.detail}`}
                                  >
                                    <b>
                                      {infectedMarker && event.infectedClass ? (
                                        <InfectedIcon
                                          infectedClass={event.infectedClass}
                                        />
                                      ) : (
                                        event.type.replaceAll("_", " ")
                                      )}
                                    </b>
                                    {(event.actor || event.subject) && (
                                      <small>
                                        {event.actor ?? event.subject}
                                      </small>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </section>
            );
          })}
          {active && (
            <article className={`timeline-focus ${active.event.type}`}>
              <div>
                <time>
                  {active.demo.demo.tickRate === null
                    ? "Time N/A"
                    : duration(active.event.timeSeconds)}
                </time>
                <span>tick {whole.format(active.event.tick)}</span>
              </div>
              <div>
                <span className="eyebrow">
                  {active.demo.mapName} ·{" "}
                  {active.event.type.replaceAll("_", " ")}
                </span>
                <h3>{active.event.detail}</h3>
                <p>
                  {[
                    active.event.infectedClass,
                    active.event.weapon,
                    active.event.headshot ? "headshot" : undefined,
                    active.event.position
                      ? `position ${Math.round(active.event.position.x)}, ${Math.round(active.event.position.y)}, ${Math.round(active.event.position.z)}`
                      : undefined,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <span>{active.demo.sha256.slice(0, 12)}</span>
            </article>
          )}
          {hovered &&
            (() => {
              const item = visible.find(
                (candidate) => candidate.key === hovered.key,
              );
              if (!item) return null;
              return createPortal(
                <div
                  className="timeline-float-tooltip"
                  role="tooltip"
                  style={{ left: hovered.x, top: hovered.y }}
                >
                  <em>
                    {item.demo.mapName} · tick {whole.format(item.event.tick)} ·{" "}
                    {item.demo.demo.tickRate === null
                      ? "time unavailable"
                      : duration(item.event.timeSeconds)}
                  </em>
                  <strong>
                    {item.event.actor ?? item.event.subject ?? "Match"}
                    {item.event.victim ? ` to ${item.event.victim}` : ""}
                  </strong>
                  <small>{item.event.detail}</small>
                </div>,
                document.body,
              );
            })()}
        </div>
      ) : (
        <Empty
          title="No detailed timeline available"
          text="This analysis predates detailed event retention or the demo did not expose supported match events."
        />
      )}
    </div>
  );
}

function Signals({
  analyses,
  stats,
  onOpenTimeline,
}: {
  analyses: JobAnalysis[];
  stats: DemoStats[];
  onOpenTimeline: (jobId: string, demoSha256: string, tick: number) => void;
}) {
  const [mapFilter, setMapFilter] = useState("all");
  const [playerFilter, setPlayerFilter] = useState("all");
  const [familyFilter, setFamilyFilter] = useState("all");
  const allEvidence = analyses.flatMap((analysis, index) =>
    analysis.engineResult.cases.flatMap((item) =>
      (item.presentation?.evidence ?? [])
        .filter((evidence) => {
          const ranges = stats[index]?.competitive?.halves.map(
            (half) => half.tickRange,
          );
          return (
            ranges === undefined ||
            ranges.some(
              (range) =>
                evidence.tick >= range.start && evidence.tick <= range.end,
            )
          );
        })
        .map((evidence) => ({
          ...evidence,
          player: item.presentation?.alias ?? "Unlinked player",
          identityNote: item.presentation?.alias
            ? null
            : "This detector case did not retain a reliable player identity.",
          mapName: analysis.engineResult.demo.mapName,
          jobId: analysis.jobId,
          demoSha256: analysis.demoSha256,
          versions: item.versions,
          config: item.config,
          caseLimitations: item.limitations ?? [],
        })),
    ),
  );
  const evidence = allEvidence.filter(
    (item) =>
      (mapFilter === "all" || item.demoSha256 === mapFilter) &&
      (playerFilter === "all" || item.player === playerFilter) &&
      (familyFilter === "all" || item.family === familyFilter),
  );
  const players = [...new Set(allEvidence.map((item) => item.player))].sort();
  const families = [...new Set(allEvidence.map((item) => item.family))].sort();
  return (
    <div className="tab-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Interesting moments</span>
          <h2>
            {evidence.length} review signal{evidence.length === 1 ? "" : "s"}
          </h2>
        </div>
        <span className="safety-note">
          <ShieldAlert /> Signals are not verdicts
        </span>
      </div>
      <article className="signal-explainer panel">
        <ShieldAlert />
        <div>
          <h3>What is a review signal?</h3>
          <p>
            A detector found a short, inspectable pattern worth human review. It
            is not a cheating probability or verdict. Telemetry completeness
            describes how much of the detector's required input was retained for
            that moment. Counterevidence and limitations explain why an innocent
            play may look similar.
          </p>
        </div>
      </article>
      <div className="signal-summary" aria-label="Signal summary">
        <span>
          <b>{allEvidence.length}</b> windows
        </span>
        <span>
          <b>{players.length}</b> players
        </span>
        <span>
          <b>{families.length}</b> detector families
        </span>
        <span>
          <b>{new Set(allEvidence.map((item) => item.demoSha256)).size}</b> maps
        </span>
      </div>
      <div className="signal-filters">
        <label>
          Map
          <select
            value={mapFilter}
            onChange={(event) => setMapFilter(event.target.value)}
          >
            <option value="all">All maps</option>
            {analyses.map((analysis) => (
              <option key={analysis.demoSha256} value={analysis.demoSha256}>
                {analysis.engineResult.demo.mapName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Player
          <select
            value={playerFilter}
            onChange={(event) => setPlayerFilter(event.target.value)}
          >
            <option value="all">All players</option>
            {players.map((player) => (
              <option key={player}>{player}</option>
            ))}
          </select>
        </label>
        <label>
          Detector
          <select
            value={familyFilter}
            onChange={(event) => setFamilyFilter(event.target.value)}
          >
            <option value="all">All families</option>
            {families.map((family) => (
              <option key={family}>{family}</option>
            ))}
          </select>
        </label>
      </div>
      {evidence.length ? (
        <div className="signal-list">
          {evidence.map((item) => (
            <article
              className="signal-card"
              key={`${item.demoSha256}-${item.id}`}
            >
              <div className="signal-glyph">
                <Crosshair />
              </div>
              <div>
                <span>
                  {item.player} · {item.mapName} · {item.family} · tick{" "}
                  {whole.format(item.tick)}
                </span>
                {item.identityNote && (
                  <small className="signal-identity-note">
                    {item.identityNote}
                  </small>
                )}
                <h3>
                  {item.title}{" "}
                  <SourceBadge
                    kind="derived"
                    detail="Detector output derived from the retained evidence window"
                  />
                </h3>
                <p>{item.explanation}</p>
                <p className="signal-counterevidence">
                  <strong>Strongest counterevidence:</strong>{" "}
                  {item.counterevidence[0] ??
                    "No detector-specific counterevidence was retained."}
                </p>
                <button
                  className="signal-timeline-link"
                  onClick={() =>
                    onOpenTimeline(item.jobId, item.demoSha256, item.tick)
                  }
                >
                  View tick {whole.format(item.tick)} on timeline
                </button>
                <dl className="signal-facts">
                  <div>
                    <dt>Window</dt>
                    <dd>
                      {duration(item.window.contextSeconds)} · ticks{" "}
                      {whole.format(item.tickRange.start)}–
                      {whole.format(item.tickRange.end)}
                    </dd>
                  </div>
                  <div>
                    <dt>Evidence available</dt>
                    <dd>
                      {item.quality.basis.join(", ") || "No stated basis"}
                    </dd>
                  </div>
                  <div>
                    <dt>Model contribution</dt>
                    <dd>
                      {item.contribution === null
                        ? "Descriptive only, no numeric contribution"
                        : `${item.contribution.toFixed(3)} review-model input, not cheating probability`}
                    </dd>
                  </div>
                </dl>
                <details>
                  <summary>Why this might be innocent</summary>
                  <p>
                    {item.counterevidence.join(" ") ||
                      "No specific counterevidence was supplied."}
                  </p>
                </details>
                <details>
                  <summary>Detector limitations</summary>
                  <p>
                    {item.limitations.join(" ") ||
                      "No additional limitations were recorded for this window."}
                  </p>
                </details>
                <details>
                  <summary>Detector lineage and configuration</summary>
                  <dl className="signal-lineage">
                    <div>
                      <dt>Parser</dt>
                      <dd>{item.versions?.parser ?? "Not retained"}</dd>
                    </div>
                    <div>
                      <dt>Schema</dt>
                      <dd>{item.versions?.schema ?? "Not retained"}</dd>
                    </div>
                    <div>
                      <dt>Detectors</dt>
                      <dd>
                        {item.versions?.detectors.join(", ") ?? "Not retained"}
                      </dd>
                    </div>
                    <div>
                      <dt>Model</dt>
                      <dd>{item.versions?.model ?? "Not retained"}</dd>
                    </div>
                  </dl>
                  {item.config !== undefined && (
                    <pre>{JSON.stringify(item.config, null, 2)}</pre>
                  )}
                  {item.caseLimitations.length > 0 && (
                    <p>{item.caseLimitations.join(" ")}</p>
                  )}
                </details>
              </div>
              <div className="quality-score">
                <strong>{Math.round(item.quality.value * 100)}%</strong>
                <span>telemetry completeness</span>
                <small>
                  {item.quality.basis.length} retained input
                  {item.quality.basis.length === 1 ? "" : "s"}
                </small>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title={
            allEvidence.length
              ? "No signals match these filters"
              : "Nothing unusual surfaced"
          }
          text={
            allEvidence.length
              ? "Change the map, player, or detector filter to see retained windows."
              : "No detector window met its prerequisites. That is a result, not a guarantee."
          }
        />
      )}
    </div>
  );
}

function Quality({
  stats,
  analyses,
}: {
  stats: DemoStats[];
  analyses: JobAnalysis[];
}) {
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const fields = [
    "position",
    "eyeAngles",
    "team",
    "playerClass",
    "weapon",
  ] as const;
  const averages = Object.fromEntries(
    fields.map((field) => [
      field,
      stats.reduce((sum, value) => sum + value.observationCount, 0)
        ? stats.reduce(
            (sum, value) =>
              sum + value.availability[field] * value.observationCount,
            0,
          ) / stats.reduce((sum, value) => sum + value.observationCount, 0)
        : 0,
    ]),
  ) as Record<(typeof fields)[number], number>;
  return (
    <div className="tab-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Data coverage</span>
          <h2>What could be reconstructed, and what could not</h2>
        </div>
      </div>
      <p className="coverage-intro">
        SourceTV demos do not contain every action a player performed. These
        percentages show how often each network field was available across
        sampled player states. They measure evidence coverage, not match quality
        or player skill.
      </p>
      <div className="quality-grid">
        <article className="panel rings">
          <Ring value={averages.position} label="Position" />
          <Ring value={averages.eyeAngles} label="View angles" />
          <Ring value={averages.weapon} label="Weapons" />
          <Ring value={averages.team} label="Teams" />
          <Ring value={averages.playerClass} label="Player class" />
        </article>
        <article className="panel provenance">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Provenance</span>
              <h3>Reproducible inputs</h3>
            </div>
            <Layers3 />
          </div>
          {analyses.map((analysis) => (
            <div className="hash-row" key={analysis.demoSha256}>
              <div>
                <strong>{analysis.engineResult.demo.mapName}</strong>
                <span>{bytes(analysis.engineResult.demo.bytes)}</span>
              </div>
              <code>{analysis.demoSha256}</code>
              <button
                type="button"
                className="copy-hash"
                aria-label={`Copy SHA-256 for ${analysis.engineResult.demo.mapName}`}
                onClick={() => {
                  void navigator.clipboard
                    .writeText(analysis.demoSha256)
                    .then(() => setCopiedHash(analysis.demoSha256));
                }}
              >
                {copiedHash === analysis.demoSha256 ? <Check /> : <Copy />}
                {copiedHash === analysis.demoSha256 ? "Copied" : "Copy"}
              </button>
              <span className="verified">
                <Check /> verified
              </span>
            </div>
          ))}
        </article>
      </div>
      <article className="panel coverage-by-map">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Per-map evidence</span>
            <h3>Coverage denominators and decode status</h3>
          </div>
          <SourceBadge kind="observed" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Map</th>
                <th>Samples</th>
                {fields.map((field) => (
                  <th key={field}>{counterLabel(field)}</th>
                ))}
                <th>Decode issues</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((demo, index) => (
                <tr key={analyses[index]?.demoSha256 ?? index}>
                  <td>
                    {analyses[index]?.engineResult.demo.mapName ??
                      `Map ${index + 1}`}
                  </td>
                  <td>{whole.format(demo.observationCount)}</td>
                  {fields.map((field) => (
                    <td key={field}>{pct(demo.availability[field])}</td>
                  ))}
                  <td>{whole.format(demo.decodeIssueCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <small>
          Aggregate rings are weighted by these player-state sample counts, not
          by a mean of map percentages.
        </small>
      </article>
      <article className="panel coverage-semantics">
        <div>
          <SourceBadge kind="observed" />
          <strong>Carried directly by a network property or game event</strong>
          <p>
            Examples include player position, team, health, and death events.
          </p>
        </div>
        <div>
          <SourceBadge kind="derived" />
          <strong>Computed from bounded observed samples</strong>
          <p>
            Examples include pin duration, SI lives, hit clusters, and narrow
            clears.
          </p>
        </div>
        <div>
          <SourceBadge kind="unavailable" />
          <strong>Not present or not validated in this SourceTV demo</strong>
          <p>
            Never silently replaced with zero. Accuracy, exact damage
            attribution, and player input remain unavailable.
          </p>
        </div>
      </article>
      <article className="panel capability-matrix">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Capability boundary</span>
            <h3>What this report can and cannot prove</h3>
          </div>
          <ShieldAlert />
        </div>
        <div>
          <section>
            <h4>
              Supported evidence <SourceBadge kind="observed" />
            </h4>
            <dl>
              <div>
                <dt>Identity and participation</dt>
                <dd>
                  Userinfo names, SteamID64, connection epochs, team, and
                  observed class.
                </dd>
              </div>
              <div>
                <dt>Versus structure</dt>
                <dd>
                  Scores, Survivor distance, side state, reset-aware halves, SI
                  lives, hits, Tank, and Witch sequences.
                </dd>
              </div>
              <div>
                <dt>Combat story</dt>
                <dd>
                  Death attribution, checkpoint counters, pins, incaps, revives,
                  narrow clears, ticks, and available positions.
                </dd>
              </div>
              <div>
                <dt>Review lineage</dt>
                <dd>
                  Demo hashes, parser versions, coverage, detector limitations,
                  counterevidence, and exact timeline windows.
                </dd>
              </div>
            </dl>
          </section>
          <section>
            <h4>
              Not provable here <SourceBadge kind="unavailable" />
            </h4>
            <dl>
              <div>
                <dt>Accuracy and exact damage</dt>
                <dd>
                  Shots, hits, misses, hit groups, attacker damage, assists,
                  friendly fire, and exact damage taken need omitted hurt and
                  weapon events.
                </dd>
              </div>
              <div>
                <dt>Competitive skill events</dt>
                <dd>
                  Skeets, deadstops, levels, crowns, general saves, shove
                  clears, rock hits, and hittable damage need richer live-server
                  telemetry.
                </dd>
              </div>
              <div>
                <dt>Intent and private input</dt>
                <dd>
                  Voice, communications, player commands, recoil input, and
                  intent are not present in SourceTV.
                </dd>
              </div>
              <div>
                <dt>Cheating verdict</dt>
                <dd>
                  Signals identify inspectable moments. No calibrated,
                  representative labelled dataset supports a definitive
                  probability or verdict.
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </article>
    </div>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-result">
      <Activity />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

export default App;
