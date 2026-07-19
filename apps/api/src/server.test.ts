import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { sha256, WorkbenchRepository } from "@witchwatch/storage";
import { createApi } from "./server.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
});
async function fixture(apiOptions: Parameters<typeof createApi>[2] = {}) {
  const root = await mkdtemp(join(tmpdir(), "witchwatch-api-")),
    inbox = join(root, "inbox"),
    uploads = join(root, "uploads"),
    geometry = join(root, "geometry");
  await mkdir(inbox);
  await mkdir(geometry);
  const demo = join(inbox, "sample.dem");
  await writeFile(demo, "HL2DEMO");
  const repo = new WorkbenchRepository();
  repo.upsertCase({
    id: "case-1",
    playerKey: "redacted-player",
    status: "unreviewed",
    score: {
      status: "insufficient-data",
      strongestCounterevidence: ["Limited reconstruction"],
    },
  });
  repo.setCaseLineage("case-1", {
    demoSha256: "a".repeat(64),
    parserVersion: "fixture-v1",
    detectorVersions: {},
    modelVersion: "controlled-v1",
  });
  repo.putWindow("case-1", 100, 200, { poses: [{ tick: 120 }] });
  repo.setCaseLineage("case-1", {
    source: { demoSha256: "a".repeat(64) },
    artifacts: { engineResultSha256: "b".repeat(64) },
    versions: {
      parser: "controlled@1",
      schema: "observations/v1",
      detectors: [],
      model: "none",
    },
    config: { id: "controlled" },
    map: { name: "controlled", assetVersion: "none" },
    derivation: ["controlled fixture"],
  });
  repo.setCasePresentation("case-1", {
    schemaVersion: 1,
    id: "case-1",
    alias: "Controlled case",
    identityLabel: "Controlled demo-local epoch",
    provenance: { controlledFixture: true, label: "API test fixture" },
    demos: [
      {
        id: "demo-a",
        sha256: "a".repeat(64),
        mapName: "controlled",
        sourceLabel: "fixture",
        quality: { value: null, basis: ["not evaluated"] },
        corroboration: "unassociated",
      },
    ],
    evidence: [
      {
        id: "evidence-a",
        family: "aim",
        title: "Controlled evidence",
        tick: 120,
        tickRange: { start: 119, end: 121 },
        quality: { value: 0.5, basis: ["controlled"] },
        contribution: null,
        explanation: "Controlled only",
        counterevidence: ["Limited reconstruction"],
        limitations: ["Fixture"],
        demoSha256: "a".repeat(64),
        window: { startTick: 100, endTick: 200, contextSeconds: 8 },
      },
    ],
    association: {
      kind: "demo-local-epoch",
      corroboratingDemoCount: 0,
      explanation: "No stable token",
    },
    summary: { encounterCount: 1, independentSignalFamilies: ["aim"] },
  });
  const server = createApi(
    repo,
    {
      allowedHosts: ["cedapug.com"],
      allowedLocalRoots: [inbox],
      maxLocalBytes: 1024,
    },
    {
      ssePollIntervalMs: 5,
      uploadRoot: uploads,
      maxUploadBytes: 1024,
      geometryRoot: geometry,
      ...apiOptions,
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  cleanups.push(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    repo.close();
    await rm(root, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${address.port}`, demo, repo, geometry };
}

const geometryArtifact = (map: string, hash = "a".repeat(64)) => ({
  format: "witchwatch-map-mesh-v1",
  bspVersion: 21,
  mapRevision: 7,
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  indices: [0, 1, 2],
  triangleZ: [0],
  bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 } },
  coverage: {
    worldFaces: 1,
    emittedFaces: 1,
    emittedTriangles: 1,
    skippedToolFaces: 0,
    skippedDisplacements: 0,
    emittedDisplacements: 0,
    rejectedFaces: 0,
    staticProps: "unavailable",
    dynamicState: "unavailable",
    compression: {
      codec: "valve-source-lzma1",
      decoder: "@napi-rs/lzma@1.5.1",
      decodedLumps: [],
      decodedBytes: 0,
    },
  },
  provenance: {
    map,
    sourceBspSha256: hash,
    sourceBytes: 4096,
    sourceKind: "steam-dedicated-server",
    steamAppId: 222860,
    steamBuildId: "12345678",
    contentRoot: "left4dead2",
    extractor: "@witchwatch/map-source1@0.0.0",
  },
});

describe("review API", () => {
  it("reports database readiness instead of process-only health", async () => {
    const { base, repo } = await fixture();
    expect(await (await fetch(`${base}/health`)).json()).toEqual({
      ok: true,
      checks: { database: true },
    });
    repo.isReady = () => false;
    const unavailable = await fetch(`${base}/health`);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({
      ok: false,
      checks: { database: false },
    });
  });
  it("exports privacy-safe operational metrics and rejection counters", async () => {
    const token = "metrics-api-token-with-at-least-32-bytes";
    const { base, repo } = await fixture({
      apiToken: token,
      authFailureRateLimit: { requests: 2, windowMs: 60_000 },
      workerHeartbeatPath: "/definitely/missing/worker-heartbeat.json",
    });
    repo.enqueue(
      {
        kind: "local",
        path: "/private/never-export-this.dem",
        sha256: "f".repeat(64),
        bytes: 7,
      },
      "private-idempotency-key",
    );
    expect((await fetch(`${base}/api/openapi.json`)).status).toBe(401);
    const response = await fetch(`${base}/metrics`);
    const metrics = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("version=0.0.4");
    expect(metrics).toContain("l4dstats_database_ready 1");
    expect(metrics).toContain('l4dstats_jobs{state="queued"} 1');
    expect(metrics).toContain("l4dstats_auth_rejections_total 1");
    expect(metrics).toContain(
      'l4dstats_http_request_duration_seconds_bucket{le="+Inf"}',
    );
    expect(metrics).toContain("l4dstats_worker_heartbeat_available 0");
    expect(metrics).not.toContain("never-export-this");
    expect(metrics).not.toContain("private-idempotency-key");
    expect(metrics).not.toContain("ffffffffffffffff");
  });
  it("protects API routes with constant-time bearer authentication", async () => {
    const token = "test-api-token-with-at-least-32-bytes";
    const { base } = await fixture({
      apiToken: token,
      authFailureRateLimit: { requests: 2, windowMs: 60_000 },
    });
    expect((await fetch(`${base}/health`)).status).toBe(200);
    const missing = await fetch(`${base}/api/openapi.json`);
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toBe("Bearer");
    expect(
      (
        await fetch(`${base}/api/openapi.json`, {
          headers: { authorization: "Bearer incorrect" },
        })
      ).status,
    ).toBe(401);
    const limited = await fetch(`${base}/api/openapi.json`);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(
      (
        await fetch(`${base}/api/openapi.json`, {
          headers: { authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(200);
  });
  it("returns the real rejection after consuming a large streamed upload", async () => {
    const token = "large-body-rejection-token-0123456789";
    const { base } = await fixture({ apiToken: token });
    const response = await fetch(`${base}/api/uploads?filename=large.dem`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: Buffer.alloc(2 * 1024 * 1024, 7),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "authentication required",
    });
  });
  it("rate-limits mutation bursts without blocking health checks", async () => {
    const { base } = await fixture({
      mutationRateLimit: { requests: 2, windowMs: 60_000 },
    });
    for (let index = 0; index < 2; index += 1)
      expect(
        (
          await fetch(`${base}/api/jobs`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          })
        ).status,
      ).toBe(400);
    const limited = await fetch(`${base}/api/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(limited.headers.get("x-ratelimit-remaining")).toBe("0");
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });
  it("isolates mutation quotas by authenticated proxy identity", async () => {
    const token = "identity-quota-token-with-at-least-32-bytes";
    const { base } = await fixture({
      apiToken: token,
      mutationRateLimit: { requests: 1, windowMs: 60_000 },
    });
    const mutate = (user: string) =>
      fetch(`${base}/api/jobs`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-witchwatch-user": user,
        },
        body: "{}",
      });
    expect((await mutate("reviewer-a")).status).toBe(400);
    expect((await mutate("reviewer-a")).status).toBe(429);
    expect((await mutate("reviewer-b")).status).toBe(400);
  });
  it("serves only a matching, versioned local map geometry artifact", async () => {
    const { base, geometry } = await fixture();
    expect((await fetch(`${base}/api/maps/c2m1_highway/geometry`)).status).toBe(
      404,
    );
    await writeFile(
      join(geometry, "c2m1_highway.json"),
      JSON.stringify(geometryArtifact("c2m1_highway")),
    );
    const response = await fetch(`${base}/api/maps/c2m1_highway/geometry`);
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toMatch(/^"sha256:[a-f0-9]{64}"$/);
    expect(response.headers.get("x-source-bsp-sha256")).toBe("a".repeat(64));
    expect(await response.json()).toMatchObject({
      format: "witchwatch-map-mesh-v1",
    });
    await writeFile(
      join(geometry, "c2m2_fairgrounds.json"),
      JSON.stringify({
        ...geometryArtifact("c2m2_fairgrounds", "b".repeat(64)),
        indices: [0, 1, 3],
      }),
    );
    expect(
      (await fetch(`${base}/api/maps/c2m2_fairgrounds/geometry`)).status,
    ).toBe(416);
    expect((await fetch(`${base}/api/maps/bad-map/geometry`)).status).toBe(416);
  });
  it("falls back to committed geometry after the writable local cache", async () => {
    const fallback = await mkdtemp(join(tmpdir(), "witchwatch-geometry-"));
    cleanups.push(() => rm(fallback, { recursive: true, force: true }));
    await writeFile(
      join(fallback, "c5m1_waterfront.json"),
      JSON.stringify(geometryArtifact("c5m1_waterfront")),
    );
    const { base } = await fixture({
      geometryRoots: [join(fallback, "empty-local-cache"), fallback],
    });
    const response = await fetch(`${base}/api/maps/c5m1_waterfront/geometry`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      provenance: { map: "c5m1_waterfront" },
    });
  });
  it("serves the committed Parish geometry with its extraction lineage", async () => {
    const committedGeometry = fileURLToPath(
      new URL("../../../map-geometry", import.meta.url),
    );
    const { base } = await fixture({
      geometryRoots: [committedGeometry],
    });
    const response = await fetch(`${base}/api/maps/c5m1_waterfront/geometry`);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-source-bsp-sha256")).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(await response.json()).toMatchObject({
      format: "witchwatch-map-mesh-v1",
      provenance: {
        map: "c5m1_waterfront",
        sourceKind: "steam-dedicated-server",
        steamAppId: 222860,
        steamBuildId: "23990100",
        extractor: "@witchwatch/map-source1@0.1.0",
      },
    });
  });
  it("rejects incomplete or self-contradictory geometry provenance", async () => {
    const { base, geometry } = await fixture();
    const cases = [
      {
        map: "c1m1_hotel",
        artifact: { ...geometryArtifact("c1m1_hotel"), triangleZ: undefined },
      },
      {
        map: "c1m2_streets",
        artifact: {
          ...geometryArtifact("c1m2_streets"),
          bounds: {
            min: { x: 0, y: 0, z: 0 },
            max: { x: 99, y: 1, z: 0 },
          },
        },
      },
      {
        map: "c1m3_mall",
        artifact: {
          ...geometryArtifact("c1m3_mall"),
          provenance: {
            ...geometryArtifact("c1m3_mall").provenance,
            steamAppId: 550,
          },
        },
      },
      {
        map: "c1m4_atrium",
        artifact: {
          ...geometryArtifact("c1m4_atrium"),
          coverage: {
            ...geometryArtifact("c1m4_atrium").coverage,
            emittedTriangles: 2,
          },
        },
      },
    ];
    for (const value of cases) {
      await writeFile(
        join(geometry, `${value.map}.json`),
        JSON.stringify(value.artifact),
      );
      expect(
        (await fetch(`${base}/api/maps/${value.map}/geometry`)).status,
      ).toBe(416);
    }
  });
  it("does not serve stale geometry outside the active extraction catalog", async () => {
    const { base, geometry } = await fixture();
    const artifact = geometryArtifact("c2m1_highway");
    await writeFile(
      join(geometry, "c2m1_highway.json"),
      JSON.stringify(artifact),
    );
    const catalog = {
      format: "witchwatch-map-catalog-v1",
      sourceKind: "steam-dedicated-server",
      steamAppId: 222860,
      steamBuildId: "12345678",
      extractor: "@witchwatch/map-source1@0.0.0",
      maps: [],
    };
    await writeFile(join(geometry, "catalog.json"), JSON.stringify(catalog));
    expect((await fetch(`${base}/api/maps/c2m1_highway/geometry`)).status).toBe(
      404,
    );

    await writeFile(
      join(geometry, "catalog.json"),
      JSON.stringify({
        ...catalog,
        maps: [
          {
            map: "c2m1_highway",
            sourceBspSha256: "b".repeat(64),
            sourceBytes: artifact.provenance.sourceBytes,
            bspVersion: artifact.bspVersion,
            mapRevision: artifact.mapRevision,
            emittedTriangles: artifact.coverage.emittedTriangles,
            contentRoot: artifact.provenance.contentRoot,
          },
        ],
      }),
    );
    expect((await fetch(`${base}/api/maps/c2m1_highway/geometry`)).status).toBe(
      416,
    );
  });
  it("accepts raw demo uploads and enqueues their content-addressed local job", async () => {
    const { base } = await fixture();
    const response = await fetch(`${base}/api/uploads?filename=match.dem`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: "HL2DEMO-upload-fixture",
    });
    expect(response.status).toBe(202);
    const payload = (await response.json()) as {
      job: {
        id: string;
        source: { kind: string; path: string; sha256: string };
      };
      upload: { filename: string; bytes: number; sha256: string };
    };
    expect(payload.upload).toMatchObject({ filename: "match.dem", bytes: 22 });
    expect(payload.upload.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.job.source).toMatchObject({
      kind: "local",
      sha256: payload.upload.sha256,
    });
    expect(payload.job.source.path).toMatch(/uploads\/.*\.dem$/);
  });

  it("rejects invalid and oversized browser uploads", async () => {
    const { base } = await fixture();
    expect(
      (
        await fetch(`${base}/api/uploads?filename=match.txt`, {
          method: "POST",
          body: "not a demo",
        })
      ).status,
    ).toBe(416);
    expect(
      (
        await fetch(`${base}/api/uploads?filename=match.dem`, {
          method: "POST",
          body: "x".repeat(1025),
        })
      ).status,
    ).toBe(416);
  });
  it("serves a provenance-valid one-off local BSP artifact without a catalog", async () => {
    const { base, geometry } = await fixture();
    const official = geometryArtifact("custom_campaign_map");
    const {
      steamAppId: _app,
      steamBuildId: _build,
      contentRoot: _root,
      ...rest
    } = official.provenance;
    await writeFile(
      join(geometry, "custom_campaign_map.json"),
      JSON.stringify({
        ...official,
        provenance: { ...rest, sourceKind: "local-bsp" },
      }),
    );
    const response = await fetch(
      `${base}/api/maps/custom_campaign_map/geometry`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-source-bsp-sha256")).toBe("a".repeat(64));
  });
  it("ingests metadata idempotently and supports cancel/retry", async () => {
    const { base, demo } = await fixture();
    const request = {
      source: { kind: "local", path: demo },
      idempotencyKey: "upload-1",
    };
    const first = await fetch(`${base}/api/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    expect(first.status).toBe(202);
    const job = (await first.json()) as {
      id: string;
      source: { sha256: string };
    };
    expect(job.source.sha256).toMatch(/^[a-f0-9]{64}$/);
    const duplicate = (await fetch(`${base}/api/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    }).then((r) => r.json())) as { id: string };
    expect(duplicate.id).toBe(job.id);
    const reanalysis = (await fetch(`${base}/api/jobs/${job.id}/reanalyze`, {
      method: "POST",
    }).then((response) => response.json())) as { id: string };
    expect(reanalysis.id).not.toBe(job.id);
    expect(
      (await fetch(`${base}/api/jobs/${job.id}/cancel`, { method: "POST" }))
        .status,
    ).toBe(200);
    expect(
      (await fetch(`${base}/api/jobs/${job.id}/retry`, { method: "POST" }))
        .status,
    ).toBe(200);
  });
  it("rejects malformed, non-allowlisted, and oversized range requests", async () => {
    const { base } = await fixture();
    expect(
      (
        await fetch(`${base}/api/jobs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{",
        })
      ).status,
    ).toBe(400);
    const denied = await fetch(`${base}/api/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: { kind: "remote", url: "https://example.com/demo.zip" },
        idempotencyKey: "x",
      }),
    });
    expect(denied.status).toBe(400);
    expect(
      (await fetch(`${base}/api/cases/case-1/telemetry?start=0&end=3001`))
        .status,
    ).toBe(416);
  });
  it("returns only bounded windows and deterministic verifiable reports", async () => {
    const { base } = await fixture();
    const window = (await fetch(
      `${base}/api/cases/case-1/telemetry?start=100&end=180`,
    ).then((r) => r.json())) as {
      chunks: { startTick: number; endTick: number }[];
    };
    expect(window.chunks).toHaveLength(1);
    expect(window.chunks[0]).toMatchObject({ startTick: 100, endTick: 180 });
    const first = (await fetch(`${base}/api/cases/case-1/report`).then((r) =>
      r.json(),
    )) as { sha256: string; canonicalJson: string };
    const second = (await fetch(`${base}/api/cases/case-1/report`).then((r) =>
      r.json(),
    )) as typeof first;
    const detail = (await fetch(`${base}/api/cases/case-1`).then((r) =>
      r.json(),
    )) as { presentation: unknown };
    const reportManifest = JSON.parse(first.canonicalJson) as {
      presentation: unknown;
    };
    expect(reportManifest.presentation).toEqual(detail.presentation);
    expect(second).toEqual(first);
    expect(sha256(first.canonicalJson)).toBe(first.sha256);
    expect(first.canonicalJson).not.toContain("telemetry");
    expect(first.canonicalJson).toContain("engineResultSha256");
    expect(first.canonicalJson).toContain("observations/v1");
    const events = await fetch(`${base}/api/jobs/not-found/events`);
    expect(events.status).toBe(404);
  });
  it("clips a one-tick query and keeps SSE open until terminal state", async () => {
    const { base, repo } = await fixture();
    repo.putWindow("case-1", 1_000, 1_600, {
      poses: Array.from({ length: 600 }, (_, offset) => ({
        tick: 1_000 + offset,
        x: offset,
      })),
    });
    const response = await fetch(
      `${base}/api/cases/case-1/telemetry?start=1234&end=1235`,
    );
    const text = await response.text();
    expect(text).toContain('"tick":1234');
    expect(text).not.toContain('"tick":1233');
    expect(text).not.toContain('"tick":1235');
    expect(text.length).toBeLessThan(500);

    const job = repo.enqueue(
      { kind: "remote", url: "https://cedapug.com/demos/a.zip" },
      "sse-job",
    );
    const streamPromise = fetch(`${base}/api/jobs/${job.id}/events`).then((r) =>
      r.text(),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    repo.cancel(job.id);
    const stream = await streamPromise;
    expect(stream.match(/event: progress/g)).toHaveLength(2);
    expect(stream).toContain('"state":"queued"');
    expect(stream).toContain('"state":"cancelled"');
  });
  it("persists review status and notes as auditable local decisions", async () => {
    const { base } = await fixture();
    const status = await fetch(`${base}/api/cases/case-1/review-status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "needs-context" }),
    });
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ status: "needs-context" });
    const note = await fetch(`${base}/api/cases/case-1/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "Check the audio cue", tick: 120 }),
    });
    expect(note.status).toBe(201);
    const notes = (await fetch(`${base}/api/cases/case-1/notes`).then((value) =>
      value.json(),
    )) as { items: unknown[] };
    expect(notes.items).toHaveLength(1);
    const report = (await fetch(`${base}/api/cases/case-1/report`).then(
      (value) => value.json(),
    )) as { canonicalJson: string };
    expect(report.canonicalJson).toContain("case.status-changed");
    expect(report.canonicalJson).toContain("note.created");
  });
  it("serves the versioned OpenAPI contract", async () => {
    const { base } = await fixture();
    const document = (await fetch(`${base}/api/openapi.json`).then((value) =>
      value.json(),
    )) as { openapi: string; paths: Record<string, unknown> };
    expect(document.openapi).toBe("3.1.0");
    expect(document.paths).toHaveProperty("/api/cases/{caseId}/telemetry");
    expect(document.paths).toHaveProperty("/api/jobs");
    expect(document.paths).toHaveProperty("/api/games/{gameId}");
    expect(document.paths).toHaveProperty("/api/uploads");
  });
  it("enforces server-side case pagination", async () => {
    const { base, repo } = await fixture();
    repo.upsertCase({
      id: "case-2",
      playerKey: "another-redacted-player",
      status: "unreviewed",
      score: { status: "insufficient-data" },
    });
    const page = (await fetch(`${base}/api/cases?limit=1&offset=0`).then(
      (response) => response.json(),
    )) as { items: unknown[] };
    expect(page.items).toHaveLength(1);
    expect((await fetch(`${base}/api/cases?limit=101`)).status).toBe(416);
    expect((await fetch(`${base}/api/cases?limit=1&offset=-1`)).status).toBe(
      416,
    );
  });
});
