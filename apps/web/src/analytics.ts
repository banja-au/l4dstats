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

function scrub(value: string): string {
  return value
    .replace(/[a-f0-9]{64}/gi, "[hash]")
    .replace(/\b7656119\d{10}\b/g, "[steam-id]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .slice(0, 2_000);
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
      ...properties,
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
  send("$pageview", { route: location.pathname === "/" ? "home" : "other" });
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
    $exception_type: scrub(exception?.name ?? "UnknownError"),
    $exception_message: scrub(
      exception?.message ?? "Unknown application error",
    ),
    $exception_stack_trace_raw: scrub(exception?.stack ?? "Stack unavailable"),
    ...properties,
  });
}
