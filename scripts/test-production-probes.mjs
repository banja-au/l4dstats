import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";

const username = "probe-operator";
const password = "probe-production-password";
const expectedAuthorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
let healthy = true;
let heartbeatAge = 2;
const server = createServer((request, response) => {
  if (request.headers.authorization !== expectedAuthorization) {
    response.writeHead(401).end();
    return;
  }
  if (request.url === "/health") {
    response.writeHead(healthy ? 200 : 503, {
      "content-type": "application/json",
    });
    response.end(
      JSON.stringify({ ok: healthy, checks: { database: healthy } }),
    );
    return;
  }
  if (request.url === "/metrics") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end(`l4dstats_database_ready 1
l4dstats_worker_heartbeat_available 1
l4dstats_worker_heartbeat_age_seconds ${heartbeatAge}
l4dstats_oldest_queued_job_age_seconds 0
`);
    return;
  }
  response.writeHead(404).end();
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string")
  throw new Error("probe did not bind");
const base = `http://127.0.0.1:${address.port}`;

async function probe(script, extraEnvironment = {}) {
  const child = spawn(process.execPath, [script], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      L4DSTATS_WEB_USERNAME: username,
      L4DSTATS_WEB_PASSWORD: password,
      L4DSTATS_HEALTH_URL: base,
      L4DSTATS_METRICS_URL: base,
      ...extraEnvironment,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const [code] = await once(child, "exit");
  return { code, output };
}

try {
  const healthPass = await probe("scripts/check-production-health.mjs");
  if (healthPass.code !== 0) throw new Error(healthPass.output);
  const metricsPass = await probe("scripts/check-production-metrics.mjs");
  if (metricsPass.code !== 0) throw new Error(metricsPass.output);
  healthy = false;
  const healthFail = await probe("scripts/check-production-health.mjs");
  if (healthFail.code === 0) throw new Error("failed readiness was accepted");
  healthy = true;
  heartbeatAge = 30;
  const metricsFail = await probe("scripts/check-production-metrics.mjs");
  if (metricsFail.code === 0)
    throw new Error("stale worker heartbeat was accepted");
  process.stdout.write("Production readiness and metrics probes passed.\n");
} finally {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
