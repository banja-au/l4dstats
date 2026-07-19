import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { once } from "node:events";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { open, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  telemetryLimits,
  type ReviewStatus,
  type WorkbenchRepository,
} from "@l4dstats/storage";
import {
  isSupportedDemoFilename,
  prepareUploadedDemo,
} from "@l4dstats/acquisition";
import { exportReport } from "./report.js";
import { validateSource, type IngestionPolicy } from "./validation.js";

const MAX_BODY = 64 * 1024;
const MAX_GEOMETRY_ARTIFACT_BYTES = 128 * 1024 * 1024;
const OFFICIAL_MAP_CONTENT_ROOTS = new Set([
  "update",
  "left4dead2_dlc3",
  "left4dead2_dlc2",
  "left4dead2_dlc1",
  "left4dead2",
]);
const TERMINAL_JOB_STATES = new Set(["succeeded", "failed", "cancelled"]);
const openApiDocument = JSON.parse(
  readFileSync(new URL("../openapi.json", import.meta.url), "utf8"),
) as unknown;

function assertGeometryArtifact(record: Record<string, unknown>, map: string) {
  if (record.format !== "l4dstats-map-mesh-v1")
    throw new RangeError("map geometry artifact format is unsupported");
  const positions = record.positions,
    indices = record.indices,
    provenance = record.provenance as Record<string, unknown> | undefined;
  if (
    (record.bspVersion !== 20 && record.bspVersion !== 21) ||
    !Number.isSafeInteger(record.mapRevision) ||
    Number(record.mapRevision) < 0
  )
    throw new RangeError("map geometry BSP metadata is invalid");
  if (
    !Array.isArray(positions) ||
    positions.length === 0 ||
    positions.length % 3 !== 0 ||
    positions.length > 12_000_000 ||
    !positions.every(
      (value) => typeof value === "number" && Number.isFinite(value),
    )
  )
    throw new RangeError("map geometry positions are invalid");
  const vertexCount = positions.length / 3;
  if (
    !Array.isArray(indices) ||
    indices.length === 0 ||
    indices.length % 3 !== 0 ||
    indices.length > 12_000_000 ||
    !indices.every(
      (value) =>
        typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= 0 &&
        value < vertexCount,
    )
  )
    throw new RangeError("map geometry indices are invalid");
  const triangleZ = record.triangleZ;
  if (
    !Array.isArray(triangleZ) ||
    triangleZ.length !== indices.length / 3 ||
    !triangleZ.every(
      (value) => typeof value === "number" && Number.isFinite(value),
    )
  )
    throw new RangeError("map geometry floor metadata is invalid");
  const bounds = record.bounds as Record<string, unknown> | undefined;
  const minimum = bounds?.min as Record<string, unknown> | undefined;
  const maximum = bounds?.max as Record<string, unknown> | undefined;
  const axes = ["x", "y", "z"] as const;
  if (
    !minimum ||
    !maximum ||
    axes.some(
      (axis) =>
        typeof minimum[axis] !== "number" ||
        !Number.isFinite(minimum[axis]) ||
        typeof maximum[axis] !== "number" ||
        !Number.isFinite(maximum[axis]) ||
        minimum[axis] > maximum[axis],
    )
  )
    throw new RangeError("map geometry bounds are invalid");
  const actual = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };
  for (let index = 0; index < positions.length; index += 3) {
    for (const [offset, axis] of axes.entries()) {
      const value = positions[index + offset]!;
      actual.min[axis] = Math.min(actual.min[axis], value);
      actual.max[axis] = Math.max(actual.max[axis], value);
    }
  }
  if (
    axes.some(
      (axis) =>
        minimum[axis] !== actual.min[axis] ||
        maximum[axis] !== actual.max[axis],
    )
  )
    throw new RangeError("map geometry bounds do not match its positions");
  const coverage = record.coverage as Record<string, unknown> | undefined;
  const compression = coverage?.compression as
    | Record<string, unknown>
    | undefined;
  const coverageCounts = [
    "worldFaces",
    "emittedFaces",
    "emittedTriangles",
    "skippedToolFaces",
    "skippedDisplacements",
    "emittedDisplacements",
    "rejectedFaces",
  ];
  if (
    !coverage ||
    coverageCounts.some(
      (name) =>
        !Number.isSafeInteger(coverage[name]) || Number(coverage[name]) < 0,
    ) ||
    coverage.emittedTriangles !== indices.length / 3 ||
    coverage.staticProps !== "unavailable" ||
    coverage.dynamicState !== "unavailable" ||
    compression?.codec !== "valve-source-lzma1" ||
    compression.decoder !== "@napi-rs/lzma@1.5.1" ||
    !Array.isArray(compression.decodedLumps) ||
    compression.decodedLumps.some(
      (value) =>
        !Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 63,
    ) ||
    new Set(compression.decodedLumps).size !==
      compression.decodedLumps.length ||
    !Number.isSafeInteger(compression.decodedBytes) ||
    Number(compression.decodedBytes) < 0
  )
    throw new RangeError("map geometry coverage provenance is invalid");
  if (provenance?.map !== map)
    throw new RangeError("map geometry provenance does not match the request");
  if (!/^[a-f0-9]{64}$/.test(String(provenance.sourceBspSha256 ?? "")))
    throw new RangeError("map geometry BSP hash is invalid");
  if (
    (provenance.sourceKind !== "steam-dedicated-server" &&
      provenance.sourceKind !== "local-bsp") ||
    (provenance.sourceKind === "steam-dedicated-server" &&
      (provenance.steamAppId !== 222860 ||
        !OFFICIAL_MAP_CONTENT_ROOTS.has(String(provenance.contentRoot)))) ||
    (provenance.sourceKind === "local-bsp" &&
      (provenance.steamAppId !== undefined ||
        provenance.steamBuildId !== undefined ||
        provenance.contentRoot !== undefined)) ||
    !Number.isSafeInteger(provenance.sourceBytes) ||
    Number(provenance.sourceBytes) <= 0 ||
    Number(provenance.sourceBytes) > 768 * 1024 * 1024 ||
    typeof provenance.extractor !== "string" ||
    !provenance.extractor.startsWith("@l4dstats/map-source1@") ||
    (provenance.steamBuildId !== undefined &&
      !/^[0-9]+$/.test(String(provenance.steamBuildId)))
  )
    throw new RangeError("map geometry derivation provenance is invalid");
  return provenance;
}

