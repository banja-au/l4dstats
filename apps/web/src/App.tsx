import {
  Fragment,
  lazy,
  Suspense,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  AlertCircle,
  Braces,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  Crosshair,
  ExternalLink,
  Layers3,
  LoaderCircle,
  Mail,
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
import {
  buildScreenPointIndex,
  spatialSubjectPlayerId,
  type ScreenPointIndex,
} from "./spatial-map";
import { formatElapsedTime, formatTickTime } from "./time-format";
import { numberHitsByObservedRounds } from "./story-timeline";
import {
  buildNormalizedDensityGrid,
  densityDifference,
} from "./spatial-density";
import { reconstructVersusScores } from "./score-reconstruction";
import { PlayerProfile } from "./PlayerProfile";
import { PlayerLookup } from "./PlayerLookup";
import { parsePlayerProfilePath, PlayerIdentityLinks } from "./player-links";
import { INFECTED_CLASSES, InfectedIcon } from "./visual";
import { useI18n } from "./i18n";
import { captureAnalyticsEvent } from "./analytics";
const StatsPage = lazy(() => import("./StatsPage"));

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
const DEMO_FILE_SUFFIXES = [
  ".dem",
  ".zip",
  ".dem.zip",
  ".dem.gz",
  ".dem.xz",
  ".dem.bz2",
  ".dem.zst",
] as const;
const isDemoUploadFilename = (value: string) => {
  const lower = value.toLowerCase();
  return DEMO_FILE_SUFFIXES.some((suffix) => lower.endsWith(suffix));
};
const uploadFormat = (value: string) => {
  const lower = value.toLowerCase();
  if (lower.endsWith(".zip")) return "zip";
  if (lower.endsWith(".gz")) return "gzip";
  if (lower.endsWith(".xz")) return "xz";
  if (lower.endsWith(".bz2")) return "bzip2";
  if (lower.endsWith(".zst")) return "zstd";
  return "raw";
};
const byteSizeBand = (bytes: number) =>
  bytes < 1024 * 1024
    ? "under_1mb"
    : bytes < 10 * 1024 * 1024
      ? "1_to_10mb"
      : bytes < 50 * 1024 * 1024
        ? "10_to_50mb"
        : "50mb_or_more";
const errorCategory = (error: unknown) => {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("size") || message.includes("limit")) return "limit";
  if (message.includes("compress") || message.includes("archive"))
    return "compression";
  if (message.includes("network") || message.includes("fetch"))
    return "network";
  return "other";
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const activeNumberLocale = () =>
  document.documentElement.lang === "es" ? "es-ES" : "en-US";
const compact = {
  format: (value: number) =>
    new Intl.NumberFormat(activeNumberLocale(), {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value),
};
const whole = {
  format: (value: number) =>
    new Intl.NumberFormat(activeNumberLocale()).format(value),
};
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
    ? `${new Intl.NumberFormat(activeNumberLocale(), { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(value / 1024 ** 2)} MB`
    : `${Math.round(value / 1024)} KB`;
const counterLabel = (value: string) =>
  value
    .replace(/^m_(checkpoint|mission)/, "")
    .replace(/^PZ/, "SI ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ");

const detectorSpanish: Record<string, string> = {
  "Server-observed aim dynamics":
    "Dinámica de puntería observada por el servidor",
  "Audited hidden-target alignment": "Alineación auditada con objetivo oculto",
  "Authoritative fire cadence invariant":
    "Invariante autoritativa de cadencia de disparo",
  "Authoritative movement invariant": "Invariante autoritativa de movimiento",
  "SourceTV quantization and interpolation":
    "Cuantización e interpolación de SourceTV",
  "low tick rate": "baja frecuencia de ticks",
  "spectator state is not direct mouse input":
    "el estado del espectador no representa entradas directas del ratón",
  "target selection uncertainty": "incertidumbre en la selección del objetivo",
  "Shot timing was unavailable; the window is aim-only.":
    "No estaba disponible el momento del disparo; la ventana solo contiene puntería.",
  "A fast human flick can produce the same local shape.":
    "Un flick humano rápido puede producir la misma forma local.",
  "Residual target error is material rather than pixel-perfect.":
    "El error residual respecto al objetivo es apreciable y no perfecto al píxel.",
  "No authoritative shot occurred near the acquisition.":
    "No ocurrió ningún disparo autoritativo cerca de la adquisición.",
  "complete angle/position/time window":
    "ventana completa de ángulo, posición y tiempo",
  "shot timing unavailable": "momento del disparo no disponible",
  "shot timing observed": "momento del disparo observado",
  "server-observed rather than direct input":
    "observado por el servidor, no como entrada directa",
  "missing map collision": "falta la colisión del mapa",
  "unmodeled callouts": "avisos de voz no modelados",
  "sound propagation differs from distance":
    "la propagación del sonido difiere de la distancia",
  "target-selection ambiguity": "ambigüedad en la selección del objetivo",
  "authoritative visibility source": "fuente de visibilidad autoritativa",
  "audibility and prior knowledge audited":
    "audibilidad y conocimiento previo auditados",
  "dynamic occluders resolved": "oclusores dinámicos resueltos",
  "Team voice communication is not represented.":
    "La comunicación de voz del equipo no está representada.",
  "Coincidental crosshair placement remains plausible.":
    "Una colocación casual de la mira sigue siendo plausible.",
  "A single audited alignment is weak evidence.":
    "Una sola alineación auditada constituye evidencia débil.",
  "weapon upgrades or mode changes absent from state":
    "mejoras de arma o cambios de modo ausentes del estado",
  "tick quantization": "cuantización de ticks",
  "event duplication": "duplicación de eventos",
  "authoritative state": "estado autoritativo",
  "matching weapon": "arma coincidente",
  "consistent ammo transitions": "transiciones de munición coherentes",
  "A parser duplication or incomplete weapon-mode model can mimic this violation.":
    "Una duplicación del analizador o un modelo incompleto del modo del arma puede imitar esta infracción.",
  "knockback or map triggers": "retroceso o activadores del mapa",
  "unmodeled temporary modifiers": "modificadores temporales no modelados",
  teleports: "teletransportes",
  "authoritative movement state": "estado de movimiento autoritativo",
  "mode-specific bound": "límite específico del modo",
  "An unmodeled impulse, trigger, or temporary modifier may explain the excess.":
    "Un impulso, activador o modificador temporal no modelado podría explicar el exceso.",
};

const localizeDetectorCopy = (value: string, locale: "en" | "es") => {
  if (locale === "en") return value;
  const exact = detectorSpanish[value];
  if (exact) return exact;
  let match = value.match(
    /^View direction moved ([\d.]+)°\/s and ended ([\d.]+)° from the selected target( near an observed shot)?\.$/,
  );
  if (match)
    return `La dirección de la vista se movió a ${match[1]}°/s y terminó a ${match[2]}° del objetivo seleccionado${match[3] ? " cerca de un disparo observado" : ""}.`;
  match = value.match(
    /^View alignment was ([\d.]+)° from a target while the recorded visibility, audibility, and prior-knowledge channels were negative\.$/,
  );
  if (match)
    return `La vista quedó alineada a ${match[1]}° de un objetivo mientras los canales registrados de visibilidad, audibilidad y conocimiento previo eran negativos.`;
  match = value.match(
    /^Two authoritative (.+) fire events were ([\d.]+)s apart, below its ([\d.]+)s cycle\.$/,
  );
  if (match)
    return `Dos disparos autoritativos de ${match[1]} estuvieron separados por ${match[2]} s, por debajo de su ciclo de ${match[3]} s.`;
  match = value.match(
    /^Observed speed ([\d.]+) exceeded the (.+) bound ([\d.]+)\.$/,
  );
  if (match)
    return `La velocidad observada ${match[1]} superó el límite ${match[2]} de ${match[3]}.`;
  return value;
};

const ratingSpanish: Record<string, string> = {
  "Threat removal": "Eliminación de amenazas",
  Rescue: "Rescate",
  Durability: "Resistencia",
  "Boss output": "Rendimiento contra jefes",
  Conversion: "Conversión",
  Control: "Control",
  Setup: "Preparación",
  Tank: "Tank",
  "SI kill rate": "Tasa de bajas de infectados especiales",
  "Revive rate": "Tasa de reanimaciones",
  "Death-correlated clear rate":
    "Tasa de liberaciones correlacionadas con muertes",
  "Death rate": "Tasa de muertes",
  "Incap rate": "Tasa de incapacitación",
  "Damage taken rate": "Tasa de daño recibido",
  "Tank damage rate": "Tasa de daño al Tank",
  "Witch damage rate": "Tasa de daño a la Witch",
  "Damage per life": "Daño por vida",
  "Incaps per life": "Incapacitaciones por vida",
  "Kills per life": "Bajas por vida",
  "Controls per life": "Controles por vida",
  "Pin seconds per control": "Segundos de agarre por control",
  "Booms per life": "Vómitos por vida",
  "Pulls per life": "Arrastres por vida",
  "Charge victims per life": "Víctimas de carga por vida",
  "Pounces per life": "Abalanzamientos por vida",
  "Tank punches per life": "Puñetazos de Tank por vida",
  "Registered Tank throws per life":
    "Lanzamientos de Tank registrados por vida",
  "engine-counter": "contador del motor",
  "game-event": "evento del juego",
  sampled: "muestreado",
  derived: "derivado",
  "This is a selected-game performance index, not latent skill or win probability.":
    "Este es un índice de rendimiento de la partida seleccionada, no de habilidad latente ni de probabilidad de victoria.",
  "The v0.2 fallback baseline is game-relative because a representative frozen reference corpus does not yet exist.":
    "La referencia alternativa v0.2 es relativa a la partida porque aún no existe un corpus de referencia congelado y representativo.",
  "Engine damage counters are aggregate checkpoint values and do not provide event-level attacker attribution.":
    "Los contadores de daño del motor son valores agregados de checkpoint y no atribuyen el atacante en cada evento.",
  "Unavailable telemetry is omitted rather than imputed as zero; realized weights and coverage therefore vary.":
    "La telemetría no disponible se omite en vez de imputarse como cero; por ello varían los pesos efectivos y la cobertura.",
};
const localizeRatingCopy = (value: string, locale: "en" | "es") =>
  locale === "es" ? (ratingSpanish[value] ?? value) : value;

function BrandMark() {
  return <img src="/art/infected-mark.webp" alt="" aria-hidden="true" />;
}

function BanjaAttribution({
  placement,
}: {
  placement: "homepage" | "loading" | "report";
}) {
  const { t } = useI18n();
  return (
    <div className={`banja-attribution banja-attribution-${placement}`}>
      <a
        className="banja-signature"
        href={`https://banja.au/?utm_source=l4dstats&utm_medium=referral&utm_campaign=l4dstats_product&utm_content=${placement}_signature`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t("brand.banjaTab")}
        onClick={() =>
          captureAnalyticsEvent("outbound_link_clicked", { target: "banja" })
        }
      >
        <span>{t("brand.by")}</span> {t("brand.banjaName")}
      </a>
      <a
        className="banja-email"
        href="mailto:labs@banja.au"
        aria-label={t("brand.banjaEmail")}
        title={t("brand.banjaAddress")}
        onClick={() =>
          captureAnalyticsEvent("outbound_link_clicked", { target: "email" })
        }
      >
        <Mail aria-hidden="true" />
      </a>
      <a
        className="banja-developers"
        href="https://developers.l4dstats.gg/"
        aria-label={t("brand.developers")}
        title={t("brand.developers")}
        onClick={() =>
          captureAnalyticsEvent("outbound_link_clicked", {
            target: "developers",
          })
        }
      >
        <Braces aria-hidden="true" />
      </a>
    </div>
  );
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
  if (
    window.location.pathname === "/stats" ||
    window.location.pathname === "/stats/"
  )
    return (
      <Suspense fallback={null}>
        <StatsPage />
      </Suspense>
    );
  const { locale, t, tx } = useI18n();
  const requestedPlayerProfile = parsePlayerProfilePath(
    window.location.pathname,
  );
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [routeLoading, setRouteLoading] = useState(() =>
    Boolean(
      gameRouteParts() || parsePlayerProfilePath(window.location.pathname),
    ),
  );
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
  const [landingTool, setLandingTool] = useState<"upload" | "player">(() =>
    new URLSearchParams(window.location.search).has("player")
      ? "player"
      : "upload",
  );
  const refreshedGames = useRef(false);

  const update = (key: string, patch: Partial<UploadItem>) =>
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );

  async function watchJob(
    key: string,
    id: string,
    updateUrl: boolean,
    analytics?: {
      format: string;
      operation: "upload" | "reanalyze";
      startedAt: number;
    },
  ) {
    for (;;) {
      const job = await workbenchApi.job(id);
      update(key, {
        state: job.state === "cancelled" ? "failed" : job.state,
        progress: job.progress,
        message:
          job.message ??
          (job.state === "succeeded"
            ? t("analysis.complete")
            : t("analysis.analyzing")),
        job,
        ...(job.analysis ? { analysis: job.analysis } : {}),
      });
      if (
        job.state === "succeeded" ||
        job.state === "failed" ||
        job.state === "cancelled"
      ) {
        if (analytics)
          captureAnalyticsEvent("analysis_finished", {
            attempt: job.attempt ?? 0,
            duration_seconds: Math.max(
              0,
              Math.round((performance.now() - analytics.startedAt) / 1000),
            ),
            format: analytics.format,
            operation: analytics.operation,
            outcome: job.state,
          });
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
    const startedAt = performance.now();
    const format = uploadFormat(item.file.name);
    captureAnalyticsEvent("demo_upload_started", {
      format,
      size_band: byteSizeBand(item.file.size),
    });
    try {
      if (!item.source) throw new Error(t("upload.unavailable"));
      const uploaded = await workbenchApi.uploadDemo(item.source);
      update(item.key, {
        state: "queued",
        progress: 0.05,
        message: t("upload.queued"),
        job: uploaded.job,
      });
      captureAnalyticsEvent("demo_upload_accepted", {
        duplicate: uploaded.duplicate ?? false,
        format,
        initial_state: uploaded.job.state,
        size_band: byteSizeBand(item.file.size),
      });
      await watchJob(item.key, uploaded.job.id, updateUrl, {
        format,
        operation: "upload",
        startedAt,
      });
    } catch (error) {
      captureAnalyticsEvent("demo_upload_failed", {
        category: errorCategory(error),
        format,
        size_band: byteSizeBand(item.file.size),
      });
      update(item.key, {
        state: "failed",
        message: error instanceof Error ? error.message : t("upload.failed"),
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
            message: tx(
              "Reanalyzing with the current engine",
              "Volviendo a analizar con el motor actual",
            ),
            job,
          });
          await watchJob(item.key, job.id, false, {
            format: uploadFormat(item.file.name),
            operation: "reanalyze",
            startedAt: performance.now(),
          });
        }),
      );
    } catch (error) {
      setUploadError(
        error instanceof Error
          ? error.message
          : tx("Reanalysis failed", "El nuevo análisis falló"),
      );
    }
  }

  function addFiles(files: File[]) {
    const demos = files.filter((file) => isDemoUploadFilename(file.name));
    if (!demos.length) {
      captureAnalyticsEvent("upload_selection_rejected", {
        category: "unsupported_format",
        selected_count: files.length,
      });
      setUploadError(
        tx(
          "Choose one or more supported demo or compressed-demo files.",
          "Elige uno o más archivos de demo o demo comprimida compatibles.",
        ),
      );
      return;
    }
    if (items.length + demos.length > MAX_DEMOS) {
      captureAnalyticsEvent("upload_selection_rejected", {
        category: "batch_limit",
        selected_count: demos.length,
      });
      setUploadError(
        tx(
          "You can analyze up to {maximum} demos at once.",
          "Puedes analizar hasta {maximum} demos a la vez.",
          { maximum: MAX_DEMOS },
        ),
      );
      return;
    }
    captureAnalyticsEvent("upload_batch_selected", {
      demo_count: demos.length,
      formats: [...new Set(demos.map((file) => uploadFormat(file.name)))]
        .sort()
        .join(","),
      total_size_band: byteSizeBand(
        demos.reduce((sum, file) => sum + file.size, 0),
      ),
    });
    setUploadError("");
    const next = demos.map((source) => ({
      key: `${source.name}:${source.size}:${source.lastModified}:${crypto.randomUUID()}`,
      file: { name: source.name, size: source.size },
      source,
      state: "uploading" as const,
      progress: 0,
      message: tx("Uploading demo", "Subiendo demo"),
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
          captureAnalyticsEvent("game_viewed", {
            confidence: game.confidence,
            demo_count: game.analyses.length,
            entry: playerMatch ? "player_profile" : "direct_route",
          });
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
              message: t("analysis.complete"),
              analysis,
            })),
          );
          setRouteLoading(false);
        },
        (error) => {
          captureAnalyticsEvent("game_load_failed", {
            category: errorCategory(error),
          });
          setItems([
            {
              key: `game:${id}:error`,
              file: { name: tx("Saved game", "Partida guardada"), size: 0 },
              state: "failed",
              progress: 0,
              message:
                error instanceof Error
                  ? error.message
                  : tx("Game not found", "Partida no encontrada"),
            },
          ]);
          setRouteLoading(false);
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
        file: { name: tx("Saved analysis", "Análisis guardado"), size: 0 },
        state: "running",
        progress: 0,
        message: tx("Loading analysis", "Cargando análisis"),
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
              message: t("analysis.complete"),
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
                      : tx("Analysis not found", "Análisis no encontrado"),
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
    const canonical = document.querySelector<HTMLLinkElement>(
      "link[rel='canonical']",
    );
    if (canonical)
      canonical.href = `${window.location.origin}${window.location.pathname}`;
  }, [selectedGame, tab, requestedPlayerProfile?.playerId]);
  useEffect(() => {
    if (!gameAnalyses.length) {
      document.title = isWorking
        ? tx("Analyzing demos | L4DStats", "Analizando demos | L4DStats")
        : "L4DStats";
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
      : tx(
          "{campaign} analysis | L4DStats",
          "Análisis de {campaign} | L4DStats",
          { campaign },
        );
  }, [
    gameAnalyses,
    selectedCampaignName,
    canonicalScoreEntries,
    isWorking,
    locale,
    tx,
  ]);
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
    if (next !== tab)
      captureAnalyticsEvent("results_tab_selected", {
        route: selectedGame ? "game" : "analysis",
        tab: next,
      });
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
  const phase = routeLoading
    ? "loading"
    : items.length === 0
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
      aria-label={t("upload.choose")}
      accept={DEMO_FILE_SUFFIXES.join(",")}
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
          <h1 className="sr-only">{t("analysis.heading")}</h1>
          <img
            className="landing-infected"
            src="/art/boomer-trace.webp"
            alt={t("analysis.illustration")}
          />
          <div className="poster-brand" aria-hidden="true">
            <BrandMark />
            <span>L4D</span>
            <b>STATS</b>
          </div>
          <div className="landing-actions">
            {landingTool === "upload" ? (
              <button
                className={`dropzone ${dragging ? "is-dragging" : ""}`}
                onClick={() => input.current?.click()}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => {
                  if (
                    !event.currentTarget.contains(event.relatedTarget as Node)
                  )
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
                <span>{t("upload.drop")}</span>
                <small>{t("upload.hint", { maximum: MAX_DEMOS })}</small>
                {uploadError && (
                  <em className="upload-error" role="alert">
                    {uploadError}
                  </em>
                )}
              </button>
            ) : (
              <PlayerLookup />
            )}
            <div className="landing-tool-links">
              <button
                className="landing-tool-switch"
                type="button"
                onClick={() => {
                  captureAnalyticsEvent("landing_tool_switched", {
                    destination: landingTool === "upload" ? "player" : "upload",
                  });
                  setLandingTool(
                    landingTool === "upload" ? "player" : "upload",
                  );
                }}
              >
                {t(
                  landingTool === "upload"
                    ? "playerSearch.switchTo"
                    : "playerSearch.switchBack",
                )}
              </button>
              <a
                href="/game/0b1b114c-ece0-415e-91ae-7844c8b990fb/overview"
                onClick={() => captureAnalyticsEvent("example_game_opened")}
              >
                {t("results.exampleGame")}
              </a>
            </div>
          </div>
          <BanjaAttribution placement="homepage" />
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
            <span>{t("analysis.reconstructing")}</span>
            <h1>
              {t("analysis.horde")}
              <br />
              {t("analysis.leavesEvidence")}
              <span>.</span>
            </h1>
            <div className="loading-progress-meta">
              <strong>{Math.round(overallProgress * 100)}%</strong>
              <span>
                {items.find((item) => item.state !== "succeeded")?.message ??
                  (routeLoading
                    ? tx("Loading game", "Cargando partida")
                    : t("analysis.safeRoom"))}
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
          <BanjaAttribution placement="loading" />
        </main>
      )}

      {phase === "results" && (
        <main className="results-screen">
          {picker}
          <div className="results-head">
            <a
              className="grunge-wordmark"
              href="/"
              aria-label={t("brand.home")}
            >
              <BrandMark />
              <span>
                L4D<b>STATS</b>
              </span>
            </a>
            <div>
              <span className="results-kicker">
                {t("results.complete")}
                <span className="results-parser-help">
                  <HeaderHelp
                    label={t("results.provenance")}
                    description={parserProvenance}
                  />
                </span>
              </span>
              <h1>
                {selectedGame
                  ? (selectedCampaignName ??
                    gameAnalyses[0]?.engineResult.demo.session?.campaign?.toUpperCase() ??
                    t("results.defaultGame"))
                  : (gameCampaignName(analyses) ??
                    analyses[0]?.engineResult.demo.session?.campaign ??
                    analyses[0]?.engineResult.demo.mapName ??
                    t("results.defaultMatch"))}
              </h1>
            </div>
            <button
              className="add-demos"
              disabled={items.length >= MAX_DEMOS}
              onClick={() => input.current?.click()}
            >
              <UploadCloud />{" "}
              {items.length >= MAX_DEMOS
                ? t("results.demoLimit")
                : t("results.addDemos")}
            </button>
          </div>
          <section className="results">
            {(hasLegacyAnalysis || hasOutdatedCompetitive) && (
              <aside className="legacy-analysis" role="status">
                <div>
                  <strong>{t("results.update")}</strong>
                  <span>{t("results.updateDetail")}</span>
                </div>
                <button onClick={() => void reanalyzeLegacy()}>
                  <RefreshCw /> {t("results.reanalyze")}
                </button>
              </aside>
            )}
            <div className="results-toolbar">
              <nav aria-label={t("results.sections")}>
                {TABS.map((value) => (
                  <button
                    key={value}
                    className={tab === value ? "active" : ""}
                    onClick={() => selectTab(value)}
                  >
                    {t(`tabs.${value}`)}
                  </button>
                ))}
              </nav>
              <div className="scope-filters">
                {gameGroups.length > 1 && (
                  <label className="game-filter">
                    <span>{t("filters.game")}</span>
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
                            {campaignName ??
                              t("filters.gameNumber", {
                                number: index + 1,
                              })}{" "}
                            ·{" "}
                            {t(
                              maps.length === 1
                                ? "filters.mapCount"
                                : "filters.mapCountPlural",
                              { count: maps.length },
                            )}
                          </option>
                        );
                      })}
                    </select>
                    <ChevronDown />
                  </label>
                )}
                <details
                  className="map-toggle"
                  onToggle={(event) => {
                    if (!event.currentTarget.open) return;
                    for (const sibling of event.currentTarget.parentElement?.querySelectorAll(
                      "details[open]",
                    ) ?? [])
                      if (sibling !== event.currentTarget)
                        sibling.removeAttribute("open");
                  }}
                >
                  <summary>
                    <Layers3 />{" "}
                    {t("filters.maps", {
                      enabled: visible.length,
                      total: gameAnalyses.length,
                    })}
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
                              {t("filters.chapter", {
                                chapter:
                                  analysis.engineResult.demo.session?.chapter ??
                                  t("common.notAvailable"),
                              })}{" "}
                              · {analysis.demoSha256.slice(0, 8)}
                            </small>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </details>
                {roundScopes.length > 1 && (
                  <details
                    className="map-toggle half-toggle"
                    onToggle={(event) => {
                      if (!event.currentTarget.open) return;
                      for (const sibling of event.currentTarget.parentElement?.querySelectorAll(
                        "details[open]",
                      ) ?? [])
                        if (sibling !== event.currentTarget)
                          sibling.removeAttribute("open");
                    }}
                  >
                    <summary>
                      <Layers3 />{" "}
                      {t("filters.rounds", {
                        enabled: enabledRoundCount,
                        total: roundScopes.length,
                      })}
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
                                  ? t("filters.observedRound")
                                  : t("filters.half", { half: half.id })}
                              </strong>
                              <small>
                                {analysis.engineResult.demo.mapName} ·{" "}
                                {t("filters.ticks", {
                                  start: whole.format(half.tickRange.start),
                                  end: whole.format(half.tickRange.end),
                                })}
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
                <h2>{t("player.missing")}</h2>
                <p>{t("player.missingDetail")}</p>
                <a
                  href={`/game/${encodeURIComponent(selectedGame ?? playerProfileRoute.gameId)}/players`}
                >
                  {t("player.back")}
                </a>
              </section>
            )}

            {!playerProfileRoute && selectedGame && (
              <aside className="game-grouping-note">
                <strong>
                  {t("group.maps", { count: gameAnalyses.length })}
                  {gameConfidence === "high"
                    ? ` · ${t("group.highConfidence")}`
                    : gameConfidence === "provisional"
                      ? ` · ${t("group.provisional")}`
                      : gameConfidence === "unassociated"
                        ? ` · ${t("group.unassociated")}`
                        : ""}
                </strong>
                <span>
                  {gameConfidence === "unassociated"
                    ? t("group.unassociatedDetail")
                    : gameConfidence === "provisional"
                      ? t("group.provisionalDetail")
                      : t("group.highDetail")}{" "}
                  {t("group.recalculate")}
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
          <BanjaAttribution placement="report" />
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
  const { t } = useI18n();
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
    id: string;
    label: string;
    unit: string;
    description: string;
    value: (player: PlayerStats) => number | null;
    format?: (value: number) => string;
  }> = [
    {
      id: "infectedKills",
      label: t("awards.infectedKills"),
      unit: t("awards.infectedKillsUnit"),
      description: t("awards.infectedKillsHelp"),
      value: (player: PlayerStats) => player.checkpointInfectedKills ?? null,
    },
    {
      id: "siKills",
      label: t("awards.siKills"),
      unit: t("awards.siUnit"),
      description: t("awards.siKillsHelp"),
      value: (player: PlayerStats) => player.specialInfectedKills ?? null,
    },
    {
      id: "hunterKills",
      label: t("awards.hunterKills"),
      unit: t("awards.hunterUnit"),
      description: t("awards.hunterKillsHelp"),
      value: (player: PlayerStats) =>
        player.killsByInfectedClass?.Hunter ?? null,
    },
    {
      id: "siDamage",
      label: t("awards.siDamage"),
      unit: t("awards.damageUnit"),
      description: t("awards.siDamageHelp"),
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
      id: "clears",
      label: t("awards.clears"),
      unit: t("awards.clearsUnit"),
      description: t("awards.clearsHelp"),
      value: (player: PlayerStats) => clearTotals.get(player.id) ?? null,
    },
    {
      id: "pinTime",
      label: t("awards.pinTime"),
      unit: t("awards.secondsUnit"),
      description: t("awards.pinTimeHelp"),
      value: (player: PlayerStats) => player.pinSeconds ?? null,
      format: (value: number) => duration(value),
    },
    {
      id: "revives",
      label: t("awards.revives"),
      unit: t("awards.revivesUnit"),
      description: t("awards.revivesHelp"),
      value: (player: PlayerStats) => player.revives ?? null,
    },
    {
      id: "bestPounce",
      label: t("awards.bestPounce"),
      unit: t("awards.damageUnit"),
      description: t("awards.bestPounceHelp"),
      value: (player: PlayerStats) => player.highestPounceDamage ?? null,
    },
    {
      id: "siIncaps",
      label: t("awards.siIncaps"),
      unit: t("awards.incapsUnit"),
      description: t("awards.siIncapsHelp"),
      value: (player: PlayerStats) => player.specialIncaps ?? null,
    },
    {
      id: "tankDamage",
      label: t("awards.tankDamage"),
      unit: t("awards.damageUnit"),
      description: t("awards.tankDamageHelp"),
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
  const winningTeam: "a" | "b" | "draw" | null = terminalScore?.complete
    ? terminalScore.teamA === terminalScore.teamB
      ? "draw"
      : terminalScore.teamA > (terminalScore.teamB ?? 0)
        ? "a"
        : "b"
    : null;
  const winningScoreIndex =
    winningTeam === "a" ? 0 : winningTeam === "b" ? 1 : null;
  const winningTeamLabel =
    winningTeam === "a"
      ? t("overview.teamA")
      : winningTeam === "b"
        ? t("overview.teamB")
        : winningTeam === "draw"
          ? t("overview.draw")
          : null;
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
            <strong>{t("overview.restartTitle")}</strong>
            <span>
              {t(
                restartMaps === 1
                  ? "overview.restartDetailOne"
                  : "overview.restartDetailMany",
                { count: restartMaps },
              )}
            </span>
          </div>
          <SourceBadge kind="observed" />
        </aside>
      )}
      <section
        className="rating-mvp overview-mvp"
        aria-label={t("overview.gameMvp")}
      >
        <div className="rating-crown">
          <MvpMark />
          <span>
            {ratings.mvp.status === "unavailable"
              ? t("overview.mvpUnavailable")
              : ratings.mvp.status === "shared"
                ? t("overview.mvpUnresolved")
                : t("overview.gameMvp")}
          </span>
        </div>
        <strong>
          {ratings.mvp.status === "unavailable"
            ? t("overview.mvpNoData")
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
                <b>{player.rating?.toFixed(2) ?? t("common.notAvailable")}</b>
                <small>
                  {t("player.survivorRating", {
                    rating:
                      player.survivor.score?.toFixed(2) ??
                      t("common.notAvailable"),
                  })}{" "}
                  ·{" "}
                  {t("player.infectedRating", {
                    rating:
                      player.infected.score?.toFixed(2) ??
                      t("common.notAvailable"),
                  })}{" "}
                  · {t("overview.coverage", { value: pct(player.coverage) })}
                </small>
              </span>
            ))}
          </div>
        )}
        <small>
          {ratings.mvp.status === "shared"
            ? t("overview.mvpShared", {
                resolution: ratings.mvp.resolution.toFixed(2),
              })
            : t("overview.mvpMethod")}
        </small>
      </section>
      {spectators.length > 0 && (
        <details className="spectator-summary">
          <summary>
            <Users />
            {t(
              spectators.length === 1
                ? "overview.spectatorOne"
                : "overview.spectatorMany",
              { count: spectators.length },
            )}
            <span>{t("overview.spectatorExcluded")}</span>
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
        <article className="game-result" aria-label={t("overview.finalScore")}>
          <div className="game-result-final">
            <span className="eyebrow">
              {terminalScore?.complete
                ? t("overview.finalScore")
                : t("overview.latestScore")}{" "}
              · {t("overview.neutralIndex")}
            </span>
            <strong>
              <b>{whole.format(displayedScore.teamA)}</b>
              <i>:</i>
              <b>{whole.format(displayedScore.teamB ?? 0)}</b>
            </strong>
            <span className={`game-winner ${winningTeam ? "" : "incomplete"}`}>
              {winningTeamLabel ?? t("overview.finalUnavailable")}
            </span>
            <small>
              {!terminalScore?.complete
                ? t("overview.scoreIncomplete")
                : winningTeam === "draw"
                  ? t("overview.drawDetail")
                  : t("overview.winDetail", { team: winningTeamLabel ?? "" })}
            </small>
          </div>
          <div
            className="map-score-strip"
            aria-label={t("overview.scoreByMap")}
          >
            {scoreRows.map((row, index) => (
              <div key={`${row.mapName}-${index}`}>
                <span>{index + 1}</span>
                <strong>{row.mapName}</strong>
                <b>
                  {whole.format(row.teamA)} :{" "}
                  {row.teamB === null
                    ? t("overview.pending")
                    : whole.format(row.teamB)}
                </b>
                <small>
                  {t("overview.chapter")} {whole.format(row.chapterA)} :{" "}
                  {row.chapterB === null
                    ? t("overview.pending")
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
            <strong>{t("overview.progressionDetail")}</strong>
            <small>{t("overview.progressionDetailHelp")}</small>
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
          label={t("overview.playTime")}
          value={duration(totals.duration)}
          detail={t(
            totals.demos === 1
              ? "overview.acrossDemoOne"
              : "overview.acrossDemoMany",
            { count: totals.demos },
          )}
        />
        <StatCard
          icon={Users}
          label={t("overview.players")}
          value={whole.format(totals.players)}
          detail={t("overview.uniquePlayers")}
        />
        <StatCard
          icon={Activity}
          label={t("overview.siKilled")}
          value={whole.format(siKilled)}
          detail={t("overview.attributedDeaths")}
        />
        <StatCard
          icon={ShieldAlert}
          label={t("overview.survivorDeaths")}
          value={whole.format(survivorDeaths)}
          detail={t("overview.selectedRounds")}
        />
      </div>
      <div className="overview-summary-grid">
        <article className="panel winning-team-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">{t("overview.finalResult")}</span>
              <h3>{t("overview.winningTeam")}</h3>
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
                      {player.rating?.toFixed(2) ?? t("common.notAvailable")}
                      <small>L4DStats</small>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="muted">
              {winningTeam === "draw"
                ? t("overview.tied")
                : t("overview.winnerUnavailable")}
            </p>
          )}
        </article>
        <article className="panel map-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">{t("overview.demoSet")}</span>
              <h3>{t("overview.mapsAnalyzed")}</h3>
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
                      t("overview.unknownMap")}
                  </strong>
                  <span>
                    {duration(value.durationSeconds)} ·{" "}
                    {t("overview.observations", {
                      count: compact.format(value.observationCount),
                    })}
                  </span>
                </div>
                <b>
                  {value.tickRate?.toFixed(0) ?? t("common.notAvailable")}
                  <small> {t("overview.tick")}</small>
                </b>
                {analyses[index]?.jobId && (
                  <a
                    className="analysis-link"
                    href={`/analysis/${encodeURIComponent(analyses[index].jobId)}/overview`}
                    aria-label={t("overview.openAnalysis", {
                      map: analyses[index].engineResult.demo.mapName,
                    })}
                  >
                    {t("overview.open")} <ExternalLink />
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
            <span className="eyebrow">{t("overview.competitiveLeaders")}</span>
            <h3>{t("overview.matchAwards")}</h3>
          </div>
          <Crosshair />
        </div>
        <div className="award-grid">
          {competitiveAwards.map((award) => (
            <article key={award.label}>
              <header>
                <span>{award.label}</span>
                <HeaderHelp
                  label={t("overview.about")}
                  description={award.description}
                />
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
                  {award.id === "tankDamage" && !award.observed
                    ? t("overview.reanalyzeTank")
                    : award.observed
                      ? t("overview.noPositive")
                      : t("overview.unavailableSelected")}
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
  const { t, tx } = useI18n();
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
                {t("overview.halfLabel", { half: half.id })}
              </span>
              <b>
                {tx("ticks {start}–{end}", "ticks {start}–{end}", {
                  start: whole.format(half.tickRange.start),
                  end: whole.format(half.tickRange.end),
                })}
              </b>
            </div>
            <section>
              <h3>{t("overview.survivorSide")}</h3>
              {half.survivorPlayerIds.map((id) => (
                <span key={id}>{alias(id)}</span>
              ))}
            </section>
            <section>
              <h3>{t("overview.infectedSide")}</h3>
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
  const { t } = useI18n();
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
          <span className="eyebrow">{t("overview.roundProgression")}</span>
          <h3>{t("overview.campaignScore")}</h3>
        </div>
        <span className="score-legend">
          <i /> {t("overview.teamA")} <i /> {t("overview.teamB")}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={t("overview.scoreChart")}
      >
        <path className="score-a" d={path(0)} />
        <path className="score-b" d={path(1)} />
      </svg>
      <small>{t("overview.scoreChartHelp")}</small>
    </article>
  );
}

function DistanceProgression({
  points,
}: {
  points: NonNullable<NonNullable<DemoStats["match"]>["scoreTimeline"]>;
}) {
  const { t } = useI18n();
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
          <span className="eyebrow">{t("overview.survivorProgression")}</span>
          <h3>{t("overview.distance")}</h3>
        </div>
        <strong>
          {t("overview.units", { count: whole.format(maxDistance) })}
        </strong>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={t("overview.distanceChart")}
      >
        <path d={path} />
      </svg>
      <small>{t("overview.distanceHelp")}</small>
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
  const { t, tx } = useI18n();
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
    source: SourceKind;
    value: (player: PlayerStats) => string | number;
  }> = [
    {
      source: "event",
      roles: ["overall", "survivor"],
      label: tx("SI kills", "Bajas de IE"),
      description: tx(
        "Special Infected you killed while playing Survivor.",
        "Infectados especiales que eliminaste mientras jugabas como superviviente.",
      ),
      value: (player) =>
        player.specialInfectedKills ?? t("common.notAvailable"),
    },
    {
      source: "counter",
      roles: ["overall", "survivor"],
      label: tx("All infected kills", "Bajas de todos los infectados"),
      description: tx(
        "Total Common and Special Infected kills from the networked checkpoint counter. This is not a Common Infected total.",
        "Bajas totales de infectados comunes y especiales según el contador de checkpoint de red. No es un total exclusivo de infectados comunes.",
      ),
      value: (player) =>
        player.checkpointInfectedKills ?? t("common.notAvailable"),
    },
    {
      source: "event",
      roles: ["overall", "survivor"],
      label: tx("Surv deaths", "Muertes de superviviente"),
      description: tx(
        "Deaths recorded while this player was on the Survivor side.",
        "Muertes registradas mientras este jugador estaba en el bando superviviente.",
      ),
      value: (player) => player.survivorDeaths ?? t("common.notAvailable"),
    },
    {
      source: "counter",
      roles: ["overall", "survivor"],
      label: t("player.revives"),
      description: tx(
        "Incapacitated teammates this player helped back onto their feet.",
        "Compañeros incapacitados a quienes este jugador ayudó a levantarse.",
      ),
      value: (player) => player.revives ?? t("common.notAvailable"),
    },
    {
      source: "counter",
      roles: ["overall", "infected"],
      label: t("player.siIncaps"),
      description: tx(
        "Survivors this player incapacitated while controlling Special Infected.",
        "Supervivientes que este jugador incapacitó mientras controlaba infectados especiales.",
      ),
      value: (player) => player.specialIncaps ?? t("common.notAvailable"),
    },
    {
      source: "sampled",
      roles: ["overall", "infected"],
      label: t("player.pinTime"),
      description: tx(
        "Observed time actively controlling a Survivor with a tongue, pounce, ride, carry, or pummel.",
        "Tiempo observado controlando activamente a un superviviente con lengua, abalanzamiento, montura, carga o golpeo.",
      ),
      value: (player) =>
        player.pinSeconds === undefined
          ? t("common.notAvailable")
          : duration(player.pinSeconds),
    },
    {
      source: "event",
      roles: ["overall", "infected"],
      label: t("player.siDeaths"),
      description: tx(
        "Deaths recorded across this player's Special Infected lives.",
        "Muertes registradas durante las vidas de infectado especial de este jugador.",
      ),
      value: (player) => player.infectedDeaths ?? t("common.notAvailable"),
    },
    {
      source: "counter",
      roles: ["overall", "infected"],
      label: t("player.bestPounce"),
      description: tx(
        "Highest networked Hunter pounce-damage value observed in the demo.",
        "Mayor valor de daño de abalanzamiento de Hunter observado en la demo.",
      ),
      value: (player) => player.highestPounceDamage ?? t("common.notAvailable"),
    },
    {
      source: "derived",
      roles: ["overall"],
      label: tx("Tracked", "Seguimiento"),
      description: tx(
        "How long this player epoch was reconstructed from network snapshots.",
        "Duración durante la cual se reconstruyó esta época del jugador a partir de capturas de red.",
      ),
      value: (player) => duration(player.durationSeconds),
    },
    {
      source: "derived",
      roles: ["overall"],
      label: tx("Signals", "Señales"),
      description: tx(
        "Detector windows marked for human review. Signals are not cheating verdicts.",
        "Ventanas del detector marcadas para revisión humana. Las señales no son veredictos de trampas.",
      ),
      value: (player) => player.evidenceWindows || t("common.notAvailable"),
    },
  ];
  const visibleColumns = statColumns.filter((column) =>
    column.roles.includes(roleScope),
  );
  return (
    <div className="tab-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">
            {tx("Player breakdown", "Desglose de jugadores")}
          </span>
          <h2>
            {tx(
              players.length === 1 ? "1 player" : "{count} players",
              players.length === 1 ? "1 jugador" : "{count} jugadores",
              { count: players.length },
            )}
          </h2>
        </div>
        <span className="muted">
          {tx(
            "Embedded Steam identities when available, aliases otherwise",
            "Identidades de Steam integradas cuando están disponibles; alias en caso contrario",
          )}
        </span>
      </div>
      <div className="player-scope-bar">
        <div>
          <span>{tx("Role", "Rol")}</span>
          {(["overall", "survivor", "infected"] as const).map((role) => (
            <button
              type="button"
              key={role}
              className={roleScope === role ? "active" : ""}
              aria-pressed={roleScope === role}
              onClick={() => setRoleScope(role)}
            >
              {role === "overall"
                ? tx("overall", "general")
                : role === "survivor"
                  ? tx("survivor", "superviviente")
                  : tx("infected", "infectado")}
            </button>
          ))}
        </div>
        <div>
          <span>{t("player.map")}</span>
          <button
            type="button"
            className={mapScope === "all" ? "active" : ""}
            aria-pressed={mapScope === "all"}
            onClick={() => setMapScope("all")}
          >
            {tx("All maps", "Todos los mapas")}
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
              <th>{tx("Player", "Jugador")}</th>
              <th>
                <HeaderHelp
                  label={tx("Rating", "Puntuación")}
                  description={tx(
                    "Experimental selected-game L4DStats Match Rating. Overall requires eligible Survivor and Infected role scores.",
                    "Puntuación experimental L4DStats de la partida seleccionada. La puntuación general requiere resultados válidos de los roles de superviviente e infectado.",
                  )}
                />
              </th>
              {visibleColumns.map((column) => (
                <th key={column.label}>
                  <HeaderHelp
                    label={column.label}
                    description={column.description}
                    source={column.source}
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
                        <small
                          title={tx(
                            "The entity slot exposed one unique human identity later in this demo.",
                            "La ranura de entidad mostró una única identidad humana más adelante en esta demo.",
                          )}
                        >
                          {tx(
                            "identity inferred from unique demo slot",
                            "identidad inferida de una ranura única de la demo",
                          )}
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
                      return value == null
                        ? t("common.notAvailable")
                        : value.toFixed(2);
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
            <strong>
              {tx("Map and round detail", "Detalle de mapas y rondas")}
            </strong>
            <small>
              {tx(
                "Rosters, per-half scoreboards, loadouts, ammo and health traces",
                "Plantillas, marcadores por mitad, equipamiento y trazas de munición y salud",
              )}
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
  const { locale, t, tx } = useI18n();
  const ranked = [...ratings.players].sort(
    (left, right) =>
      (right.rating ?? Number.NEGATIVE_INFINITY) -
        (left.rating ?? Number.NEGATIVE_INFINITY) ||
      right.coverage - left.coverage ||
      left.playerAlias.localeCompare(right.playerAlias),
  );
  const score = (value: number | null) =>
    value === null ? t("common.notAvailable") : value.toFixed(2);
  return (
    <section
      className="rating-section"
      aria-label={tx(
        "L4DStats player ratings",
        "Puntuaciones de jugadores de L4DStats",
      )}
    >
      <div className="rating-intro">
        <div>
          <span className="eyebrow">
            {tx(
              "Experimental match model v0.2",
              "Modelo experimental de partida v0.2",
            )}
          </span>
          <h3>
            {tx("L4DStats Rating", "Puntuación L4DStats")}{" "}
            <SourceBadge kind="derived" />
          </h3>
        </div>
        <p>
          {tx(
            "A 1.00-neutral, selected-game performance index. Survivor and Infected contribution are rated separately, opportunity-normalized, shrunk toward neutral for short samples, then combined 50/50 only when both roles qualify. It is not career skill or win probability.",
            "Un índice de rendimiento de la partida seleccionada con 1,00 como valor neutral. Las contribuciones como superviviente e infectado se puntúan por separado, se normalizan por oportunidad, se acercan al valor neutral en muestras cortas y solo se combinan al 50 % cuando ambos roles cumplen los requisitos. No mide la habilidad histórica ni la probabilidad de victoria.",
          )}
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
                  {tx(
                    "{confidence} confidence · {coverage} model coverage",
                    "confianza {confidence} · {coverage} de cobertura del modelo",
                    {
                      confidence: player.confidence,
                      coverage: pct(player.coverage),
                    },
                  )}
                </small>
              </span>
              <b>{score(player.rating)}</b>
              <ChevronDown />
            </summary>
            <div className="rating-detail">
              {[player.survivor, player.infected].map((role) => (
                <section key={role.role}>
                  <header>
                    <span>
                      {role.role === "survivor"
                        ? tx("survivor", "superviviente")
                        : tx("infected", "infectado")}
                    </span>
                    <b>{score(role.score)}</b>
                    <small>
                      {tx("{coverage} coverage", "{coverage} de cobertura", {
                        coverage: pct(role.coverage),
                      })}
                    </small>
                  </header>
                  {role.pillars.map((pillar) => (
                    <div className="rating-pillar" key={pillar.name}>
                      <span>
                        {localizeRatingCopy(pillar.name, locale)}
                        <b>
                          {pillar.score.toFixed(2)} · {pct(pillar.coverage)}
                        </b>
                      </span>
                      <ul>
                        {pillar.metrics.map((metric) => (
                          <li key={metric.key}>
                            <span>
                              {localizeRatingCopy(metric.label, locale)}
                              <small>
                                {localizeRatingCopy(metric.source, locale)}
                              </small>
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
                      {tx(
                        "Role rating withheld: requires sufficient opportunity, at least two pillars and 70% planned coverage.",
                        "Puntuación del rol retenida: requiere suficientes oportunidades, al menos dos pilares y un 70 % de cobertura prevista.",
                      )}
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
          {tx(
            "Formula, scientific status and limitations",
            "Fórmula, estado científico y limitaciones",
          )}{" "}
          <ChevronDown />
        </summary>
        <div>
          <p>
            {tx(
              "Every metric is expressed per relevant opportunity, compared with observed peers, capped to limit outliers, and shrunk by exposure. Missing telemetry is omitted and weights are renormalized visibly. This experimental game-relative baseline will be replaced by a frozen external cohort only after enough comparable games exist.",
              "Cada métrica se expresa por oportunidad relevante, se compara con los jugadores observados, se limita para reducir valores atípicos y se ajusta según la exposición. La telemetría ausente se omite y los pesos se normalizan de nuevo de forma visible. Esta referencia experimental relativa a la partida se sustituirá por una cohorte externa congelada cuando existan suficientes partidas comparables.",
            )}
          </p>
          <ul>
            {ratings.limitations.map((limitation) => (
              <li key={limitation}>{localizeRatingCopy(limitation, locale)}</li>
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
  const { tx } = useI18n();
  const demos = stats.flatMap((demo, index) =>
    demo.competitive?.rosters?.length
      ? [
          {
            demo,
            index,
            rosters: demo.competitive.rosters,
            mapName:
              analyses[index]?.engineResult.demo.mapName ??
              tx("Map {number}", "Mapa {number}", { number: index + 1 }),
          },
        ]
      : [],
  );
  if (!demos.length) return null;
  return (
    <section className="roster-reconstruction">
      <div className="scoreboard-explainer">
        <div>
          <span className="eyebrow">
            {tx("Neutral rosters", "Plantillas neutrales")}
          </span>
          <h3>
            {tx(
              "Side-swap reconstruction",
              "Reconstrucción del cambio de bando",
            )}{" "}
            <SourceBadge kind="derived" />
          </h3>
        </div>
        <p>
          {tx(
            "Roster A starts from the earliest observed Survivor side and Roster B from the opposing side. Membership is followed through the swap. These neutral labels are not engine Team A or Team B score indices.",
            "La plantilla A parte del primer bando superviviente observado y la plantilla B del bando opuesto. La pertenencia se sigue durante el cambio. Estas etiquetas neutrales no son los índices de puntuación Equipo A o Equipo B del motor.",
          )}
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
                    {tx("Roster {id}", "Plantilla {id}", { id: roster.id })}
                    <small>
                      {roster.confidence === "high"
                        ? tx("high", "alta")
                        : tx("provisional", "provisional")}
                    </small>
                  </h4>
                  <p>
                    {roster.playerIds
                      .map(
                        (id) =>
                          demo.players.find((player) => player.id === id)
                            ?.alias ?? id.slice(0, 8),
                      )
                      .join(" · ") ||
                      tx("Membership unavailable", "Pertenencia no disponible")}
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
  const { tx } = useI18n();
  const maps = stats.flatMap((demo, demoIndex) => {
    const traces = demo.survivorLoadoutTraces ?? [];
    const ammoTraces = demo.survivorAmmoTraces ?? [];
    return traces.length || ammoTraces.length
      ? [
          {
            mapName:
              analyses[demoIndex]?.engineResult.demo.mapName ??
              tx("Map {number}", "Mapa {number}", { number: demoIndex + 1 }),
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
    value === undefined
      ? tx("Unavailable", "No disponible")
      : value === null
        ? tx("Empty", "Vacío")
        : value.name;
  return (
    <section className="loadout-section">
      <div className="scoreboard-explainer">
        <div>
          <span className="eyebrow">
            {tx("Survivor resources", "Recursos de supervivientes")}
          </span>
          <h3>
            {tx("Networked loadouts", "Equipamiento de red")}{" "}
            <SourceBadge kind="sampled" />
          </h3>
        </div>
        <p>
          {tx(
            "Primary, first-aid and temporary-health slots come directly from the player-resource entity. A change proves observed possession changed, but does not prove who supplied an item or why it disappeared.",
            "Las ranuras de arma principal, primeros auxilios y salud temporal proceden directamente de la entidad de recursos del jugador. Un cambio demuestra que cambió la posesión observada, pero no quién proporcionó un objeto ni por qué desapareció.",
          )}
        </p>
      </div>
      <div className="loadout-maps">
        {maps.map((map, mapIndex) => (
          <article key={`${map.mapName}-${mapIndex}`}>
            <header>
              <div>
                <span className="eyebrow">
                  {tx("Map {number}", "Mapa {number}", {
                    number: mapIndex + 1,
                  })}
                </span>
                <h3>{map.mapName}</h3>
              </div>
              <span>
                {tx(
                  "{count} Survivor loadouts",
                  "{count} equipamientos de superviviente",
                  { count: map.traces.length },
                )}
              </span>
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
                        {tx(
                          trace.points.length === 1
                            ? "1 observed state"
                            : "{count} observed states",
                          trace.points.length === 1
                            ? "1 estado observado"
                            : "{count} estados observados",
                          { count: trace.points.length },
                        )}
                      </small>
                    </div>
                    <dl>
                      <div>
                        <dt>{tx("Primary", "Principal")}</dt>
                        <dd>{itemName(last?.primaryWeapon)}</dd>
                      </div>
                      <div>
                        <dt>{tx("First aid", "Primeros auxilios")}</dt>
                        <dd>{itemName(last?.firstAid)}</dd>
                      </div>
                      <div>
                        <dt>{tx("Temp health", "Salud temporal")}</dt>
                        <dd>{itemName(last?.temporaryHealth)}</dd>
                      </div>
                    </dl>
                    <div className="loadout-coverage">
                      <span>
                        {tx("{value} primary", "{value} principal", {
                          value: pct(trace.coverage.primaryWeapon),
                        })}
                      </span>
                      <span>
                        {tx("{value} aid", "{value} auxilios", {
                          value: pct(trace.coverage.firstAid),
                        })}
                      </span>
                      <span>
                        {tx("{value} temp", "{value} temporal", {
                          value: pct(trace.coverage.temporaryHealth),
                        })}
                      </span>
                    </div>
                    {ammo && latestAmmo && (
                      <div className="ammo-state">
                        <div>
                          <span>
                            {tx(
                              "Sampled active ammo",
                              "Munición activa muestreada",
                            )}
                          </span>
                          <strong>
                            {latestAmmo.clip ?? "?"} /{" "}
                            {latestAmmo.reserve ?? "?"}
                          </strong>
                          <small>
                            {tx("{value} coverage", "{value} de cobertura", {
                              value: pct(ammo.coverage),
                            })}
                          </small>
                        </div>
                        <svg
                          viewBox={`0 0 ${Math.max(1, ammoValues.length - 1)} 24`}
                          preserveAspectRatio="none"
                          role="img"
                          aria-label={tx(
                            "Sampled total clip and reserve ammo over time",
                            "Munición total muestreada en cargador y reserva a lo largo del tiempo",
                          )}
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
                          {itemName(first?.primaryWeapon)} {tx("to", "a")}{" "}
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
        {tx(
          "Ammo is sampled network state. Drops can include firing, reloads, weapon swaps or discarded weapons, so this view does not infer shots, hits or accuracy.",
          "La munición es un estado de red muestreado. Las disminuciones pueden deberse a disparos, recargas, cambios o armas descartadas; por eso esta vista no infiere disparos, impactos ni precisión.",
        )}
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
  const { tx } = useI18n();
  const demos = stats.flatMap((demo, index) =>
    demo.survivorHealthTraces?.length
      ? [
          {
            index,
            duration: Math.max(1, demo.durationSeconds),
            traces: demo.survivorHealthTraces,
            mapName:
              analyses[index]?.engineResult.demo.mapName ??
              tx("Demo {number}", "Demo {number}", { number: index + 1 }),
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
    <section
      className="health-traces"
      aria-label={tx(
        "Sampled Survivor health",
        "Salud muestreada de supervivientes",
      )}
    >
      <div className="scoreboard-explainer">
        <div>
          <span className="eyebrow">
            {tx("Survivor state", "Estado de supervivientes")}
          </span>
          <h3>
            {tx("Sampled health traces", "Trazas de salud muestreadas")}{" "}
            <SourceBadge kind="sampled" />
          </h3>
        </div>
        <p>
          {tx(
            "Green is permanent health. Blue is the raw networked temporary-health buffer, not calculated effective health. Sampling can miss changes, so these traces are lower-bound review evidence, not damage attribution.",
            "El verde representa salud permanente. El azul es el búfer bruto de salud temporal de red, no la salud efectiva calculada. El muestreo puede omitir cambios, así que estas trazas son evidencia mínima para revisión, no atribución de daño.",
          )}
        </p>
      </div>
      {demos.map((demo) => (
        <article className="panel health-trace-card" key={demo.index}>
          <header>
            <div>
              <span className="eyebrow">
                {tx("Map {number}", "Mapa {number}", {
                  number: demo.index + 1,
                })}
              </span>
              <h3>{demo.mapName}</h3>
            </div>
            <span>
              <i className="health-key permanent" />{" "}
              {tx("permanent", "permanente")}
              <i className="health-key buffer" />{" "}
              {tx("raw buffer", "búfer bruto")}
              <i className="health-key incap" /> {tx("incap", "incapacitación")}
            </span>
          </header>
          <div className="health-trace-scroll">
            <svg
              viewBox={`0 0 ${width} ${demo.traces.length * rowHeight}`}
              role="img"
              aria-label={tx(
                "Sampled Survivor health on {map}",
                "Salud muestreada de supervivientes en {map}",
                { map: demo.mapName },
              )}
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
                        aria-label={tx(
                          "View {player} incap at tick {tick} on timeline",
                          "Ver la incapacitación de {player} en el tick {tick} en la cronología",
                          { player: trace.playerAlias, tick: point.tick },
                        )}
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
                          {tx(
                            "{player}, incap at tick {tick}",
                            "{player}, incapacitación en el tick {tick}",
                            {
                              player: trace.playerAlias,
                              tick: whole.format(point.tick),
                            },
                          )}
                        </title>
                      </circle>
                    ))}
                  <title>
                    {tx(
                      "{player}: {health} health coverage, {buffer} buffer coverage, {samples} source samples",
                      "{player}: {health} de cobertura de salud, {buffer} de cobertura de búfer, {samples} muestras de origen",
                      {
                        player: trace.playerAlias,
                        health: pct(trace.healthCoverage),
                        buffer: pct(trace.bufferCoverage),
                        samples: whole.format(trace.sourceSamples),
                      },
                    )}
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
  const { tx } = useI18n();
  const help = (
    label: string,
    labelEs: string,
    description: string,
    descriptionEs: string,
  ) => {
    const derived = new Set(["Tank share", "Controls", "Lives"]);
    const sampled = new Set(["Pin time"]);
    return (
      <HeaderHelp
        label={tx(label, labelEs)}
        description={tx(description, descriptionEs)}
        source={
          derived.has(label)
            ? "derived"
            : sampled.has(label)
              ? "sampled"
              : "counter"
        }
      />
    );
  };
  const records = stats.flatMap((demo, demoIndex) =>
    (demo.competitive?.halves ?? []).map((half) => ({
      demo,
      demoIndex,
      half,
      mapName:
        analyses[demoIndex]?.engineResult.demo.mapName ??
        tx("Map {number}", "Mapa {number}", { number: demoIndex + 1 }),
    })),
  );
  if (!records.length) return null;
  return (
    <section
      className="half-scoreboards"
      aria-label={tx("Per-half scoreboards", "Marcadores por mitad")}
    >
      <div className="scoreboard-explainer">
        <div>
          <span className="eyebrow">
            {tx("Competitive split", "División competitiva")}
          </span>
          <h3>
            {tx(
              "Reset-aware half scoreboards",
              "Marcadores por mitad con reinicios",
            )}
          </h3>
        </div>
        <p>
          {tx(
            "Values are positive deltas from networked engine counters inside each half. They do not carry across a side swap or counter reset.",
            "Los valores son incrementos positivos de los contadores de red del motor dentro de cada mitad. No se trasladan a través de un cambio de bando ni de un reinicio de contadores.",
          )}
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
                    ? tx("recorded second half", "segunda mitad registrada")
                    : half.secondHalf === false
                      ? tx("recorded first half", "primera mitad registrada")
                      : tx("half unknown", "mitad desconocida")}
                </span>
                <h3>
                  {half.id === "unknown"
                    ? tx("Observed segment", "Segmento observado")
                    : tx("{half} half", "mitad {half}", {
                        half: `${half.id[0]?.toUpperCase()}${half.id.slice(1)}`,
                      })}
                </h3>
              </div>
              <span>
                {tx("ticks {start} to {end}", "ticks {start} a {end}", {
                  start: whole.format(half.tickRange.start),
                  end: whole.format(half.tickRange.end),
                })}
              </span>
            </header>
            {survivorRows.length > 0 && (
              <div className="side-scoreboard">
                <h4>{tx("Survivor output", "Resultado de supervivientes")}</h4>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{tx("Player", "Jugador")}</th>
                        <th>
                          {help(
                            "Tank damage",
                            "Daño al Tank",
                            "Damage to Tank reported by the engine checkpoint counter during this half.",
                            "Daño al Tank indicado por el contador de checkpoint del motor durante esta mitad.",
                          )}
                        </th>
                        <th>
                          {help(
                            "Tank share",
                            "Proporción de Tank",
                            "This player's share of the four-person Tank-damage total. Hidden when roster coverage is incomplete.",
                            "Proporción de este jugador en el daño total al Tank de los cuatro integrantes. Se oculta cuando la cobertura de la plantilla está incompleta.",
                          )}
                        </th>
                        <th>
                          {help(
                            "Witch damage",
                            "Daño a la Witch",
                            "Damage to Witch reported by the engine checkpoint counter during this half.",
                            "Daño a la Witch indicado por el contador de checkpoint del motor durante esta mitad.",
                          )}
                        </th>
                        <th>
                          {help(
                            "Damage taken",
                            "Daño recibido",
                            "Damage received reported by the engine checkpoint counter. This is distinct from sampled health loss.",
                            "Daño recibido indicado por el contador de checkpoint del motor. Es distinto de la pérdida de salud muestreada.",
                          )}
                        </th>
                        <th>
                          {help(
                            "Medkits",
                            "Botiquines",
                            "First-aid kits used during this half.",
                            "Botiquines utilizados durante esta mitad.",
                          )}
                        </th>
                        <th>
                          {help(
                            "Pills + adren",
                            "Píldoras + adrenalina",
                            "Pain pills and adrenaline used during this half.",
                            "Píldoras analgésicas y adrenalina utilizadas durante esta mitad.",
                          )}
                        </th>
                        <th>
                          {help(
                            "Throws",
                            "Arrojadizos",
                            "Molotovs, pipe bombs, and Boomer bile jars used during this half.",
                            "Cócteles molotov, bombas caseras y frascos de bilis utilizados durante esta mitad.",
                          )}
                        </th>
                        <th>
                          {help(
                            "Defibs",
                            "Desfibriladores",
                            "Defibrillators used according to the engine checkpoint counter.",
                            "Desfibriladores utilizados según el contador de checkpoint del motor.",
                          )}
                        </th>
                        <th>
                          {help(
                            "Aid shared",
                            "Ayuda compartida",
                            "First-aid items shared according to the engine checkpoint counter.",
                            "Objetos de primeros auxilios compartidos según el contador de checkpoint del motor.",
                          )}
                        </th>
                        <th>
                          {help(
                            "Melee kills",
                            "Bajas cuerpo a cuerpo",
                            "Melee kills reported by the engine checkpoint counter.",
                            "Bajas cuerpo a cuerpo indicadas por el contador de checkpoint del motor.",
                          )}
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
                <h4>{tx("Infected output", "Resultado de infectados")}</h4>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{tx("Player", "Jugador")}</th>
                        <th>
                          {help(
                            "Damage",
                            "Daño",
                            "Sum of positive class-specific infected damage-counter deltas during this half.",
                            "Suma de los incrementos positivos de los contadores de daño específicos de cada clase infectada durante esta mitad.",
                          )}
                        </th>
                        <th>
                          {help(
                            "Incaps",
                            "Incapacitaciones",
                            "Survivor incapacitations reported by the infected checkpoint counter during this half.",
                            "Incapacitaciones de supervivientes indicadas por el contador de checkpoint infectado durante esta mitad.",
                          )}
                        </th>
                        <th>
                          {help(
                            "Controls",
                            "Controles",
                            "Observed pin controls across reconstructed Special Infected lives in this half.",
                            "Controles de inmovilización observados en las vidas reconstruidas de infectados especiales durante esta mitad.",
                          )}
                        </th>
                        <th>
                          {help(
                            "Lives",
                            "Vidas",
                            "Reconstructed spawned Special Infected lives whose start falls inside this half.",
                            "Vidas reconstruidas de infectados especiales cuyo inicio se encuentra dentro de esta mitad.",
                          )}
                        </th>
                        <th>
                          {help(
                            "Pin time",
                            "Tiempo inmovilizando",
                            "Observed seconds spent actively controlling a Survivor across those lives.",
                            "Segundos observados controlando activamente a un superviviente durante esas vidas.",
                          )}
                        </th>
                        <th>
                          {help(
                            "Tank actions",
                            "Acciones de Tank",
                            "Registered Tank punches and rock throws. A registered throw does not prove a rock hit.",
                            "Puñetazos y lanzamientos de roca de Tank registrados. Un lanzamiento registrado no demuestra que la roca impactara.",
                          )}
                        </th>
                        <th>
                          {help(
                            "Pulls",
                            "Arrastres",
                            "Smoker pull and hang actions reported by engine checkpoint counters.",
                            "Acciones de arrastre y ahorcamiento de Smoker indicadas por los contadores de checkpoint del motor.",
                          )}
                        </th>
                        <th>
                          {help(
                            "Booms",
                            "Vómitos",
                            "Boomer bomb and vomit actions reported by engine checkpoint counters.",
                            "Acciones de bomba y vómito de Boomer indicadas por los contadores de checkpoint del motor.",
                          )}
                        </th>
                        <th>
                          {help(
                            "Charges",
                            "Cargas",
                            "Charge victims reported by the engine checkpoint counter.",
                            "Víctimas de carga indicadas por el contador de checkpoint del motor.",
                          )}
                        </th>
                        <th>
                          {help(
                            "Pushes",
                            "Empujones",
                            "Survivor pushes received while infected, as reported by the engine checkpoint counter.",
                            "Empujones recibidos de supervivientes mientras se jugaba como infectado, según el contador de checkpoint del motor.",
                          )}
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
                                ].join(", ") ||
                                  tx(
                                    "No reconstructed life",
                                    "Sin vida reconstruida",
                                  )}
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
                {tx(
                  "This older artifact has half boundaries but no per-half player counters. Reanalyze the demo to populate this scoreboard.",
                  "Este artefacto antiguo contiene límites de mitad, pero no contadores de jugadores por mitad. Vuelve a analizar la demo para completar este marcador.",
                )}
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
  source,
}: {
  label: string;
  description: string;
  source?: SourceKind;
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
  const { tx } = useI18n();
  const descriptions: Record<SourceKind, string> = {
    observed: tx(
      "Direct network property or game-event evidence",
      "Evidencia directa de propiedad de red o evento del juego",
    ),
    event: tx(
      "Direct game-event payload",
      "Contenido directo de evento del juego",
    ),
    counter: tx(
      "Direct networked engine counter",
      "Contador de red directo del motor",
    ),
    sampled: tx(
      "Bounded network-state samples that can miss intermediate changes",
      "Muestras acotadas del estado de red que pueden omitir cambios intermedios",
    ),
    derived: tx(
      "Deterministic computation from retained observations",
      "Cálculo determinista a partir de observaciones conservadas",
    ),
    unavailable: tx(
      "Not present or not validated in this demo",
      "No presente o no validado en esta demo",
    ),
  };
  const labels: Record<SourceKind, string> = {
    observed: tx("observed", "observado"),
    event: tx("event", "evento"),
    counter: tx("counter", "contador"),
    sampled: tx("sampled", "muestreado"),
    derived: tx("derived", "derivado"),
    unavailable: tx("unavailable", "no disponible"),
  };
  return (
    <span
      className={`source-badge ${kind}`}
      title={detail ?? descriptions[kind]}
      aria-label={`${labels[kind]}: ${detail ?? descriptions[kind]}`}
    >
      {labels[kind]}
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
  const { tx } = useI18n();
  if (!demoSha256) return null;
  return (
    <button
      type="button"
      className="tick-link"
      onClick={() => onOpenTimeline(demoSha256, tick)}
      aria-label={tx(
        "View tick {tick} on timeline",
        "Ver el tick {tick} en la cronología",
        { tick },
      )}
    >
      {tx("tick {tick}", "tick {tick}", { tick: whole.format(tick) })}{" "}
      <ExternalLink />
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
  const { t, tx } = useI18n();
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
          <span className="eyebrow">
            {tx("Combat scoreboard", "Marcador de combate")}
          </span>
          <h2>{tx("Who killed what, and how", "Quién eliminó qué y cómo")}</h2>
        </div>
      </div>
      <div className="metric-grid combat-metrics compact-mobile-metrics">
        <StatCard
          icon={Crosshair}
          label={tx("SI killed", "IE eliminados")}
          value={whole.format(total("specialInfectedDeaths"))}
          detail={tx("player_death events", "eventos player_death")}
        />
        <StatCard
          icon={ShieldAlert}
          label={t("overview.survivorDeaths")}
          value={whole.format(total("survivorDeaths"))}
          detail={tx("both Versus halves", "ambas mitades de Versus")}
        />
        <StatCard
          icon={Activity}
          label={tx("Tanks killed", "Tanks eliminados")}
          value={whole.format(total("tankDeaths"))}
          detail={tx("observed deaths", "muertes observadas")}
        />
        <StatCard
          icon={ShieldAlert}
          label={tx("Witches killed", "Witches eliminadas")}
          value={whole.format(total("witchDeaths"))}
          detail={tx("observed deaths", "muertes observadas")}
        />
      </div>
      <div className="combat-grid">
        <Breakdown
          title={tx(
            "Special Infected deaths",
            "Muertes de infectados especiales",
          )}
          rows={classes}
        />
        <Breakdown
          title={tx("Kill weapons", "Armas de eliminación")}
          rows={weapons}
        />
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
              label={tx("Inferred SI hits", "Ataques de IE inferidos")}
              value={whole.format(allHits.length)}
              detail={tx(
                "spawn-gap clusters, not intent",
                "grupos por intervalo de aparición, no intención",
              )}
            />
            <StatCard
              icon={Activity}
              label={tx("SI lives", "Vidas de IE")}
              value={whole.format(lives.length)}
              detail={tx("{count} controls", "{count} controles", {
                count: lives.reduce((sum, life) => sum + life.controls, 0),
              })}
            />
            <StatCard
              icon={ShieldAlert}
              label={tx("Narrow clears", "Liberaciones ajustadas")}
              value={whole.format(
                clears.reduce(
                  (sum, player) => sum + player.deathCorrelatedClears,
                  0,
                ),
              )}
              detail={tx(
                "death-correlated only",
                "solo correlacionadas con muertes",
              )}
            />
            <StatCard
              icon={Activity}
              label={tx("Tank controls", "Controles de Tank")}
              value={whole.format(allTanks.length)}
              detail={tx("{count} punches", "{count} puñetazos", {
                count: allTanks.reduce(
                  (sum, { tank }) => sum + tank.punches,
                  0,
                ),
              })}
            />
          </div>
          <div className="competitive-grid">
            <article className="panel hit-board">
              <span className="eyebrow">
                {tx("Infected coordination", "Coordinación de infectados")}
              </span>
              <h3>
                {tx("Hit clusters", "Grupos de ataques")}{" "}
                <SourceBadge kind="derived" />
              </h3>
              {hits.map(({ hit, demoIndex, derivationVersion }, index) => (
                <div
                  className={index >= 8 && !showAllHits ? "hit-row-hidden" : ""}
                  key={`${index}:${hit.id}`}
                >
                  <time>
                    {tx("ticks {start}–{end}", "ticks {start}–{end}", {
                      start: whole.format(hit.tickRange.start),
                      end: whole.format(hit.tickRange.end),
                    })}
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
                        title={tx(
                          "Maximum observed team permanent-health drawdown in the bounded hit window; damage source is not attributable",
                          "Máxima reducción observada de salud permanente del equipo en la ventana acotada; la fuente del daño no es atribuible",
                        )}
                      >
                        -{whole.format(hit.observedSurvivorHealthLoss)}{" "}
                        {tx("team HP", "PV del equipo")}
                      </b>
                    ) : derivationVersion >= 6 ? (
                      <b className="hp-loss-pill hp-loss-low">
                        {tx("HP unavailable", "PV no disponibles")}
                      </b>
                    ) : (
                      <b className="hp-loss-pill hp-loss-low">
                        {tx(
                          "reanalyze for HP",
                          "volver a analizar para obtener PV",
                        )}
                      </b>
                    )}
                  </strong>
                  <span className="hit-cluster-summary">
                    <span>
                      {tx(
                        "{controls} controls · {pins} simultaneous · {spread}s spawn spread",
                        "{controls} controles · {pins} simultáneos · {spread}s de dispersión de aparición",
                        {
                          controls: hit.controls,
                          pins: hit.peakSimultaneousPins,
                          spread: hit.spawnSpreadSeconds.toFixed(1),
                        },
                      )}
                    </span>
                    <small>
                      {derivationVersion >= 6 && hit.survivorHealthSamples >= 2
                        ? tx(
                            "Maximum contiguous permanent-health drawdown per upright Survivor across {samples} state samples in this bounded hit window. Healing is not counted twice and team loss is capped at 400 HP. The demo does not identify the damage source, so commons, friendly fire, falls, and other damage may contribute.",
                            "Máxima reducción continua de salud permanente por superviviente en pie a lo largo de {samples} muestras de estado en esta ventana acotada. La curación no se cuenta dos veces y la pérdida del equipo se limita a 400 PV. La demo no identifica la fuente del daño, por lo que pueden contribuir infectados comunes, fuego amigo, caídas y otros daños.",
                            {
                              samples: whole.format(hit.survivorHealthSamples),
                            },
                          )
                        : derivationVersion >= 6
                          ? tx(
                              "No adjacent upright Survivor health samples cover this window.",
                              "No hay muestras adyacentes de salud de supervivientes en pie que cubran esta ventana.",
                            )
                          : tx(
                              "Legacy HP could double-count repeated loss or include invalid cluster windows and incap health. Reanalyze before using it.",
                              "Los PV antiguos podrían contar dos veces pérdidas repetidas o incluir ventanas no válidas y salud de incapacitación. Vuelve a analizar antes de utilizarlos.",
                            )}
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
                    ? tx(
                        "Show highest-impact clusters only",
                        "Mostrar solo los grupos de mayor impacto",
                      )
                    : tx(
                        "Show {count} more clusters",
                        "Mostrar {count} grupos más",
                        { count: hits.length - 8 },
                      )}
                  <ChevronDown />
                </button>
              )}
            </article>
            <article className="panel tank-board">
              <span className="eyebrow">
                {tx("Tank encounters", "Encuentros con Tank")}
              </span>
              <h3>
                {tx("Control and outcome", "Control y resultado")}{" "}
                <SourceBadge kind="derived" />
              </h3>
              {tanks.map(({ tank, demoIndex }, index) => (
                <div key={`${index}:${tank.id}`}>
                  <strong>
                    {tank.controllerAlias}
                    <small>
                      {analyses[demoIndex]?.engineResult.demo.mapName ??
                        tx("Map {number}", "Mapa {number}", {
                          number: demoIndex + 1,
                        })}
                    </small>
                  </strong>
                  <span>
                    {tx(
                      "{duration} · {punches} punches · {throws} throws · {incaps} incaps · {deaths} deaths",
                      "{duration} · {punches} puñetazos · {throws} lanzamientos · {incaps} incapacitados · {deaths} muertes",
                      {
                        duration: duration(tank.durationSeconds),
                        punches: tank.punches,
                        throws: tank.registeredRockThrows,
                        incaps: tank.survivorIncaps,
                        deaths: tank.survivorDeaths,
                      },
                    )}
                  </span>
                  <span>
                    {tank.damageDealt == null
                      ? tx(
                          "Tank damage unavailable",
                          "Daño de Tank no disponible",
                        )
                      : tx(
                          "{value} damage dealt",
                          "{value} de daño infligido",
                          {
                            value: whole.format(tank.damageDealt),
                          },
                        )}{" "}
                    ·{" "}
                    {tank.damageTaken == null
                      ? tx(
                          "damage taken unavailable",
                          "daño recibido no disponible",
                        )
                      : tx("{value} damage taken", "{value} de daño recibido", {
                          value: whole.format(tank.damageTaken),
                        })}
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
                        {tx(
                          "observed Tank HP lost, attacker unavailable",
                          "PV de Tank perdidos observados; atacante no disponible",
                        )}
                      </small>
                    )}
                  <b>
                    {tank.healthAtTake ?? t("common.notAvailable")} →{" "}
                    {tank.healthAtEnd ??
                      tank.lowestObservedHealth ??
                      t("common.notAvailable")}{" "}
                    {tx("HP", "PV")}
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
              <span className="eyebrow">
                {tx("Witch encounters", "Encuentros con Witch")}
              </span>
              <h3>
                {tx(
                  "Rage, fire, and observed outcome",
                  "Furia, fuego y resultado observado",
                )}{" "}
                <SourceBadge kind="sampled" />
              </h3>
            </div>
            <AlertCircle />
          </div>
          <p className="muted">
            {tx(
              "Rage, burning state, and entity lifetime are direct network observations. A death outcome is correlated by tick. Crown, startler, target, world position, and attacker-attributed damage remain unavailable.",
              "La furia, el estado en llamas y la vida de la entidad son observaciones directas de red. Un resultado de muerte se correlaciona por tick. Crown, quién la asustó, objetivo, posición y daño atribuido al atacante siguen sin estar disponibles.",
            )}
          </p>
          <div className="witch-encounter-list">
            {witches.map(({ witch, demoIndex }, index) => (
              <div key={`${index}:${witch.id}`}>
                <span>
                  {tx("ticks {start} to {end}", "ticks {start} a {end}", {
                    start: whole.format(witch.tickRange.start),
                    end: whole.format(witch.tickRange.end),
                  })}
                </span>
                <strong>
                  {witch.endReason === "death-correlated"
                    ? tx("Death correlated", "Muerte correlacionada")
                    : tx("Outcome unresolved", "Resultado sin resolver")}
                </strong>
                <dl>
                  <div>
                    <dt>{tx("Peak rage", "Furia máxima")}</dt>
                    <dd>
                      {witch.peakRage === null
                        ? t("common.notAvailable")
                        : witch.peakRage.toFixed(2)}
                    </dd>
                  </div>
                  <div>
                    <dt>{tx("Enraged", "Enfurecida")}</dt>
                    <dd>
                      {witch.enragedTick === null
                        ? tx("not observed", "no observado")
                        : tx("tick {tick}", "tick {tick}", {
                            tick: whole.format(witch.enragedTick),
                          })}
                    </dd>
                  </div>
                  <div>
                    <dt>{tx("Burning", "En llamas")}</dt>
                    <dd>
                      {witch.burningTick === null
                        ? tx("not observed", "no observado")
                        : tx("tick {tick}", "tick {tick}", {
                            tick: whole.format(witch.burningTick),
                          })}
                    </dd>
                  </div>
                  <div>
                    <dt>{tx("Samples", "Muestras")}</dt>
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
  const { tx } = useI18n();
  const maps = stats.map((demo, index) => ({
    demo,
    analysis: analyses[index],
    key: analyses[index]?.demoSha256 ?? `map-${index}`,
    name:
      analyses[index]?.engineResult.demo.mapName ??
      tx("Map {number}", "Mapa {number}", { number: index + 1 }),
    positionedEvents: (demo.timeline ?? []).filter((event) => event.position)
      .length,
  }));
  const selected = maps[selectedMapIndex] ?? maps[0];

  if (!selected || maps.every((map) => map.positionedEvents === 0)) return null;
  return (
    <section
      className="spatial-workspace"
      aria-label={tx("Spatial combat map", "Mapa de combate espacial")}
    >
      <header>
        <div>
          <span className="eyebrow">
            {tx("Spatial combat", "Combate espacial")}
          </span>
          <h3>{tx("Where the fight happened", "Dónde ocurrió el combate")}</h3>
        </div>
        <span>
          {tx(
            selected.positionedEvents === 1
              ? "One map at a time · 1 positioned moment"
              : "One map at a time · {count} positioned moments",
            selected.positionedEvents === 1
              ? "Un mapa cada vez · 1 momento posicionado"
              : "Un mapa cada vez · {count} momentos posicionados",
            { count: selected.positionedEvents },
          )}
        </span>
      </header>
      <div
        className="spatial-map-selector"
        aria-label={tx(
          "Spatial combat map selector",
          "Selector de mapa de combate espacial",
        )}
      >
        {maps.map((map, index) => (
          <button
            type="button"
            key={map.key}
            className={map.key === selected.key ? "active" : ""}
            aria-pressed={map.key === selected.key}
            aria-label={tx(
              "Show spatial combat for {map}",
              "Mostrar el combate espacial de {map}",
              { map: map.name },
            )}
            onClick={() => onSelectMap(index)}
          >
            <small>
              {tx("Map {number}", "Mapa {number}", { number: index + 1 })}
            </small>
            <strong>{map.name}</strong>
            <span>
              {tx("{count} moments", "{count} momentos", {
                count: map.positionedEvents,
              })}
            </span>
          </button>
        ))}
      </div>
      <DeathPositions
        key={selected.key}
        events={selected.demo.timeline ?? []}
        competitive={selected.demo.competitive}
        players={selected.demo.players}
        mapName={selected.name}
        demoSha256={selected.analysis?.demoSha256}
        onOpenTimeline={onOpenTimeline}
      />
    </section>
  );
}

function DeathPositions({
  events,
  competitive,
  players,
  mapName,
  demoSha256,
  onOpenTimeline,
}: {
  events: MatchTimelineEvent[];
  competitive: CompetitiveStats | undefined;
  players: PlayerStats[];
  mapName: string | undefined;
  demoSha256: string | undefined;
  onOpenTimeline: (demoSha256: string, tick: number) => void;
}) {
  const { tx } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [geometry, setGeometry] = useState<MapGeometry | null | undefined>();
  const [floorMode, setFloorMode] = useState<"events" | "all">("events");
  const [heightRadius, setHeightRadius] = useState(256);
  const [viewport, setViewport] = useState({ zoom: 1, x: 0, y: 0 });
  const viewportValue = useRef(viewport);
  const viewportFrame = useRef<number | null>(null);
  const viewportUiTimer = useRef<number | null>(null);
  const viewportDetailTimer = useRef<number | null>(null);
  const viewportInteracting = useRef(false);
  const drawSpatial = useRef<(() => void) | null>(null);
  const scheduleViewport = (
    update:
      | { zoom: number; x: number; y: number }
      | ((current: { zoom: number; x: number; y: number }) => {
          zoom: number;
          x: number;
          y: number;
        }),
  ) => {
    viewportValue.current =
      typeof update === "function" ? update(viewportValue.current) : update;
    viewportInteracting.current = true;
    if (viewportDetailTimer.current !== null)
      window.clearTimeout(viewportDetailTimer.current);
    viewportDetailTimer.current = window.setTimeout(() => {
      viewportDetailTimer.current = null;
      viewportInteracting.current = false;
      drawSpatial.current?.();
    }, 180);
    if (viewportFrame.current !== null) return;
    viewportFrame.current = requestAnimationFrame(() => {
      viewportFrame.current = null;
      drawSpatial.current?.();
      if (viewportUiTimer.current === null) {
        viewportUiTimer.current = window.setTimeout(() => {
          viewportUiTimer.current = null;
          setViewport({ ...viewportValue.current });
        }, 120);
      }
    });
  };
  const setViewportImmediately = (next: {
    zoom: number;
    x: number;
    y: number;
  }) => {
    if (viewportFrame.current !== null)
      cancelAnimationFrame(viewportFrame.current);
    viewportFrame.current = null;
    viewportInteracting.current = false;
    if (viewportDetailTimer.current !== null)
      window.clearTimeout(viewportDetailTimer.current);
    viewportDetailTimer.current = null;
    viewportValue.current = next;
    setViewport(next);
    drawSpatial.current?.();
  };
  useEffect(
    () => () => {
      if (viewportFrame.current !== null)
        cancelAnimationFrame(viewportFrame.current);
      if (viewportUiTimer.current !== null)
        window.clearTimeout(viewportUiTimer.current);
      if (viewportDetailTimer.current !== null)
        window.clearTimeout(viewportDetailTimer.current);
    },
    [],
  );
  const [displayMode, setDisplayMode] = useState<
    "events" | "density" | "hybrid"
  >("hybrid");
  const [eventScope, setEventScope] = useState<
    "all" | "critical" | "pins" | "boss"
  >("all");
  const [halfScope, setHalfScope] = useState<
    "all" | "first" | "second" | "unknown"
  >("all");
  const [rosterScope, setRosterScope] = useState<"all" | "A" | "B">("all");
  const [roleScope, setRoleScope] = useState<"all" | "Survivor" | "Infected">(
    "all",
  );
  const [playerScope, setPlayerScope] = useState("all");
  const [classScope, setClassScope] = useState("all");
  const [compareTeams, setCompareTeams] = useState(false);
  const [compareDensityMode, setCompareDensityMode] = useState<
    "difference" | "overlay" | "split"
  >("difference");
  const [expanded, setExpanded] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(() => window.innerWidth > 700);
  const [densityRadius, setDensityRadius] = useState(256);
  const infectedIconImages = useRef(new Map<string, HTMLImageElement>());
  const [infectedIconRevision, setInfectedIconRevision] = useState(0);
  const positionedTickBounds = events.reduce<[number, number]>(
    (bounds, event) =>
      event.position
        ? [Math.min(bounds[0], event.tick), Math.max(bounds[1], event.tick)]
        : bounds,
    [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
  );
  const tickMinimum = Number.isFinite(positionedTickBounds[0])
    ? positionedTickBounds[0]
    : 0;
  const tickMaximum = Number.isFinite(positionedTickBounds[1])
    ? positionedTickBounds[1]
    : 1;
  const [tickRange, setTickRange] = useState<[number, number]>([
    tickMinimum,
    tickMaximum,
  ]);
  const [selectedSpatialIndex, setSelectedSpatialIndex] = useState<
    number | null
  >(null);
  const [hoveredSpatialIndex, setHoveredSpatialIndex] = useState<number | null>(
    null,
  );
  const [selectedCluster, setSelectedCluster] = useState<{
    count: number;
    tickStart: number;
    tickEnd: number;
    composition: string;
  } | null>(null);
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{
    distance: number;
    midpointX: number;
    midpointY: number;
    viewport: { zoom: number; x: number; y: number };
  } | null>(null);
  const canvasPoints = useRef<Array<{ x: number; y: number; index: number }>>(
    [],
  );
  const canvasPointIndex = useRef<ScreenPointIndex | null>(null);
  const canvasClusters = useRef<
    Array<{
      x: number;
      y: number;
      radius: number;
      indices: number[];
    }>
  >([]);
  const clusterKeyboardIndex = useRef(0);
  const spatialRenderCount = useRef(0);
  const resetSpatialFilters = () => {
    setEventScope("all");
    setHalfScope("all");
    setRosterScope("all");
    setRoleScope("all");
    setPlayerScope("all");
    setClassScope("all");
    setTickRange([tickMinimum, tickMaximum]);
    setFloorMode("events");
    setHeightRadius(256);
    setDensityRadius(256);
    setDisplayMode("hybrid");
    setCompareTeams(false);
    setCompareDensityMode("difference");
    setSelectedSpatialIndex(null);
    setSelectedCluster(null);
  };
  const eventHalf = (event: MatchTimelineEvent) =>
    competitive?.halves.find(
      (half) =>
        event.tick >= half.tickRange.start && event.tick <= half.tickRange.end,
    );
  const participantId = spatialSubjectPlayerId;
  const rosterForEvent = (event: MatchTimelineEvent) => {
    const playerId = participantId(event);
    return competitive?.rosters?.find((roster) =>
      playerId ? roster.playerIds.includes(playerId) : false,
    );
  };
  const infectedClasses = [
    ...new Set(
      events.flatMap((event) =>
        event.infectedClass ? [event.infectedClass] : [],
      ),
    ),
  ].sort();
  const positioned = useMemo(
    () =>
      events.filter((event) => {
        if (!event.position) return false;
        if (event.tick < tickRange[0] || event.tick > tickRange[1])
          return false;
        if (
          eventScope === "critical" &&
          event.type !== "incap" &&
          event.type !== "death" &&
          event.type !== "revive"
        )
          return false;
        if (
          eventScope === "pins" &&
          event.type !== "pin_start" &&
          event.type !== "pin_end" &&
          event.type !== "clear"
        )
          return false;
        if (
          eventScope === "boss" &&
          event.infectedClass !== "Tank" &&
          event.infectedClass !== "Witch" &&
          !event.type.startsWith("witch_") &&
          event.type !== "tank_control"
        )
          return false;
        const half = eventHalf(event);
        if (halfScope !== "all" && half?.id !== halfScope) return false;
        const playerId = participantId(event);
        if (playerScope !== "all" && playerId !== playerScope) return false;
        if (classScope !== "all" && event.infectedClass !== classScope)
          return false;
        if (rosterScope !== "all") {
          const roster = competitive?.rosters?.find(
            (candidate) => candidate.id === rosterScope,
          );
          if (!playerId || !roster?.playerIds.includes(playerId)) return false;
        }
        if (roleScope !== "all") {
          if (!playerId || !half) return false;
          const ids =
            roleScope === "Survivor"
              ? half.survivorPlayerIds
              : half.infectedPlayerIds;
          if (!ids.includes(playerId)) return false;
        }
        return true;
      }),
    [
      events,
      tickRange,
      eventScope,
      halfScope,
      playerScope,
      classScope,
      rosterScope,
      roleScope,
      competitive,
    ],
  );
  const selectedSpatialEvent =
    selectedSpatialIndex === null
      ? undefined
      : positioned[selectedSpatialIndex];
  const comparisonCounts = positioned.reduce(
    (counts, event) => {
      const roster = rosterForEvent(event)?.id;
      if (roster === "A") counts.A += 1;
      else if (roster === "B") counts.B += 1;
      else counts.unassigned += 1;
      return counts;
    },
    { A: 0, B: 0, unassigned: 0 },
  );
  const rosterConfidence = competitive?.rosters?.some(
    (roster) => roster.confidence === "provisional",
  )
    ? "provisional"
    : "high";
  const openingLandmarks = useMemo(
    () =>
      (competitive?.halves ?? []).flatMap((half) => {
        const area = half.observedOpeningArea;
        if (
          !area ||
          area.availability !== "derived" ||
          (halfScope !== "all" && half.id !== halfScope)
        )
          return [];
        return [{ half, area }];
      }),
    [competitive, halfScope],
  );
  const observedExtentLandmarks = useMemo(() => {
    const ranges = competitive?.halves.length
      ? competitive.halves
          .filter((half) => halfScope === "all" || half.id === halfScope)
          .map((half) => ({ label: half.id, range: half.tickRange }))
      : [{ label: "match", range: { start: tickMinimum, end: tickMaximum } }];
    return ranges.flatMap(({ label, range }) => {
      const observed = positioned
        .filter((event) => event.tick >= range.start && event.tick <= range.end)
        .sort((left, right) => left.tick - right.tick);
      const first = observed[0];
      const last = observed.at(-1);
      if (!first) return [];
      return [
        { kind: "first" as const, label, event: first },
        ...(last && last.tick !== first.tick
          ? [{ kind: "last" as const, label, event: last }]
          : []),
      ];
    });
  }, [competitive, halfScope, positioned, tickMaximum, tickMinimum]);
  const densityGrids = useMemo(() => {
    if (!geometry) return null;
    const width = Math.max(1, geometry.bounds.max.x - geometry.bounds.min.x);
    const height = Math.max(1, geometry.bounds.max.y - geometry.bounds.min.y);
    const columns = 72;
    const rows = Math.min(
      128,
      Math.max(24, Math.round(columns * (height / width))),
    );
    const bounds = {
      min: { x: geometry.bounds.min.x, y: geometry.bounds.min.y },
      max: { x: geometry.bounds.max.x, y: geometry.bounds.max.y },
    };
    const grid = (points: Array<{ x: number; y: number }>) =>
      buildNormalizedDensityGrid(points, bounds, columns, rows, densityRadius);
    const all = grid(
      positioned.map((event) => ({
        x: event.position!.x,
        y: event.position!.y,
      })),
    );
    const team = (id: "A" | "B") =>
      grid(
        positioned.flatMap((event) =>
          rosterForEvent(event)?.id === id
            ? [{ x: event.position!.x, y: event.position!.y }]
            : [],
        ),
      );
    const A = team("A");
    const B = team("B");
    return { bounds, all, A, B, difference: densityDifference(A, B) };
  }, [geometry, positioned, competitive, densityRadius]);
  const densityRaster = useMemo(() => {
    if (!densityGrids || typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = densityGrids.all.columns;
    canvas.height = densityGrids.all.rows;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const pixels = context.createImageData(canvas.width, canvas.height);
    let differenceMaximum = 0;
    for (const value of densityGrids.difference)
      differenceMaximum = Math.max(differenceMaximum, Math.abs(value));
    const sharedMaximum = Math.max(
      densityGrids.A.maximum,
      densityGrids.B.maximum,
    );
    for (let index = 0; index < densityGrids.all.values.length; index += 1) {
      const column = index % canvas.width;
      const row = Math.floor(index / canvas.width);
      const pixel = ((canvas.height - 1 - row) * canvas.width + column) * 4;
      let red = 255,
        green = 150,
        blue = 56,
        alpha =
          densityGrids.all.maximum > 0
            ? (densityGrids.all.values[index] ?? 0) / densityGrids.all.maximum
            : 0;
      if (compareTeams && compareDensityMode === "difference") {
        const difference = densityGrids.difference[index] ?? 0;
        const strength =
          differenceMaximum > 0 ? Math.abs(difference) / differenceMaximum : 0;
        [red, green, blue] = difference >= 0 ? [52, 210, 255] : [255, 151, 61];
        alpha = strength;
      } else if (compareTeams) {
        const a =
          sharedMaximum > 0
            ? (densityGrids.A.values[index] ?? 0) / sharedMaximum
            : 0;
        const b =
          sharedMaximum > 0
            ? (densityGrids.B.values[index] ?? 0) / sharedMaximum
            : 0;
        const total = a + b;
        red = total > 0 ? (52 * a + 236 * b) / total : 0;
        green = total > 0 ? (210 * a + 92 * b) / total : 0;
        blue = 255;
        alpha = Math.min(1, total);
      }
      const displayAlpha = alpha < 0.035 ? 0 : alpha ** 0.62 * 0.78;
      pixels.data[pixel] = Math.round(red);
      pixels.data[pixel + 1] = Math.round(green);
      pixels.data[pixel + 2] = Math.round(blue);
      pixels.data[pixel + 3] = Math.round(displayAlpha * 255);
    }
    context.putImageData(pixels, 0, 0);
    return canvas;
  }, [densityGrids, compareTeams, compareDensityMode]);
  const splitDensityRasters = useMemo(() => {
    if (!densityGrids || typeof document === "undefined") return null;
    const sharedMaximum = Math.max(
      densityGrids.A.maximum,
      densityGrids.B.maximum,
    );
    const raster = (id: "A" | "B") => {
      const grid = densityGrids[id];
      const canvas = document.createElement("canvas");
      canvas.width = grid.columns;
      canvas.height = grid.rows;
      const context = canvas.getContext("2d");
      if (!context) return null;
      const pixels = context.createImageData(canvas.width, canvas.height);
      const color = id === "A" ? [52, 210, 255] : [236, 92, 255];
      for (let index = 0; index < grid.values.length; index += 1) {
        const column = index % canvas.width;
        const row = Math.floor(index / canvas.width);
        const pixel = ((canvas.height - 1 - row) * canvas.width + column) * 4;
        const strength =
          sharedMaximum > 0 ? (grid.values[index] ?? 0) / sharedMaximum : 0;
        const alpha = strength < 0.035 ? 0 : strength ** 0.62 * 0.82;
        pixels.data[pixel] = color[0]!;
        pixels.data[pixel + 1] = color[1]!;
        pixels.data[pixel + 2] = color[2]!;
        pixels.data[pixel + 3] = Math.round(alpha * 255);
      }
      context.putImageData(pixels, 0, 0);
      return canvas;
    };
    const A = raster("A");
    const B = raster("B");
    return A && B ? { A, B } : null;
  }, [densityGrids]);
  const selectedParticipantId = selectedSpatialEvent
    ? participantId(selectedSpatialEvent)
    : undefined;
  const selectedParticipant = players.find(
    (player) => player.id === selectedParticipantId,
  );
  const eventFloor = positioned.length
    ? [...positioned]
        .map((event) => event.position!.z)
        .sort((left, right) => left - right)[Math.floor(positioned.length / 2)]!
    : 0;
  const geometryLayers = useMemo(() => {
    if (!geometry || typeof Path2D === "undefined") return null;
    const bands = Array.from({ length: 5 }, () => new Path2D());
    const edges = new Map<number, { count: number; a: number; b: number }>();
    const vertexCount = geometry.positions.length / 3;
    for (let offset = 0; offset < geometry.indices.length; offset += 3) {
      const triangle = offset / 3;
      const z = geometry.triangleZ?.[triangle] ?? eventFloor;
      if (floorMode === "events" && Math.abs(z - eventFloor) > heightRadius)
        continue;
      const delta = z - eventFloor;
      const band =
        delta < -384
          ? 0
          : delta < -128
            ? 1
            : delta <= 128
              ? 2
              : delta <= 384
                ? 3
                : 4;
      const path = bands[band]!;
      const vertices = [0, 1, 2].map(
        (corner) => geometry.indices[offset + corner] ?? 0,
      );
      for (let corner = 0; corner < 3; corner += 1) {
        const vertex = vertices[corner]! * 3;
        const x = geometry.positions[vertex] ?? 0;
        const y = geometry.positions[vertex + 1] ?? 0;
        if (corner === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      }
      path.closePath();
      for (let edge = 0; edge < 3; edge += 1) {
        const first = vertices[edge]!;
        const second = vertices[(edge + 1) % 3]!;
        const a = Math.min(first, second);
        const b = Math.max(first, second);
        const key = a * vertexCount + b;
        const existing = edges.get(key);
        if (existing) existing.count += 1;
        else edges.set(key, { count: 1, a, b });
      }
    }
    const outline = new Path2D();
    for (const edge of edges.values()) {
      if (edge.count !== 1) continue;
      const a = edge.a * 3;
      const b = edge.b * 3;
      outline.moveTo(
        geometry.positions[a] ?? 0,
        geometry.positions[a + 1] ?? 0,
      );
      outline.lineTo(
        geometry.positions[b] ?? 0,
        geometry.positions[b + 1] ?? 0,
      );
    }
    return { bands, outline };
  }, [geometry, floorMode, eventFloor, heightRadius]);
  const geometryRaster = useMemo(() => {
    if (!geometry || !geometryLayers || typeof document === "undefined")
      return null;
    const worldWidth = Math.max(
      1,
      geometry.bounds.max.x - geometry.bounds.min.x,
    );
    const worldHeight = Math.max(
      1,
      geometry.bounds.max.y - geometry.bounds.min.y,
    );
    const longestSide = 2048;
    const rasterScale = longestSide / Math.max(worldWidth, worldHeight);
    const raster = document.createElement("canvas");
    raster.width = Math.max(1, Math.round(worldWidth * rasterScale));
    raster.height = Math.max(1, Math.round(worldHeight * rasterScale));
    const context = raster.getContext("2d");
    if (!context) return null;
    context.setTransform(
      rasterScale,
      0,
      0,
      -rasterScale,
      -geometry.bounds.min.x * rasterScale,
      geometry.bounds.max.y * rasterScale,
    );
    const bandColors = [
      "rgba(41, 58, 69, .18)",
      "rgba(50, 75, 72, .24)",
      "rgba(103, 139, 116, .38)",
      "rgba(69, 106, 91, .28)",
      "rgba(45, 70, 76, .2)",
    ];
    geometryLayers.bands.forEach((path, index) => {
      context.fillStyle = bandColors[index]!;
      context.fill(path);
      context.strokeStyle = "rgba(196, 220, 202, .055)";
      context.lineWidth = 0.45 / rasterScale;
      context.stroke(path);
    });
    context.strokeStyle = "rgba(181, 228, 187, .38)";
    context.lineWidth = 1.2 / rasterScale;
    context.stroke(geometryLayers.outline);
    return raster;
  }, [geometry, geometryLayers]);
  useEffect(() => {
    setSelectedSpatialIndex(null);
    setHoveredSpatialIndex(null);
  }, [
    eventScope,
    halfScope,
    rosterScope,
    roleScope,
    playerScope,
    classScope,
    tickRange,
  ]);
  useEffect(() => {
    const images = infectedIconImages.current;
    for (const infectedClass of INFECTED_CLASSES) {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => setInfectedIconRevision((revision) => revision + 1);
      image.src = `/art/si/${infectedClass.toLowerCase()}.png`;
      images.set(infectedClass.toLowerCase(), image);
    }
    return () => {
      for (const image of images.values()) image.onload = null;
      images.clear();
    };
  }, []);
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
    const element = canvas.current;
    if (!element) return;
    const containWheel = (event: WheelEvent) => {
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      event.preventDefault();
      requestAnimationFrame(() => {
        const root = document.documentElement;
        const previousBehavior = root.style.scrollBehavior;
        root.style.scrollBehavior = "auto";
        window.scrollTo(scrollX, scrollY);
        root.style.scrollBehavior = previousBehavior;
      });
    };
    element.addEventListener("wheel", containWheel, { passive: false });
    return () => element.removeEventListener("wheel", containWheel);
  }, [geometry]);
  useEffect(() => {
    if (!geometry || !canvas.current) return;
    const element = canvas.current;
    const draw = () => {
      const drawStartedAt = performance.now();
      spatialRenderCount.current += 1;
      element.dataset.renderCount = String(spatialRenderCount.current);
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, element.clientWidth);
      const height = Math.max(1, element.clientHeight);
      const backingWidth = Math.round(width * ratio);
      const backingHeight = Math.round(height * ratio);
      if (element.width !== backingWidth) element.width = backingWidth;
      if (element.height !== backingHeight) element.height = backingHeight;
      const context = element.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.fillStyle = "#080d0a";
      context.fillRect(0, 0, width, height);
      const { min, max } = geometry.bounds;
      const view = viewportValue.current;
      const scale =
        Math.min(
          (width - 32) / Math.max(1, max.x - min.x),
          (height - 32) / Math.max(1, max.y - min.y),
        ) * view.zoom;
      const drawnWidth = (max.x - min.x) * scale;
      const drawnHeight = (max.y - min.y) * scale;
      const point = (x: number, y: number) =>
        [
          (width - drawnWidth) / 2 + (x - min.x) * scale + view.x,
          (height + drawnHeight) / 2 - (y - min.y) * scale + view.y,
        ] as const;
      if (
        compareTeams &&
        compareDensityMode === "split" &&
        splitDensityRasters
      ) {
        const stacked = width <= 700;
        const gap = 8;
        const panelWidth = stacked ? width : (width - gap) / 2;
        const panelHeight = stacked ? (height - gap) / 2 : height;
        canvasPoints.current = [];
        canvasClusters.current = [];
        element.dataset.clusterCount = "0";
        element.dataset.comparisonLayout = stacked ? "stacked" : "side-by-side";
        const drawPanel = (id: "A" | "B", panelIndex: number) => {
          const panelX = stacked ? 0 : panelIndex * (panelWidth + gap);
          const panelY = stacked ? panelIndex * (panelHeight + gap) : 0;
          const panelScale =
            Math.min(
              (panelWidth - 24) / Math.max(1, max.x - min.x),
              (panelHeight - 24) / Math.max(1, max.y - min.y),
            ) * view.zoom;
          const mapWidth = (max.x - min.x) * panelScale;
          const mapHeight = (max.y - min.y) * panelScale;
          const left = panelX + (panelWidth - mapWidth) / 2 + view.x;
          const top = panelY + (panelHeight - mapHeight) / 2 + view.y;
          context.save();
          context.beginPath();
          context.rect(panelX, panelY, panelWidth, panelHeight);
          context.clip();
          context.fillStyle = id === "A" ? "#071116" : "#120814";
          context.fillRect(panelX, panelY, panelWidth, panelHeight);
          if (geometryRaster) {
            context.globalAlpha = 0.84;
            context.drawImage(geometryRaster, left, top, mapWidth, mapHeight);
            context.globalAlpha = 1;
          }
          if (displayMode !== "events")
            context.drawImage(
              splitDensityRasters[id],
              left,
              top,
              mapWidth,
              mapHeight,
            );
          if (displayMode !== "density") {
            for (const [index, event] of positioned.entries()) {
              if (rosterForEvent(event)?.id !== id) continue;
              const x = left + (event.position!.x - min.x) * panelScale;
              const y =
                top + mapHeight - (event.position!.y - min.y) * panelScale;
              if (
                x < panelX ||
                x > panelX + panelWidth ||
                y < panelY ||
                y > panelY + panelHeight
              )
                continue;
              canvasPoints.current.push({ x, y, index });
              context.beginPath();
              context.arc(
                x,
                y,
                event.infectedClass === "Tank" ? 6 : 3.5,
                0,
                Math.PI * 2,
              );
              context.fillStyle = id === "A" ? "#34d2ff" : "#ec5cff";
              context.fill();
            }
          }
          context.fillStyle = "rgba(4, 8, 6, .9)";
          context.fillRect(panelX + 10, panelY + 10, 198, 42);
          context.fillStyle = id === "A" ? "#70ddff" : "#f29aff";
          context.font = "800 12px ui-monospace, monospace";
          context.fillText(
            `TEAM ${id} · NEUTRAL ROSTER`,
            panelX + 18,
            panelY + 27,
          );
          context.fillStyle = "rgba(232, 242, 235, .72)";
          context.font = "700 10px ui-monospace, monospace";
          context.fillText(
            `${comparisonCounts[id]} POSITIONED MOMENTS`,
            panelX + 18,
            panelY + 43,
          );
          context.restore();
        };
        drawPanel("A", 0);
        drawPanel("B", 1);
        canvasPointIndex.current = buildScreenPointIndex(canvasPoints.current);
        context.fillStyle = "rgba(5, 10, 7, .9)";
        context.fillRect(width / 2 - 110, height - 30, 220, 20);
        context.fillStyle = "rgba(225, 239, 229, .78)";
        context.font = "700 10px ui-monospace, monospace";
        context.textAlign = "center";
        context.fillText(
          "SHARED PAN · ZOOM · FILTERS · SCALE",
          width / 2,
          height - 16,
        );
        context.textAlign = "start";
        element.dataset.drawDuration = (
          performance.now() - drawStartedAt
        ).toFixed(3);
        return;
      }
      element.dataset.comparisonLayout = "single";
      if (geometryRaster && (view.zoom < 4 || viewportInteracting.current)) {
        element.dataset.geometryDetail = "raster";
        context.save();
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(
          geometryRaster,
          (width - drawnWidth) / 2 + view.x,
          (height - drawnHeight) / 2 + view.y,
          drawnWidth,
          drawnHeight,
        );
        context.restore();
      } else if (geometryLayers) {
        element.dataset.geometryDetail = "vector";
        context.save();
        context.translate(
          (width - drawnWidth) / 2 + view.x,
          (height + drawnHeight) / 2 + view.y,
        );
        context.scale(scale, -scale);
        context.translate(-min.x, -min.y);
        const bandColors = [
          "rgba(41, 58, 69, .18)",
          "rgba(50, 75, 72, .24)",
          "rgba(103, 139, 116, .38)",
          "rgba(69, 106, 91, .28)",
          "rgba(45, 70, 76, .2)",
        ];
        geometryLayers.bands.forEach((path, index) => {
          context.fillStyle = bandColors[index]!;
          context.fill(path);
        });
        context.strokeStyle = "rgba(181, 228, 187, .38)";
        context.lineWidth = 1.2 / scale;
        context.stroke(geometryLayers.outline);
        if (view.zoom >= 2.4) {
          context.strokeStyle = "rgba(196, 220, 202, .07)";
          context.lineWidth = 0.45 / scale;
          for (const path of geometryLayers.bands) context.stroke(path);
        }
        context.restore();
      }
      canvasPoints.current = [];
      const projected = positioned.map((event, index) => {
        const [x, y] = point(event.position!.x, event.position!.y);
        canvasPoints.current.push({ x, y, index });
        return { event, index, x, y };
      });
      const visibleProjected = projected.filter(
        ({ x, y }) =>
          x >= -36 && x <= width + 36 && y >= -36 && y <= height + 36,
      );
      canvasPointIndex.current = buildScreenPointIndex(canvasPoints.current);
      for (const { half, area } of openingLandmarks) {
        const [x, y] = point(area.center.x, area.center.y);
        const radius = Math.max(
          16,
          Math.min(90, area.planarRadiusUnits * scale),
        );
        context.save();
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fillStyle = "rgba(167, 255, 56, .055)";
        context.fill();
        context.strokeStyle = "rgba(190, 255, 112, .82)";
        context.lineWidth = 1.5;
        context.setLineDash(half.id === "second" ? [2, 5] : [7, 4]);
        context.stroke();
        context.setLineDash([]);
        context.fillStyle = "rgba(5, 10, 7, .9)";
        context.fillRect(x - 4, y - radius - 16, 136, 18);
        context.fillStyle = "#c9ff83";
        context.font = "700 9px ui-monospace, monospace";
        context.fillText(
          `OBSERVED OPENING · ${half.id.toUpperCase()}`,
          x + 2,
          y - radius - 4,
        );
        context.restore();
      }
      for (const landmark of observedExtentLandmarks) {
        const [x, y] = point(
          landmark.event.position!.x,
          landmark.event.position!.y,
        );
        if (x < -80 || x > width + 80 || y < -40 || y > height + 40) continue;
        const color = landmark.kind === "first" ? "#74d8ff" : "#ffba63";
        context.save();
        context.translate(x, y);
        context.rotate(Math.PI / 4);
        context.fillStyle = "rgba(5, 10, 8, .92)";
        context.strokeStyle = color;
        context.lineWidth = 2;
        context.fillRect(-6, -6, 12, 12);
        context.strokeRect(-6, -6, 12, 12);
        context.restore();
        context.fillStyle = "rgba(5, 10, 8, .9)";
        context.fillRect(x + 10, y - 10, 152, 20);
        context.fillStyle = color;
        context.font = "700 11px ui-monospace, monospace";
        context.fillText(
          `${landmark.kind === "first" ? "FIRST" : "LAST"} OBSERVED · ${landmark.label.toUpperCase()}`,
          x + 15,
          y + 4,
        );
      }
      if (
        (displayMode === "density" || displayMode === "hybrid") &&
        densityRaster
      ) {
        context.save();
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(
          densityRaster,
          (width - drawnWidth) / 2 + view.x,
          (height - drawnHeight) / 2 + view.y,
          drawnWidth,
          drawnHeight,
        );
        context.restore();
      }
      if (displayMode === "events" || displayMode === "hybrid") {
        if (visibleProjected.length > 350 && view.zoom < 4) {
          const clusters = new Map<
            string,
            { x: number; y: number; count: number; indices: number[] }
          >();
          const clusterSize = 44;
          for (const marker of visibleProjected) {
            const key = `${Math.floor(marker.x / clusterSize)}:${Math.floor(marker.y / clusterSize)}`;
            const cluster = clusters.get(key);
            if (cluster) {
              cluster.x += marker.x;
              cluster.y += marker.y;
              cluster.count += 1;
              cluster.indices.push(marker.index);
            } else {
              clusters.set(key, {
                x: marker.x,
                y: marker.y,
                count: 1,
                indices: [marker.index],
              });
            }
          }
          canvasClusters.current = [];
          for (const cluster of clusters.values()) {
            const x = cluster.x / cluster.count;
            const y = cluster.y / cluster.count;
            const radius = Math.min(18, 7 + Math.log2(cluster.count + 1) * 2);
            canvasClusters.current.push({
              x,
              y,
              radius,
              indices: cluster.indices,
            });
            context.beginPath();
            context.arc(x, y, radius, 0, Math.PI * 2);
            context.fillStyle = "rgba(9, 18, 13, .9)";
            context.fill();
            context.strokeStyle = "rgba(167, 255, 56, .86)";
            context.lineWidth = 1.5;
            context.stroke();
            context.fillStyle = "#d9ffad";
            context.font = "700 10px ui-monospace, monospace";
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.fillText(String(cluster.count), x, y + 0.5);
          }
          context.textAlign = "start";
          context.textBaseline = "alphabetic";
          element.dataset.clusterCount = String(canvasClusters.current.length);
        } else {
          canvasClusters.current = [];
          element.dataset.clusterCount = "0";
          for (const { event, index, x, y } of visibleProjected) {
            const infectedIcon = event.infectedClass
              ? infectedIconImages.current.get(
                  event.infectedClass.toLowerCase(),
                )
              : undefined;
            const iconSize = event.infectedClass === "Tank" ? 30 : 22;
            if (infectedIcon?.complete && infectedIcon.naturalWidth > 0) {
              context.save();
              context.beginPath();
              context.arc(x, y, iconSize / 2, 0, Math.PI * 2);
              context.fillStyle = "rgba(4, 8, 6, .92)";
              context.fill();
              context.clip();
              context.drawImage(
                infectedIcon,
                x - iconSize / 2,
                y - iconSize / 2,
                iconSize,
                iconSize,
              );
              context.restore();
              const roster = rosterForEvent(event);
              context.beginPath();
              context.arc(x, y, iconSize / 2 + 1.5, 0, Math.PI * 2);
              context.strokeStyle =
                compareTeams && roster?.id === "A"
                  ? "#34d2ff"
                  : compareTeams && roster?.id === "B"
                    ? "#ec5cff"
                    : index === selectedSpatialIndex
                      ? "#ffffff"
                      : "rgba(167, 255, 56, .72)";
              context.lineWidth = index === selectedSpatialIndex ? 2.5 : 1.5;
              context.stroke();
              continue;
            }
            context.beginPath();
            context.arc(
              x,
              y,
              event.infectedClass === "Tank"
                ? 8
                : index === selectedSpatialIndex
                  ? 7
                  : 4.5,
              0,
              Math.PI * 2,
            );
            const roster = rosterForEvent(event);
            context.fillStyle =
              compareTeams && roster?.id === "A"
                ? "#34d2ff"
                : compareTeams && roster?.id === "B"
                  ? "#ec5cff"
                  : event.type === "pin_start" || event.type === "pin_end"
                    ? "#4ac7ff"
                    : event.infectedClass === "Witch"
                      ? "#d58cff"
                      : event.type === "tank_control"
                        ? "#ffc15c"
                        : event.type === "incap" || event.type === "death"
                          ? "#ff665b"
                          : "#a7ff38";
            context.fill();
            if (index === selectedSpatialIndex) {
              context.strokeStyle = "#ffffff";
              context.lineWidth = 2;
              context.stroke();
            }
          }
        }
      } else {
        canvasClusters.current = [];
        element.dataset.clusterCount = "0";
      }
      const targetScalePixels = 84;
      const rawScaleUnits = targetScalePixels / Math.max(scale, 0.000001);
      const magnitude = 10 ** Math.floor(Math.log10(rawScaleUnits));
      const normalizedScale = rawScaleUnits / magnitude;
      const scaleUnits =
        (normalizedScale >= 5 ? 5 : normalizedScale >= 2 ? 2 : 1) * magnitude;
      const scalePixels = Math.min(130, scaleUnits * scale);
      element.dataset.scaleUnits = String(scaleUnits);
      const scaleX = 18;
      const scaleY = height - 18;
      context.save();
      context.strokeStyle = "rgba(218, 235, 222, .78)";
      context.fillStyle = "rgba(218, 235, 222, .72)";
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(scaleX, scaleY - 5);
      context.lineTo(scaleX, scaleY);
      context.lineTo(scaleX + scalePixels, scaleY);
      context.lineTo(scaleX + scalePixels, scaleY - 5);
      context.stroke();
      context.font = "700 11px ui-monospace, monospace";
      context.fillText(
        tx("{units} SOURCE UNITS", "{units} UNIDADES SOURCE", {
          units: whole.format(scaleUnits),
        }),
        scaleX,
        scaleY - 9,
      );
      const orientationX = width - 24;
      const orientationY = 30;
      context.beginPath();
      context.moveTo(orientationX, orientationY + 18);
      context.lineTo(orientationX, orientationY - 5);
      context.lineTo(orientationX - 4, orientationY + 2);
      context.moveTo(orientationX, orientationY - 5);
      context.lineTo(orientationX + 4, orientationY + 2);
      context.stroke();
      context.textAlign = "center";
      context.fillText("+Y", orientationX, orientationY - 10);
      context.restore();
      const drawDuration = performance.now() - drawStartedAt;
      element.dataset.drawDuration = drawDuration.toFixed(3);
      element.dataset.maxDrawDuration = Math.max(
        Number(element.dataset.maxDrawDuration ?? 0),
        drawDuration,
      ).toFixed(3);
    };
    drawSpatial.current = draw;
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (drawSpatial.current === draw) drawSpatial.current = null;
    };
  }, [
    geometry,
    positioned,
    floorMode,
    eventFloor,
    heightRadius,
    displayMode,
    densityRadius,
    selectedSpatialIndex,
    compareTeams,
    geometryLayers,
    geometryRaster,
    densityRaster,
    splitDensityRasters,
    compareDensityMode,
    infectedIconRevision,
    openingLandmarks,
    observedExtentLandmarks,
    tx,
  ]);
  const exploreCluster = (
    cluster: (typeof canvasClusters.current)[number],
    width: number,
    height: number,
  ) => {
    const members = cluster.indices.map((index) => positioned[index]!);
    const classCounts = new Map<string, number>();
    for (const member of members) {
      const label = member.infectedClass ?? member.type.replaceAll("_", " ");
      classCounts.set(label, (classCounts.get(label) ?? 0) + 1);
    }
    setSelectedCluster({
      count: members.length,
      tickStart: Math.min(...members.map((member) => member.tick)),
      tickEnd: Math.max(...members.map((member) => member.tick)),
      composition: [...classCounts.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 3)
        .map(([label, count]) => `${label} ${count}`)
        .join(" · "),
    });
    setSelectedSpatialIndex(null);
    scheduleViewport((current) => {
      const nextZoom = Math.min(8, current.zoom * 1.8);
      const ratio = nextZoom / current.zoom;
      return {
        zoom: nextZoom,
        x: (current.x + width / 2 - cluster.x) * ratio,
        y: (current.y + height / 2 - cluster.y) * ratio,
      };
    });
  };
  if (geometry)
    return (
      <article
        className={`panel death-map geometry-map${expanded ? " spatial-expanded" : ""}`}
      >
        <div className="panel-heading">
          <div>
            <span className="eyebrow">
              {tx(
                "Spatial combat · actual BSP geometry",
                "Combate espacial · geometría BSP real",
              )}
            </span>
            <h3>
              {tx(
                "{count} positioned combat moments on {map}",
                "{count} momentos de combate posicionados en {map}",
                { count: positioned.length, map: mapName ?? "" },
              )}
            </h3>
          </div>
          <span className="muted">
            {tx(
              "Local official map · top-down",
              "Mapa oficial local · vista cenital",
            )}
          </span>
        </div>
        <div
          className="spatial-controls"
          aria-label={tx("Spatial map controls", "Controles del mapa espacial")}
        >
          <span
            className="spatial-mode-switch"
            aria-label={tx("Display layer", "Capa de visualización")}
          >
            {(["events", "hybrid", "density"] as const).map((mode) => (
              <button
                key={mode}
                className={displayMode === mode ? "active" : ""}
                aria-pressed={displayMode === mode}
                onClick={() => setDisplayMode(mode)}
              >
                {mode === "events"
                  ? tx("events", "eventos")
                  : mode === "hybrid"
                    ? tx("hybrid", "híbrido")
                    : tx("density", "densidad")}
              </button>
            ))}
          </span>
          <span className="spatial-viewport-actions">
            <button
              aria-label={tx("Zoom out", "Alejar")}
              onClick={() =>
                scheduleViewport((current) => ({
                  ...current,
                  zoom: Math.max(0.65, current.zoom / 1.3),
                }))
              }
            >
              −
            </button>
            <button
              aria-label={tx("Fit map", "Ajustar mapa")}
              onClick={() => setViewportImmediately({ zoom: 1, x: 0, y: 0 })}
            >
              {tx("Fit", "Ajustar")}
            </button>
            <button
              aria-label={tx("Zoom in", "Acercar")}
              onClick={() =>
                scheduleViewport((current) => ({
                  ...current,
                  zoom: Math.min(8, current.zoom * 1.3),
                }))
              }
            >
              +
            </button>
            <button
              aria-label={
                expanded
                  ? tx("Exit expanded map", "Salir del mapa ampliado")
                  : tx("Expand map", "Ampliar mapa")
              }
              aria-pressed={expanded}
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? tx("Close", "Cerrar") : tx("Expand", "Ampliar")}
            </button>
          </span>
        </div>
        <div
          className="spatial-presets"
          aria-label={tx("Map review presets", "Ajustes predefinidos del mapa")}
        >
          <span>{tx("Presets", "Preajustes")}</span>
          <button
            type="button"
            className={
              eventScope === "all" && displayMode === "hybrid" && !compareTeams
                ? "active"
                : ""
            }
            onClick={() => {
              resetSpatialFilters();
            }}
          >
            {tx("Review", "Revisión")}
          </button>
          <button
            type="button"
            className={eventScope === "critical" ? "active" : ""}
            onClick={() => {
              resetSpatialFilters();
              setEventScope("critical");
              setDisplayMode("events");
            }}
          >
            {tx("Critical outcomes", "Resultados críticos")}
          </button>
          <button
            type="button"
            className={eventScope === "pins" ? "active" : ""}
            onClick={() => {
              resetSpatialFilters();
              setEventScope("pins");
              setDisplayMode("events");
            }}
          >
            {tx("Pins & clears", "Inmovilizaciones y liberaciones")}
          </button>
          {competitive?.rosters?.length === 2 && (
            <button
              type="button"
              className={compareTeams ? "active" : ""}
              onClick={() => {
                resetSpatialFilters();
                setDisplayMode("density");
                setCompareTeams(true);
                setCompareDensityMode("split");
              }}
            >
              {tx("Team comparison", "Comparación de equipos")}
            </button>
          )}
        </div>
        <details
          className="spatial-filter-drawer"
          open={filtersOpen}
          onToggle={(event) => setFiltersOpen(event.currentTarget.open)}
        >
          <summary>
            <span>{tx("Map filters", "Filtros del mapa")}</span>
            <strong>
              {
                [
                  eventScope,
                  halfScope,
                  rosterScope,
                  roleScope,
                  playerScope,
                  classScope,
                ].filter((value) => value !== "all").length
              }{" "}
              {tx("active", "activos")}
            </strong>
            <ChevronDown />
          </summary>
          <div
            className="spatial-filter-bar"
            aria-label={tx("Map filters", "Filtros del mapa")}
          >
            <label>
              <span>{tx("Moments", "Momentos")}</span>
              <select
                value={eventScope}
                onChange={(event) =>
                  setEventScope(event.target.value as typeof eventScope)
                }
              >
                <option value="all">
                  {tx(
                    "All positioned events",
                    "Todos los eventos posicionados",
                  )}
                </option>
                <option value="critical">
                  {tx(
                    "Incaps, deaths & revives",
                    "Incapacitaciones, muertes y reanimaciones",
                  )}
                </option>
                <option value="pins">
                  {tx("Pins & clears", "Inmovilizaciones y liberaciones")}
                </option>
                <option value="boss">
                  {tx("Tank & Witch", "Tank y Witch")}
                </option>
              </select>
            </label>
            <label>
              <span>{tx("Half", "Mitad")}</span>
              <select
                value={halfScope}
                onChange={(event) =>
                  setHalfScope(event.target.value as typeof halfScope)
                }
              >
                <option value="all">
                  {tx("Both halves", "Ambas mitades")}
                </option>
                <option value="first">
                  {tx("First half", "Primera mitad")}
                </option>
                <option value="second">
                  {tx("Second half", "Segunda mitad")}
                </option>
                <option value="unknown">
                  {tx("Unknown segment", "Segmento desconocido")}
                </option>
              </select>
            </label>
            <label>
              <span>{tx("Squad", "Plantilla")}</span>
              <select
                value={rosterScope}
                disabled={!competitive?.rosters?.length}
                onChange={(event) =>
                  setRosterScope(event.target.value as typeof rosterScope)
                }
              >
                <option value="all">{tx("Both teams", "Ambos equipos")}</option>
                <option value="A">{tx("Team A", "Equipo A")}</option>
                <option value="B">{tx("Team B", "Equipo B")}</option>
              </select>
            </label>
            <label>
              <span>{tx("Role", "Rol")}</span>
              <select
                value={roleScope}
                disabled={!competitive?.halves.length}
                onChange={(event) =>
                  setRoleScope(event.target.value as typeof roleScope)
                }
              >
                <option value="all">{tx("Both roles", "Ambos roles")}</option>
                <option value="Survivor">
                  {tx("Survivors", "Supervivientes")}
                </option>
                <option value="Infected">{tx("Infected", "Infectados")}</option>
              </select>
            </label>
            <label>
              <span>{tx("Player", "Jugador")}</span>
              <select
                value={playerScope}
                onChange={(event) => setPlayerScope(event.target.value)}
              >
                <option value="all">
                  {tx("All players", "Todos los jugadores")}
                </option>
                {players.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.alias}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{tx("SI class", "Clase de IE")}</span>
              <select
                value={classScope}
                onChange={(event) => setClassScope(event.target.value)}
              >
                <option value="all">
                  {tx("All classes", "Todas las clases")}
                </option>
                {infectedClasses.map((infectedClass) => (
                  <option key={infectedClass} value={infectedClass}>
                    {infectedClass}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>
        {competitive?.rosters?.length === 2 && (
          <div className="spatial-compare-strip">
            <div>
              <span>{tx("Versus comparison", "Comparación Versus")}</span>
              <strong>
                {tx(
                  "Team A × Team B · colors follow stable roster, not current role",
                  "Equipo A × Equipo B · los colores siguen la plantilla estable, no el rol actual",
                )}
              </strong>
              <small>
                {tx(
                  "{confidence} roster inference · neutral labels · A {a} · B {b} · unassigned {unassigned}",
                  "inferencia de plantilla {confidence} · etiquetas neutrales · A {a} · B {b} · sin asignar {unassigned}",
                  {
                    confidence: rosterConfidence,
                    a: comparisonCounts.A,
                    b: comparisonCounts.B,
                    unassigned: comparisonCounts.unassigned,
                  },
                )}
              </small>
            </div>
            <div className="spatial-compare-actions">
              {compareTeams && (
                <span
                  aria-label={tx(
                    "Team density comparison mode",
                    "Modo de comparación de densidad de equipos",
                  )}
                >
                  {(["difference", "overlay", "split"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={compareDensityMode === mode ? "active" : ""}
                      aria-pressed={compareDensityMode === mode}
                      onClick={() => setCompareDensityMode(mode)}
                    >
                      {mode === "difference"
                        ? tx("difference", "diferencia")
                        : mode === "overlay"
                          ? tx("overlay", "superposición")
                          : tx("split", "dividido")}
                    </button>
                  ))}
                </span>
              )}
              <button
                type="button"
                className={compareTeams ? "active" : ""}
                aria-pressed={compareTeams}
                onClick={() => {
                  setCompareTeams((current) => !current);
                  setRosterScope("all");
                }}
              >
                {compareTeams
                  ? tx("Exit compare", "Salir de comparación")
                  : tx("Compare teams", "Comparar equipos")}
              </button>
            </div>
          </div>
        )}
        {!positioned.length && (
          <div className="spatial-zero-state" role="status">
            <div>
              <strong>
                {tx(
                  "No positioned moments match these filters",
                  "Ningún momento posicionado coincide con estos filtros",
                )}
              </strong>
              <span>
                {tx(
                  "The map and shared controls remain available.",
                  "El mapa y los controles compartidos siguen disponibles.",
                )}
              </span>
            </div>
            <button type="button" onClick={resetSpatialFilters}>
              {tx("Clear filters", "Borrar filtros")}
            </button>
          </div>
        )}
        <div
          className={`spatial-canvas-shell${compareTeams && compareDensityMode === "split" ? " is-split" : ""}`}
        >
          <canvas
            ref={canvas}
            tabIndex={0}
            aria-label={tx(
              "Interactive top-down {map} world geometry with {count} positioned combat events, a Source-unit scale, and +Y orientation. Drag to pan, scroll to zoom, press Enter to explore the largest visible cluster, or comma and period to traverse visible clusters.",
              "Geometría interactiva cenital del mundo de {map} con {count} eventos de combate posicionados, escala en unidades Source y orientación +Y. Arrastra para desplazar, usa la rueda para ampliar, pulsa Intro para explorar el mayor grupo visible o coma y punto para recorrer los grupos visibles.",
              { map: mapName ?? "", count: positioned.length },
            )}
            onWheel={(wheelEvent) => {
              wheelEvent.preventDefault();
              wheelEvent.stopPropagation();
              const rect = wheelEvent.currentTarget.getBoundingClientRect();
              const cursorX = wheelEvent.clientX - rect.left;
              const cursorY = wheelEvent.clientY - rect.top;
              scheduleViewport((current) => {
                const nextZoom = Math.max(
                  0.65,
                  Math.min(
                    8,
                    current.zoom * Math.exp(-wheelEvent.deltaY * 0.0015),
                  ),
                );
                const ratio = nextZoom / current.zoom;
                return {
                  zoom: nextZoom,
                  x:
                    current.x +
                    (cursorX - rect.width / 2 - current.x) * (1 - ratio),
                  y:
                    current.y +
                    (cursorY - rect.height / 2 - current.y) * (1 - ratio),
                };
              });
            }}
            onPointerDown={(pointerEvent) => {
              pointerEvent.currentTarget.setPointerCapture(
                pointerEvent.pointerId,
              );
              pointers.current.set(pointerEvent.pointerId, {
                x: pointerEvent.clientX,
                y: pointerEvent.clientY,
              });
              if (pointers.current.size === 2) {
                const [first, second] = [...pointers.current.values()];
                if (first && second) {
                  pinch.current = {
                    distance: Math.max(
                      1,
                      Math.hypot(second.x - first.x, second.y - first.y),
                    ),
                    midpointX: (first.x + second.x) / 2,
                    midpointY: (first.y + second.y) / 2,
                    viewport: { ...viewportValue.current },
                  };
                }
                drag.current = null;
                return;
              }
              drag.current = {
                pointerId: pointerEvent.pointerId,
                x: pointerEvent.clientX,
                y: pointerEvent.clientY,
                moved: false,
              };
            }}
            onPointerMove={(pointerEvent) => {
              if (pointers.current.has(pointerEvent.pointerId)) {
                pointers.current.set(pointerEvent.pointerId, {
                  x: pointerEvent.clientX,
                  y: pointerEvent.clientY,
                });
              }
              if (pointers.current.size >= 2 && pinch.current) {
                const [first, second] = [...pointers.current.values()];
                if (first && second) {
                  const start = pinch.current;
                  const distance = Math.max(
                    1,
                    Math.hypot(second.x - first.x, second.y - first.y),
                  );
                  const midpointX = (first.x + second.x) / 2;
                  const midpointY = (first.y + second.y) / 2;
                  const nextZoom = Math.max(
                    0.65,
                    Math.min(
                      8,
                      start.viewport.zoom * (distance / start.distance),
                    ),
                  );
                  const ratio = nextZoom / start.viewport.zoom;
                  scheduleViewport({
                    zoom: nextZoom,
                    x:
                      start.viewport.x +
                      (midpointX - start.midpointX) +
                      (start.midpointX -
                        pointerEvent.currentTarget.getBoundingClientRect()
                          .left -
                        pointerEvent.currentTarget.clientWidth / 2 -
                        start.viewport.x) *
                        (1 - ratio),
                    y:
                      start.viewport.y +
                      (midpointY - start.midpointY) +
                      (start.midpointY -
                        pointerEvent.currentTarget.getBoundingClientRect().top -
                        pointerEvent.currentTarget.clientHeight / 2 -
                        start.viewport.y) *
                        (1 - ratio),
                  });
                }
                return;
              }
              const activeDrag = drag.current;
              if (
                activeDrag &&
                activeDrag.pointerId === pointerEvent.pointerId
              ) {
                const dx = pointerEvent.clientX - activeDrag.x;
                const dy = pointerEvent.clientY - activeDrag.y;
                if (Math.abs(dx) + Math.abs(dy) > 1) activeDrag.moved = true;
                activeDrag.x = pointerEvent.clientX;
                activeDrag.y = pointerEvent.clientY;
                scheduleViewport((current) => ({
                  ...current,
                  x: current.x + dx,
                  y: current.y + dy,
                }));
                return;
              }
              const rect = pointerEvent.currentTarget.getBoundingClientRect();
              const x = pointerEvent.clientX - rect.left;
              const y = pointerEvent.clientY - rect.top;
              const nearest = canvasPointIndex.current?.nearest(x, y, 14);
              setHoveredSpatialIndex(nearest?.index ?? null);
            }}
            onPointerUp={(pointerEvent) => {
              const activeDrag = drag.current;
              pointers.current.delete(pointerEvent.pointerId);
              pinch.current = null;
              if (pointers.current.size === 1) {
                const [remaining] = [...pointers.current.entries()];
                if (remaining) {
                  drag.current = {
                    pointerId: remaining[0],
                    x: remaining[1].x,
                    y: remaining[1].y,
                    moved: true,
                  };
                }
                return;
              }
              drag.current = null;
              if (activeDrag?.moved) return;
              const rect = pointerEvent.currentTarget.getBoundingClientRect();
              const x = pointerEvent.clientX - rect.left;
              const y = pointerEvent.clientY - rect.top;
              const cluster = canvasClusters.current.find(
                (candidate) =>
                  Math.hypot(candidate.x - x, candidate.y - y) <=
                  candidate.radius + 8,
              );
              if (cluster) {
                exploreCluster(cluster, rect.width, rect.height);
                return;
              }
              const nearest = canvasPointIndex.current?.nearest(x, y, 18);
              if (nearest) {
                setSelectedCluster(null);
                setSelectedSpatialIndex(nearest.index);
              }
            }}
            onPointerCancel={(pointerEvent) => {
              pointers.current.delete(pointerEvent.pointerId);
              pinch.current = null;
              drag.current = null;
            }}
            onDoubleClick={() =>
              scheduleViewport((current) => ({
                ...current,
                zoom: Math.min(8, current.zoom * 1.6),
              }))
            }
            onKeyDown={(event) => {
              const step = event.shiftKey ? 80 : 32;
              if (event.key === "Enter" && canvasClusters.current.length) {
                event.preventDefault();
                const largest = [...canvasClusters.current].sort(
                  (left, right) => right.indices.length - left.indices.length,
                )[0]!;
                exploreCluster(
                  largest,
                  event.currentTarget.clientWidth,
                  event.currentTarget.clientHeight,
                );
              }
              if (
                (event.key === "," || event.key === ".") &&
                canvasClusters.current.length
              ) {
                event.preventDefault();
                clusterKeyboardIndex.current =
                  (clusterKeyboardIndex.current +
                    (event.key === "." ? 1 : -1) +
                    canvasClusters.current.length) %
                  canvasClusters.current.length;
                exploreCluster(
                  canvasClusters.current[clusterKeyboardIndex.current]!,
                  event.currentTarget.clientWidth,
                  event.currentTarget.clientHeight,
                );
              }
              if (event.key === "Escape") {
                setSelectedSpatialIndex(null);
                setSelectedCluster(null);
                setExpanded(false);
              }
              if (event.key === "0")
                setViewportImmediately({ zoom: 1, x: 0, y: 0 });
              if (event.key === "+" || event.key === "=")
                scheduleViewport((current) => ({
                  ...current,
                  zoom: Math.min(8, current.zoom * 1.25),
                }));
              if (event.key === "-")
                scheduleViewport((current) => ({
                  ...current,
                  zoom: Math.max(0.65, current.zoom / 1.25),
                }));
              if (
                (event.key === "[" || event.key === "]") &&
                positioned.length
              ) {
                event.preventDefault();
                setSelectedSpatialIndex((current) => {
                  const index = current ?? (event.key === "]" ? -1 : 0);
                  return (
                    (index + (event.key === "]" ? 1 : -1) + positioned.length) %
                    positioned.length
                  );
                });
              }
              if (event.key.startsWith("Arrow")) {
                event.preventDefault();
                scheduleViewport((current) => ({
                  ...current,
                  x:
                    current.x +
                    (event.key === "ArrowLeft"
                      ? step
                      : event.key === "ArrowRight"
                        ? -step
                        : 0),
                  y:
                    current.y +
                    (event.key === "ArrowUp"
                      ? step
                      : event.key === "ArrowDown"
                        ? -step
                        : 0),
                }));
              }
            }}
          />
          <div className="spatial-map-status" aria-live="polite">
            <span>{viewport.zoom.toFixed(2)}×</span>
            <span>
              {tx(
                "{count} positioned moments",
                "{count} momentos posicionados",
                {
                  count: positioned.length,
                },
              )}
              {positioned.length > 350 && viewport.zoom < 4
                ? tx(" · clustered", " · agrupados")
                : ""}
            </span>
            <span>
              {tx(
                "Drag · scroll · pinch · [ ] select",
                "Arrastrar · rueda · pellizcar · [ ] seleccionar",
              )}
            </span>
          </div>
          {hoveredSpatialIndex !== null && positioned[hoveredSpatialIndex] && (
            <div className="spatial-hover-card" role="tooltip">
              <strong>{positioned[hoveredSpatialIndex].detail}</strong>
              <span>
                {formatElapsedTime(positioned[hoveredSpatialIndex].timeSeconds)}{" "}
                ·{" "}
                {tx("tick {tick}", "tick {tick}", {
                  tick: whole.format(positioned[hoveredSpatialIndex].tick),
                })}
              </span>
            </div>
          )}
        </div>
        {selectedCluster && (
          <article
            className="spatial-selection spatial-cluster-selection"
            aria-live="polite"
          >
            <div>
              <span>
                {tx(
                  "Explored cluster · ticks {start}–{end}",
                  "Grupo explorado · ticks {start}–{end}",
                  {
                    start: whole.format(selectedCluster.tickStart),
                    end: whole.format(selectedCluster.tickEnd),
                  },
                )}
              </span>
              <strong>
                {tx(
                  "{count} positioned moments",
                  "{count} momentos posicionados",
                  {
                    count: selectedCluster.count,
                  },
                )}
              </strong>
              <small>{selectedCluster.composition}</small>
            </div>
            <button type="button" onClick={() => setSelectedCluster(null)}>
              {tx("Dismiss", "Descartar")}
            </button>
          </article>
        )}
        <details className="spatial-advanced-controls">
          <summary>{tx("Layers & height", "Capas y altura")}</summary>
          <div>
            {geometry.triangleZ && (
              <label>
                <span>{tx("Height band", "Banda de altura")}</span>
                <select
                  value={floorMode === "all" ? "all" : String(heightRadius)}
                  onChange={(event) => {
                    if (event.target.value === "all") setFloorMode("all");
                    else {
                      setFloorMode("events");
                      setHeightRadius(Number(event.target.value));
                    }
                  }}
                >
                  <option value="128">
                    {tx("Focused ±128u", "Enfocada ±128u")}
                  </option>
                  <option value="256">
                    {tx("Event level ±256u", "Nivel del evento ±256u")}
                  </option>
                  <option value="512">
                    {tx("Wide ±512u", "Amplia ±512u")}
                  </option>
                  <option value="all">
                    {tx("All elevations", "Todas las elevaciones")}
                  </option>
                </select>
              </label>
            )}
            <label>
              <span>
                {tx(
                  "Smoothing · {radius} world units",
                  "Suavizado · {radius} unidades del mundo",
                  {
                    radius: densityRadius,
                  },
                )}
              </span>
              <input
                type="range"
                min="96"
                max="768"
                step="32"
                value={densityRadius}
                onChange={(event) =>
                  setDensityRadius(Number(event.target.value))
                }
              />
            </label>
            <label className="spatial-time-range">
              <span>
                {tx(
                  "Tick range · {start}–{end}",
                  "Intervalo de ticks · {start}–{end}",
                  {
                    start: whole.format(tickRange[0]),
                    end: whole.format(tickRange[1]),
                  },
                )}
              </span>
              <input
                aria-label={tx("Start tick", "Tick inicial")}
                type="range"
                min={tickMinimum}
                max={tickMaximum}
                value={tickRange[0]}
                onChange={(event) =>
                  setTickRange((current) => [
                    Math.min(Number(event.target.value), current[1]),
                    current[1],
                  ])
                }
              />
              <input
                aria-label={tx("End tick", "Tick final")}
                type="range"
                min={tickMinimum}
                max={tickMaximum}
                value={tickRange[1]}
                onChange={(event) =>
                  setTickRange((current) => [
                    current[0],
                    Math.max(Number(event.target.value), current[0]),
                  ])
                }
              />
            </label>
          </div>
        </details>
        {selectedSpatialEvent && (
          <article className="spatial-selection" aria-live="polite">
            <div>
              <span>
                {formatElapsedTime(selectedSpatialEvent.timeSeconds)} ·{" "}
                {tx("tick {tick}", "tick {tick}", {
                  tick: whole.format(selectedSpatialEvent.tick),
                })}
              </span>
              <strong>{selectedSpatialEvent.detail}</strong>
              <small>
                {selectedParticipant?.alias
                  ? `${selectedParticipant.alias} · `
                  : ""}
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
                {tx("Open on timeline", "Abrir en la cronología")}
              </button>
            )}
          </article>
        )}
        <div className="death-map-key">
          {compareTeams ? (
            <>
              <span className="team-a">
                <i /> {tx("Team A", "Equipo A")}
              </span>
              <span className="team-b">
                <i /> {tx("Team B", "Equipo B")}
              </span>
              <span>
                {positioned.filter((event) => rosterForEvent(event)?.id === "A")
                  .length || 0}{" "}
                /{" "}
                {positioned.filter((event) => rosterForEvent(event)?.id === "B")
                  .length || 0}{" "}
                {tx("positioned moments", "momentos posicionados")}
              </span>
            </>
          ) : (
            <>
              <span className="support">
                <i /> {tx("Attack/support", "Ataque/apoyo")}
              </span>
              <span className="critical">
                <i /> {tx("Incap/death", "Incapacitación/muerte")}
              </span>
              <span className="pin">
                <i /> {tx("Pin", "Inmovilización")}
              </span>
              <span className="tank">
                <i /> {tx("Tank", "Tank")}
              </span>
              <span className="witch">
                <i /> {tx("Witch", "Witch")}
              </span>
            </>
          )}
          {openingLandmarks.length > 0 && (
            <span className="opening">
              <i /> {tx("Observed opening", "Inicio observado")}
            </span>
          )}
          <span className="extent">
            <i /> {tx("First/last observed", "Primero/último observado")}
          </span>
        </div>
        {displayMode !== "events" && densityGrids && (
          <div className="spatial-density-legend">
            <div
              className={`spatial-density-ramp ${compareTeams ? compareDensityMode : "single"}`}
            />
            <strong>
              {compareTeams && compareDensityMode === "difference"
                ? tx(
                    "More Team A concentration ← normalized difference → More Team B concentration",
                    "Mayor concentración del Equipo A ← diferencia normalizada → Mayor concentración del Equipo B",
                  )
                : compareTeams
                  ? tx(
                      "Shared scale · Team A cyan · Team B magenta",
                      "Escala compartida · Equipo A cian · Equipo B magenta",
                    )
                  : tx(
                      "Lower ← normalized share of positioned events → higher",
                      "Menor ← proporción normalizada de eventos posicionados → mayor",
                    )}
            </strong>
            <span>
              {tx(
                "Smoothing {radius} world units · normalized within each cohort · A n={a} · B n={b}",
                "Suavizado de {radius} unidades del mundo · normalizado dentro de cada cohorte · A n={a} · B n={b}",
                {
                  radius: densityRadius,
                  a: densityGrids.A.sampleCount,
                  b: densityGrids.B.sampleCount,
                },
              )}
              {compareTeams &&
              (densityGrids.A.sampleCount < 10 ||
                densityGrids.B.sampleCount < 10)
                ? tx(
                    " · sparse observations—patterns are unstable",
                    " · observaciones escasas; los patrones son inestables",
                  )
                : ""}
            </span>
          </div>
        )}
        {openingLandmarks.length > 0 && (
          <div className="spatial-landmark-notice">
            <strong>
              {tx(
                "Observed Survivor opening area",
                "Área inicial observada de supervivientes",
              )}
            </strong>
            <span>
              {tx(
                "First observed round opening · demo-derived, not an authored saferoom",
                "Primer inicio de ronda observado · derivado de la demo, no un refugio definido",
              )}{" "}
              ·{" "}
              {openingLandmarks
                .map(({ half, area }) =>
                  tx(
                    "{half} {observed}/{total} players · radius {radius}u · ticks {start}–{end}",
                    "{half} {observed}/{total} jugadores · radio {radius}u · ticks {start}–{end}",
                    {
                      half: half.id,
                      observed: area.samples.length,
                      total: half.survivorPlayerIds.length,
                      radius: whole.format(area.planarRadiusUnits),
                      start: whole.format(area.tickRange.start),
                      end: whole.format(area.tickRange.end),
                    },
                  ),
                )
                .join(" · ")}
            </span>
          </div>
        )}
        <div className="spatial-landmark-notice extent-notice">
          <strong>
            {tx(
              "Observed progression anchors",
              "Anclas de progresión observadas",
            )}
          </strong>
          <span>
            {tx(
              "First and last positioned event in each visible half · demo-derived orientation aids, not authored saferoom boundaries or movement routes",
              "Primer y último evento posicionado de cada mitad visible · ayudas de orientación derivadas de la demo, no límites de refugio ni rutas de movimiento definidos",
            )}
          </span>
        </div>
        <SpatialEventLinks
          events={positioned}
          demoSha256={demoSha256}
          onOpenTimeline={onOpenTimeline}
        />
        <small>
          {tx(
            "Density represents positioned timeline events, not player occupancy. · {triangles} world-brush triangles · BSP {bsp} · {displacements} displacements reconstructed{skipped} · static props unavailable",
            "La densidad representa eventos posicionados de la cronología, no la ocupación de jugadores. · {triangles} triángulos de brushes del mundo · BSP {bsp} · {displacements} desplazamientos reconstruidos{skipped} · objetos estáticos no disponibles",
            {
              triangles: whole.format(geometry.coverage.emittedTriangles),
              bsp: geometry.provenance.sourceBspSha256.slice(0, 12),
              displacements: whole.format(
                geometry.coverage.emittedDisplacements,
              ),
              skipped: geometry.coverage.skippedDisplacements
                ? tx(
                    " · {count} displacements skipped",
                    " · {count} desplazamientos omitidos",
                    {
                      count: whole.format(
                        geometry.coverage.skippedDisplacements,
                      ),
                    },
                  )
                : "",
            },
          )}
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
          <span className="eyebrow">
            {tx("Spatial combat", "Combate espacial")}
          </span>
          <h3>
            {tx(
              "{count} positioned combat moments",
              "{count} momentos de combate posicionados",
              { count: positioned.length },
            )}
          </h3>
        </div>
        <span className="muted">
          {tx(
            "Normalized event coordinates",
            "Coordenadas normalizadas de eventos",
          )}
        </span>
      </div>
      <svg
        viewBox="0 0 900 300"
        role="img"
        aria-label={tx(
          "Normalized combat-event positions",
          "Posiciones normalizadas de eventos de combate",
        )}
      >
        {positioned.map((event, index) => (
          <circle
            key={`${event.tick}-${index}`}
            className={event.type}
            cx={scale(event.position!.x, minX, maxX)}
            cy={282 - scale(event.position!.y, minY, maxY) * (282 / 900)}
            r={event.infectedClass === "Tank" ? 8 : 4}
          >
            <title>{`${formatElapsedTime(event.timeSeconds)} · ${event.detail}`}</title>
          </circle>
        ))}
      </svg>
      <div className="death-map-key">
        <span>
          <i /> {tx("Attacks and support", "Ataques y apoyo")}
        </span>
        <span>
          <i /> {tx("Incaps and deaths", "Incapacitaciones y muertes")}
        </span>
      </div>
      <SpatialEventLinks
        events={positioned}
        demoSha256={demoSha256}
        onOpenTimeline={onOpenTimeline}
      />
      <small>
        {tx(
          "This is not map geometry; it preserves relative positions from death events. Install the matching local BSP artifact for real map geometry.",
          "Esto no es geometría del mapa; conserva posiciones relativas de los eventos de muerte. Instala el artefacto BSP local correspondiente para obtener la geometría real del mapa.",
        )}
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
  const { tx } = useI18n();
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(100);
  if (!demoSha256) return null;
  return (
    <details
      className="spatial-event-links"
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        setOpen(nextOpen);
        if (!nextOpen) setLimit(100);
      }}
    >
      <summary>
        {tx(
          "Inspect {count} positioned moments",
          "Inspeccionar {count} momentos posicionados",
          { count: whole.format(events.length) },
        )}
        <ChevronDown />
      </summary>
      {open && (
        <div>
          {events.slice(0, limit).map((event, index) => (
            <button
              type="button"
              key={`${event.tick}:${event.type}:${index}`}
              onClick={() => onOpenTimeline(demoSha256, event.tick)}
            >
              <span>
                {event.infectedClass ?? event.type.replaceAll("_", " ")}
              </span>
              <strong>{event.detail}</strong>
              <time>
                {tx("tick {tick}", "tick {tick}", {
                  tick: whole.format(event.tick),
                })}
              </time>
            </button>
          ))}
          {limit < events.length && (
            <button
              type="button"
              className="spatial-event-more"
              onClick={() => setLimit((current) => current + 100)}
            >
              {tx("Show next {count}", "Mostrar los siguientes {count}", {
                count: whole.format(Math.min(100, events.length - limit)),
              })}
            </button>
          )}
        </div>
      )}
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
  const { tx } = useI18n();
  const max = rows[0]?.[1] ?? 1;
  return (
    <article className="panel breakdown-panel">
      <span className="eyebrow">{tx("Distribution", "Distribución")}</span>
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
        <p className="muted">
          {tx(
            "This demo did not expose these events.",
            "Esta demo no expuso estos eventos.",
          )}
        </p>
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
  const { locale, tx } = useI18n();
  const initialTimelineParameters = new URLSearchParams(window.location.search);
  const initialFilter = initialTimelineParameters.get("storyFilter");
  const [filter, setFilter] = useState(
    [
      "all",
      "combat",
      "pins",
      "infected",
      "bosses",
      "rounds",
      "support",
    ].includes(initialFilter ?? "")
      ? initialFilter!
      : "all",
  );
  const [mapScope, setMapScope] = useState(
    initialTimelineParameters.get("storyMap") ?? analyses[0]?.demoSha256 ?? "",
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedHit, setSelectedHit] = useState<string | null>(
    initialTimelineParameters.get("hit"),
  );
  const [zoom, setZoom] = useState(() => {
    const requested = Number(initialTimelineParameters.get("storyDensity"));
    return [1, 2, 4].includes(requested)
      ? requested
      : window.innerWidth <= 700
        ? 1
        : 2;
  });
  const [fullscreen, setFullscreen] = useState(false);
  const [storyLimit, setStoryLimit] = useState(100);
  const [moreTimelineFilters, setMoreTimelineFilters] = useState(
    initialTimelineParameters.get("storyMore") === "1",
  );
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
    mapName:
      analyses[demoIndex]?.engineResult.demo.mapName ??
      tx("Unknown map", "Mapa desconocido"),
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
  const filterCounts = Object.fromEntries(
    ["all", ...Object.keys(groups)].map((name) => [
      name,
      name === "all"
        ? eventCount
        : scopedDemos.reduce(
            (count, demo) =>
              count +
              demo.events.filter(({ event }) =>
                groups[name]?.includes(event.type),
              ).length,
            0,
          ),
    ]),
  );
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
    const parameters = new URLSearchParams(window.location.search);
    parameters.delete("storyView");
    parameters.set("storyFilter", filter);
    parameters.set("storyMap", mapScope);
    parameters.set("storyDensity", String(zoom));
    parameters.delete("storyPresentation");
    parameters.set("storyMore", moreTimelineFilters ? "1" : "0");
    if (selectedHit) parameters.set("hit", selectedHit);
    else parameters.delete("hit");
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}?${parameters.toString()}`,
    );
  }, [filter, mapScope, moreTimelineFilters, selectedHit, zoom]);
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
  useEffect(() => setStoryLimit(100), [filter, mapScope]);
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
  const hitSummaries = scopedDemos.flatMap((demo) => {
    const competitive = demo.demo.competitive;
    if (!competitive) return [];
    return competitive.hits.map((hit, index) => ({
      hit,
      index,
      demo,
      lives: hit.lifeIds.flatMap((lifeId) => {
        const life = competitive.infectedLives.find(
          (candidate) => candidate.id === lifeId,
        );
        return life ? [life] : [];
      }),
    }));
  });
  const openHit = (summary: (typeof hitSummaries)[number]) => {
    const target = summary.demo.events
      .filter(({ event }) => event.tick >= summary.hit.tickRange.start)
      .sort(
        (left, right) =>
          Math.abs(left.event.tick - summary.hit.tickRange.start) -
          Math.abs(right.event.tick - summary.hit.tickRange.start),
      )[0];
    if (target) setSelected(target.key);
  };
  const selectedHitSummary = selectedHit
    ? (hitSummaries.find(
        (summary) => `${summary.demo.sha256}:${summary.hit.id}` === selectedHit,
      ) ?? null)
    : null;
  const visibleHitSummaries = hitSummaries.filter((summary) => {
    if (filter === "all" || filter === "infected") return true;
    if (filter === "combat")
      return (
        summary.hit.controls > 0 || summary.hit.observedSurvivorHealthLoss > 0
      );
    if (filter === "pins") return summary.hit.peakSimultaneousPins > 0;
    if (filter === "bosses")
      return summary.lives.some(
        (life) =>
          life.infectedClass === "Tank" || life.infectedClass === "Witch",
      );
    return false;
  });
  const hitRoundContexts = new Map<
    string,
    { hit: number; round: number; observedBoundary: boolean }
  >();
  for (const demo of scopedDemos) {
    const roundStarts = demo.events
      .filter(({ event }) => event.type === "round_start")
      .map(({ event }) => event.tick)
      .sort((left, right) => left - right);
    const demoHits = hitSummaries.filter(
      (candidate) => candidate.demo.sha256 === demo.sha256,
    );
    const numbers = numberHitsByObservedRounds(
      demoHits.map((summary) => ({
        id: summary.hit.id,
        startTick: summary.hit.tickRange.start,
      })),
      roundStarts,
    );
    for (const summary of demoHits) {
      const number = numbers.get(summary.hit.id);
      if (number)
        hitRoundContexts.set(`${demo.sha256}:${summary.hit.id}`, number);
    }
  }
  const hitRoundContext = (summary: (typeof hitSummaries)[number]) =>
    hitRoundContexts.get(`${summary.demo.sha256}:${summary.hit.id}`) ?? {
      hit: 1,
      round: 0,
      observedBoundary: false,
    };
  const majorStoryTypes = new Set<MatchTimelineEvent["type"]>([
    "round_start",
    "round_end",
    "team_change",
    "incap",
    "death",
    "revive",
    "clear",
    "tank_control",
    "witch_spawn",
    "witch_enrage",
    "witch_burn",
    "witch_end",
  ]);
  const storyEventGroups = new Map<string, Array<(typeof visible)[number]>>();
  for (const item of visible.filter(({ event }) =>
    majorStoryTypes.has(event.type),
  )) {
    const key = `${item.demo.sha256}:${item.event.tick}`;
    const group = storyEventGroups.get(key) ?? [];
    group.push(item);
    storyEventGroups.set(key, group);
  }
  const topLevelStoryEventGroups = [...storyEventGroups.values()].filter(
    (items) => {
      const first = items[0];
      if (!first) return false;
      if (
        items.some(
          ({ event }) =>
            event.type === "round_start" || event.type === "round_end",
        )
      )
        return true;
      return !visibleHitSummaries.some(
        (summary) =>
          summary.demo.sha256 === first.demo.sha256 &&
          first.event.tick >= summary.hit.tickRange.start &&
          first.event.tick <= summary.hit.tickRange.end,
      );
    },
  );
  const storyItems = [
    ...visibleHitSummaries.map((summary) => ({
      kind: "hit" as const,
      tick: summary.hit.tickRange.start,
      summary,
    })),
    ...topLevelStoryEventGroups.map((items) => ({
      kind: "event" as const,
      tick: items[0]!.event.tick,
      items,
    })),
  ].sort((left, right) => left.tick - right.tick);
  const storyRoundStarts = new Map(
    scopedDemos.map((demo) => [
      demo.sha256,
      demo.events
        .filter(({ event }) => event.type === "round_start")
        .map(({ event }) => event.tick)
        .sort((left, right) => left - right),
    ]),
  );
  const roundContextForTick = (
    demo: (typeof scopedDemos)[number],
    tick: number,
  ) => {
    const starts = storyRoundStarts.get(demo.sha256) ?? [];
    const observedRound = starts.reduce(
      (found, start, index) => (start <= tick ? index : found),
      -1,
    );
    const half = demo.demo.competitive?.halves.find(
      (candidate) =>
        tick >= candidate.tickRange.start && tick <= candidate.tickRange.end,
    );
    const survivorRoster = demo.demo.competitive?.rosters?.find((roster) =>
      half?.survivorPlayerIds.some((playerId) =>
        roster.playerIds.includes(playerId),
      ),
    );
    return {
      key: `${demo.sha256}:${observedRound}`,
      label:
        observedRound >= 0
          ? tx("Swap sides", "Cambio de lados")
          : tx("Round start", "Inicio de ronda"),
      detail:
        observedRound >= 0
          ? `${survivorRoster ? tx("Team {id} now Survivors · ", "El equipo {id} ahora es Superviviente · ", { id: survivorRoster.id }) : ""}${formatTickTime(starts[observedRound]!, demo.demo.tickRate)}`
          : tx("Beginning of retained demo", "Inicio de la demo conservada"),
    };
  };
  const storyRoundContext = (story: (typeof storyItems)[number]) => {
    const demo =
      story.kind === "hit" ? story.summary.demo : story.items[0]!.demo;
    return roundContextForTick(demo, story.tick);
  };
  const storyEventLabel = (event: MatchTimelineEvent) => {
    if (event.type === "tank_control")
      return tx("Tank entered play", "El Tank entró en juego");
    if (event.type === "witch_spawn")
      return tx("Witch observed", "Witch observada");
    if (event.type === "witch_enrage")
      return tx("Witch enraged", "Witch enfurecida");
    if (event.type === "witch_burn")
      return tx("Witch burning", "Witch en llamas");
    if (event.type === "witch_end")
      return tx(
        "Witch observation ended",
        "Terminó la observación de la Witch",
      );
    if (event.type === "round_start")
      return tx("Round started", "Ronda iniciada");
    if (event.type === "round_end") return tx("Round ended", "Ronda terminada");
    if (event.type === "team_change")
      return tx("Side changed", "Cambio de bando");
    return tx(
      event.type.replaceAll("_", " "),
      (
        {
          attack: "ataque",
          clear: "liberación",
          death: "muerte",
          incap: "incapacitación",
          pin_start: "inicio del agarre",
          pin_end: "fin del agarre",
          revive: "reanimación",
          spawn: "aparición",
        } as Record<string, string>
      )[event.type] ?? event.type.replaceAll("_", " "),
    );
  };
  const timelineDetail = (event: MatchTimelineEvent) => {
    if (locale === "en") return event.detail;
    const actor = event.actor ?? tx("Environment", "Entorno");
    const victim = event.victim ?? tx("a Survivor", "un superviviente");
    const infected =
      event.infectedClass ?? tx("Special Infected", "infectado especial");
    if (event.type === "round_start")
      return tx("Round started", "Ronda iniciada");
    if (event.type === "round_end") return tx("Round ended", "Ronda terminada");
    if (event.type === "team_change")
      return tx("{player} changed team", "{player} cambió de equipo", {
        player: event.subject ?? tx("Player", "Jugador"),
      });
    if (event.type === "tank_control")
      return tx(
        "{player} took Tank control",
        "{player} tomó el control del Tank",
        { player: actor },
      );
    if (event.type === "spawn")
      return tx(
        "{player} spawned as {class}",
        "{player} apareció como {class}",
        { player: actor, class: infected },
      );
    if (event.type === "incap")
      return tx("{player} was incapacitated", "{player} quedó incapacitado", {
        player: victim,
      });
    if (event.type === "revive")
      return tx(
        "{player} completed a revive",
        "{player} completó una reanimación",
        { player: actor },
      );
    if (event.type === "pin_start")
      return tx(
        "{actor} pinned {victim} as {class}",
        "{actor} inmovilizó a {victim} como {class}",
        { actor, victim, class: infected },
      );
    if (event.type === "pin_end")
      return tx(
        "{actor}'s pin on {victim} ended",
        "Terminó el agarre de {actor} sobre {victim}",
        { actor, victim },
      );
    if (event.type === "clear")
      return tx(
        "{actor} freed {victim} from {class}",
        "{actor} liberó a {victim} de {class}",
        { actor, victim, class: infected },
      );
    if (event.type === "death")
      return event.victim
        ? tx("{victim} died", "{victim} murió", { victim: event.victim })
        : tx("{actor} killed {victim}", "{actor} mató a {victim}", {
            actor,
            victim: infected,
          });
    if (event.type === "witch_spawn")
      return tx("Witch became observable", "La Witch se volvió observable");
    if (event.type === "witch_enrage")
      return tx("Witch became enraged", "La Witch se enfureció");
    if (event.type === "witch_burn")
      return tx("Witch began burning", "La Witch empezó a arder");
    if (event.type === "witch_end")
      return tx(
        "Witch observation ended",
        "Terminó la observación de la Witch",
      );
    if (event.type === "attack") {
      const action = event.detail.split(":").slice(1).join(":").trim();
      return tx("{actor}: {action}", "{actor}: {action}", { actor, action });
    }
    return storyEventLabel(event);
  };
  return (
    <div
      className={`tab-panel timeline-panel ${fullscreen ? "is-fullscreen" : ""}`}
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">
            {tx("Match story", "Historia de la partida")}
          </span>
          <h2>
            {tx(
              "{count} tick-addressed moments",
              "{count} momentos ubicados por tick",
              { count: eventCount },
            )}
          </h2>
        </div>
        <div className="timeline-heading-actions">
          <span className="muted">
            {tx(
              "One independent clock per demo",
              "Un reloj independiente por demo",
            )}
          </span>
          <button
            type="button"
            className="timeline-fullscreen"
            onClick={() => setFullscreen((value) => !value)}
            aria-label={
              fullscreen
                ? tx(
                    "Exit fullscreen timeline",
                    "Salir de la cronología a pantalla completa",
                  )
                : tx(
                    "Open fullscreen timeline",
                    "Abrir la cronología a pantalla completa",
                  )
            }
          >
            {fullscreen ? <Minimize2 /> : <Maximize2 />}
            {fullscreen
              ? tx("Exit", "Salir")
              : tx("Fullscreen", "Pantalla completa")}
          </button>
        </div>
      </div>
      <div
        className={`timeline-filters ${moreTimelineFilters || ["pins", "infected", "rounds", "support"].includes(filter) ? "show-secondary" : ""}`}
        aria-label={tx("Timeline filters", "Filtros de cronología")}
      >
        <span
          className="timeline-map-filter"
          aria-label={tx("Timeline map", "Mapa de la cronología")}
        >
          {demos.map((demo) => (
            <button
              type="button"
              key={demo.sha256}
              className={mapScope === demo.sha256 ? "active" : ""}
              aria-pressed={mapScope === demo.sha256}
              onClick={() => {
                setMapScope(demo.sha256);
                setSelected(null);
                setSelectedHit(null);
              }}
            >
              {demo.mapName}
            </button>
          ))}
        </span>
        {["all", ...Object.keys(groups)].map((value) => (
          <button
            type="button"
            className={`${filter === value ? "active" : ""} ${["pins", "infected", "rounds", "support"].includes(value) ? "timeline-filter-secondary" : ""}`}
            aria-pressed={filter === value}
            aria-label={tx(
              value,
              (
                {
                  all: "todos",
                  combat: "combate",
                  pins: "agarres",
                  infected: "infectados",
                  bosses: "jefes",
                  rounds: "rondas",
                  support: "apoyo",
                } as Record<string, string>
              )[value] ?? value,
            )}
            key={value}
            onClick={() => {
              setFilter(value);
              setSelected(null);
              setSelectedHit(null);
            }}
          >
            {tx(
              value,
              (
                {
                  all: "todos",
                  combat: "combate",
                  pins: "agarres",
                  infected: "infectados",
                  bosses: "jefes",
                  rounds: "rondas",
                  support: "apoyo",
                } as Record<string, string>
              )[value] ?? value,
            )}{" "}
            <span aria-hidden="true">{filterCounts[value]}</span>
          </button>
        ))}
        <button
          type="button"
          className="timeline-more-toggle"
          aria-expanded={moreTimelineFilters}
          onClick={() => setMoreTimelineFilters((current) => !current)}
        >
          {moreTimelineFilters ? tx("Less", "Menos") : tx("More", "Más")}
        </button>
        <span
          className="timeline-zoom"
          aria-label={tx("Story density", "Densidad de la historia")}
        >
          {[1, 2, 4].map((value) => (
            <button
              key={value}
              className={zoom === value ? "active" : ""}
              aria-pressed={zoom === value}
              onClick={() => setZoom(value)}
            >
              {value === 1
                ? tx("compact", "compacto")
                : value === 2
                  ? tx("comfortable", "cómodo")
                  : tx("spacious", "espacioso")}
            </button>
          ))}
        </span>
      </div>
      <section
        aria-label={tx("Match story", "Historia de la partida")}
        className={`hit-roundup hit-density-${zoom}`}
      >
        <header>
          <strong>
            {tx(
              "{moments} story moments · {events} source events",
              "{moments} momentos de la historia · {events} eventos de origen",
              { moments: storyItems.length, events: visible.length },
            )}
          </strong>
          <span>
            {tx(
              "Select a moment to inspect its source evidence",
              "Selecciona un momento para inspeccionar su evidencia de origen",
            )}
          </span>
        </header>
        <p className="story-availability-note">
          {tx(
            "Saferoom departure/arrival, pills taken, and Witch crowns are not available in retained demo telemetry; they are not inferred here.",
            "La salida/llegada al refugio, las píldoras tomadas y las coronas a la Witch no están disponibles en la telemetría conservada; no se infieren aquí.",
          )}
        </p>
        {storyItems.length ? (
          <div className="hit-roundup-scroll">
            {storyItems.slice(0, storyLimit).map((story, storyIndex) => {
              const round = storyRoundContext(story);
              const previousRound =
                storyIndex > 0
                  ? storyRoundContext(storyItems[storyIndex - 1]!)
                  : undefined;
              return (
                <Fragment
                  key={
                    story.kind === "hit"
                      ? `${story.summary.demo.sha256}:${story.summary.hit.id}`
                      : `story:${story.items[0]!.key}`
                  }
                >
                  {previousRound?.key !== round.key && (
                    <div className="story-round-divider">
                      <strong>{round.label}</strong>
                      <span>{round.detail}</span>
                    </div>
                  )}
                  {story.kind === "event" ? (
                    <button
                      type="button"
                      className={`hit-summary-card story-event-row ${story.items
                        .map(({ event }) => `story-event-${event.type}`)
                        .join(
                          " ",
                        )} ${story.items.some((item) => item.key === selected) ? "is-selected" : ""}`}
                      aria-pressed={story.items.some(
                        (item) => item.key === selected,
                      )}
                      onClick={() => {
                        setSelected(story.items[0]!.key);
                        setSelectedHit(null);
                      }}
                    >
                      <span className="story-event-context">
                        {story.items[0]!.event.infectedClass && (
                          <InfectedIcon
                            infectedClass={story.items[0]!.event.infectedClass}
                            label={story.items[0]!.event.infectedClass}
                          />
                        )}
                        <span>
                          <strong>
                            {story.items[0]!.event.actor ??
                              story.items[0]!.event.subject ??
                              story.items[0]!.event.victim ??
                              tx("Match", "Partida")}
                          </strong>
                          <small>
                            {story.items[0]!.event.infectedClass ??
                              "match state"}
                          </small>
                          <small className="story-event-mobile-meta">
                            {story.items.length > 1
                              ? tx(
                                  "{count} linked moments",
                                  "{count} momentos vinculados",
                                  { count: story.items.length },
                                )
                              : storyEventLabel(story.items[0]!.event)}{" "}
                            ·{" "}
                            {formatElapsedTime(
                              story.items[0]!.event.timeSeconds,
                            )}
                          </small>
                        </span>
                      </span>
                      <span className="story-event-core">
                        <small>
                          {story.items.length > 1
                            ? tx(
                                "{count} linked moments",
                                "{count} momentos vinculados",
                                { count: story.items.length },
                              )
                            : storyEventLabel(story.items[0]!.event)}
                        </small>
                        <span>
                          <strong>
                            {story.items.some(
                              ({ event }) => event.type === "death",
                            )
                              ? "†"
                              : story.items.some(
                                    ({ event }) => event.type === "incap",
                                  )
                                ? "!"
                                : story.items.some(
                                      ({ event }) => event.type === "revive",
                                    )
                                  ? "+"
                                  : "•"}
                          </strong>
                        </span>
                        <small>
                          {formatElapsedTime(story.items[0]!.event.timeSeconds)}
                        </small>
                      </span>
                      <span className="story-event-detail">
                        <strong>
                          {story.items
                            .map(({ event }) => timelineDetail(event))
                            .join(" · ")}
                        </strong>
                        <small>
                          {story.items[0]!.event.weapon ??
                            (story.items.some(({ event }) => event.position)
                              ? tx("position observed", "posición observada")
                              : tx(
                                  "position unavailable",
                                  "posición no disponible",
                                ))}
                        </small>
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={`hit-summary-card ${selectedHit === `${story.summary.demo.sha256}:${story.summary.hit.id}` ? "is-selected" : ""}`}
                      aria-pressed={
                        selectedHit ===
                        `${story.summary.demo.sha256}:${story.summary.hit.id}`
                      }
                      onClick={() => {
                        setSelectedHit(
                          `${story.summary.demo.sha256}:${story.summary.hit.id}`,
                        );
                        setSelected(null);
                      }}
                    >
                      <span className="hit-summary-core">
                        <small>
                          {tx("{round} · Hit {hit}", "{round} · Ataque {hit}", {
                            round: hitRoundContext(story.summary)
                              .observedBoundary
                              ? tx("Round {number}", "Ronda {number}", {
                                  number: hitRoundContext(story.summary).round,
                                })
                              : tx("Round start", "Inicio de ronda"),
                            hit: String(
                              hitRoundContext(story.summary).hit,
                            ).padStart(2, "0"),
                          })}
                        </small>
                        <span>
                          <strong>
                            {whole.format(
                              story.summary.hit.observedSurvivorHealthLoss,
                            )}
                          </strong>
                          <small>
                            {tx("observed HP loss", "pérdida de PS observada")}
                          </small>
                        </span>
                        <small>
                          {formatTickTime(
                            story.summary.hit.tickRange.start,
                            story.summary.demo.demo.tickRate,
                          )}
                          –
                          {formatTickTime(
                            story.summary.hit.tickRange.end,
                            story.summary.demo.demo.tickRate,
                          )}
                        </small>
                      </span>
                      <span className="hit-summary-lineup">
                        {story.summary.lives.map((life) => {
                          const damageEntry = Object.entries(
                            life.counterDeltas,
                          ).find(
                            ([name]) =>
                              name.startsWith("m_checkpointPZ") &&
                              name.endsWith("Damage"),
                          );
                          const damage = damageEntry?.[1];
                          return (
                            <span key={life.id} className="hit-life">
                              <InfectedIcon
                                infectedClass={life.infectedClass}
                                label={life.infectedClass}
                              />
                              <span>
                                <strong>{life.playerAlias}</strong>
                                <small>
                                  {life.infectedClass} ·{" "}
                                  {damage !== undefined
                                    ? `${whole.format(damage)} dmg`
                                    : tx(
                                        "damage unavailable",
                                        "daño no disponible",
                                      )}
                                </small>
                                <i>
                                  <i
                                    style={{
                                      width: `${Math.min(100, (damage ?? 0) / 2)}%`,
                                    }}
                                  />
                                </i>
                              </span>
                            </span>
                          );
                        })}
                      </span>
                      <span className="hit-summary-metrics">
                        <span>
                          <strong>
                            {whole.format(story.summary.hit.controls)}
                          </strong>
                          <small>{tx("controls", "controles")}</small>
                          <i>
                            <i
                              style={{
                                width: `${Math.min(100, story.summary.hit.controls * 25)}%`,
                              }}
                            />
                          </i>
                        </span>
                        <span>
                          <strong>
                            {whole.format(
                              story.summary.hit.peakSimultaneousPins,
                            )}
                          </strong>
                          <small>{tx("peak pins", "máximo de agarres")}</small>
                          <i>
                            <i
                              style={{
                                width: `${Math.min(100, story.summary.hit.peakSimultaneousPins * 25)}%`,
                              }}
                            />
                          </i>
                        </span>
                        <span>
                          <strong>
                            {tx("{seconds}s", "{seconds}s", {
                              seconds:
                                story.summary.hit.spawnSpreadSeconds.toFixed(1),
                            })}
                          </strong>
                          <small>
                            {tx("spawn spread", "dispersión de aparición")}
                          </small>
                          <i>
                            <i
                              style={{
                                width: `${Math.min(100, story.summary.hit.spawnSpreadSeconds * 12.5)}%`,
                              }}
                            />
                          </i>
                        </span>
                      </span>
                      <span className="hit-summary-footnote">
                        {tx(
                          "Survivor → SI damage unavailable · spawn-gap-v1 grouping",
                          "Daño de Superviviente → infectado especial no disponible · agrupación spawn-gap-v1",
                        )}
                      </span>
                    </button>
                  )}
                </Fragment>
              );
            })}
            {storyLimit < storyItems.length && (
              <button
                type="button"
                className="story-show-more"
                onClick={() => setStoryLimit((current) => current + 100)}
              >
                {tx(
                  "Show next {count} of {total} moments",
                  "Mostrar los siguientes {count} de {total} momentos",
                  {
                    count: Math.min(100, storyItems.length - storyLimit),
                    total: storyItems.length,
                  },
                )}
              </button>
            )}
          </div>
        ) : (
          <p className="muted">
            {tx(
              "No major story moments match the current map and category filters.",
              "Ningún momento importante coincide con los filtros actuales de mapa y categoría.",
            )}
          </p>
        )}
        {selectedHitSummary && (
          <article className="story-inspector hit-inspector" aria-live="polite">
            <div>
              <span>
                {tx("Hit {number}", "Ataque {number}", {
                  number: hitRoundContext(selectedHitSummary).hit,
                })}{" "}
                ·{" "}
                {formatTickTime(
                  selectedHitSummary.hit.tickRange.start,
                  selectedHitSummary.demo.demo.tickRate,
                )}
                –
                {formatTickTime(
                  selectedHitSummary.hit.tickRange.end,
                  selectedHitSummary.demo.demo.tickRate,
                )}
              </span>
              <strong>
                {whole.format(
                  selectedHitSummary.hit.observedSurvivorHealthLoss,
                )}{" "}
                {tx(
                  "observed HP loss · {controls} controls · peak {pins} pins",
                  "pérdida de PS observada · {controls} controles · máximo de {pins} agarres",
                  {
                    controls: selectedHitSummary.hit.controls,
                    pins: selectedHitSummary.hit.peakSimultaneousPins,
                  },
                )}
              </strong>
              <small>
                {
                  selectedHitSummary.demo.events.filter(
                    ({ event }) =>
                      event.tick >= selectedHitSummary.hit.tickRange.start &&
                      event.tick <= selectedHitSummary.hit.tickRange.end,
                  ).length
                }{" "}
                {tx(
                  "constituent retained events · spawn-gap-v1 grouping",
                  "eventos constituyentes conservados · agrupación spawn-gap-v1",
                )}
              </small>
            </div>
          </article>
        )}
        {active && !selectedHitSummary && (
          <article className="story-inspector" aria-live="polite">
            <div>
              <span>
                {formatElapsedTime(active.event.timeSeconds)} ·{" "}
                {active.event.type.replaceAll("_", " ")}
              </span>
              <strong>{timelineDetail(active.event)}</strong>
              <small>
                {tx("tick {tick} · {map}", "tick {tick} · {map}", {
                  tick: whole.format(active.event.tick),
                  map: active.demo.mapName,
                })}
              </small>
            </div>
          </article>
        )}
      </section>
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
  const { locale, tx } = useI18n();
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
          player:
            item.presentation?.alias ??
            tx("Unlinked player", "Jugador no vinculado"),
          identityNote: item.presentation?.alias
            ? null
            : tx(
                "This detector case did not retain a reliable player identity.",
                "Este caso del detector no conservó una identidad de jugador fiable.",
              ),
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
          <span className="eyebrow">
            {tx("Interesting moments", "Momentos interesantes")}
          </span>
          <h2>
            {tx("{count} review signals", "{count} señales para revisar", {
              count: evidence.length,
            })}
          </h2>
        </div>
        <span className="safety-note">
          <ShieldAlert />{" "}
          {tx("Signals are not verdicts", "Las señales no son veredictos")}
        </span>
      </div>
      <article className="signal-explainer panel">
        <ShieldAlert />
        <div>
          <h3>
            {tx("What is a review signal?", "¿Qué es una señal para revisar?")}
          </h3>
          <p>
            {tx(
              "A detector found a short, inspectable pattern worth human review. It is not a cheating probability or verdict. Telemetry completeness describes how much of the detector's required input was retained for that moment. Counterevidence and limitations explain why an innocent play may look similar.",
              "Un detector encontró un patrón breve e inspeccionable que merece revisión humana. No es una probabilidad de trampas ni un veredicto. La integridad de la telemetría indica cuántos datos necesarios conservó el detector para ese momento. La contraevidencia y las limitaciones explican por qué una jugada inocente puede parecer similar.",
            )}
          </p>
        </div>
      </article>
      <div
        className="signal-summary"
        aria-label={tx("Signal summary", "Resumen de señales")}
      >
        <span>
          <b>{allEvidence.length}</b> {tx("windows", "ventanas")}
        </span>
        <span>
          <b>{players.length}</b> {tx("players", "jugadores")}
        </span>
        <span>
          <b>{families.length}</b>{" "}
          {tx("detector families", "familias de detectores")}
        </span>
        <span>
          <b>{new Set(allEvidence.map((item) => item.demoSha256)).size}</b>{" "}
          {tx("maps", "mapas")}
        </span>
      </div>
      <div className="signal-filters">
        <label>
          {tx("Map", "Mapa")}
          <select
            value={mapFilter}
            onChange={(event) => setMapFilter(event.target.value)}
          >
            <option value="all">{tx("All maps", "Todos los mapas")}</option>
            {analyses.map((analysis) => (
              <option key={analysis.demoSha256} value={analysis.demoSha256}>
                {analysis.engineResult.demo.mapName}
              </option>
            ))}
          </select>
        </label>
        <label>
          {tx("Player", "Jugador")}
          <select
            value={playerFilter}
            onChange={(event) => setPlayerFilter(event.target.value)}
          >
            <option value="all">
              {tx("All players", "Todos los jugadores")}
            </option>
            {players.map((player) => (
              <option key={player}>{player}</option>
            ))}
          </select>
        </label>
        <label>
          {tx("Detector", "Detector")}
          <select
            value={familyFilter}
            onChange={(event) => setFamilyFilter(event.target.value)}
          >
            <option value="all">
              {tx("All families", "Todas las familias")}
            </option>
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
                  {item.player} · {item.mapName} · {item.family} ·{" "}
                  {tx("tick", "tick")} {whole.format(item.tick)}
                </span>
                {item.identityNote && (
                  <small className="signal-identity-note">
                    {item.identityNote}
                  </small>
                )}
                <h3>
                  {localizeDetectorCopy(item.title, locale)}{" "}
                  <SourceBadge
                    kind="derived"
                    detail={tx(
                      "Detector output derived from the retained evidence window",
                      "Resultado del detector derivado de la ventana de evidencia conservada",
                    )}
                  />
                </h3>
                <p>{localizeDetectorCopy(item.explanation, locale)}</p>
                <p className="signal-counterevidence">
                  <strong>
                    {tx(
                      "Strongest counterevidence:",
                      "Contraevidencia más sólida:",
                    )}
                  </strong>{" "}
                  {item.counterevidence[0]
                    ? localizeDetectorCopy(item.counterevidence[0], locale)
                    : tx(
                        "No detector-specific counterevidence was retained.",
                        "No se conservó contraevidencia específica del detector.",
                      )}
                </p>
                <button
                  className="signal-timeline-link"
                  onClick={() =>
                    onOpenTimeline(item.jobId, item.demoSha256, item.tick)
                  }
                >
                  {tx(
                    "View tick {tick} on timeline",
                    "Ver el tick {tick} en la cronología",
                    {
                      tick: whole.format(item.tick),
                    },
                  )}
                </button>
                <dl className="signal-facts">
                  <div>
                    <dt>{tx("Window", "Ventana")}</dt>
                    <dd>
                      {duration(item.window.contextSeconds)} ·{" "}
                      {tx("ticks {start}–{end}", "ticks {start}–{end}", {
                        start: whole.format(item.tickRange.start),
                        end: whole.format(item.tickRange.end),
                      })}
                    </dd>
                  </div>
                  <div>
                    <dt>{tx("Evidence available", "Evidencia disponible")}</dt>
                    <dd>
                      {item.quality.basis.length
                        ? item.quality.basis
                            .map((value) => localizeDetectorCopy(value, locale))
                            .join(", ")
                        : tx("No stated basis", "Sin base declarada")}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      {tx("Model contribution", "Contribución al modelo")}
                    </dt>
                    <dd>
                      {item.contribution === null
                        ? tx(
                            "Descriptive only, no numeric contribution",
                            "Solo descriptivo, sin contribución numérica",
                          )
                        : tx(
                            "{value} review-model input, not cheating probability",
                            "{value} de entrada al modelo de revisión; no es una probabilidad de trampas",
                            { value: item.contribution.toFixed(3) },
                          )}
                    </dd>
                  </div>
                </dl>
                <details>
                  <summary>
                    {tx(
                      "Why this might be innocent",
                      "Por qué podría ser inocente",
                    )}
                  </summary>
                  <p>
                    {item.counterevidence
                      .map((value) => localizeDetectorCopy(value, locale))
                      .join(" ") ||
                      tx(
                        "No specific counterevidence was supplied.",
                        "No se aportó contraevidencia específica.",
                      )}
                  </p>
                </details>
                <details>
                  <summary>
                    {tx("Detector limitations", "Limitaciones del detector")}
                  </summary>
                  <p>
                    {item.limitations
                      .map((value) => localizeDetectorCopy(value, locale))
                      .join(" ") ||
                      tx(
                        "No additional limitations were recorded for this window.",
                        "No se registraron limitaciones adicionales para esta ventana.",
                      )}
                  </p>
                </details>
                <details>
                  <summary>
                    {tx(
                      "Detector lineage and configuration",
                      "Linaje y configuración del detector",
                    )}
                  </summary>
                  <dl className="signal-lineage">
                    <div>
                      <dt>{tx("Parser", "Analizador")}</dt>
                      <dd>
                        {item.versions?.parser ??
                          tx("Not retained", "No conservado")}
                      </dd>
                    </div>
                    <div>
                      <dt>{tx("Schema", "Esquema")}</dt>
                      <dd>
                        {item.versions?.schema ??
                          tx("Not retained", "No conservado")}
                      </dd>
                    </div>
                    <div>
                      <dt>{tx("Detectors", "Detectores")}</dt>
                      <dd>
                        {item.versions?.detectors.join(", ") ??
                          tx("Not retained", "No conservado")}
                      </dd>
                    </div>
                    <div>
                      <dt>{tx("Model", "Modelo")}</dt>
                      <dd>
                        {item.versions?.model ??
                          tx("Not retained", "No conservado")}
                      </dd>
                    </div>
                  </dl>
                  {item.config !== undefined && (
                    <pre>{JSON.stringify(item.config, null, 2)}</pre>
                  )}
                  {item.caseLimitations.length > 0 && (
                    <p>
                      {item.caseLimitations
                        .map((value) => localizeDetectorCopy(value, locale))
                        .join(" ")}
                    </p>
                  )}
                </details>
              </div>
              <div className="quality-score">
                <strong>{Math.round(item.quality.value * 100)}%</strong>
                <span>
                  {tx("telemetry completeness", "integridad de la telemetría")}
                </span>
                <small>
                  {tx(
                    "{count} retained inputs",
                    "{count} entradas conservadas",
                    {
                      count: item.quality.basis.length,
                    },
                  )}
                </small>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title={
            allEvidence.length
              ? tx(
                  "No signals match these filters",
                  "Ninguna señal coincide con estos filtros",
                )
              : tx("Nothing unusual surfaced", "No apareció nada inusual")
          }
          text={
            allEvidence.length
              ? tx(
                  "Change the map, player, or detector filter to see retained windows.",
                  "Cambia el filtro de mapa, jugador o detector para ver las ventanas conservadas.",
                )
              : tx(
                  "No detector window met its prerequisites. That is a result, not a guarantee.",
                  "Ninguna ventana del detector cumplió sus requisitos previos. Es un resultado, no una garantía.",
                )
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
  const { tx } = useI18n();
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
          <span className="eyebrow">
            {tx("Data coverage", "Cobertura de datos")}
          </span>
          <h2>
            {tx(
              "What could be reconstructed, and what could not",
              "Qué se pudo reconstruir y qué no",
            )}
          </h2>
        </div>
      </div>
      <p className="coverage-intro">
        {tx(
          "SourceTV demos do not contain every action a player performed. These percentages show how often each network field was available across sampled player states. They measure evidence coverage, not match quality or player skill.",
          "Las demos de SourceTV no contienen todas las acciones realizadas por un jugador. Estos porcentajes muestran con qué frecuencia estuvo disponible cada campo de red en los estados de jugador muestreados. Miden la cobertura de evidencia, no la calidad de la partida ni la habilidad del jugador.",
        )}
      </p>
      <div className="quality-grid">
        <article className="panel rings">
          <Ring value={averages.position} label={tx("Position", "Posición")} />
          <Ring
            value={averages.eyeAngles}
            label={tx("View angles", "Ángulos de visión")}
          />
          <Ring value={averages.weapon} label={tx("Weapons", "Armas")} />
          <Ring value={averages.team} label={tx("Teams", "Equipos")} />
          <Ring
            value={averages.playerClass}
            label={tx("Player class", "Clase del jugador")}
          />
        </article>
        <article className="panel provenance">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">{tx("Provenance", "Procedencia")}</span>
              <h3>{tx("Reproducible inputs", "Entradas reproducibles")}</h3>
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
                aria-label={tx(
                  "Copy SHA-256 for {map}",
                  "Copiar SHA-256 de {map}",
                  { map: analysis.engineResult.demo.mapName },
                )}
                onClick={() => {
                  void navigator.clipboard
                    .writeText(analysis.demoSha256)
                    .then(() => setCopiedHash(analysis.demoSha256));
                }}
              >
                {copiedHash === analysis.demoSha256 ? <Check /> : <Copy />}
                {copiedHash === analysis.demoSha256
                  ? tx("Copied", "Copiado")
                  : tx("Copy", "Copiar")}
              </button>
              <span className="verified">
                <Check /> {tx("verified", "verificado")}
              </span>
            </div>
          ))}
        </article>
      </div>
      <article className="panel coverage-by-map">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">
              {tx("Per-map evidence", "Evidencia por mapa")}
            </span>
            <h3>
              {tx(
                "Coverage denominators and decode status",
                "Denominadores de cobertura y estado de decodificación",
              )}
            </h3>
          </div>
          <SourceBadge kind="observed" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{tx("Map", "Mapa")}</th>
                <th>{tx("Samples", "Muestras")}</th>
                {fields.map((field) => (
                  <th key={field}>{counterLabel(field)}</th>
                ))}
                <th>{tx("Decode issues", "Problemas de decodificación")}</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((demo, index) => (
                <tr key={analyses[index]?.demoSha256 ?? index}>
                  <td>
                    {analyses[index]?.engineResult.demo.mapName ??
                      tx("Map {number}", "Mapa {number}", {
                        number: index + 1,
                      })}
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
          {tx(
            "Aggregate rings are weighted by these player-state sample counts, not by a mean of map percentages.",
            "Los anillos agregados se ponderan por estos recuentos de muestras de estado del jugador, no por una media de los porcentajes de los mapas.",
          )}
        </small>
      </article>
      <article className="panel coverage-semantics">
        <div>
          <SourceBadge kind="observed" />
          <strong>
            {tx(
              "Carried directly by a network property or game event",
              "Proporcionado directamente por una propiedad de red o evento del juego",
            )}
          </strong>
          <p>
            {tx(
              "Examples include player position, team, health, and death events.",
              "Algunos ejemplos son la posición, el equipo, la salud y los eventos de muerte del jugador.",
            )}
          </p>
        </div>
        <div>
          <SourceBadge kind="derived" />
          <strong>
            {tx(
              "Computed from bounded observed samples",
              "Calculado a partir de muestras observadas y acotadas",
            )}
          </strong>
          <p>
            {tx(
              "Examples include pin duration, SI lives, hit clusters, and narrow clears.",
              "Algunos ejemplos son la duración de los agarres, las vidas de infectados especiales, los grupos de ataques y las liberaciones estrictamente definidas.",
            )}
          </p>
        </div>
        <div>
          <SourceBadge kind="unavailable" />
          <strong>
            {tx(
              "Not present or not validated in this SourceTV demo",
              "No presente o no validado en esta demo de SourceTV",
            )}
          </strong>
          <p>
            {tx(
              "Never silently replaced with zero. Accuracy, exact damage attribution, and player input remain unavailable.",
              "Nunca se sustituye silenciosamente por cero. La precisión, la atribución exacta del daño y las entradas del jugador siguen sin estar disponibles.",
            )}
          </p>
        </div>
      </article>
      <article className="panel capability-matrix">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">
              {tx("Capability boundary", "Límite de capacidades")}
            </span>
            <h3>
              {tx(
                "What this report can and cannot prove",
                "Qué puede y qué no puede demostrar este informe",
              )}
            </h3>
          </div>
          <ShieldAlert />
        </div>
        <div>
          <section>
            <h4>
              {tx("Supported evidence", "Evidencia compatible")}{" "}
              <SourceBadge kind="observed" />
            </h4>
            <dl>
              <div>
                <dt>
                  {tx(
                    "Identity and participation",
                    "Identidad y participación",
                  )}
                </dt>
                <dd>
                  {tx(
                    "Userinfo names, SteamID64, connection epochs, team, and observed class.",
                    "Nombres de userinfo, SteamID64, épocas de conexión, equipo y clase observada.",
                  )}
                </dd>
              </div>
              <div>
                <dt>{tx("Versus structure", "Estructura de Versus")}</dt>
                <dd>
                  {tx(
                    "Scores, Survivor distance, side state, reset-aware halves, SI lives, hits, Tank, and Witch sequences.",
                    "Puntuaciones, distancia de los supervivientes, estado del bando, mitades sensibles a reinicios, vidas y ataques de infectados especiales y secuencias de Tank y Witch.",
                  )}
                </dd>
              </div>
              <div>
                <dt>{tx("Combat story", "Historia del combate")}</dt>
                <dd>
                  {tx(
                    "Death attribution, checkpoint counters, pins, incaps, revives, narrow clears, ticks, and available positions.",
                    "Atribución de muertes, contadores de checkpoint, agarres, incapacitados, reanimaciones, liberaciones estrictamente definidas, ticks y posiciones disponibles.",
                  )}
                </dd>
              </div>
              <div>
                <dt>{tx("Review lineage", "Linaje de revisión")}</dt>
                <dd>
                  {tx(
                    "Demo hashes, parser versions, coverage, detector limitations, counterevidence, and exact timeline windows.",
                    "Hashes de demos, versiones del analizador, cobertura, limitaciones del detector, contraevidencia y ventanas exactas de la cronología.",
                  )}
                </dd>
              </div>
            </dl>
          </section>
          <section>
            <h4>
              {tx("Not provable here", "No demostrable aquí")}{" "}
              <SourceBadge kind="unavailable" />
            </h4>
            <dl>
              <div>
                <dt>
                  {tx("Accuracy and exact damage", "Precisión y daño exacto")}
                </dt>
                <dd>
                  {tx(
                    "Shots, hits, misses, hit groups, attacker damage, assists, friendly fire, and exact damage taken need omitted hurt and weapon events.",
                    "Los disparos, impactos, fallos, grupos de impacto, daño del atacante, asistencias, fuego amigo y daño exacto recibido necesitan eventos de daño y armas que fueron omitidos.",
                  )}
                </dd>
              </div>
              <div>
                <dt>
                  {tx(
                    "Competitive skill events",
                    "Eventos de habilidad competitiva",
                  )}
                </dt>
                <dd>
                  {tx(
                    "Skeets, deadstops, levels, crowns, general saves, shove clears, rock hits, and hittable damage need richer live-server telemetry.",
                    "Los skeets, deadstops, levels, coronas, salvamentos generales, liberaciones con empujón, impactos de roca y daño con objetos golpeables necesitan telemetría más completa del servidor en vivo.",
                  )}
                </dd>
              </div>
              <div>
                <dt>
                  {tx(
                    "Intent and private input",
                    "Intención y entradas privadas",
                  )}
                </dt>
                <dd>
                  {tx(
                    "Voice, communications, player commands, recoil input, and intent are not present in SourceTV.",
                    "La voz, las comunicaciones, los comandos del jugador, las entradas de retroceso y la intención no están presentes en SourceTV.",
                  )}
                </dd>
              </div>
              <div>
                <dt>{tx("Cheating verdict", "Veredicto sobre trampas")}</dt>
                <dd>
                  {tx(
                    "Signals identify inspectable moments. No calibrated, representative labelled dataset supports a definitive probability or verdict.",
                    "Las señales identifican momentos inspeccionables. Ningún conjunto de datos etiquetado, representativo y calibrado permite una probabilidad o veredicto definitivo.",
                  )}
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
