const apiHost = (
  process.env.POSTHOG_API_HOST ?? "https://us.posthog.com"
).replace(/\/$/, "");
const projectId = process.env.POSTHOG_PROJECT_ID;
const personalKey = process.env.POSTHOG_API_KEY;
if (!projectId || !personalKey)
  throw new Error("POSTHOG_PROJECT_ID and POSTHOG_API_KEY are required");

const dashboardName = "L4DStats — Product & Reliability";
const headers = {
  authorization: `Bearer ${personalKey}`,
  "content-type": "application/json",
};
async function api(path, init = {}) {
  const response = await fetch(`${apiHost}/api/projects/${projectId}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      `PostHog ${response.status}: ${body.detail ?? body.error ?? "request failed"}`,
    );
  return body;
}

const dateRange = { date_from: "-30d", date_to: null };
const event = (name, customName = name, extra = {}) => ({
  kind: "EventsNode",
  event: name,
  name,
  custom_name: customName,
  math: "total",
  ...extra,
});
const trend = (series, extra = {}) => ({
  kind: "TrendsQuery",
  dateRange,
  interval: "day",
  series,
  trendsFilter: { display: "ActionsLineGraph" },
  ...extra,
});
const breakdown = (name, property, customName = name) =>
  trend([event(name, customName)], {
    breakdownFilter: { breakdown: property, breakdown_type: "event" },
  });
const funnel = (series) => ({
  kind: "FunnelsQuery",
  dateRange,
  series,
  funnelsFilter: { funnelVizType: "steps" },
});

const insights = [
  {
    name: "Visitors and engaged sessions",
    description: "Anonymous visitors and key homepage activity over 30 days.",
    query: trend([
      event("$pageview", "Unique visitors", { math: "dau" }),
      event("upload_batch_selected", "Upload batches"),
      event("player_search_started", "Player searches"),
    ]),
  },
  {
    name: "Upload-to-analysis activation funnel",
    description:
      "Homepage visit → selection → accepted upload → terminal analysis.",
    query: funnel([
      event("$pageview", "Homepage viewed", {
        properties: [
          { key: "route", value: ["home"], operator: "exact", type: "event" },
        ],
      }),
      event("upload_batch_selected", "Batch selected"),
      event("demo_upload_accepted", "Upload accepted"),
      event("analysis_finished", "Analysis succeeded", {
        properties: [
          {
            key: "outcome",
            value: ["succeeded"],
            operator: "exact",
            type: "event",
          },
        ],
      }),
    ]),
  },
  {
    name: "Uploads by format",
    description: "Accepted uploads split by raw/ZIP/gzip/xz/bzip2/zstd.",
    query: breakdown("hosted_upload_accepted", "format", "Uploads"),
  },
  {
    name: "Upload size distribution",
    description: "Authoritative upload volume by coarse size band.",
    query: breakdown("hosted_upload_accepted", "sizeBand", "Uploads"),
  },
  {
    name: "Analysis outcomes",
    description: "Client-observed terminal outcomes.",
    query: breakdown("analysis_finished", "outcome", "Analyses"),
  },
  {
    name: "Analysis latency p50 / p95",
    description: "End-to-end backend processing latency in seconds.",
    query: trend([
      event("hosted_analysis_succeeded", "p50 seconds", {
        math: "p50",
        math_property: "durationSeconds",
      }),
      event("hosted_analysis_succeeded", "p95 seconds", {
        math: "p95",
        math_property: "durationSeconds",
      }),
    ]),
  },
  {
    name: "Backend analysis reliability",
    description: "Successful analyses versus failed attempts.",
    query: trend([
      event("hosted_analysis_succeeded", "Succeeded"),
      event("hosted_analysis_failed", "Failed attempt"),
    ]),
  },
  {
    name: "Failure categories",
    description:
      "Coarse failure classes; raw errors and identifiers are excluded.",
    query: breakdown("hosted_analysis_failed", "category", "Failures"),
  },
  {
    name: "Player search outcomes",
    description: "Player lookup success and failure outcomes.",
    query: breakdown("player_search_finished", "outcome", "Searches"),
  },
  {
    name: "Player search failure categories",
    description: "Coarse lookup failure classes without search terms or IDs.",
    query: breakdown("player_search_finished", "category", "Search failures"),
  },
  {
    name: "Results section engagement",
    description: "Analysis sections visitors intentionally open.",
    query: breakdown("results_tab_selected", "tab", "Tab opens"),
  },
  {
    name: "Locale mix",
    description: "Anonymous pageviews by effective locale.",
    query: breakdown("$pageview", "locale", "Pageviews"),
  },
  {
    name: "Discovery and outbound engagement",
    description: "Example opens, tool switching, and external links.",
    query: trend([
      event("example_game_opened", "Example game"),
      event("landing_tool_switched", "Tool switches"),
      event("outbound_link_clicked", "Outbound links"),
    ]),
  },
  {
    name: "Developer portal activation",
    description: "Portal visits, console actions, and API-key creation.",
    query: trend([
      event("developer_portal_viewed", "Portal views"),
      event("developer_console_action", "Console actions"),
      event("developer_api_key_created", "Keys created"),
    ]),
  },
  {
    name: "Developer API usage by endpoint",
    description: "Authenticated calls by normalized path; IDs are excluded.",
    query: breakdown("developer_api_request", "path", "API requests"),
  },
  {
    name: "Developer API status codes",
    description: "API reliability, authentication failures, and rate limits.",
    query: breakdown("developer_api_request", "status", "API requests"),
  },
  {
    name: "Application exceptions",
    description: "Browser and portal exceptions without user identifiers.",
    query: trend([
      event("$exception", "Web exceptions"),
      event("developer_portal_exception", "Portal exceptions"),
    ]),
  },
];

const listed = await api(
  `/dashboards/?limit=100&search=${encodeURIComponent(dashboardName)}`,
);
let dashboard = (listed.results ?? []).find(
  (candidate) => candidate.name === dashboardName && !candidate.deleted,
);
if (!dashboard) {
  dashboard = await api("/dashboards/", {
    method: "POST",
    body: JSON.stringify({
      name: dashboardName,
      description:
        "Privacy-safe acquisition, activation, reliability, latency, engagement, localization, developer adoption, and errors. Rolling 30-day window.",
      pinned: true,
      tags: ["l4dstats", "production"],
    }),
  });
}

const existing = await api(
  `/insights/?basic=true&limit=100&dashboards=${encodeURIComponent(JSON.stringify([dashboard.id]))}`,
);
const names = new Set((existing.results ?? []).map((item) => item.name));
let created = 0;
for (const insight of insights) {
  if (names.has(insight.name)) continue;
  await api("/insights/?include_dashboards=true", {
    method: "POST",
    body: JSON.stringify({
      ...insight,
      dashboards: [dashboard.id],
      tags: ["l4dstats", "production"],
    }),
  });
  created += 1;
}

console.log(
  JSON.stringify({
    dashboardId: dashboard.id,
    dashboardUrl: `${apiHost}/project/${projectId}/dashboard/${dashboard.id}`,
    insightsCreated: created,
    insightsTotal: insights.length,
  }),
);