function assertCatalogEntry(
  catalog: Record<string, unknown>,
  artifact: Record<string, unknown>,
  map: string,
) {
  const provenance = artifact.provenance as Record<string, unknown>;
  if (
    catalog.format !== "l4dstats-map-catalog-v1" ||
    catalog.sourceKind !== provenance.sourceKind ||
    (catalog.sourceKind === "steam-dedicated-server" &&
      catalog.steamAppId !== 222860) ||
    (catalog.sourceKind === "local-bsp" && catalog.steamAppId !== undefined) ||
    catalog.extractor !== provenance.extractor ||
    (catalog.steamBuildId ?? undefined) !==
      (provenance.steamBuildId ?? undefined) ||
    !Array.isArray(catalog.maps)
  )
    throw new RangeError("map geometry catalog provenance is invalid");
  const entry = catalog.maps.find(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      (value as Record<string, unknown>).map === map,
  ) as Record<string, unknown> | undefined;
  if (!entry) return false;
  const coverage = artifact.coverage as Record<string, unknown>;
  if (
    entry.sourceBspSha256 !== provenance.sourceBspSha256 ||
    entry.sourceBytes !== provenance.sourceBytes ||
    entry.bspVersion !== artifact.bspVersion ||
    entry.mapRevision !== artifact.mapRevision ||
    entry.emittedTriangles !== coverage.emittedTriangles ||
    entry.contentRoot !== provenance.contentRoot
  )
    throw new RangeError("map geometry does not match its catalog entry");
  return true;
}
async function body(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("request body is too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new Error("request body must be valid JSON");
  }
}

