import process from "node:process";

const baseUrl = process.env.WITCHWATCH_METRICS_URL ?? "http://127.0.0.1:5173";
const username = process.env.WITCHWATCH_WEB_USERNAME;
const password = process.env.WITCHWATCH_WEB_PASSWORD;
const maximumHeartbeatAge = Number(
  process.env.WITCHWATCH_MAX_HEARTBEAT_AGE_SECONDS ?? 15,
);
const maximumQueueAge = Number(
  process.env.WITCHWATCH_MAX_QUEUE_AGE_SECONDS ?? 900,
);

function sample(body, name, labels = "") {
  const escaped = labels.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${name}${escaped} ([0-9.eE+-]+)$`, "m").exec(body);
  if (!match) throw new Error(`required metric is absent: ${name}${labels}`);
  const value = Number(match[1]);
  if (!Number.isFinite(value)) throw new Error(`metric is invalid: ${name}`);
  return value;
}

if (!username || !password) {
  process.stderr.write(
    "WITCHWATCH_WEB_USERNAME and WITCHWATCH_WEB_PASSWORD are required.\n",
  );
  process.exitCode = 2;
} else {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(new URL("/metrics", baseUrl), {
      headers: {
        authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
      },
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok)
      throw new Error(`metrics returned HTTP ${response.status}`);
    if (sample(body, "l4dstats_database_ready") !== 1)
      throw new Error("database is not ready");
    if (sample(body, "l4dstats_worker_heartbeat_available") !== 1)
      throw new Error("worker heartbeat is absent");
    const heartbeatAge = sample(body, "l4dstats_worker_heartbeat_age_seconds");
    if (heartbeatAge > maximumHeartbeatAge)
      throw new Error(`worker heartbeat is ${heartbeatAge.toFixed(1)}s old`);
    const queueAge = sample(body, "l4dstats_oldest_queued_job_age_seconds");
    if (queueAge > maximumQueueAge)
      throw new Error(`oldest queued job is ${queueAge.toFixed(1)}s old`);
    process.stdout.write(
      `Operational metrics passed: worker ${heartbeatAge.toFixed(1)}s, queue ${queueAge.toFixed(1)}s.\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "metrics check failed"}\n`,
    );
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
  }
}
