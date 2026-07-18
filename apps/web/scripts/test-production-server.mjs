import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";

const username = "reviewer";
const password = "production-test-password";
const viewerUsername = "viewer";
const viewerPassword = "production-viewer-password";
const apiToken = "production-test-api-token-0123456789";
const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
const viewerAuthorization = `Basic ${Buffer.from(`${viewerUsername}:${viewerPassword}`).toString("base64")}`;

const upstream = createServer((request, response) => {
  if (request.headers.authorization !== `Bearer ${apiToken}`) {
    response.writeHead(401).end();
    return;
  }
  if (
    request.headers["x-witchwatch-user"] !== username ||
    request.headers["x-witchwatch-role"] !== "reviewer"
  ) {
    response.writeHead(403).end();
    return;
  }
  if (request.url === "/metrics") {
    response.writeHead(200, {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
    });
    response.end("l4dstats_up 1\n");
  } else {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, path: request.url }));
  }
});
upstream.listen(0, "127.0.0.1");
await once(upstream, "listening");
const upstreamAddress = upstream.address();
if (!upstreamAddress || typeof upstreamAddress === "string")
  throw new Error("mock API did not bind");

const portProbe = createServer();
portProbe.listen(0, "127.0.0.1");
await once(portProbe, "listening");
const webAddress = portProbe.address();
if (!webAddress || typeof webAddress === "string")
  throw new Error("web port probe did not bind");
const webPort = webAddress.port;
await new Promise((resolve, reject) =>
  portProbe.close((error) => (error ? reject(error) : resolve())),
);

const child = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    PORT: String(webPort),
    WITCHWATCH_API_URL: `http://127.0.0.1:${upstreamAddress.port}`,
    WITCHWATCH_API_TOKEN: apiToken,
    WITCHWATCH_WEB_USERS_JSON: JSON.stringify([
      { username, password, role: "reviewer" },
      {
        username: viewerUsername,
        password: viewerPassword,
        role: "viewer",
      },
    ]),
    WITCHWATCH_REQUIRE_AUTH: "true",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let diagnostics = "";
child.stdout.on("data", (chunk) => (diagnostics += chunk));
child.stderr.on("data", (chunk) => (diagnostics += chunk));

try {
  const base = `http://127.0.0.1:${webPort}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if (
        (
          await fetch(base, {
            headers: { authorization },
          })
        ).ok
      ) {
        ready = true;
        break;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  if (!ready) throw new Error(`production web did not start\n${diagnostics}`);

  const anonymous = await fetch(base);
  if (anonymous.status !== 401)
    throw new Error(`anonymous request returned ${anonymous.status}`);
  for (let attempt = 1; attempt < 20; attempt += 1) {
    const rejected = await fetch(base);
    if (rejected.status !== 401)
      throw new Error(
        `failed credential ${attempt + 1} returned ${rejected.status}`,
      );
  }
  const limited = await fetch(base);
  if (limited.status !== 429 || !limited.headers.get("retry-after"))
    throw new Error("web authentication failures were not rate-limited");
  const page = await fetch(`${base}/game/test/overview`, {
    headers: { authorization },
  });
  if (!page.ok || !page.headers.get("content-security-policy"))
    throw new Error("authenticated SPA route or security headers failed");
  if (page.headers.get("x-frame-options") !== "DENY")
    throw new Error("frame protection is absent");
  const proxied = await fetch(`${base}/api/test?value=1`, {
    headers: {
      authorization,
      "x-witchwatch-user": "spoofed-user",
      "x-witchwatch-role": "admin",
    },
  });
  const proxyPayload = await proxied.json();
  if (!proxied.ok || proxyPayload.path !== "/api/test?value=1")
    throw new Error("authenticated API proxy failed");
  const metrics = await fetch(`${base}/metrics`, {
    headers: { authorization },
  });
  if (!metrics.ok || !(await metrics.text()).includes("l4dstats_up 1"))
    throw new Error("authenticated metrics proxy failed");
  const viewerRead = await fetch(`${base}/api/test`, {
    headers: { authorization: viewerAuthorization },
  });
  if (viewerRead.status !== 403)
    throw new Error(
      "viewer identity was not isolated at the upstream boundary",
    );
  const viewerMutation = await fetch(`${base}/api/test`, {
    method: "POST",
    headers: { authorization: viewerAuthorization },
  });
  if (viewerMutation.status !== 403)
    throw new Error("viewer role was allowed to mutate API state");
  const viewerPage = await fetch(`${base}/game/test/overview`, {
    headers: { authorization: viewerAuthorization },
  });
  if (!viewerPage.ok)
    throw new Error("viewer role could not read the analysis UI");
  const missing = await fetch(`${base}/assets/missing.js`, {
    headers: { authorization },
  });
  if (missing.status !== 404)
    throw new Error(`missing immutable asset returned ${missing.status}`);
  const traversal = await fetch(`${base}/%2e%2e%2fpackage.json`, {
    headers: { authorization },
  });
  if (traversal.status !== 400)
    throw new Error(`encoded traversal returned ${traversal.status}`);
  process.stdout.write("Production web authentication and proxy passed.\n");
} finally {
  const childExit =
    child.exitCode === null ? once(child, "exit") : Promise.resolve();
  const upstreamClose = once(upstream, "close");
  child.kill("SIGTERM");
  upstream.close();
  await Promise.allSettled([childExit, upstreamClose]);
}
