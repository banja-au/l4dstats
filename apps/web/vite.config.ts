import { createHash, timingSafeEqual } from "node:crypto";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type ProxyOptions } from "vite";
import { applyApiProxyHeaders } from "./src/dev-proxy";

const apiToken = process.env.WITCHWATCH_API_TOKEN;
const authenticatedProxy: ProxyOptions = {
  target: process.env.WITCHWATCH_API_URL ?? "http://127.0.0.1:8787",
  changeOrigin: true,
  ...(apiToken ? { headers: { authorization: `Bearer ${apiToken}` } } : {}),
  configure(proxy) {
    proxy.on("proxyReq", (proxyRequest) =>
      applyApiProxyHeaders(proxyRequest, apiToken),
    );
  },
};

function apiAuthenticationGate(): Plugin {
  return {
    name: "l4dstats-api-authentication-gate",
    async configureServer(server) {
      if (!apiToken) return;
      const api = new URL(
        process.env.WITCHWATCH_API_URL ?? "http://127.0.0.1:8787",
      );
      let lastError = "API unavailable";
      for (let attempt = 0; attempt < 50; attempt += 1) {
        try {
          const response = await fetch(new URL("/api/openapi.json", api), {
            headers: { authorization: `Bearer ${apiToken}` },
            signal: AbortSignal.timeout(1_000),
          });
          if (response.ok) {
            server.config.logger.info(
              "L4DStats API authentication preflight passed.",
            );
            return;
          }
          if (response.status === 401 || response.status === 429)
            throw new Error(
              "The web and API containers have different WITCHWATCH_API_TOKEN values. Recreate the complete Compose stack so both services receive the same token.",
            );
          lastError = `API authentication preflight returned HTTP ${response.status}`;
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes("different WITCHWATCH_API_TOKEN")
          )
            throw error;
          lastError = error instanceof Error ? error.message : lastError;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(
        `The web development server could not authenticate to the API at ${api.origin}: ${lastError}`,
      );
    },
  };
}

function webAccessGate(): Plugin {
  const username = process.env.WITCHWATCH_WEB_USERNAME;
  const password = process.env.WITCHWATCH_WEB_PASSWORD;
  if (Boolean(username) !== Boolean(password))
    throw new Error(
      "WITCHWATCH_WEB_USERNAME and WITCHWATCH_WEB_PASSWORD must be set together",
    );
  if (password && Buffer.byteLength(password, "utf8") < 16)
    throw new Error("WITCHWATCH_WEB_PASSWORD must contain at least 16 bytes");
  const expected =
    username && password
      ? createHash("sha256")
          .update(
            `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
          )
          .digest()
      : undefined;
  const failures = new Map<
    string,
    { windowStartedAt: number; requests: number }
  >();
  return {
    name: "l4dstats-web-access-gate",
    configureServer(server) {
      if (!expected) return;
      server.middlewares.use((request, response, next) => {
        const key = request.socket.remoteAddress ?? "unknown";
        const supplied = createHash("sha256")
          .update(request.headers.authorization ?? "")
          .digest();
        if (timingSafeEqual(expected, supplied)) {
          failures.delete(key);
          next();
          return;
        }
        const timestamp = Date.now();
        const prior = failures.get(key);
        const bucket =
          prior && timestamp - prior.windowStartedAt < 5 * 60_000
            ? prior
            : { windowStartedAt: timestamp, requests: 0 };
        if (bucket.requests >= 20) {
          response.statusCode = 429;
          response.setHeader(
            "retry-after",
            Math.max(
              1,
              Math.ceil(
                (bucket.windowStartedAt + 5 * 60_000 - timestamp) / 1_000,
              ),
            ),
          );
          response.setHeader("cache-control", "no-store");
          response.end("Authentication rate limit exceeded");
          return;
        }
        bucket.requests += 1;
        failures.set(key, bucket);
        response.statusCode = 401;
        response.setHeader(
          "www-authenticate",
          'Basic realm="L4DStats", charset="UTF-8"',
        );
        response.setHeader("content-type", "text/plain; charset=utf-8");
        response.setHeader("cache-control", "no-store");
        response.end("Authentication required");
      });
    },
  };
}

export default defineConfig({
  plugins: [apiAuthenticationGate(), webAccessGate(), react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      "/api": {
        ...authenticatedProxy,
      },
      "/health": {
        target: process.env.WITCHWATCH_API_URL ?? "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
});
