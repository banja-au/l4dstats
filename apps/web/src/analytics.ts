type SafeProperties = Record<string, boolean | number | string>;

const token = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN;
const host = (
  import.meta.env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com"
).replace(/\/$/, "");
const storageKey = "l4dstats.analytics.anonymous-id";
let initialized = false;

function anonymousId(): string {
  const existing = localStorage.getItem(storageKey);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(storageKey, created);
  return created;
}

export function scrubAnalyticsValue(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\bl4d_live_[A-Za-z0-9_-]+\b/g, "[api-key]")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      "[id]",
    )
    .replace(/[a-f0-9]{64}/gi, "[hash]")
    .replace(/\b7656119\d{10}\b/g, "[steam-id]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .slice(0, 2_000);
}

function routeType(pathname: string): string {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/game/")) return "game";
  if (pathname.startsWith("/analysis/")) return "analysis";
  if (pathname.startsWith("/player/")) return "player";
  return "other";
}

export function analyticsLocale(): "en" | "es" {
  const stored = localStorage.getItem("l4dstats.locale");
  if (stored === "en" || stored === "es") return stored;
  const cookie = document.cookie
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === "l4dstats_locale")?.[1];
  if (cookie === "en" || cookie === "es") return cookie;
  return navigator.languages.some(
    (language) => language.toLowerCase().split("-")[0] === "es",
  )
    ? "es"
    : "en";
}

function send(event: string, properties: SafeProperties): void {
  if (!token) return;
  const body = JSON.stringify({
    api_key: token,
    event,
    properties: {
      distinct_id: anonymousId(),
      $process_person_profile: false,
      app: "l4dstats-web",
      ...Object.fromEntries(
        Object.entries(properties).map(([key, value]) => [
          key,
          typeof value === "string" ? scrubAnalyticsValue(value) : value,
        ]),
      ),
    },
  });
  if (navigator.sendBeacon?.(`${host}/capture/`, body)) return;
  void fetch(`${host}/capture/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

export function initializeAnalytics(): void {
  if (!token || initialized) return;
  initialized = true;
  send("$pageview", {
    route: routeType(location.pathname),
    locale: analyticsLocale(),
  });
  addEventListener("error", (event) => captureAnalyticsException(event.error));
  addEventListener("unhandledrejection", (event) =>
    captureAnalyticsException(event.reason),
  );
}

/** Capture only coarse, explicitly selected properties; never pass user content. */
export function captureAnalyticsEvent(
  event: string,
  properties: SafeProperties = {},
): void {
  if (initialized) send(event, properties);
}

export function captureAnalyticsException(
  error: unknown,
  properties: SafeProperties = {},
): void {
  if (!initialized) return;
  const exception = error instanceof Error ? error : undefined;
  send("$exception", {
    $exception_type: scrubAnalyticsValue(exception?.name ?? "UnknownError"),
    $exception_message: scrubAnalyticsValue(
      exception?.message ?? "Unknown application error",
    ),
    $exception_stack_trace_raw: scrubAnalyticsValue(
      exception?.stack ?? "Stack unavailable",
    ),
    ...properties,
  });
}