async function receiveDemoUpload(
  request: IncomingMessage,
  root: string,
  filename: string,
  maxBytes: number,
) {
  if (!filename || filename.length > 240 || !isSupportedDemoFilename(filename))
    throw new RangeError("upload filename is invalid");
  mkdirSync(root, { recursive: true });
  const uploadPath = join(root, `${randomUUID()}.upload`);
  const demoPath = join(root, `${randomUUID()}.dem`);
  const file = await open(uploadPath, "wx", 0o600);
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    for await (const value of request) {
      const chunk = value as Buffer;
      bytes += chunk.byteLength;
      if (bytes > maxBytes)
        throw new RangeError("uploaded demo exceeds the byte limit");
      hash.update(chunk);
      await file.write(chunk);
    }
    if (bytes === 0) throw new RangeError("uploaded demo is empty");
    await file.close();
    const sourceObjectSha256 = hash.digest("hex");
    const prepared = await prepareUploadedDemo(
      filename,
      await readFile(uploadPath),
      {
        maxSourceBytes: maxBytes,
        maxDemoBytes: maxBytes,
        maxCompressionRatio: 100,
        maxZipEntries: 16,
        timeoutMs: 30_000,
      },
    ).catch((error: unknown) => {
      throw new RangeError(
        error instanceof Error ? error.message : "compressed demo is invalid",
      );
    });
    await writeFile(demoPath, prepared.bytes, { flag: "wx", mode: 0o600 });
    await unlink(uploadPath);
    return {
      path: demoPath,
      bytes: prepared.bytes.byteLength,
      sha256: prepared.sha256,
      filename,
      sourceObjectSha256,
      sourceObjectBytes: bytes,
      sourceObjectFormat: prepared.sourceFormat,
    };
  } catch (error) {
    await file.close().catch(() => undefined);
    await unlink(uploadPath).catch(() => undefined);
    await unlink(demoPath).catch(() => undefined);
    throw error;
  }
}

