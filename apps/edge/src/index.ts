import { createClient } from "@libsql/client/web";
import {
  HostedJobRepository,
  TursoSqlClient,
  type HostedSource,
} from "@l4dstats/storage";
import {
  handleDeveloperConsole,
  handlePublicDeveloperApi,
  openApiDocument,
} from "./developer-api.js";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const SUPPORTED_UPLOAD_SUFFIXES = [
  ".dem",
  ".dem.zip",
  ".dem.gz",
  ".dem.xz",
  ".dem.bz2",
  ".dem.zst",
] as const;
export function isSupportedUploadFilename(filename: string): boolean {
  return (
    Boolean(filename) &&
    !/[/\\\0]/.test(filename) &&
    SUPPORTED_UPLOAD_SUFFIXES.some((suffix) =>
      filename.toLowerCase().endsWith(suffix),
    )
  );
}
const SHA256 = /^[a-f0-9]{64}$/;
const UPLOAD_ID = /^[a-f0-9-]{16,64}$/;

interface QueueMessage<T> {
  body: T;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

interface MessageBatch<T> {
  messages: Array<QueueMessage<T>>;
}

interface QueueBinding<T> {
  send(body: T): Promise<void>;
}

interface R2Object {
  size: number;
}

interface R2ObjectBody extends R2Object {
  body: ReadableStream;
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface R2BucketBinding {
  head(key: string): Promise<R2Object | null>;
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ReadableStream | Uint8Array,
    options: {
      customMetadata: Record<string, string>;
      httpMetadata: { contentType: string };
    },
  ): Promise<R2Object | null>;
  delete(key: string): Promise<void>;
}

interface ContainerStub {
  fetch(request: Request): Promise<Response>;
}

interface ContainerNamespace {
  getByName(name: string): ContainerStub;
}

interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

export interface EdgeEnvironment {
  ASSETS: AssetsBinding;
  TEMPORARY_DEMOS: R2BucketBinding;
  DERIVED_ARTIFACTS: R2BucketBinding;
  ANALYSIS_QUEUE: QueueBinding<{ jobId: string }>;
  ANALYSIS_CONTAINER: ContainerNamespace;
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
  L4DSTATS_PSEUDONYM_KEY: string;
  L4DSTATS_ENVIRONMENT: string;
  POSTHOG_PROJECT_TOKEN?: string;
  POSTHOG_HOST?: string;
  STEAM_WEB_API_KEY?: string;
}

type OperationalEvent = "hosted_analysis_failed" | "hosted_analysis_succeeded";

function failureCategory(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("container")) return "container";
  if (message.includes("source object")) return "source_object";
  if (message.includes("artifact")) return "derived_artifact";
  if (message.includes("claim")) return "job_claim";
  return "unknown";
}

function isTransientContainerCapacity(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return (
    message.includes(
      "Maximum number of running container instances exceeded",
    ) || message.includes("internal error connecting to port")
  );
}

