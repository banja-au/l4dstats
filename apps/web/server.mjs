import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, request as proxyRequest } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const distRoot = resolve(
  process.env.L4DSTATS_WEB_ROOT ??
    fileURLToPath(new URL("./dist/", import.meta.url)),
);
const port = positiveInteger(process.env.PORT ?? "5173", "PORT");
const api = new URL(process.env.L4DSTATS_API_URL ?? "http://127.0.0.1:8787");
const apiToken = process.env.L4DSTATS_API_TOKEN;
const username = process.env.L4DSTATS_WEB_USERNAME;
const password = process.env.L4DSTATS_WEB_PASSWORD;
const usersJson = process.env.L4DSTATS_WEB_USERS_JSON;
const requireAuth = process.env.L4DSTATS_REQUIRE_AUTH === "true";

if (usersJson && (username || password))
  throw new Error(
    "L4DSTATS_WEB_USERS_JSON cannot be combined with single-user credentials",
  );
if (Boolean(username) !== Boolean(password))
  throw new Error(
    "L4DSTATS_WEB_USERNAME and L4DSTATS_WEB_PASSWORD must be set together",
  );
if (password && Buffer.byteLength(password, "utf8") < 16)
  throw new Error("L4DSTATS_WEB_PASSWORD must contain at least 16 bytes");
if (apiToken && Buffer.byteLength(apiToken, "utf8") < 32)
  throw new Error("L4DSTATS_API_TOKEN must contain at least 32 bytes");
const configuredUsers = usersJson
  ? parseUsers(usersJson)
  : username && password
    ? [{ username, password, role: "admin" }]
    : [];
if (requireAuth && (configuredUsers.length === 0 || !apiToken))
  throw new Error(
    "Production mode requires web credentials and L4DSTATS_API_TOKEN",
  );

const expectedUsers = configuredUsers.map((user) => ({
  username: user.username,
  role: user.role,
  digest: digest(
    `Basic ${Buffer.from(`${user.username}:${user.password}`).toString("base64")}`,
  ),
}));
const authFailures = new Map();
const publicOrigin = "https://l4dstats.gg";
const homeSocialImage = `${publicOrigin}/art/og-home.webp`;

const mime = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
]);

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function digest(value) {
  return createHash("sha256").update(value).digest();
}

function parseUsers(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("L4DSTATS_WEB_USERS_JSON must be valid JSON");
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 100)
    throw new Error("L4DSTATS_WEB_USERS_JSON must contain 1 to 100 users");
  const names = new Set();
  return parsed.map((user) => {
    if (!user || typeof user !== "object")
      throw new Error("Each configured web user must be an object");
    const { username, password, role } = user;
    if (
      typeof username !== "string" ||
      !/^[A-Za-z0-9_.@-]{1,64}$/.test(username) ||
      names.has(username)
    )
      throw new Error("Web usernames must be unique and URL-safe");
    if (typeof password !== "string" || Buffer.byteLength(password) < 16)
      throw new Error("Every web password must contain at least 16 bytes");
    if (role !== "viewer" && role !== "reviewer" && role !== "admin")
      throw new Error("Web roles must be viewer, reviewer, or admin");
    names.add(username);
    return { username, password, role };
  });
}

function secureHeaders(response) {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  response.setHeader(
    "content-security-policy",
    "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
  );
}