async function drainRequest(request: IncomingMessage) {
  if (request.complete || request.readableEnded || request.destroyed) return;
  request.resume();
  await Promise.race([
    once(request, "end"),
    once(request, "aborted"),
    once(request, "error"),
  ]).catch(() => undefined);
}
function send(
  response: ServerResponse,
  status: number,
  payload: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function prometheusLine(name: string, value: number, labels = "") {
  return `${name}${labels} ${Number.isFinite(value) ? value : 0}`;
}

function hasValidBearerToken(request: IncomingMessage, token: string) {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return false;
  const expected = createHash("sha256").update(token).digest();
  const supplied = createHash("sha256")
    .update(authorization.slice("Bearer ".length))
    .digest();
  return timingSafeEqual(expected, supplied);
}

export function createApi(
  repo: WorkbenchRepository,
  policy: IngestionPolicy,
  options: {
    ssePollIntervalMs?: number;
    uploadRoot?: string;
    maxUploadBytes?: number;
    geometryRoot?: string;
    geometryRoots?: readonly string[];
    mutationRateLimit?: { requests: number; windowMs: number };
    authFailureRateLimit?: { requests: number; windowMs: number };
    apiToken?: string;
    workerHeartbeatPath?: string;
  } = {},
) {
  const mutationBuckets = new Map<
    string,
    { windowStartedAt: number; requests: number }
  >();
  const authFailureBuckets = new Map<
    string,
    { windowStartedAt: number; requests: number }
  >();
  const startedAt = Date.now();
  let requestsTotal = 0;
  let authRejectionsTotal = 0;
  let mutationRateLimitedTotal = 0;
  const responseClasses = new Map<string, number>();
  const durationBuckets = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;
  const durationCounts = new Map<number, number>();
  let durationCount = 0;
  let durationSum = 0;
  return createServer(async (request, response) => {
    requestsTotal += 1;
    const requestStartedAt = process.hrtime.bigint();
    response.once("finish", () => {
      const responseClass = `${Math.floor(response.statusCode / 100)}xx`;
      responseClasses.set(
        responseClass,
        (responseClasses.get(responseClass) ?? 0) + 1,
      );
      const duration = Number(process.hrtime.bigint() - requestStartedAt) / 1e9;
      durationCount += 1;
      durationSum += duration;
      for (const bucket of durationBuckets) {
        if (duration <= bucket)
          durationCounts.set(bucket, (durationCounts.get(bucket) ?? 0) + 1);
      }
    });
    try {
      const url = new URL(request.url ?? "/", "http://localhost"),
        parts = url.pathname.split("/").filter(Boolean);
      const bearerValid = options.apiToken
        ? hasValidBearerToken(request, options.apiToken)
        : true;
      const suppliedUser = request.headers["x-l4dstats-user"];
      const authenticatedUser =
        bearerValid &&
        typeof suppliedUser === "string" &&
        /^[A-Za-z0-9_.@-]{1,64}$/.test(suppliedUser)
          ? suppliedUser
          : undefined;
      const rateLimit = options.mutationRateLimit;
      if (
        rateLimit &&
        request.method !== "GET" &&
        request.method !== "HEAD" &&
        url.pathname.startsWith("/api/")
      ) {
        const now = Date.now();
        const key = authenticatedUser
          ? `user:${authenticatedUser}`
          : `address:${request.socket.remoteAddress ?? "unknown"}`;
        const prior = mutationBuckets.get(key);
        const bucket =
          prior && now - prior.windowStartedAt < rateLimit.windowMs
            ? prior
            : { windowStartedAt: now, requests: 0 };
        const resetSeconds = Math.max(
          1,
          Math.ceil(
            (bucket.windowStartedAt + rateLimit.windowMs - now) / 1_000,
          ),
        );
        response.setHeader("x-ratelimit-limit", rateLimit.requests);
        response.setHeader(
          "x-ratelimit-remaining",
          Math.max(0, rateLimit.requests - bucket.requests - 1),
        );
        response.setHeader("x-ratelimit-reset", resetSeconds);
        if (bucket.requests >= rateLimit.requests) {
          mutationRateLimitedTotal += 1;
          await drainRequest(request);
          response.setHeader("retry-after", resetSeconds);
          send(response, 429, { error: "mutation rate limit exceeded" });
          return;
        }
        bucket.requests += 1;
        mutationBuckets.set(key, bucket);
      }
      if (request.method === "GET" && url.pathname === "/health") {
        const database = repo.isReady();
        send(response, database ? 200 : 503, {
          ok: database,
          checks: { database },
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/metrics") {
        const database = repo.isReady();
        const operations = database
          ? repo.operationalMetrics()
          : {
              jobs: {
                queued: 0,
                running: 0,
                succeeded: 0,
                failed: 0,
                cancelled: 0,
              },
              oldestQueuedAgeSeconds: null,
            };
        let heartbeatAgeSeconds: number | null = null;
        if (options.workerHeartbeatPath) {
          try {
            heartbeatAgeSeconds = Math.max(
              0,
              (Date.now() - statSync(options.workerHeartbeatPath).mtimeMs) /
                1_000,
            );
          } catch {
            heartbeatAgeSeconds = null;
          }
        }
        const lines = [
          "# HELP l4dstats_up Whether the API process can serve metrics.",
          "# TYPE l4dstats_up gauge",
          prometheusLine("l4dstats_up", 1),
          "# HELP l4dstats_database_ready Whether SQLite accepts a readiness query.",
          "# TYPE l4dstats_database_ready gauge",
          prometheusLine("l4dstats_database_ready", database ? 1 : 0),
          "# HELP l4dstats_process_uptime_seconds API process uptime.",
          "# TYPE l4dstats_process_uptime_seconds gauge",
          prometheusLine(
            "l4dstats_process_uptime_seconds",
            (Date.now() - startedAt) / 1_000,
          ),
          "# HELP l4dstats_http_requests_total HTTP requests received by response class.",
          "# TYPE l4dstats_http_requests_total counter",
          ...["2xx", "3xx", "4xx", "5xx"].map((responseClass) =>
            prometheusLine(
              "l4dstats_http_requests_total",
              responseClasses.get(responseClass) ?? 0,
              `{class="${responseClass}"}`,
            ),
          ),
          prometheusLine(
            "l4dstats_http_requests_in_progress",
            Math.max(
              0,
              requestsTotal -
                [...responseClasses.values()].reduce(
                  (sum, value) => sum + value,
                  0,
                ),
            ),
          ),
          "# HELP l4dstats_http_request_duration_seconds API request duration.",
          "# TYPE l4dstats_http_request_duration_seconds histogram",
          ...durationBuckets.map((bucket) =>
            prometheusLine(
              "l4dstats_http_request_duration_seconds_bucket",
              durationCounts.get(bucket) ?? 0,
              `{le="${bucket}"}`,
            ),
          ),
          prometheusLine(
            "l4dstats_http_request_duration_seconds_bucket",
            durationCount,
            '{le="+Inf"}',
          ),
          prometheusLine(
            "l4dstats_http_request_duration_seconds_sum",
            durationSum,
          ),
          prometheusLine(
            "l4dstats_http_request_duration_seconds_count",
            durationCount,
          ),
          "# HELP l4dstats_auth_rejections_total Rejected API bearer authentication attempts.",
          "# TYPE l4dstats_auth_rejections_total counter",
          prometheusLine("l4dstats_auth_rejections_total", authRejectionsTotal),
          "# HELP l4dstats_mutation_rate_limited_total Mutation requests rejected by quota.",
          "# TYPE l4dstats_mutation_rate_limited_total counter",
          prometheusLine(
            "l4dstats_mutation_rate_limited_total",
            mutationRateLimitedTotal,
          ),
          "# HELP l4dstats_jobs Current durable jobs by state.",
          "# TYPE l4dstats_jobs gauge",
          ...Object.entries(operations.jobs).map(([state, value]) =>
            prometheusLine("l4dstats_jobs", value, `{state="${state}"}`),
          ),
          "# HELP l4dstats_oldest_queued_job_age_seconds Age of the oldest queued job, or zero with no queue.",
          "# TYPE l4dstats_oldest_queued_job_age_seconds gauge",
          prometheusLine(
            "l4dstats_oldest_queued_job_age_seconds",
            operations.oldestQueuedAgeSeconds ?? 0,
          ),
          "# HELP l4dstats_worker_heartbeat_available Whether the shared worker heartbeat exists.",
          "# TYPE l4dstats_worker_heartbeat_available gauge",
          prometheusLine(
            "l4dstats_worker_heartbeat_available",
            heartbeatAgeSeconds === null ? 0 : 1,
          ),
          "# HELP l4dstats_worker_heartbeat_age_seconds Age of the shared worker heartbeat.",
          "# TYPE l4dstats_worker_heartbeat_age_seconds gauge",
          prometheusLine(
            "l4dstats_worker_heartbeat_age_seconds",
            heartbeatAgeSeconds ?? 0,
          ),
        ];
        response.writeHead(database ? 200 : 503, {
          "content-type": "text/plain; version=0.0.4; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(`${lines.join("\n")}\n`);
        return;
      }
      if (options.apiToken && url.pathname.startsWith("/api/")) {
        const key = request.socket.remoteAddress ?? "unknown";
        if (bearerValid) {
          authFailureBuckets.delete(key);
        } else {
          authRejectionsTotal += 1;
          const limit = options.authFailureRateLimit;
          if (limit) {
            const timestamp = Date.now();
            const prior = authFailureBuckets.get(key);
            const bucket =
              prior && timestamp - prior.windowStartedAt < limit.windowMs
                ? prior
                : { windowStartedAt: timestamp, requests: 0 };
            const resetSeconds = Math.max(
              1,
              Math.ceil(
                (bucket.windowStartedAt + limit.windowMs - timestamp) / 1_000,
              ),
            );
            if (bucket.requests >= limit.requests) {
              await drainRequest(request);
              response.setHeader("retry-after", resetSeconds);
              send(response, 429, {
                error: "authentication rate limit exceeded",
              });
              return;
            }
            bucket.requests += 1;
            authFailureBuckets.set(key, bucket);
          }
          await drainRequest(request);
          response.setHeader("www-authenticate", "Bearer");
          send(response, 401, { error: "authentication required" });
          return;
        }
      }
      if (request.method === "GET" && url.pathname === "/api/openapi.json") {
        send(response, 200, openApiDocument);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/stats") {
        send(response, 200, repo.publicStats());
        return;
      }
      if (
        request.method === "GET" &&
        parts[0] === "api" &&
        parts[1] === "maps" &&
        parts[2] &&
        parts[3] === "geometry" &&
        parts.length === 4
      ) {
        const map = parts[2];
        if (!/^[a-z0-9_]+$/i.test(map))
          throw new RangeError("map name is invalid");
        const geometryRoots = options.geometryRoots ?? [
          options.geometryRoot ?? "data/geometry",
        ];
        let geometryRoot: string | undefined;
        let path: string | undefined;
        let metadata;
        for (const candidate of geometryRoots) {
          const candidatePath = join(candidate, `${map}.json`);
          try {
            const candidateMetadata = statSync(candidatePath);
            geometryRoot = candidate;
            path = candidatePath;
            metadata = candidateMetadata;
            break;
          } catch (error) {
            if (
              error instanceof Error &&
              "code" in error &&
              error.code === "ENOENT"
            )
              continue;
            throw error;
          }
        }
        if (!geometryRoot || !path || !metadata) {
          send(response, 404, {
            error: "map geometry is unavailable on this instance",
            map,
            availability: "unavailable",
            setup: "Run pnpm maps:install and pnpm maps:extract locally",
          });
          return;
        }
        if (!metadata.isFile() || metadata.size > MAX_GEOMETRY_ARTIFACT_BYTES)
          throw new RangeError("map geometry artifact exceeds the byte limit");
        const artifact = readFileSync(path, "utf8");
        let parsed: unknown;
        try {
          parsed = JSON.parse(artifact) as unknown;
        } catch {
          throw new RangeError("map geometry artifact is invalid JSON");
        }
        const record = parsed as Record<string, unknown>;
        const provenance = assertGeometryArtifact(record, map);
        const catalogPath = join(geometryRoot, "catalog.json");
        try {
          const catalog = JSON.parse(
            readFileSync(catalogPath, "utf8"),
          ) as Record<string, unknown>;
          if (!assertCatalogEntry(catalog, record, map)) {
            send(response, 404, {
              error: "map geometry is absent from the active local catalog",
              map,
              availability: "unavailable",
            });
            return;
          }
        } catch (error) {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          ) {
            // A single custom-map artifact does not require a catalog.
          } else if (error instanceof SyntaxError) {
            throw new RangeError("map geometry catalog is invalid JSON");
          } else {
            throw error;
          }
        }
        const artifactSha256 = createHash("sha256")
          .update(artifact)
          .digest("hex");
        response.setHeader("etag", `"sha256:${artifactSha256}"`);
        response.setHeader(
          "x-source-bsp-sha256",
          String(provenance.sourceBspSha256),
        );
        send(response, 200, parsed);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/players/resolve") {
        const query = (url.searchParams.get("q") ?? "").trim();
        const numeric = /^7656119\d{10}$/.test(query)
          ? query
          : /^https:\/\/steamcommunity\.com\/profiles\/(7656119\d{10})\/?$/.exec(
              query,
            )?.[1];
        if (!numeric) {
          send(response, 400, {
            error: "enter a SteamID64 or numeric Steam profile URL",
          });
          return;
        }
        const history = repo.getPlayerHistory(numeric);
        send(
          response,
          history ? 200 : 404,
          history ?? {
            error: "No retained L4DStats games include this Steam player",
          },
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/uploads") {
        const uploaded = await receiveDemoUpload(
          request,
          options.uploadRoot ?? "data/uploads",
          url.searchParams.get("filename") ?? "",
          options.maxUploadBytes ?? policy.maxLocalBytes,
        );
        const job = repo.enqueue(
          {
            kind: "local",
            path: uploaded.path,
            sha256: uploaded.sha256,
            bytes: uploaded.bytes,
            sourceObjectSha256: uploaded.sourceObjectSha256,
            sourceObjectBytes: uploaded.sourceObjectBytes,
            sourceObjectFormat: uploaded.sourceObjectFormat,
          },
          `upload:${uploaded.sha256}`,
        );
        send(response, 202, {
          job,
          upload: {
            filename: uploaded.filename,
            bytes: uploaded.bytes,
            sha256: uploaded.sha256,
          },
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/jobs") {
        const input = (await body(request)) as Record<string, unknown>,
          source = await validateSource(input.source, policy);
        const key =
          typeof input.idempotencyKey === "string" ? input.idempotencyKey : "";
        send(response, 202, repo.enqueue(source, key));
        return;
      }
      if (
        request.method === "GET" &&
        parts[0] === "api" &&
        parts[1] === "games" &&
        parts[2] &&
        parts.length === 3
      ) {
        try {
          send(response, 200, repo.getGame(parts[2]));
        } catch {
          send(response, 404, { error: "game not found" });
        }
        return;
      }
      if (parts[0] === "api" && parts[1] === "jobs" && parts[2]) {
        const job = repo.getJob(parts[2]);
        if (!job) {
          send(response, 404, { error: "job not found" });
          return;
        }
        if (request.method === "GET" && parts.length === 3) {
          let analysis: unknown;
          if (job.state === "succeeded") {
            try {
              analysis = repo.getJobAnalysis(job.id);
            } catch {
              analysis = undefined;
            }
          }
          send(response, 200, { ...job, ...(analysis ? { analysis } : {}) });
          return;
        }
        if (request.method === "POST" && parts[3] === "cancel") {
          send(response, 200, repo.cancel(job.id));
          return;
        }
        if (request.method === "POST" && parts[3] === "retry") {
          send(response, 200, repo.retry(job.id));
          return;
        }
        if (request.method === "POST" && parts[3] === "reanalyze") {
          send(
            response,
            202,
            repo.enqueue(job.source, `reanalyze:${job.id}:${randomUUID()}`),
          );
          return;
        }
        if (request.method === "GET" && parts[3] === "events") {
          response.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          });
          response.flushHeaders();
          let lastSignature = "";
          const emit = () => {
            const current = repo.getJob(job.id);
            if (!current) {
              response.end();
              return;
            }
            const signature = JSON.stringify(current);
            if (signature !== lastSignature) {
              response.write(`event: progress\ndata: ${signature}\n\n`);
              lastSignature = signature;
            }
            if (TERMINAL_JOB_STATES.has(current.state)) {
              clearInterval(timer);
              response.end();
            }
          };
          const timer = setInterval(emit, options.ssePollIntervalMs ?? 250);
          timer.unref();
          response.once("close", () => clearInterval(timer));
          emit();
          return;
        }
      }
      if (request.method === "GET" && url.pathname === "/api/cases") {
        send(response, 200, {
          items: repo.listCases(
            Number(url.searchParams.get("limit") ?? 50),
            Number(url.searchParams.get("offset") ?? 0),
          ),
        });
        return;
      }
      if (parts[0] === "api" && parts[1] === "cases" && parts[2]) {
        const caseId = parts[2];
        if (request.method === "GET" && parts.length === 3) {
          const found = repo.getCase(caseId);
          send(
            response,
            found ? 200 : 404,
            found
              ? {
                  ...found,
                  score: JSON.parse(found.scoreJson) as unknown,
                  presentation: repo.getCasePresentation(caseId),
                  lineage: repo.getCaseLineage(caseId),
                }
              : { error: "case not found" },
          );
          return;
        }
        if (request.method === "POST" && parts[3] === "notes") {
          const input = (await body(request)) as Record<string, unknown>;
          send(
            response,
            201,
            repo.addNote(
              caseId,
              String(input.body ?? ""),
              input.tick === null || input.tick === undefined
                ? null
                : Number(input.tick),
            ),
          );
          return;
        }
        if (request.method === "GET" && parts[3] === "notes") {
          send(response, 200, { items: repo.listNotes(caseId) });
          return;
        }
        if (request.method === "PATCH" && parts[3] === "review-status") {
          const input = (await body(request)) as Record<string, unknown>;
          send(
            response,
            200,
            repo.updateCaseStatus(caseId, String(input.status) as ReviewStatus),
          );
          return;
        }
        if (request.method === "GET" && parts[3] === "telemetry") {
          const start = Number(url.searchParams.get("start")),
            end = Number(url.searchParams.get("end")),
            demoSha256 = url.searchParams.get("demo") ?? undefined;
          if (demoSha256 !== undefined && !/^[a-f0-9]{64}$/.test(demoSha256))
            throw new RangeError("demo must be a SHA-256 digest");
          const telemetryResponse = {
            caseId,
            startTick: start,
            endTick: end,
            chunks: repo.getWindow(
              caseId,
              start,
              end,
              telemetryLimits.maxQueryTicks,
              demoSha256,
            ),
          };
          if (
            Buffer.byteLength(JSON.stringify(telemetryResponse)) >
            telemetryLimits.maxResponseBytes
          )
            throw new RangeError("telemetry response exceeds the byte limit");
          send(response, 200, telemetryResponse);
          return;
        }
        if (request.method === "GET" && parts[3] === "report") {
          const report = exportReport(repo, caseId);
          response.setHeader("etag", `\"sha256:${report.sha256}\"`);
          send(response, 200, report);
          return;
        }
      }
      send(response, 404, { error: "not found" });
    } catch (error) {
      await drainRequest(request);
      const message =
        error instanceof Error ? error.message : "unexpected error";
      send(response, error instanceof RangeError ? 416 : 400, {
        error: message,
      });
    }
  });
}
