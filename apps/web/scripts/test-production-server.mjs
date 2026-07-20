import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const username = "reviewer";
const password = "production-test-password";
const viewerUsername = "viewer";
const viewerPassword = "production-viewer-password";
const apiToken = "production-test-api-token-0123456789";
const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
const viewerAuthorization = `Basic ${Buffer.from(`${viewerUsername}:${viewerPassword}`).toString("base64")}`;
const webRoot = await mkdtemp(join(tmpdir(), "l4dstats-production-web-"));
await writeFile(
  join(webRoot, "index.html"),
  `<!doctype html><html><head>
  <link rel="canonical" href="https://l4dstats.gg/" />
  <meta name="description" content="home" />
  <meta property="og:title" content="home" />
  <meta property="og:description" content="home" />
  <meta property="og:url" content="https://l4dstats.gg/" />
  <meta property="og:image" content="home.webp" />
  <meta property="og:image:alt" content="home" />
  <meta name="twitter:title" content="home" />
  <meta name="twitter:description" content="home" />
  <meta name="twitter:image" content="home.webp" />
  <title>Home</title></head><body>L4DStats production test</body></html>`,
  { mode: 0o600 },
);

const upstream = createServer((request, response) => {
  if (request.headers.authorization !== `Bearer ${apiToken}`) {
    response.writeHead(401).end();
    return;
  }
  if (
    request.headers["x-l4dstats-user"] !== username ||
    request.headers["x-l4dstats-role"] !== "reviewer"
  ) {
    response.writeHead(403).end();
    return;
  }
  if (request.url === "/metrics") {
    response.writeHead(200, {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
    });
    response.end("l4dstats_up 1\n");
  } else if (request.url === "/api/games/test") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: "test",
        analyses: [
          { engineResult: { demo: { mapName: "c2m1_highway" } } },
          { engineResult: { demo: { mapName: "c2m2_fairgrounds" } } },
        ],
      }),
    );
  } else if (request.url === "/api/players/resolve?q=76561198000000007") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        steamId64: "76561198000000007",
        displayName: "Coach",
        games: [{ id: "one" }, { id: "two" }],
      }),
    );
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
    L4DSTATS_API_URL: `http://127.0.0.1:${upstreamAddress.port}`,
    L4DSTATS_API_TOKEN: apiToken,
    L4DSTATS_WEB_USERS_JSON: JSON.stringify([
      { username, password, role: "reviewer" },
      {
        username: viewerUsername,
        password: viewerPassword,
        role: "viewer",
      },
    ]),
    L4DSTATS_REQUIRE_AUTH: "true",
    L4DSTATS_WEB_ROOT: webRoot,
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
  const gameHtml = await page.text();
  if (
    !gameHtml.includes("Dark Carnival · 2 maps · L4DStats") ||
    !gameHtml.includes(
      'property="og:url" content="https://l4dstats.gg/game/test/overview"',
    ) ||
    !gameHtml.includes(
      'name="twitter:description" content="2 maps reconstructed as one Dark Carnival game.',
    )
  )
    throw new Error(
      "game route did not receive campaign-specific social metadata",
    );
  const statsPage = await fetch(`${base}/stats`, {
    headers: { authorization },
  });
  const statsHtml = await statsPage.text();
  if (
    !statsHtml.includes("L4DStats · The archive in numbers") ||
    !statsHtml.includes(
      'property="og:image" content="https://l4dstats.gg/art/og-stats.webp"',
    )
  )
    throw new Error("stats route did not receive bespoke social metadata");
  const playerPage = await fetch(`${base}/player/76561198000000007`, {
    headers: { authorization },
  });
  const playerHtml = await playerPage.text();
  if (
    !playerHtml.includes("Coach · Player dossier · L4DStats") ||
    !playerHtml.includes("2 retained games") ||
    !playerHtml.includes(
      'name="twitter:image" content="https://l4dstats.gg/art/og-player.webp"',
    )
  )
    throw new Error("player route did not receive bespoke social metadata");
  if (page.headers.get("x-frame-options") !== "DENY")
    throw new Error("frame protection is absent");
  const proxied = await fetch(`${base}/api/test?value=1`, {
    headers: {
      authorization,
      "x-l4dstats-user": "spoofed-user",
      "x-l4dstats-role": "admin",
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
  await rm(webRoot, { recursive: true, force: true });
}