async function captureOperationalEvent(
  environment: EdgeEnvironment,
  event: OperationalEvent,
  properties: Record<string, boolean | number | string>,
): Promise<void> {
  if (!environment.POSTHOG_PROJECT_TOKEN) return;
  const host = environment.POSTHOG_HOST ?? "https://us.i.posthog.com";
  try {
    await fetch(`${host.replace(/\/$/, "")}/capture/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: environment.POSTHOG_PROJECT_TOKEN,
        event,
        properties: {
          distinct_id: "l4dstats-edge-production",
          environment: environment.L4DSTATS_ENVIRONMENT,
          ...properties,
        },
      }),
      signal: AbortSignal.timeout(2_000),
    });
  } catch {
    // Observability is best-effort and must never affect analysis delivery.
  }
}

function json(status: number, value: unknown): Response {
  return Response.json(value, {
    status,
    headers: secureHeaders({ "cache-control": "no-store" }),
  });
}

function secureHeaders(initial?: HeadersInit): Headers {
  const headers = new Headers(initial);
  headers.set(
    "strict-transport-security",
    "max-age=31536000; includeSubDomains",
  );
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  return headers;
}

const STEAM_ID64 = /^7656119\d{10}$/;

export function parseSteamLookup(
  value: string,
): { kind: "id"; value: string } | { kind: "vanity"; value: string } | null {
  const input = value.trim();
  if (STEAM_ID64.test(input)) return { kind: "id", value: input };
  if (input.length > 240 || input.includes("..")) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "steamcommunity.com" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    url.port
  )
    return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  if (parts[0] === "profiles" && STEAM_ID64.test(parts[1]!))
    return { kind: "id", value: parts[1]! };
  if (parts[0] === "id" && /^[A-Za-z0-9_-]{2,64}$/.test(parts[1]!))
    return { kind: "vanity", value: parts[1]! };
  return null;
}

async function resolveSteamId64(
  lookup: ReturnType<typeof parseSteamLookup> & {},
  environment: EdgeEnvironment,
): Promise<string | null> {
  if (lookup.kind === "id") return lookup.value;
  if (!environment.STEAM_WEB_API_KEY)
    throw new Error("steam vanity resolution is not configured");
  const endpoint = new URL(
    "https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/",
  );
  endpoint.searchParams.set("key", environment.STEAM_WEB_API_KEY);
  endpoint.searchParams.set("vanityurl", lookup.value);
  endpoint.searchParams.set("url_type", "1");
  const response = await fetch(endpoint, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok)
    throw new Error("steam vanity resolution is temporarily unavailable");
  const body = (await response.json()) as {
    response?: { success?: number; steamid?: unknown };
  };
  return body.response?.success === 1 &&
    typeof body.response.steamid === "string" &&
    STEAM_ID64.test(body.response.steamid)
    ? body.response.steamid
    : null;
}

function repository(environment: EdgeEnvironment): HostedJobRepository {
  return new HostedJobRepository(
    new TursoSqlClient(
      createClient({
        url: environment.TURSO_DATABASE_URL,
        authToken: environment.TURSO_AUTH_TOKEN,
      }),
    ),
  );
}

async function upload(
  request: Request,
  environment: EdgeEnvironment,
  uploadId: string,
): Promise<Response> {
  if (!UPLOAD_ID.test(uploadId))
    return json(400, { error: "invalid upload ID" });
  const url = new URL(request.url);
  const filename = url.searchParams.get("filename") ?? "";
  if (!isSupportedUploadFilename(filename))
    return json(400, {
      error:
        "filename must be a safe basename ending in .dem, .dem.zip, .dem.gz, .dem.xz, .dem.bz2, or .dem.zst",
    });
  const sha256 = request.headers.get("x-content-sha256") ?? "";
  if (!SHA256.test(sha256))
    return json(400, { error: "x-content-sha256 is required" });
  const contentLength = Number(request.headers.get("content-length"));
  if (
    !Number.isSafeInteger(contentLength) ||
    contentLength < 1 ||
    contentLength > MAX_UPLOAD_BYTES
  )
    return json(413, { error: "demo upload size is invalid" });
  if (!request.body) return json(400, { error: "demo body is required" });
  const key = `uploads/${uploadId}`;
  const stored = await environment.TEMPORARY_DEMOS.put(key, request.body, {
    customMetadata: { sha256, filename },
    httpMetadata: { contentType: "application/octet-stream" },
  });
  if (!stored || stored.size !== contentLength) {
    await environment.TEMPORARY_DEMOS.delete(key);
    return json(400, { error: "incomplete demo upload" });
  }
  const source: HostedSource = {
    kind: "object",
    bucket: `l4dstats-${environment.L4DSTATS_ENVIRONMENT}-temporary`,
    key,
    sha256,
    bytes: contentLength,
    filename,
  };
  const repo = repository(environment);
  await repo.migrate();
  const job = await repo.enqueue(source, `upload:${sha256}`);
  if (job.source.key !== key) {
    await environment.TEMPORARY_DEMOS.delete(key);
    return json(job.state === "succeeded" ? 200 : 202, {
      job,
      duplicate: true,
      sourceRetention: "delete-after-extraction",
    });
  }
  try {
    await environment.ANALYSIS_QUEUE.send({ jobId: job.id });
  } catch (error) {
    await environment.TEMPORARY_DEMOS.delete(key).catch(() => undefined);
    throw error;
  }
  return json(202, {
    job,
    upload: { filename, bytes: contentLength, sha256 },
    sourceRetention: "delete-after-extraction",
  });
}

async function compatibleUpload(
  request: Request,
  environment: EdgeEnvironment,
): Promise<Response> {
  const length = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(length) || length < 1 || length > MAX_UPLOAD_BYTES)
    return json(413, { error: "demo upload size is invalid" });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength !== length)
    return json(400, { error: "incomplete demo upload" });
  const forwarded = new Request(request.url, {
    method: "PUT",
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(bytes.byteLength),
      "x-content-sha256": await digest(bytes),
    },
    body: bytes,
  });
  return upload(forwarded, environment, crypto.randomUUID());
}

export async function fetchHandler(
  request: Request,
  environment: EdgeEnvironment,
): Promise<Response> {
  const url = new URL(request.url);
  const developerConsole = await handleDeveloperConsole(request, environment);
  if (developerConsole) return developerConsole;
  if (request.method === "GET" && url.pathname === "/openapi.json")
    return Response.json(openApiDocument(url.origin), {
      headers: secureHeaders({
        "cache-control": "public, max-age=300",
        "access-control-allow-origin": "*",
      }),
    });
  const publicDeveloperApi = await handlePublicDeveloperApi(
    request,
    environment,
    async (uploadRequest, uploadId) => {
      const response = await upload(uploadRequest, environment, uploadId);
      const value = (await response
        .clone()
        .json()
        .catch(() => null)) as {
        job?: { id?: unknown };
      } | null;
      const jobId =
        typeof value?.job?.id === "string" ? value.job.id : undefined;
      return jobId ? { response, jobId } : { response };
    },
    async (jobId) =>
      fetchHandler(
        new Request(`${url.origin}/api/jobs/${encodeURIComponent(jobId)}`),
        environment,
      ),
  );
  if (publicDeveloperApi) return publicDeveloperApi;
  if (request.method === "GET" && url.pathname === "/health")
    return json(200, {
      status: "ok",
      environment: environment.L4DSTATS_ENVIRONMENT,
    });
  const parts = url.pathname.split("/").filter(Boolean);
  if (request.method === "GET" && url.pathname === "/api/players/resolve") {
    const lookup = parseSteamLookup(url.searchParams.get("q") ?? "");
    if (!lookup)
      return json(400, {
        error: "enter a SteamID64 or complete Steam profile URL",
      });
    let steamId64: string | null;
    try {
      steamId64 = await resolveSteamId64(lookup, environment);
    } catch (error) {
      return json(
        error instanceof Error && error.message.includes("not configured")
          ? 422
          : 503,
        {
          error: error instanceof Error ? error.message : "Steam lookup failed",
        },
      );
    }
    if (!steamId64) return json(404, { error: "Steam profile was not found" });
    const repo = repository(environment);
    await repo.migrate();
    const player = await repo.getPlayerHistory(steamId64);
    if (!player)
      return json(404, {
        error: "No retained L4DStats games include this Steam player",
        steamId64,
        profileUrl: `https://steamcommunity.com/profiles/${steamId64}`,
      });
    return Response.json(player, {
      headers: {
        "cache-control": "public, max-age=60, stale-while-revalidate=300",
      },
    });
  }
  if (
    request.method === "GET" &&
    parts[0] === "api" &&
    parts[1] === "maps" &&
    parts[2] &&
    parts[3] === "geometry" &&
    parts.length === 4
  ) {
    if (!/^[A-Za-z0-9_]{1,96}$/.test(parts[2]))
      return json(400, { error: "map name is invalid" });
    const assetUrl = new URL(request.url);
    assetUrl.pathname = `/map-geometry/${parts[2].toLowerCase()}.json`;
    assetUrl.search = "";
    const asset = await environment.ASSETS.fetch(new Request(assetUrl));
    if (!asset.ok || !asset.headers.get("content-type")?.includes("json"))
      return json(404, { error: "map geometry is unavailable" });
    const headers = secureHeaders(asset.headers);
    headers.set(
      "cache-control",
      "public, max-age=3600, stale-while-revalidate=86400",
    );
    headers.set("x-content-type-options", "nosniff");
    return new Response(asset.body, { status: 200, headers });
  }
  if (request.method === "POST" && url.pathname === "/api/uploads")
    return compatibleUpload(request, environment);
  if (
    request.method === "PUT" &&
    parts[0] === "api" &&
    parts[1] === "uploads" &&
    parts[2] &&
    parts.length === 3
  )
    return upload(request, environment, parts[2]);
  if (
    request.method === "GET" &&
    parts[0] === "api" &&
    parts[1] === "jobs" &&
    parts[2] &&
    parts.length === 3
  ) {
    const repo = repository(environment);
    await repo.migrate();
    const job = await repo.getJob(parts[2]);
    if (!job) return json(404, { error: "job not found" });
    const reference =
      job.state === "succeeded" ? await repo.getAnalysis(job.id) : undefined;
    if (!reference) return json(200, job);
    const object = await environment.DERIVED_ARTIFACTS.get(reference.resultKey);
    if (!object || object.size !== reference.resultBytes)
      return json(503, { error: "derived analysis is unavailable" });
    const engineResult = JSON.parse(
      new TextDecoder().decode(await object.arrayBuffer()),
    );
    const gameId = await repo.assignAnalysisToGame({
      jobId: job.id,
      demoSha256: reference.demoSha256,
      engineResult,
    });
    return json(200, {
      ...job,
      analysis: {
        jobId: job.id,
        demoSha256: reference.demoSha256,
        sourceManifest: {
          kind: "hosted-upload",
          sha256: reference.demoSha256,
          bytes:
            typeof engineResult?.demo?.bytes === "number"
              ? engineResult.demo.bytes
              : job.source.bytes,
          sourceObjectSha256: job.source.sha256,
          sourceObjectBytes: job.source.bytes,
          availability: "deleted-after-extraction",
        },
        engineResult,
        engineResultSha256: reference.resultSha256,
        gameId,
        createdAt: reference.createdAt,
      },
    });
  }
  if (
    request.method === "GET" &&
    parts[0] === "api" &&
    parts[1] === "games" &&
    parts[2] &&
    parts.length === 3
  ) {
    const repo = repository(environment);
    await repo.migrate();
    const game = await repo.getGame(parts[2]);
    if (!game) return json(404, { error: "game not found" });
    const analyses = await Promise.all(
      game.analyses.map(async (reference) => {
        const object = await environment.DERIVED_ARTIFACTS.get(
          reference.resultKey,
        );
        if (!object || object.size !== reference.resultBytes)
          throw new Error("derived analysis is unavailable");
        const engineResult = JSON.parse(
          new TextDecoder().decode(await object.arrayBuffer()),
        );
        return {
          jobId: reference.jobId,
          demoSha256: reference.demoSha256,
          sourceManifest: {
            kind: "hosted-upload",
            sha256: reference.demoSha256,
            bytes:
              typeof engineResult?.demo?.bytes === "number"
                ? engineResult.demo.bytes
                : 0,
            availability: "deleted-after-extraction",
          },
          engineResult,
          engineResultSha256: reference.resultSha256,
          gameId: game.id,
          createdAt: reference.createdAt,
        };
      }),
    );
    return json(200, { ...game, analyses });
  }
  if (request.method === "GET" || request.method === "HEAD") {
    const developerHost =
      url.hostname === "developers.l4dstats.com" ||
      url.hostname === "developers.l4dstats.gg";
    if (developerHost && url.pathname === "/robots.txt") {
      const headers = secureHeaders({
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=3600",
      });
      return new Response("User-agent: *\nAllow: /\n", { headers });
    }
    const assetUrl = new URL(request.url);
    if (developerHost) {
      const isDeveloperAsset =
        url.pathname.startsWith("/developers/assets/") ||
        url.pathname === "/developers/";
      assetUrl.pathname = isDeveloperAsset ? url.pathname : "/developers/";
    }
    let response = await environment.ASSETS.fetch(
      new Request(assetUrl, request),
    );
    if (developerHost && response.status === 404) {
      assetUrl.pathname = "/developers/";
      response = await environment.ASSETS.fetch(new Request(assetUrl, request));
    }
    if (response.status !== 404) {
      const headers = secureHeaders(response.headers);
      headers.set("cross-origin-opener-policy", "same-origin");
      headers.set(
        "content-security-policy",
        "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://us.i.posthog.com https://cloudflareinsights.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      );
      return new Response(response.body, { status: response.status, headers });
    }
  }
  return json(404, { error: "not found" });
}

