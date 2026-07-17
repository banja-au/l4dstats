import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpen,
  Check,
  ChevronDown,
  Clock3,
  Download,
  ExternalLink,
  FileSearch,
  Filter,
  Fingerprint,
  Gauge,
  Layers3,
  Menu,
  MessageSquareText,
  Pause,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
  X,
  Zap,
} from "lucide-react";
import { type CaseSummary, type Evidence, type ReviewState } from "./data";
import {
  workbenchApi,
  type ApiCase,
  type ApiJob,
  type TelemetryWindow,
} from "./api";
import {
  AmbientField,
  EvidencePulse,
  HazardEmblem,
  TacticalScene,
} from "./visual";

type Route = {
  page: "dashboard" | "cases" | "case" | "demo";
  id?: string;
  caseId?: string;
  tick?: number;
};
const navItems = [
  { page: "dashboard" as const, label: "Overview", icon: BarChart3 },
  { page: "cases" as const, label: "Cases", icon: Users },
];

function routeFromHash(): Route {
  const [path, query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  const [page = "dashboard", id] = path!.split("/");
  const params = new URLSearchParams(query);
  const tick = Number(params.get("tick"));
  const linkedCase = params.get("case");
  const context =
    Number.isInteger(tick) && tick >= 0
      ? { tick, ...(linkedCase ? { caseId: linkedCase } : {}) }
      : {};
  return page === "case" || page === "demo" || page === "cases"
    ? id
      ? { page, id, ...context }
      : { page }
    : { page: "dashboard" };
}

function useApiCases() {
  const [items, setItems] = useState<ApiCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void workbenchApi
      .cases()
      .then((value) => {
        if (live) setItems(value);
      })
      .catch((cause: unknown) => {
        if (live)
          setError(
            cause instanceof Error ? cause.message : "Could not load cases",
          );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);
  return { items, loading, error };
}

function displayCase(apiCase: ApiCase) {
  const presentation = apiCase.presentation;
  if (!presentation)
    return {
      id: apiCase.id,
      alias: apiCase.playerKey,
      identity: "Presentation metadata unavailable",
      priority: null,
      label: "insufficient data",
      demos: [],
      encounters: 0,
      independentFamilies: 0,
      state: apiCase.status,
      lastActivity: new Date(apiCase.updatedAt).toLocaleString(),
      evidence: [],
    } satisfies CaseSummary;
  const score = apiCase.score ?? {};
  const priority =
    typeof score.reviewPriority === "number" ? score.reviewPriority : null;
  const rawLabel = score.label;
  const label =
    rawLabel === "highly-anomalous"
      ? "highly anomalous"
      : priority === null
        ? "insufficient data"
        : "ranked evidence";
  return {
    id: apiCase.id,
    alias: presentation.alias,
    identity: presentation.identityLabel,
    priority,
    label,
    demos: presentation.demos.map((demo) => demo.id),
    encounters: presentation.summary.encounterCount,
    independentFamilies: presentation.summary.independentSignalFamilies.length,
    state: apiCase.status,
    lastActivity: new Date(apiCase.updatedAt).toLocaleString(),
    evidence: presentation.evidence.map((event) => ({
      id: event.id,
      demoId:
        presentation.demos.find((demo) => demo.sha256 === event.demoSha256)
          ?.id ?? null,
      family:
        event.family === "aim" || event.family === "cadence"
          ? event.family
          : "awareness",
      title: event.title,
      tick: event.tick,
      time: `tick ${event.tick.toLocaleString()}`,
      window: `ticks ${event.window.startTick.toLocaleString()}–${event.window.endTick.toLocaleString()}`,
      contribution: event.contribution,
      quality: event.quality.value,
      explanation: event.explanation,
      counterevidence:
        event.counterevidence.join(" ") || "No counterevidence was supplied.",
      limitation: event.limitations.join(" ") || "No limitation was supplied.",
    })),
  } satisfies CaseSummary;
}

function meanEvidenceQuality(evidence: Evidence[]) {
  const known = evidence.flatMap((event) =>
    event.quality === null ? [] : [event.quality],
  );
  return known.length
    ? Math.round(
        (known.reduce((sum, value) => sum + value, 0) / known.length) * 100,
      )
    : null;
}

function App() {
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [menuOpen, setMenuOpen] = useState(false);
  const [ingestOpen, setIngestOpen] = useState(false);
  const navigate = (next: Route) => {
    const query =
      next.tick !== undefined
        ? `?tick=${next.tick}${next.caseId ? `&case=${encodeURIComponent(next.caseId)}` : ""}`
        : "";
    location.hash = `${next.page}${next.id ? `/${next.id}` : ""}${query}`;
    setRoute(next);
    setMenuOpen(false);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <aside
        className={`sidebar ${menuOpen ? "is-open" : ""}`}
        aria-label="Primary navigation"
      >
        <button
          className="mobile-close"
          onClick={() => setMenuOpen(false)}
          aria-label="Close navigation"
        >
          <X />
        </button>
        <button
          className="brand"
          onClick={() => navigate({ page: "dashboard" })}
        >
          <span className="brand-mark">
            <HazardEmblem />
          </span>
          <span>
            <b>Witchwatch</b>
            <small>Demo intelligence</small>
          </span>
        </button>
        <nav aria-label="Workbench">
          {navItems.map(({ page, label, icon: Icon }) => (
            <button
              key={page}
              className={route.page === page ? "active" : ""}
              onClick={() => navigate({ page })}
            >
              <Icon />
              {label}
            </button>
          ))}
          <button
            className={route.page === "demo" ? "active" : ""}
            onClick={() => navigate({ page: "demo", id: "select-from-case" })}
          >
            <FileSearch />
            Demos
          </button>
        </nav>
        <div className="sidebar-foot">
          <ShieldCheck />
          <div>
            <b>Research workbench</b>
            <span>No automated verdicts or actions</span>
          </div>
        </div>
      </aside>
      {menuOpen && (
        <button
          className="backdrop"
          onClick={() => setMenuOpen(false)}
          aria-label="Close navigation overlay"
        />
      )}
      <main id="workspace" className="workspace" tabIndex={-1}>
        <header className="topbar">
          <button
            className="menu-button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open navigation"
          >
            <Menu />
          </button>
          <div className="crumb">
            <span>LOCAL WORKSPACE</span>
            <i />{" "}
            <b>
              {route.page === "dashboard"
                ? "Overview"
                : route.page === "cases"
                  ? "Case queue"
                  : route.page}
            </b>
          </div>
          <div className="top-actions">
            <button className="icon-button" aria-label="View documentation">
              <BookOpen />
            </button>
            <button
              className="ingest-button"
              onClick={() => setIngestOpen(true)}
            >
              <Upload />
              Ingest demo
            </button>
          </div>
        </header>
        {route.page === "dashboard" && (
          <Dashboard navigate={navigate} onIngest={() => setIngestOpen(true)} />
        )}
        {route.page === "cases" && <CaseQueue navigate={navigate} />}
        {route.page === "case" && (
          <CaseDetail
            id={route.id ?? "select-from-queue"}
            navigate={navigate}
          />
        )}
        {route.page === "demo" && (
          <DemoDetail
            id={route.id ?? "select-from-case"}
            caseId={route.caseId}
            tick={route.tick}
            navigate={navigate}
          />
        )}
      </main>
      {ingestOpen && <IngestDialog onClose={() => setIngestOpen(false)} />}
    </div>
  );
}

function Dashboard({
  navigate,
  onIngest,
}: {
  navigate: (route: Route) => void;
  onIngest: () => void;
}) {
  const api = useApiCases();
  const visibleCases = api.items
    .map(displayCase)
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  return (
    <div className="page dashboard-page">
      <section className="hero-panel">
        <div
          className="hero-keyart"
          role="img"
          aria-label="Original bloated infected figure in a rain-soaked quarantine alley"
        />
        <AmbientField />
        <div className="hero-copy">
          <div className="eyebrow">
            <Activity /> LOCAL REVIEW WORKBENCH
          </div>
          <h1>
            Evidence, with the
            <br />
            <em>uncertainty left in.</em>
          </h1>
          <p>
            Review reconstructed play across demos. Every signal carries its
            quality, limitation, and strongest benign explanation.
          </p>
          <div className="hero-actions">
            <button
              className="primary"
              onClick={() => navigate({ page: "cases" })}
            >
              Open review queue <ArrowRight />
            </button>
            <button className="secondary" onClick={onIngest}>
              <Upload /> Add demo
            </button>
          </div>
        </div>
        <div className="hero-illustration">
          <EvidencePulse compact />
          <div className="radar-caption">
            <Zap /> TELEMETRY INDEXED
            <br />
            <b>bounded range queries</b>
          </div>
        </div>
      </section>
      <section className="metrics" aria-label="Workspace summary">
        <Metric
          label="Awaiting review"
          value={
            api.loading
              ? "…"
              : String(
                  api.items.filter((item) => item.status === "unreviewed")
                    .length,
                ).padStart(2, "0")
          }
          sub="from the local API"
          tone="acid"
        />
        <Metric
          label="API cases"
          value={api.loading ? "…" : String(api.items.length).padStart(2, "0")}
          sub={api.error || "persisted locally"}
        />
        <Metric
          label="Evidence windows"
          value="—"
          sub="available after analysis"
        />
        <Metric
          label="Telemetry"
          value="bounded"
          sub="whole files stay server-side"
        />
      </section>
      <div className="section-heading">
        <div>
          <span className="kicker">REVIEW QUEUE</span>
          <h2>Cases worth a second look</h2>
        </div>
        <button
          className="text-button"
          onClick={() => navigate({ page: "cases" })}
        >
          View all cases <ArrowRight />
        </button>
      </div>
      <section className="case-grid">
        {visibleCases.map((item) => (
          <CaseCard
            key={item.id}
            item={item}
            onClick={() => navigate({ page: "case", id: item.id })}
          />
        ))}
      </section>
      <div className="split-grid">
        <section className="panel">
          <div className="panel-title">
            <div>
              <span className="kicker">API PRESENTATION</span>
              <h3>Demo context is case-scoped</h3>
            </div>
            <button className="icon-button" aria-label="Filter recent demos">
              <Filter />
            </button>
          </div>
          <div className="empty-state">
            <Layers3 />
            <h3>No global demo claims</h3>
            <p>
              Open a case returned by the API to see only its associated demos,
              provenance, and bounded evidence windows.
            </p>
          </div>
        </section>
        <SafetyPanel />
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: string;
}) {
  return (
    <div className={`metric ${tone ?? ""}`}>
      <span>{label}</span>
      <b>{value}</b>
      <small>{sub}</small>
    </div>
  );
}
function Quality({ value }: { value: number }) {
  return (
    <span className={`quality ${value < 70 ? "warn" : ""}`}>
      <i style={{ width: `${value}%` }} />
      <small>{value}% quality</small>
    </span>
  );
}

function CaseCard({
  item,
  onClick,
}: {
  item: CaseSummary;
  onClick: () => void;
}) {
  return (
    <button className="case-card" onClick={onClick}>
      <div className="case-top">
        <span className="avatar">{item.alias.slice(-2)}</span>
        <span className="case-name">
          <b>{item.alias}</b>
          <small>{item.identity}</small>
        </span>
        <Priority value={item.priority} />
      </div>
      <div className="case-label">
        <span className={`status-dot ${item.label.replace(" ", "-")}`} />
        {item.label}
      </div>
      <div className="case-stats">
        <span>
          <b>{item.demos.length}</b> demos
        </span>
        <span>
          <b>{item.encounters}</b> encounters
        </span>
        <span>
          <b>{item.independentFamilies}</b> families
        </span>
      </div>
      <div className="case-foot">
        <span className={`review-state ${item.state}`}>
          {item.state.replace("-", " ")}
        </span>
        <span>
          {item.lastActivity} <ArrowRight />
        </span>
      </div>
    </button>
  );
}
function Priority({ value }: { value: number | null }) {
  return (
    <span
      className={`priority ${value === null ? "muted" : value > 75 ? "hot" : ""}`}
      aria-label={
        value === null ? "No review priority" : `Review priority ${value}`
      }
    >
      <small>{value === null ? "No review priority" : "priority"}</small>
      <b>{value ?? "—"}</b>
    </span>
  );
}

function CaseQueue({ navigate }: { navigate: (route: Route) => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const api = useApiCases();
  const apiCases = api.items
    .map(displayCase)
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const visible = useMemo(
    () =>
      apiCases.filter(
        (item) =>
          (filter === "all" || item.state === filter) &&
          `${item.alias} ${item.identity}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [query, filter, apiCases],
  );
  return (
    <div className="page">
      <PageTitle
        kicker="CASE QUEUE"
        title="Triage without shortcuts"
        description="Priority orders attention. It is not a verdict, and missing data never becomes certainty."
      />
      {api.items.some(
        (item) => item.presentation?.provenance.controlledFixture,
      ) && (
        <p className="fixture-notice">
          <Sparkles /> Controlled seeded examples are invented workflow data and
          represent no real player or demo.
        </p>
      )}
      <div className="toolbar">
        <label className="search">
          <Search />
          <span className="sr-only">Search cases</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search player or identity…"
          />
        </label>
        <label className="select-wrap">
          <Filter />
          <span className="sr-only">Filter by status</span>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="unreviewed">Unreviewed</option>
            <option value="in-review">In review</option>
            <option value="needs-context">Needs context</option>
            <option value="resolved">Resolved</option>
          </select>
          <ChevronDown />
        </label>
      </div>
      {visible.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Player epoch</th>
                <th>Review priority</th>
                <th>Evidence</th>
                <th>Quality</th>
                <th>Status</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => navigate({ page: "case", id: item.id })}
                >
                  <td>
                    <b>{item.alias}</b>
                    <small>{item.identity}</small>
                  </td>
                  <td>
                    <Priority value={item.priority} />
                    <small>{item.label}</small>
                  </td>
                  <td>
                    <b>{item.encounters} encounters</b>
                    <small>
                      {item.demos.length} demos · {item.independentFamilies}{" "}
                      families
                    </small>
                  </td>
                  <td>
                    {meanEvidenceQuality(item.evidence) === null ? (
                      <span className="method-chip">unavailable</span>
                    ) : (
                      <Quality value={meanEvidenceQuality(item.evidence)!} />
                    )}
                  </td>
                  <td>
                    <span className={`review-state ${item.state}`}>
                      {item.state.replace("-", " ")}
                    </span>
                  </td>
                  <td>
                    <button
                      className="row-action"
                      onClick={(event) => {
                        event.stopPropagation();
                        navigate({ page: "case", id: item.id });
                      }}
                      aria-label={`Open ${item.alias} case`}
                    >
                      <ArrowRight />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState />
      )}
    </div>
  );
}

function CaseDetail(props: { id: string; navigate: (route: Route) => void }) {
  const [apiCase, setApiCase] = useState<ApiCase | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void workbenchApi
      .case(props.id)
      .then((value) => {
        if (live) setApiCase(value);
      })
      .catch((cause: unknown) => {
        if (live)
          setError(cause instanceof Error ? cause.message : "Case unavailable");
      });
    return () => {
      live = false;
    };
  }, [props.id]);
  if (error)
    return (
      <div className="page">
        <EmptyState />
        <p role="alert">{error}</p>
      </div>
    );
  if (!apiCase)
    return (
      <div className="page">
        <p className="fixture-notice" role="status">
          <Activity /> Loading case detail from the local API…
        </p>
      </div>
    );
  return <CaseDetailLoaded {...props} apiCase={apiCase} />;
}

function CaseDetailLoaded({
  id,
  navigate,
  apiCase,
}: {
  id: string;
  navigate: (route: Route) => void;
  apiCase: ApiCase;
}) {
  const item = displayCase(apiCase);
  const [selected, setSelected] = useState(item.evidence[0]);
  const [state, setState] = useState<ReviewState>(item.state);
  const [notes, setNotes] = useState<
    Array<{ id: string; author: string; at: string; body: string }>
  >([]);
  const [draft, setDraft] = useState("");
  const [persistence, setPersistence] = useState(
    "Connected to local evidence store",
  );
  useEffect(() => {
    Promise.all([
      workbenchApi.notes(item.id),
      workbenchApi.reviewStatus(item.id),
    ])
      .then(([persisted, persistedStatus]) => {
        setState(persistedStatus);
        setNotes([
          ...persisted.map((note) => ({
            id: note.id,
            author: "Local reviewer",
            at: new Date(note.createdAt).toLocaleString(),
            body: note.body,
          })),
        ]);
      })
      .catch(() =>
        setPersistence("Local API unavailable — changes are paused"),
      );
  }, [item.id]);
  const addNote = async () => {
    if (!draft.trim()) return;
    try {
      const created = await workbenchApi.addNote(
        item.id,
        draft.trim(),
        selected?.tick ?? null,
      );
      setNotes([
        ...notes,
        {
          id: created.id,
          author: "Local reviewer",
          at: "Just now",
          body: draft.trim(),
        },
      ]);
      setDraft("");
      setPersistence("Note saved to the local audit log");
    } catch (error) {
      setPersistence(
        error instanceof Error ? error.message : "Note was not saved",
      );
    }
  };
  const changeStatus = async (next: ReviewState) => {
    const previous = state;
    setState(next);
    try {
      await workbenchApi.setReviewStatus(item.id, next);
      setPersistence("Review status saved to the local audit log");
    } catch (error) {
      setState(previous);
      setPersistence(
        error instanceof Error ? error.message : "Review status was not saved",
      );
    }
  };
  const exportReport = async () => {
    try {
      const sha = await workbenchApi.downloadVerifiedReport(item.id);
      setPersistence(`Verified report exported · SHA-256 ${sha.slice(0, 12)}…`);
    } catch (error) {
      setPersistence(error instanceof Error ? error.message : "Export failed");
    }
  };
  return (
    <div className="page case-detail">
      {apiCase.presentation?.provenance.controlledFixture && (
        <p className="fixture-notice">
          <Sparkles /> Controlled seeded example · invented evidence for
          workflow evaluation only.
        </p>
      )}
      <button className="back-link" onClick={() => navigate({ page: "cases" })}>
        <ArrowLeft /> Back to queue
      </button>
      <section className="case-header">
        <div className="identity-block">
          <span className="avatar large">{item.alias.slice(-2)}</span>
          <div>
            <span className="kicker">
              CROSS-DEMO CASE · {item.id.toUpperCase()}
            </span>
            <h1>{item.alias}</h1>
            <p>
              <Fingerprint /> {item.identity}
            </p>
          </div>
        </div>
        <div className="case-header-actions">
          <label className="state-select">
            <span>Review status</span>
            <select
              value={state}
              onChange={(e) => void changeStatus(e.target.value as ReviewState)}
            >
              <option value="unreviewed">Unreviewed</option>
              <option value="in-review">In review</option>
              <option value="needs-context">Needs context</option>
              <option value="resolved">Resolved — no action</option>
            </select>
          </label>
          <button className="secondary" onClick={() => void exportReport()}>
            <Download /> Export manifest
          </button>
          <span className="persistence-status" role="status">
            {persistence}
          </span>
        </div>
      </section>
      <section className="case-summary">
        <div className="score-orbit">
          <Priority value={item.priority} />
          <svg
            viewBox="0 0 100 100"
            role="img"
            aria-label={`${item.priority ?? "No"} review priority`}
          >
            <circle cx="50" cy="50" r="44" />
            <circle
              className="progress"
              cx="50"
              cy="50"
              r="44"
              pathLength="100"
              strokeDasharray={`${item.priority ?? 0} 100`}
            />
          </svg>
        </div>
        <div className="summary-copy">
          <span className={`signal-label ${item.label.replace(" ", "-")}`}>
            {item.priority === null
              ? "No review priority · insufficient data"
              : item.label}
          </span>
          <h2>
            {item.priority === null
              ? "Not enough independent evidence"
              : "Multiple independent signals warrant human review"}
          </h2>
          <p>
            Built from {item.encounters} encounter windows across{" "}
            {item.demos.length} demos. Contributions are capped by detector,
            encounter, and demo to avoid repeated ticks manufacturing
            confidence.
          </p>
        </div>
        <div className="summary-facts">
          <span>
            <Gauge />
            <b>
              {meanEvidenceQuality(item.evidence) === null
                ? "—"
                : `${meanEvidenceQuality(item.evidence)}%`}
            </b>
            <small>reconstruction</small>
          </span>
          <span>
            <Layers3 />
            <b>{item.independentFamilies}</b>
            <small>signal families</small>
          </span>
          <span>
            <Clock3 />
            <b>{item.demos.length}</b>
            <small>independent demos</small>
          </span>
        </div>
      </section>
      <section className="evidence-layout">
        <div className="evidence-stack">
          <div className="section-heading compact">
            <div>
              <span className="kicker">EVIDENCE WINDOWS</span>
              <h2>What moved the ranking</h2>
            </div>
            <span className="window-count">{item.evidence.length} windows</span>
          </div>
          {item.evidence.map((event) => (
            <EvidenceCard
              key={event.id}
              event={event}
              active={selected?.id === event.id}
              onClick={() => setSelected(event)}
            />
          ))}
        </div>
        {selected ? (
          <EvidenceInspector
            event={selected}
            navigate={navigate}
            demoId={selected.demoId}
            caseId={item.id}
          />
        ) : (
          <div className="empty-state">
            <AlertTriangle />
            <h3>No evidence windows supplied</h3>
            <p>
              This case remains reviewable, but the API did not provide bounded
              evidence presentation data.
            </p>
          </div>
        )}
      </section>
      <section className="corroboration panel">
        <div className="panel-title">
          <div>
            <span className="kicker">CORROBORATION</span>
            <h3>Across independent demos</h3>
          </div>
          <span className="method-chip">influence capped per demo</span>
        </div>
        <div
          className="comparison-grid"
          aria-label="Cross-demo evidence comparison"
        >
          <span className="comparison-head">Demo</span>
          <span className="comparison-head">Independent windows</span>
          <span className="comparison-head">Reconstruction</span>
          <span className="comparison-head">Interpretation</span>
          {(apiCase.presentation?.demos ?? []).map((demo, index) => {
            const windows = apiCase.presentation!.evidence.filter(
              (event) => event.demoSha256 === demo.sha256,
            );
            const families = [...new Set(windows.map((event) => event.family))];
            return (
              <div className="comparison-row" key={`compare-${demo.id}`}>
                <b>
                  {demo.mapName ?? "Map unavailable"}
                  <small>{demo.sha256}</small>
                </b>
                <span>
                  {windows.length}{" "}
                  <small>
                    {families.length
                      ? families.join(" + ")
                      : "no bounded windows"}
                  </small>
                </span>
                <span>
                  {demo.quality.value === null
                    ? "Unavailable"
                    : `${Math.round(demo.quality.value * 100)}%`}{" "}
                  <small>{demo.quality.basis.join(" · ")}</small>
                </span>
                <span>
                  {demo.corroboration === "same-stable-player"
                    ? index === 0
                      ? "Primary evidence"
                      : "Cross-demo persistence"
                    : "Not associated across demos"}
                  <small>
                    {demo.corroboration === "same-stable-player"
                      ? "influence capped independently"
                      : "excluded from persistence"}
                  </small>
                </span>
              </div>
            );
          })}
        </div>
        <div className="demo-list">
          {(apiCase.presentation?.demos ?? []).map((demo) => {
            const findingCount = apiCase.presentation!.evidence.filter(
              (event) => event.demoSha256 === demo.sha256,
            ).length;
            return (
              <button
                key={demo.id}
                onClick={() =>
                  navigate({ page: "demo", id: demo.id, caseId: item.id })
                }
              >
                <span className="map-thumb">
                  <Layers3 />
                </span>
                <span className="demo-main">
                  <b>{demo.mapName ?? "Map unavailable"}</b>
                  <small>
                    {demo.sourceLabel} · {demo.sha256}
                  </small>
                </span>
                {demo.quality.value === null ? (
                  <span className="method-chip">quality unavailable</span>
                ) : (
                  <Quality value={Math.round(demo.quality.value * 100)} />
                )}
                <span className="finding-count">
                  {findingCount}
                  <small>signals</small>
                </span>
                <ArrowRight />
              </button>
            );
          })}
        </div>
      </section>
      <section className="notes-panel">
        <div className="panel-title">
          <div>
            <span className="kicker">REVIEW LOG</span>
            <h3>Notes stay with the case</h3>
          </div>
          <span className="method-chip">
            <Check /> saved locally
          </span>
        </div>
        <div className="notes-list">
          {notes.map((note) => (
            <article key={note.id}>
              <span className="avatar tiny">LR</span>
              <div>
                <b>
                  {note.author}
                  <small>{note.at}</small>
                </b>
                <p>{note.body}</p>
              </div>
            </article>
          ))}
        </div>
        <div className="note-compose">
          <MessageSquareText />
          <label>
            <span className="sr-only">Add review note</span>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Record context, uncertainty, or the next check…"
            />
          </label>
          <button
            className="primary"
            onClick={() => void addNote()}
            disabled={!draft.trim()}
          >
            Add note
          </button>
        </div>
      </section>
    </div>
  );
}

function EvidenceCard({
  event,
  active,
  onClick,
}: {
  event: Evidence;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`evidence-card ${active ? "active" : ""}`}
      onClick={onClick}
    >
      <span className={`family-icon ${event.family}`}>
        <Activity />
      </span>
      <span className="evidence-copy">
        <small>
          {event.family} · tick {event.tick.toLocaleString()}
        </small>
        <b>{event.title}</b>
        <p>{event.explanation}</p>
        <span className="counter">
          <ShieldCheck /> Benign context: {event.counterevidence}
        </span>
      </span>
      <span className="evidence-meta">
        <b>
          {event.contribution === null
            ? "—"
            : `+${event.contribution.toFixed(2)}`}
        </b>
        <small>
          {event.contribution === null
            ? "contribution unavailable"
            : "contribution"}
        </small>
        {event.quality === null ? (
          <small>quality unavailable</small>
        ) : (
          <Quality value={Math.round(event.quality * 100)} />
        )}
      </span>
    </button>
  );
}
function EvidenceInspector({
  event,
  navigate,
  demoId,
  caseId,
}: {
  event: Evidence;
  navigate: (r: Route) => void;
  demoId: string | null;
  caseId: string;
}) {
  return (
    <aside className="inspector">
      <div className="inspector-preview">
        <TacticalScene active />
        <span className="player-dot subject" />
        <span className="player-dot target" />
        <span className="sight-line" />
        <div className="play-controls">
          <button aria-label="Play evidence context">
            <Play />
          </button>
          <span>
            {event.time} / {event.window}
          </span>
          <span className="scrub">
            <i />
          </span>
        </div>
      </div>
      <div className="inspector-body">
        <span className="kicker">SELECTED WINDOW</span>
        <h3>{event.title}</h3>
        <dl>
          <div>
            <dt>Primary tick</dt>
            <dd>{event.tick.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Window</dt>
            <dd>{event.window}</dd>
          </div>
          <div>
            <dt>Data quality</dt>
            <dd>
              {event.quality === null
                ? "Unavailable"
                : `${Math.round(event.quality * 100)}%`}
            </dd>
          </div>
        </dl>
        <div className="context-box benign">
          <ShieldCheck />
          <div>
            <b>Strongest benign explanation</b>
            <p>{event.counterevidence}</p>
          </div>
        </div>
        <div className="context-box limitation">
          <AlertTriangle />
          <div>
            <b>Known limitation</b>
            <p>{event.limitation}</p>
          </div>
        </div>
        <button
          className="primary wide"
          disabled={demoId === null}
          onClick={() =>
            demoId &&
            navigate({ page: "demo", id: demoId, caseId, tick: event.tick })
          }
        >
          {demoId ? "Inspect 8-second context" : "Demo association unavailable"}{" "}
          <ExternalLink />
        </button>
      </div>
    </aside>
  );
}

function DemoDetail({
  id,
  caseId,
  tick,
  navigate,
}: {
  id: string;
  caseId: string | undefined;
  tick: number | undefined;
  navigate: (r: Route) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [detail, setDetail] = useState<ApiCase | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryWindow | null>(null);
  const [telemetryState, setTelemetryState] = useState(
    "Select a finding to request bounded telemetry",
  );
  useEffect(() => {
    if (!caseId) return;
    void workbenchApi
      .case(caseId)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [caseId]);
  const demo = detail?.presentation?.demos.find(
    (candidate) => candidate.id === id,
  );
  useEffect(() => {
    if (!caseId || tick === undefined || !demo) return;
    const start = Math.max(0, tick - 256);
    const end = tick + 256;
    setTelemetryState(
      `Loading ticks ${start.toLocaleString()}–${end.toLocaleString()}…`,
    );
    void workbenchApi
      .telemetry(caseId, start, end, demo.sha256)
      .then((result) => {
        setTelemetry(result);
        setTelemetryState(
          `Bounded API window · ticks ${result.startTick.toLocaleString()}–${result.endTick.toLocaleString()}`,
        );
      })
      .catch((cause: unknown) =>
        setTelemetryState(
          cause instanceof Error ? cause.message : "Telemetry unavailable",
        ),
      );
  }, [caseId, tick, demo?.sha256]);
  return (
    <div className="page">
      {detail?.presentation?.provenance.controlledFixture && (
        <p className="fixture-notice">
          <Sparkles /> Controlled seeded example · invented workflow data. The
          tactical scene is analytical reconstruction, not game footage.
        </p>
      )}
      <button
        className="back-link"
        onClick={() => navigate({ page: "dashboard" })}
      >
        <ArrowLeft /> Overview
      </button>
      <PageTitle
        kicker={
          demo
            ? `${demo.sourceLabel} · API presentation v1`
            : "DEMO CONTEXT UNAVAILABLE"
        }
        title={demo?.mapName ?? id}
        description={
          demo
            ? `SHA-256 ${demo.sha256}`
            : "Open a bounded evidence link from an API case to inspect this demo."
        }
      />
      <section className="playback">
        <div className="playback-map">
          <TacticalScene active={playing} />
          <span className="route-line" />
          <span className="player-dot subject" />
          <span className="player-dot target" />
          <span className="player-dot ally" />
          <div className="map-legend">
            <span>
              <i className="legend-subject" />
              subject
            </span>
            <span>
              <i className="legend-target" />
              opponent
            </span>
            <span>
              <i className="legend-ally" />
              teammate
            </span>
          </div>
          <span className="floor-label">
            FLOOR 01 · ANALYTICAL RECONSTRUCTION
          </span>
        </div>
        <div className="timeline">
          <button
            className="round-control"
            onClick={() => setPlaying(!playing)}
            aria-label={playing ? "Pause playback" : "Play playback"}
          >
            {playing ? <Pause /> : <Play />}
          </button>
          <span className="clock">
            tick {telemetry?.startTick.toLocaleString() ?? "—"}
          </span>
          <div className="lanes">
            <div className="ticks" />
            <span className="playhead" />
            <span className="event-mark aim" />
            <span className="event-mark awareness" />
            <span className="event-mark cadence" />
          </div>
          <span className="clock">
            tick {telemetry?.endTick.toLocaleString() ?? "—"}
          </span>
        </div>
      </section>
      <div className="telemetry-receipt" role="status">
        <Activity /> <b>{telemetryState}</b>
        {telemetry && (
          <span>
            {telemetry.chunks.length} bounded chunk ·{" "}
            {telemetry.chunks.flatMap((chunk) => chunk.poses ?? []).length}{" "}
            poses returned · demo {demo?.sha256 ?? "unavailable"} · whole
            telemetry artifact withheld
          </span>
        )}
      </div>
      <section className="demo-meta-grid">
        <div className="panel">
          <div className="panel-title">
            <div>
              <span className="kicker">DATA HEALTH</span>
              <h3>Reconstruction coverage</h3>
            </div>
            {demo?.quality.value === null || !demo ? (
              <span className="method-chip">quality unavailable</span>
            ) : (
              <Quality value={Math.round(demo.quality.value * 100)} />
            )}
          </div>
          <div className="coverage-list">
            <span>
              Quality basis{" "}
              <b>{demo?.quality.basis.join(" · ") ?? "unavailable"}</b>
            </span>
            <span>
              Bounded telemetry <b>{telemetry ? "loaded" : "not loaded"}</b>
            </span>
            <span>
              Dynamic visibility{" "}
              <b className="unknown">unavailable unless supplied</b>
            </span>
            <span>
              Whole artifact <b>withheld</b>
            </span>
          </div>
        </div>
        <div className="panel provenance">
          <span className="kicker">PROVENANCE</span>
          <h3>Traceable to source</h3>
          <p>
            <b>Source</b>
            {demo?.sourceLabel ?? "unavailable"}
          </p>
          <p>
            <b>Demo SHA-256</b>
            {demo?.sha256 ?? "unavailable"}
          </p>
          <p>
            <b>Presentation</b>case-presentation/v1
          </p>
          <p>
            <b>Association</b>
            {detail?.presentation?.association.explanation ?? "unavailable"}
          </p>
        </div>
      </section>
      <div className="section-heading">
        <div>
          <span className="kicker">RELATED CASES</span>
          <h2>Findings in this demo</h2>
        </div>
      </div>
      <section className="case-grid">
        {detail && (
          <CaseCard
            item={displayCase(detail)}
            onClick={() => navigate({ page: "case", id: detail.id })}
          />
        )}
      </section>
    </div>
  );
}

function PageTitle({
  kicker,
  title,
  description,
}: {
  kicker: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-title">
      <span className="kicker">{kicker}</span>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}
function SafetyPanel() {
  return (
    <section className="safety-panel">
      <div className="safety-rings">
        <ShieldCheck />
      </div>
      <span className="kicker">DESIGNED FOR RESTRAINT</span>
      <h3>A lead, never a verdict.</h3>
      <p>
        Review priority organizes human attention. Every result keeps
        uncertainty, counterevidence, and lineage attached.
      </p>
      <ul>
        <li>
          <Check /> No automatic action
        </li>
        <li>
          <Check /> No public accusation
        </li>
        <li>
          <Check /> Hash-verifiable exports
        </li>
      </ul>
    </section>
  );
}
function EmptyState() {
  return (
    <div className="empty-state">
      <Search />
      <h3>No cases match this view</h3>
      <p>Clear your search or choose another review status.</p>
    </div>
  );
}

function IngestDialog({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<"local" | "remote">("local");
  const [source, setSource] = useState("/data/inbox/example.dem");
  const [job, setJob] = useState<ApiJob | null>(null);
  const [error, setError] = useState("");
  const active = job?.state === "queued" || job?.state === "running";

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    if (!active || !job) return;
    const timer = window.setInterval(() => {
      workbenchApi
        .job(job.id)
        .then(setJob)
        .catch((reason: unknown) =>
          setError(
            reason instanceof Error ? reason.message : "Status check failed",
          ),
        );
    }, 600);
    return () => window.clearInterval(timer);
  }, [active, job]);

  const submit = async () => {
    setError("");
    try {
      setJob(
        await workbenchApi.createJob(
          kind === "local"
            ? { kind, path: source.trim() }
            : { kind, url: source.trim() },
        ),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ingest failed");
    }
  };

  return (
    <div className="dialog-layer" role="presentation">
      <button
        className="dialog-scrim"
        aria-label="Close ingest dialog"
        onClick={onClose}
      />
      <section
        className="ingest-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ingest-title"
      >
        <div className="dialog-heading">
          <div>
            <span className="kicker">BOUNDED LOCAL INGEST</span>
            <h2 id="ingest-title">Add a demo to the evidence queue</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close ingest dialog"
            onClick={onClose}
          >
            <X />
          </button>
        </div>
        <p>
          Local files must be mounted below <code>/data/inbox</code>. Remote
          URLs must use HTTPS and an explicitly allowlisted host. Every accepted
          local file is hashed before the worker sees it.
        </p>
        <div
          className="source-switch"
          role="group"
          aria-label="Demo source type"
        >
          <button
            className={kind === "local" ? "active" : ""}
            onClick={() => {
              setKind("local");
              setSource("/data/inbox/example.dem");
            }}
          >
            Local file
          </button>
          <button
            className={kind === "remote" ? "active" : ""}
            onClick={() => {
              setKind("remote");
              setSource("https://cedapug.com/demos/");
            }}
          >
            Allowlisted URL
          </button>
        </div>
        <label className="source-field">
          <span>{kind === "local" ? "Container path" : "HTTPS URL"}</span>
          <input
            autoFocus
            value={source}
            onChange={(event) => setSource(event.target.value)}
            disabled={active}
          />
        </label>
        {job && (
          <div className={`job-progress ${job.state}`} role="status">
            <div>
              <Activity />
              <span>
                <b>{job.state}</b>
                {job.message ?? "Waiting for the local worker"}
              </span>
              <strong>{Math.round(job.progress * 100)}%</strong>
            </div>
            <i>
              <span style={{ width: `${Math.max(4, job.progress * 100)}%` }} />
            </i>
            {job.source.sha256 && <code>SHA-256 {job.source.sha256}</code>}
          </div>
        )}
        {error && (
          <div className="dialog-error" role="alert">
            <AlertTriangle />
            {error}
          </div>
        )}
        <div className="dialog-actions">
          {active && job ? (
            <button
              className="secondary"
              onClick={() =>
                void workbenchApi
                  .cancelJob(job.id)
                  .then(setJob)
                  .catch((reason: unknown) =>
                    setError(
                      reason instanceof Error
                        ? reason.message
                        : "Cancel failed",
                    ),
                  )
              }
            >
              Cancel job
            </button>
          ) : job?.state === "failed" || job?.state === "cancelled" ? (
            <button
              className="secondary"
              onClick={() =>
                void workbenchApi
                  .retryJob(job.id)
                  .then(setJob)
                  .catch((reason: unknown) =>
                    setError(
                      reason instanceof Error ? reason.message : "Retry failed",
                    ),
                  )
              }
            >
              Retry job
            </button>
          ) : null}
          <button
            className="primary"
            onClick={() => void submit()}
            disabled={active || !source.trim()}
          >
            <Upload /> Validate &amp; queue
          </button>
        </div>
      </section>
    </div>
  );
}

export default App;
