type Properties = Record<string, boolean | number | string>;

const token = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN;
const host = (
  import.meta.env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com"
).replace(/\/$/, "");
const storageKey = "l4dstats.developers.analytics-id";
let initialized = false;

function distinctId() {
  const existing = localStorage.getItem(storageKey);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(storageKey, created);
  return created;
}

function send(event: string, properties: Properties = {}) {
  if (!token) return;
  const body = JSON.stringify({
    api_key: token,
    event,
    properties: {
      distinct_id: distinctId(),
      $process_person_profile: false,
      app: "l4dstats-developers",
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

export function initializeDeveloperAnalytics() {
  if (!token || initialized) return;
  initialized = true;
  send("developer_portal_viewed");
  addEventListener("error", () => send("developer_portal_exception"));
  addEventListener("unhandledrejection", () =>
    send("developer_portal_exception"),
  );
}

export function captureDeveloperEvent(
  event: string,
  properties: Properties = {},
) {
  if (initialized) send(event, properties);
}