async function queueHandler(
  batch: MessageBatch<{ jobId: string }>,
  environment: EdgeEnvironment,
): Promise<void> {
  for (const message of batch.messages) {
    const owner = crypto.randomUUID();
    const repo = repository(environment);
    let claimed: Awaited<ReturnType<HostedJobRepository["claim"]>> = undefined;
    try {
      await repo.migrate();
      const job = await repo.claim({
        id: message.body.jobId,
        owner,
        leaseMs: 10 * 60 * 1_000,
      });
      if (!job) {
        const current = await repo.getJob(message.body.jobId);
        if (current?.state === "succeeded") {
          message.ack();
          continue;
        }
        throw new Error("job is not currently claimable");
      }
      claimed = job;
      const source = await environment.TEMPORARY_DEMOS.get(job.source.key);
      if (!source || source.size !== job.source.bytes)
        throw new Error("temporary source object is unavailable or incomplete");
      const container = environment.ANALYSIS_CONTAINER.getByName(
        message.body.jobId,
      );
      const response = await container.fetch(
        new Request(`http://container/jobs/${message.body.jobId}`, {
          method: "POST",
          headers: {
            "content-length": String(job.source.bytes),
            "x-content-sha256": job.source.sha256,
            "x-source-filename": job.source.filename,
          },
          body: source.body,
        }),
      );
      if (!response.ok)
        throw new Error(
          `container returned ${response.status}: ${(await response.text()).slice(0, 2_000)}`,
        );
      const resultBytes = new Uint8Array(await response.arrayBuffer());
      if (
        resultBytes.byteLength < 2 ||
        resultBytes.byteLength > 16 * 1024 * 1024
      )
        throw new Error("container result size is invalid");
      const result = JSON.parse(new TextDecoder().decode(resultBytes)) as {
        schemaVersion?: unknown;
        demo?: { sha256?: unknown };
      };
      if (
        result.schemaVersion !== 1 ||
        typeof result.demo?.sha256 !== "string" ||
        !SHA256.test(result.demo.sha256)
      )
        throw new Error("container result has invalid demo provenance");
      const resultSha256 = await digest(resultBytes);
      const resultKey = `sha256/${resultSha256.slice(0, 2)}/${resultSha256}`;
      const stored = await environment.DERIVED_ARTIFACTS.put(
        resultKey,
        resultBytes,
        {
          customMetadata: {
            sha256: resultSha256,
            demoSha256: result.demo.sha256,
          },
          httpMetadata: { contentType: "application/json" },
        },
      );
      if (!stored || stored.size !== resultBytes.byteLength)
        throw new Error("derived artifact write was not confirmed");
      await repo.recordAnalysis({
        jobId: job.id,
        demoSha256: result.demo.sha256,
        resultKey,
        resultSha256,
        resultBytes: resultBytes.byteLength,
        engineResult: result,
      });
      await environment.TEMPORARY_DEMOS.delete(job.source.key);
      if (await environment.TEMPORARY_DEMOS.head(job.source.key))
        throw new Error("source demo deletion was not confirmed");
      await repo.finish({ id: job.id, owner, state: "succeeded" });
      await captureOperationalEvent(environment, "hosted_analysis_succeeded", {
        attempt: job.attempt,
        resultSizeBand:
          resultBytes.byteLength < 1024 * 1024 ? "under_1mb" : "1mb_or_more",
      });
      message.ack();
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message.slice(0, 2_000)
          : "unknown error";
      console.error(
        JSON.stringify({
          event: "hosted.analysis.failed",
          jobId: message.body.jobId,
          detail,
        }),
      );
      const job = claimed ?? (await repo.getJob(message.body.jobId));
      await captureOperationalEvent(environment, "hosted_analysis_failed", {
        attempt: job?.attempt ?? 0,
        category: failureCategory(error),
        terminal: job?.state === "running" && job.attempt >= 3,
      });
      if (job?.state === "running" && isTransientContainerCapacity(error)) {
        await repo.defer({
          id: job.id,
          owner,
          message: "Hosted analysis capacity is busy; retrying",
        });
        message.retry({ delaySeconds: 30 });
      } else if (job?.state === "running" && job.attempt >= 3) {
        await environment.TEMPORARY_DEMOS.delete(job.source.key).catch(
          () => undefined,
        );
        await repo.finish({
          id: job.id,
          owner,
          state: "failed",
          message: "Analysis failed after three bounded attempts",
        });
        message.ack();
      } else if (job?.state === "running") {
        await repo.retry({
          id: job.id,
          owner,
          message: "Analysis attempt failed; retrying",
        });
        message.retry({ delaySeconds: 30 });
      } else {
        message.retry({ delaySeconds: 30 });
      }
    }
  }
}

async function digest(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes);
  const value = new Uint8Array(
    await crypto.subtle.digest("SHA-256", copy.buffer),
  );
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default {
  fetch: fetchHandler,
  queue: queueHandler,
};