function authenticate(request, response) {
  if (expectedUsers.length === 0)
    return { username: "local-anonymous", role: "admin" };
  const key = request.socket.remoteAddress ?? "unknown";
  const supplied = digest(request.headers.authorization ?? "");
  const identity = expectedUsers.find((user) =>
    timingSafeEqual(user.digest, supplied),
  );
  if (identity) {
    authFailures.delete(key);
    return identity;
  }
  const timestamp = Date.now();
  const prior = authFailures.get(key);
  const bucket =
    prior && timestamp - prior.windowStartedAt < 5 * 60_000
      ? prior
      : { windowStartedAt: timestamp, requests: 0 };
  if (bucket.requests >= 20) {
    secureHeaders(response);
    response.writeHead(429, {
      "retry-after": Math.max(
        1,
        Math.ceil((bucket.windowStartedAt + 5 * 60_000 - timestamp) / 1_000),
      ),
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end("Authentication rate limit exceeded");
    return false;
  }
  bucket.requests += 1;
  authFailures.set(key, bucket);
  secureHeaders(response);
  response.writeHead(401, {
    "www-authenticate": 'Basic realm="L4DStats", charset="UTF-8"',
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end("Authentication required");
  return false;
}

function proxy(request, response) {
  const headers = { ...request.headers, host: api.host };
  delete headers["x-l4dstats-user"];
  delete headers["x-l4dstats-role"];
  if (apiToken) headers.authorization = `Bearer ${apiToken}`;
  headers["x-l4dstats-user"] = request.authenticatedIdentity.username;
  headers["x-l4dstats-role"] = request.authenticatedIdentity.role;
  const upstream = proxyRequest(
    new URL(request.url ?? "/", api),
    { method: request.method, headers },
    (upstreamResponse) => {
      secureHeaders(response);
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.headers,
      );
      upstreamResponse.pipe(response);
    },
  );
  upstream.on("error", () => {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    secureHeaders(response);
    response.writeHead(502, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(JSON.stringify({ error: "API unavailable" }));
  });
  request.on("aborted", () => upstream.destroy());
  request.pipe(upstream);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function campaignName(mapNames) {
  const campaigns = {
    c1: "Dead Center",
    c2: "Dark Carnival",
    c3: "Swamp Fever",
    c4: "Hard Rain",
    c5: "The Parish",
    c6: "The Passing",
    c7: "The Sacrifice",
    c8: "No Mercy",
    c9: "Crash Course",
    c10: "Death Toll",
    c11: "Dead Air",
    c12: "Blood Harvest",
    c13: "Cold Stream",
    c14: "The Last Stand",
  };
  for (const mapName of mapNames) {
    const match = /^(c\d+)m\d+(?:_|$)/i.exec(mapName);
    const name = match ? campaigns[match[1].toLowerCase()] : undefined;
    if (name) return name;
  }
  return null;
}

function replaceMeta(html, selector, value) {
  const attribute = selector.startsWith("og:") ? "property" : "name";
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(<meta\\s+${attribute}=["']${escapedSelector}["']\\s+content=["'])[^"']*(["']\\s*\\/?>)`,
  );
  return html.replace(pattern, `$1${escapeHtml(value)}$2`);
}

function renderSocialMetadata(html, metadata) {
  let rendered = html.replace(
    /<link rel="canonical" href="[^"]*"\s*\/>/,
    `<link rel="canonical" href="${escapeHtml(metadata.url)}" />`,
  );
  rendered = rendered.replace(
    /<title>[^<]*<\/title>/,
    `<title>${escapeHtml(metadata.title)}</title>`,
  );
  for (const [selector, key] of [
    ["description", "description"],
    ["og:title", "title"],
    ["og:description", "description"],
    ["og:url", "url"],
    ["og:image", "image"],
    ["og:image:alt", "imageAlt"],
    ["twitter:title", "title"],
    ["twitter:description", "description"],
    ["twitter:image", "image"],
  ])
    rendered = replaceMeta(rendered, selector, metadata[key]);
  return rendered;
}

async function gameMetadata(request, pathname) {
  const match = /^\/game\/([^/]+)(?:\/[^/]*)?\/?$/.exec(pathname);
  if (!match) return null;
  let gameId;
  try {
    gameId = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  const url = `${publicOrigin}${pathname}`;
  const fallback = {
    title: "L4DStats · Match review",
    description:
      "Evidence-first Left 4 Dead 2 match statistics and demo review.",
    url,
    image: homeSocialImage,
    imageAlt: "L4DStats match analysis evidence board",
  };
  try {
    const headers = {
      "x-l4dstats-user": request.authenticatedIdentity.username,
      "x-l4dstats-role": request.authenticatedIdentity.role,
    };
    if (apiToken) headers.authorization = `Bearer ${apiToken}`;
    const response = await fetch(
      new URL(`/api/games/${encodeURIComponent(gameId)}`, api),
      { headers, signal: AbortSignal.timeout(2_000) },
    );
    if (!response.ok) return fallback;
    const game = await response.json();
    const maps = Array.isArray(game.analyses)
      ? game.analyses.flatMap((analysis) => {
          const mapName = analysis?.engineResult?.demo?.mapName;
          return typeof mapName === "string" && mapName ? [mapName] : [];
        })
      : [];
    const campaign = campaignName(maps);
    const subject = campaign ?? maps[0] ?? "L4D2 match";
    const mapLabel = `${maps.length || "Unknown"} ${maps.length === 1 ? "map" : "maps"}`;
    return {
      ...fallback,
      title: `${subject} · ${mapLabel} · L4DStats`,
      description: `${mapLabel} reconstructed as one ${subject} game. Review match statistics, timeline, data quality and evidence at exact ticks.`,
    };
  } catch {
    return fallback;
  }
}

async function staticFile(request, response, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    secureHeaders(response);
    response.writeHead(405, { allow: "GET, HEAD" });
    response.end();
    return;
  }
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    secureHeaders(response);
    response.writeHead(400);
    response.end();
    return;
  }
  const candidate = resolve(distRoot, `.${decoded}`);
  const inside =
    candidate === distRoot || candidate.startsWith(`${distRoot}${sep}`);
  if (!inside) {
    secureHeaders(response);
    response.writeHead(400, { "cache-control": "no-store" });
    response.end();
    return;
  }
  let path = candidate;
  try {
    if (!path || !statSync(path).isFile()) {
      if (decoded.startsWith("/assets/") || decoded.startsWith("/art/")) {
        secureHeaders(response);
        response.writeHead(404, { "cache-control": "no-store" });
        response.end();
        return;
      }
      path = resolve(distRoot, "index.html");
    }
  } catch {
    if (decoded.startsWith("/assets/") || decoded.startsWith("/art/")) {
      secureHeaders(response);
      response.writeHead(404, { "cache-control": "no-store" });
      response.end();
      return;
    }
    path = resolve(distRoot, "index.html");
  }
  const extension = extname(path);
  const immutable = decoded.startsWith("/assets/");
  secureHeaders(response);
  response.writeHead(200, {
    "content-type": mime.get(extension) ?? "application/octet-stream",
    "cache-control": immutable
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  });
  if (request.method === "HEAD") response.end();
  else if (extension === ".html") {
    const metadata = await gameMetadata(request, pathname);
    const html = await readFile(path, "utf8");
    response.end(metadata ? renderSocialMetadata(html, metadata) : html);
  } else createReadStream(path).pipe(response);
}

createServer((request, response) => {
  const identity = authenticate(request, response);
  if (!identity) return;
  request.authenticatedIdentity = identity;
  const url = new URL(request.url ?? "/", "http://localhost");
  if (
    identity.role === "viewer" &&
    url.pathname.startsWith("/api/") &&
    request.method !== "GET" &&
    request.method !== "HEAD"
  ) {
    secureHeaders(response);
    response.writeHead(403, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(JSON.stringify({ error: "viewer role is read-only" }));
    return;
  }
  if (
    url.pathname === "/health" ||
    url.pathname === "/metrics" ||
    url.pathname.startsWith("/api/")
  ) {
    proxy(request, response);
    return;
  }
  void staticFile(request, response, url.pathname).catch(() => {
    if (response.headersSent) response.destroy();
    else {
      secureHeaders(response);
      response.writeHead(500, { "cache-control": "no-store" });
      response.end();
    }
  });
}).listen(port, "0.0.0.0", () =>
  process.stdout.write(`L4DStats web on ${port}\n`),
);
