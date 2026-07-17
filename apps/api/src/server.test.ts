import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sha256, WorkbenchRepository } from "@witchwatch/storage";
import { createApi } from "./server.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "witchwatch-api-")),
    inbox = join(root, "inbox");
  await mkdir(inbox);
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
    { ssePollIntervalMs: 5 },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  cleanups.push(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    repo.close();
    await rm(root, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${address.port}`, demo, repo };
}

describe("review API", () => {
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
