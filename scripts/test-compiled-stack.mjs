import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("port probe did not bind");
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function waitFor(url, init, accepted = (response) => response.ok) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (accepted(response)) return response;
    } catch {
      // The process may still be binding its socket.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`service did not become ready: ${url}`);
}

const root = await mkdtemp(join(tmpdir(), "l4dstats-compiled-stack-"));
const apiPort = await availablePort();
const webPort = await availablePort();
const apiToken = "compiled-stack-api-token-0123456789";
const username = "compiled-reviewer";
const password = "compiled-production-password";
const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
const heartbeatPath = join(root, "worker-heartbeat.json");
await writeFile(heartbeatPath, "{}\n");
const diagnostics = [];
const children = [];

function service(command, args, env) {
  const child = spawn(command, args, {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => diagnostics.push(String(chunk)));
  child.stderr.on("data", (chunk) => diagnostics.push(String(chunk)));
  children.push(child);
  return child;
}

const api = service(process.execPath, ["apps/api/dist/main.js"], {
  NODE_OPTIONS: "--conditions=production",
  PORT: String(apiPort),
  L4DSTATS_DB: join(root, "workbench.sqlite"),
  L4DSTATS_API_TOKEN: apiToken,
  L4DSTATS_SEED_EXAMPLE: "false",
  L4DSTATS_WORKER_HEARTBEAT: heartbeatPath,
});

try {
  const directHealth = await waitFor(`http://127.0.0.1:${apiPort}/health`);
  const directPayload = await directHealth.json();
  if (directPayload?.checks?.database !== true)
    throw new Error("compiled API did not prove database readiness");

  const web = service(process.execPath, ["apps/web/server.mjs"], {
    PORT: String(webPort),
    L4DSTATS_API_URL: `http://127.0.0.1:${apiPort}`,
    L4DSTATS_API_TOKEN: apiToken,
    L4DSTATS_WEB_USERNAME: username,
    L4DSTATS_WEB_PASSWORD: password,
    L4DSTATS_REQUIRE_AUTH: "true",
  });
  const publicHealth = await waitFor(`http://127.0.0.1:${webPort}/health`, {
    headers: { authorization },
  });
  const publicPayload = await publicHealth.json();
  if (publicPayload?.checks?.database !== true)
    throw new Error("compiled public boundary lost database readiness");
  const publicMetrics = await fetch(`http://127.0.0.1:${webPort}/metrics`, {
    headers: { authorization },
  });
  const metricsText = await publicMetrics.text();
  if (
    !publicMetrics.ok ||
    !metricsText.includes("l4dstats_database_ready 1") ||
    !metricsText.includes("l4dstats_worker_heartbeat_available 1")
  )
    throw new Error("compiled public boundary lost operational metrics");

  const apiExit = once(api, "exit");
  api.kill("SIGTERM");
  await apiExit;
  await waitFor(
    `http://127.0.0.1:${webPort}/health`,
    { headers: { authorization } },
    (response) => response.status === 502,
  );

  const webExit = once(web, "exit");
  web.kill("SIGTERM");
  await webExit;
  process.stdout.write(
    "Compiled API, database readiness, web proxy and failure propagation passed.\n",
  );
} catch (error) {
  process.stderr.write(diagnostics.join(""));
  throw error;
} finally {
  await Promise.allSettled(
    children
      .filter((child) => child.exitCode === null && child.signalCode === null)
      .map(async (child) => {
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        await exited;
      }),
  );
  await rm(root, { recursive: true, force: true });
}
