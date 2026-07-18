import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ContentAddressedStore,
  WorkbenchRepository,
  sha256,
} from "@witchwatch/storage";
import { createApi } from "@witchwatch/api";
import {
  createEngineJobHandler,
  engineCommand,
  type EngineAnalysisResult,
} from "./engine.js";
import { LocalWorker } from "./worker.js";

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function associationResult(
  demo: { sha256: string; bytes: number },
  input: {
    caseId: string;
    demoId: string;
    tick: number;
    stableToken?: string;
  },
): EngineAnalysisResult {
  const evidenceId = `evidence-${input.demoId}`;
  return {
    schemaVersion: 1,
    demo: { ...demo, mapName: "controlled_grid" },
    cases: [
      {
        id: input.caseId,
        playerKey: input.stableToken ?? `epoch-${input.demoId}`,
        status: "unreviewed",
        score: { status: "ranked-evidence", researchOnly: true },
        evidence: [{ id: evidenceId, tick: input.tick }],
        windows: [
          {
            startTick: input.tick,
            endTick: input.tick + 1,
            payload: { poses: [{ tick: input.tick }] },
          },
        ],
        versions: {
          parser: "controlled-parser@1",
          schema: "observations/v1",
          detectors: ["controlled-detector@1"],
          model: "controlled-model@1",
        },
        config: { id: "association-integration-v1" },
        map: { name: "controlled_grid", assetVersion: "controlled-v1" },
        derivation: ["independent controlled ingest"],
        limitations: ["Invented fixture"],
        presentation: {
          schemaVersion: 1,
          id: input.caseId,
          alias: "Controlled player",
          identityLabel: input.stableToken
            ? "Privacy-stable player token"
            : "Demo-local player epoch",
          provenance: { controlledFixture: true, label: "Invented fixture" },
          demos: [
            {
              id: input.demoId,
              sha256: demo.sha256,
              mapName: "controlled_grid",
              sourceLabel: "controlled",
              quality: { value: 1, basis: ["controlled"] },
              corroboration: input.stableToken
                ? "same-stable-player"
                : "unassociated",
            },
          ],
          evidence: [
            {
              id: evidenceId,
              family: "aim",
              title: "Controlled evidence",
              tick: input.tick,
              tickRange: { start: input.tick, end: input.tick + 1 },
              quality: { value: 1, basis: ["controlled"] },
              contribution: null,
              explanation: "Controlled only",
              counterevidence: ["Invented input"],
              limitations: ["Invented fixture"],
              demoSha256: demo.sha256,
              window: {
                startTick: input.tick,
                endTick: input.tick + 1,
                contextSeconds: 1,
              },
            },
          ],
          association: input.stableToken
            ? {
                kind: "stable-privacy-token",
                stableToken: input.stableToken,
                corroboratingDemoCount: 0,
                explanation: "Keyed-HMAC fixture token",
              }
            : {
                kind: "demo-local-epoch",
                corroboratingDemoCount: 0,
                explanation: "Stable identity unavailable",
              },
          summary: { encounterCount: 1, independentSignalFamilies: ["aim"] },
        },
      },
    ],
  };
}

describe("LocalWorker", () => {
  it("does not overlap parser jobs when timer ticks re-enter runOnce", async () => {
    const repo = new WorkbenchRepository();
    const first = repo.enqueue(
      {
        kind: "local",
        path: "/tmp/first.dem",
        sha256: "a".repeat(64),
        bytes: 1,
      },
      "first",
    );
    const second = repo.enqueue(
      {
        kind: "local",
        path: "/tmp/second.dem",
        sha256: "b".repeat(64),
        bytes: 1,
      },
      "second",
    );
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: (jobId: string) => void;
    const handlerEntered = new Promise<string>((resolve) => {
      entered = resolve;
    });
    const worker = new LocalWorker(repo, async (job) => {
      entered(job.id);
      await blocked;
    });
    const active = worker.runOnce();
    const activeJobId = await handlerEntered;
    const queuedJobId = activeJobId === first.id ? second.id : first.id;
    expect(await worker.runOnce()).toBe(false);
    expect(repo.getJob(activeJobId)?.state).toBe("running");
    expect(repo.getJob(queuedJobId)?.state).toBe("queued");
    release();
    expect(await active).toBe(true);
    expect(repo.getJob(activeJobId)?.state).toBe("succeeded");
    await worker.runOnce();
    expect(repo.getJob(queuedJobId)?.state).toBe("succeeded");
    repo.close();
  });

  it("constructs a shell-free CLI invocation", () => {
    expect(engineCommand("/data/inbox/a.dem", false)).toEqual({
      command: process.execPath,
      args: [
        "--max-old-space-size=4096",
        "--import",
        createRequire(import.meta.url).resolve("tsx"),
        "apps/cli/src/main.ts",
        "evidence-bundle",
        "/data/inbox/a.dem",
      ],
    });
    expect(engineCommand("/data/inbox/a.dem", true).args).toEqual([
      `--as=${5 * 1024 * 1024 * 1024}`,
      "--cpu=300",
      "--nofile=64:64",
      "--core=0:0",
      "--",
      "/workspace/apps/worker/dist/parser-no-network",
      process.execPath,
      "--max-old-space-size=4096",
      "--permission",
      "--allow-fs-read=/workspace",
      "--allow-fs-read=/data/inbox/a.dem",
      "apps/cli/dist/main.js",
      "evidence-bundle",
      "/data/inbox/a.dem",
    ]);
  });

  it.runIf(process.platform === "linux")(
    "denies parser network and filesystem writes",
    () => {
      const sandbox = resolve("dist/parser-no-network");
      expect(existsSync(sandbox)).toBe(true);
      const network = spawnSync(
        sandbox,
        [
          process.execPath,
          "--input-type=module",
          "-e",
          "try{await fetch('https://example.com');process.exit(2)}catch{process.stdout.write('blocked')}",
        ],
        { cwd: resolve("apps/worker"), encoding: "utf8" },
      );
      expect(network.status).toBe(0);
      expect(network.stdout).toBe("blocked");
      const filesystem = spawnSync(
        sandbox,
        [
          process.execPath,
          "--permission",
          "--input-type=module",
          "-e",
          "try{(await import('node:fs')).writeFileSync('/tmp/parser-escape','x');process.exit(2)}catch(e){process.stdout.write(e.code)}",
        ],
        { cwd: resolve("apps/worker"), encoding: "utf8" },
      );
      expect(filesystem.status).toBe(0);
      expect(filesystem.stdout).toBe("ERR_ACCESS_DENIED");
      expect(existsSync("/tmp/parser-escape")).toBe(false);
    },
  );

  it("persists a controlled production-shaped analysis with complete lineage", async () => {
    const root = await mkdtemp(join(tmpdir(), "witchwatch-worker-"));
    cleanup.push(root);
    const sourcePath = join(root, "controlled.dem"),
      bytes = Buffer.from("HL2DEMO-controlled-worker-fixture");
    await writeFile(sourcePath, bytes);
    const repo = new WorkbenchRepository();
    const job = repo.enqueue(
      {
        kind: "local",
        path: sourcePath,
        sha256: sha256(bytes),
        bytes: bytes.byteLength,
      },
      "controlled-local-analysis",
    );
    const controlledResult: EngineAnalysisResult = {
      schemaVersion: 1,
      demo: {
        sha256: sha256(bytes),
        bytes: bytes.byteLength,
        mapName: "controlled_grid",
      },
      cases: [
        {
          id: "controlled-case",
          playerKey: "controlled-player-epoch",
          status: "unreviewed",
          score: {
            status: "ranked-evidence",
            researchOnly: true,
            strongestCounterevidence: ["Controlled benign explanation"],
          },
          evidence: [{ id: "controlled-evidence", tick: 120 }],
          windows: [
            {
              startTick: 100,
              endTick: 200,
              payload: { bounded: true, poses: [{ tick: 120 }] },
            },
          ],
          versions: {
            parser: "controlled-parser@1",
            schema: "observations/v1",
            detectors: ["controlled-detector@1"],
            model: "controlled-ranked-evidence@1",
          },
          config: { id: "controlled-config-v1" },
          map: { name: "controlled_grid", assetVersion: "controlled-v1" },
          derivation: ["controlled demo", "controlled evidence"],
          limitations: ["Invented fixture; no real player or demo"],
          presentation: {
            schemaVersion: 1,
            id: "controlled-case",
            alias: "Controlled player",
            identityLabel: "Controlled demo-local epoch",
            provenance: {
              controlledFixture: true,
              label: "Invented test fixture",
            },
            demos: [
              {
                id: "controlled-demo",
                sha256: sha256(bytes),
                mapName: "controlled_grid",
                sourceLabel: "controlled fixture",
                quality: { value: 1, basis: ["controlled"] },
                corroboration: "unassociated",
              },
            ],
            evidence: [
              {
                id: "controlled-evidence",
                family: "aim",
                title: "Controlled evidence",
                tick: 120,
                tickRange: { start: 119, end: 121 },
                quality: { value: 1, basis: ["controlled"] },
                contribution: null,
                explanation: "Controlled only",
                counterevidence: ["Controlled benign explanation"],
                limitations: ["Invented fixture"],
                demoSha256: sha256(bytes),
                window: { startTick: 100, endTick: 200, contextSeconds: 8 },
              },
            ],
            association: {
              kind: "demo-local-epoch",
              corroboratingDemoCount: 0,
              explanation: "No stable token in controlled test",
            },
            summary: { encounterCount: 1, independentSignalFamilies: ["aim"] },
          },
        },
      ],
    };
    const handler = createEngineJobHandler(repo, {
      artifactRoot: root,
      allowedHosts: ["cedapug.com"],
      analyze: async () => controlledResult,
    });
    expect(await new LocalWorker(repo, handler).runOnce()).toBe(true);
    expect(repo.getJob(job.id)?.state).toBe("succeeded");
    expect(repo.getCase("controlled-case")).toBeDefined();
    expect(repo.getWindow("controlled-case", 110, 130)).toHaveLength(1);
    const controlledLineage = repo.getCaseLineage("controlled-case") as {
      sources: unknown[];
    };
    expect(controlledLineage.sources).toHaveLength(1);
    expect(controlledLineage.sources[0]).toMatchObject({
      artifacts: { demoSha256: sha256(bytes) },
      versions: { parser: "controlled-parser@1" },
      map: { assetVersion: "controlled-v1" },
    });
    const persistedAnalysis = repo.getJobAnalysis(job.id) as {
      engineResultSha256: string;
    };
    expect(persistedAnalysis).toMatchObject({
      demoSha256: sha256(bytes),
    });
    await expect(
      new ContentAddressedStore(root).read(sha256(bytes)),
    ).resolves.toEqual(bytes);
    expect(
      await new ContentAddressedStore(root).read(
        persistedAnalysis.engineResultSha256,
      ),
    ).not.toHaveLength(0);
    const api = createApi(repo, {
      allowedHosts: ["cedapug.com"],
      allowedLocalRoots: [root],
      maxLocalBytes: 1024,
    });
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    const address = api.address();
    if (!address || typeof address === "string")
      throw new Error("fixture API did not bind");
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/cases/controlled-case/report`,
    );
    expect(response.status).toBe(200);
    const report = (await response.json()) as {
      sha256: string;
      canonicalJson: string;
    };
    expect(sha256(report.canonicalJson)).toBe(report.sha256);
    await new Promise<void>((resolve) => api.close(() => resolve()));
    repo.close();
  });

  it("streams remote acquisition through persistence and API retrieval", async () => {
    const root = await mkdtemp(join(tmpdir(), "witchwatch-remote-worker-"));
    cleanup.push(root);
    const remoteBytes = Buffer.from("HL2DEMO-controlled-remote-fixture");
    const origin = createServer((_request, response) => {
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": remoteBytes.byteLength,
      });
      response.end(remoteBytes);
    });
    await new Promise<void>((resolve) =>
      origin.listen(0, "127.0.0.1", resolve),
    );
    const originAddress = origin.address();
    if (!originAddress || typeof originAddress === "string")
      throw new Error("fixture origin did not bind");
    const repo = new WorkbenchRepository();
    const job = repo.enqueue(
      {
        kind: "remote",
        url: "https://cedapug.com/controlled.dem?token=secret#fragment",
      },
      "controlled-remote-analysis",
    );
    let analyzedHash = "";
    const handler = createEngineJobHandler(repo, {
      artifactRoot: root,
      allowedHosts: ["cedapug.com"],
      remoteFetch: async (_input, init) =>
        fetch(`http://127.0.0.1:${originAddress.port}/controlled.dem`, init),
      analyze: async (demo) => {
        analyzedHash = demo.sha256;
        return {
          schemaVersion: 1,
          demo: {
            sha256: demo.sha256,
            bytes: demo.bytes,
            mapName: "controlled_grid",
          },
          cases: [
            {
              id: "controlled-remote-case",
              playerKey: "controlled-remote-player",
              status: "unreviewed",
              score: {
                status: "insufficient-data",
                researchOnly: true,
                strongestCounterevidence: ["Controlled network fixture"],
              },
              evidence: [{ id: "remote-evidence", tick: 42 }],
              windows: [
                {
                  startTick: 40,
                  endTick: 45,
                  payload: { poses: [{ tick: 42, x: 1, y: 2 }] },
                },
              ],
              versions: {
                parser: "controlled-parser@1",
                schema: "observations/v1",
                detectors: ["controlled-detector@1"],
                model: "controlled-ranked-evidence@1",
              },
              config: { id: "controlled-remote-v1" },
              map: {
                name: "controlled_grid",
                assetVersion: "controlled-v1",
              },
              derivation: ["ephemeral HTTP fixture", "actual bounded acquire"],
              limitations: ["Invented fixture; no real player or demo"],
              presentation: {
                schemaVersion: 1,
                id: "controlled-remote-case",
                alias: "Controlled remote player",
                identityLabel: "Controlled demo-local epoch",
                provenance: {
                  controlledFixture: true,
                  label: "Invented network fixture",
                },
                demos: [
                  {
                    id: "controlled-remote-demo",
                    sha256: demo.sha256,
                    mapName: "controlled_grid",
                    sourceLabel: "ephemeral origin",
                    quality: { value: 1, basis: ["controlled"] },
                    corroboration: "unassociated",
                  },
                ],
                evidence: [
                  {
                    id: "remote-evidence",
                    family: "aim",
                    title: "Controlled remote evidence",
                    tick: 42,
                    tickRange: { start: 41, end: 43 },
                    quality: { value: 1, basis: ["controlled"] },
                    contribution: null,
                    explanation: "Controlled only",
                    counterevidence: ["Controlled network fixture"],
                    limitations: ["Invented fixture"],
                    demoSha256: demo.sha256,
                    window: {
                      startTick: 40,
                      endTick: 45,
                      contextSeconds: 5,
                    },
                  },
                ],
                association: {
                  kind: "demo-local-epoch",
                  corroboratingDemoCount: 0,
                  explanation: "No stable token in controlled test",
                },
                summary: {
                  encounterCount: 1,
                  independentSignalFamilies: ["aim"],
                },
              },
            },
          ],
        };
      },
    });
    await new LocalWorker(repo, handler).runOnce();
    expect(repo.getJob(job.id)?.state).toBe("succeeded");
    expect(analyzedHash).toBe(sha256(remoteBytes));
    expect(repo.getJobAnalysis(job.id)).toMatchObject({
      sourceManifest: {
        kind: "remote",
        sourceUrl: "https://cedapug.com/controlled.dem",
      },
    });
    const api = createApi(repo, {
      allowedHosts: ["cedapug.com"],
      allowedLocalRoots: [root],
      maxLocalBytes: 1024,
    });
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    const apiAddress = api.address();
    if (!apiAddress || typeof apiAddress === "string")
      throw new Error("fixture API did not bind");
    const base = `http://127.0.0.1:${apiAddress.port}`;
    const persistedCase = await fetch(
      `${base}/api/cases/controlled-remote-case`,
    );
    expect(persistedCase.status).toBe(200);
    expect(await persistedCase.json()).toMatchObject({
      id: "controlled-remote-case",
      status: "unreviewed",
    });
    expect(
      await fetch(
        `${base}/api/cases/controlled-remote-case/telemetry?start=42&end=43`,
      ).then((response) => response.json()),
    ).toMatchObject({ chunks: [{ startTick: 42, endTick: 43 }] });
    const report = (await fetch(
      `${base}/api/cases/controlled-remote-case/report`,
    ).then((response) => response.json())) as {
      sha256: string;
      canonicalJson: string;
    };
    expect(sha256(report.canonicalJson)).toBe(report.sha256);
    await new Promise<void>((resolve) => api.close(() => resolve()));
    await new Promise<void>((resolve) => origin.close(() => resolve()));
    repo.close();
  });

  it("merges only matching privacy-stable tokens across independent ingests", async () => {
    const root = await mkdtemp(join(tmpdir(), "witchwatch-association-"));
    cleanup.push(root);
    const repo = new WorkbenchRepository();
    const stableToken = "hmac-sha256:controlled-player-token";
    const ingests = [
      { caseId: "case-stable", demoId: "stable-a", token: stableToken },
      { caseId: "case-stable", demoId: "stable-b", token: stableToken },
      {
        caseId: "case-token-c",
        demoId: "token-c",
        token: "hmac-sha256:player-c",
      },
      {
        caseId: "case-token-d",
        demoId: "token-d",
        token: "hmac-sha256:player-d",
      },
      { caseId: "case-local-e", demoId: "local-e" },
      { caseId: "case-local-f", demoId: "local-f" },
    ];
    for (const [index, ingest] of ingests.entries()) {
      const bytes = Buffer.from(`HL2DEMO-${ingest.demoId}`),
        path = join(root, `${ingest.demoId}.dem`),
        digest = sha256(bytes);
      await writeFile(path, bytes);
      repo.enqueue(
        { kind: "local", path, sha256: digest, bytes: bytes.byteLength },
        `association-${ingest.demoId}`,
      );
      const handler = createEngineJobHandler(repo, {
        artifactRoot: root,
        allowedHosts: ["cedapug.com"],
        analyze: async (demo) =>
          associationResult(demo, {
            caseId: ingest.caseId,
            demoId: ingest.demoId,
            tick: 100 + index,
            ...(ingest.token ? { stableToken: ingest.token } : {}),
          }),
      });
      await new LocalWorker(repo, handler).runOnce();
    }

    const collisionBytes = Buffer.from("HL2DEMO-token-collision"),
      collisionPath = join(root, "collision.dem"),
      collisionHash = sha256(collisionBytes);
    await writeFile(collisionPath, collisionBytes);
    const collisionJob = repo.enqueue(
      {
        kind: "local",
        path: collisionPath,
        sha256: collisionHash,
        bytes: collisionBytes.byteLength,
      },
      "association-token-collision",
    );
    await new LocalWorker(
      repo,
      createEngineJobHandler(repo, {
        artifactRoot: root,
        allowedHosts: ["cedapug.com"],
        analyze: async (demo) =>
          associationResult(demo, {
            caseId: "case-stable",
            demoId: "collision",
            tick: 999,
            stableToken: "hmac-sha256:different-player",
          }),
      }),
    ).runOnce();
    expect(repo.getJob(collisionJob.id)).toMatchObject({
      state: "failed",
      message: "case collision without a matching privacy-stable token",
    });

    expect(repo.listCases(100)).toHaveLength(5);
    const merged = repo.getCasePresentation("case-stable");
    expect(merged).toMatchObject({
      association: {
        kind: "stable-privacy-token",
        stableToken,
        corroboratingDemoCount: 1,
      },
      summary: { encounterCount: 2 },
    });
    expect(merged.demos.map(({ id }) => id)).toEqual(["stable-a", "stable-b"]);
    expect(merged.evidence.map(({ id }) => id)).toEqual([
      "evidence-stable-a",
      "evidence-stable-b",
    ]);
    expect(
      (repo.getCaseLineage("case-stable") as { sources: unknown[] }).sources,
    ).toHaveLength(2);
    for (const id of [
      "case-token-c",
      "case-token-d",
      "case-local-e",
      "case-local-f",
    ])
      expect(repo.getCasePresentation(id).demos).toHaveLength(1);

    const api = createApi(repo, {
      allowedHosts: ["cedapug.com"],
      allowedLocalRoots: [root],
      maxLocalBytes: 1024,
    });
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    const address = api.address();
    if (!address || typeof address === "string")
      throw new Error("fixture API did not bind");
    const base = `http://127.0.0.1:${address.port}`;
    const caseResponse = (await fetch(`${base}/api/cases/case-stable`).then(
      (response) => response.json(),
    )) as { presentation: unknown };
    expect(caseResponse.presentation).toEqual(merged);
    const report = (await fetch(`${base}/api/cases/case-stable/report`).then(
      (response) => response.json(),
    )) as {
      sha256: string;
      canonicalJson: string;
      manifest: { presentation: unknown };
    };
    expect(report.manifest.presentation).toEqual(caseResponse.presentation);
    expect(sha256(report.canonicalJson)).toBe(report.sha256);
    await new Promise<void>((resolve) => api.close(() => resolve()));
    repo.close();
  });

  it("records failures for explicit retry", async () => {
    const repo = new WorkbenchRepository();
    const job = repo.enqueue(
      { kind: "remote", url: "https://cedapug.com/demo.dem" },
      "failure",
    );
    const worker = new LocalWorker(repo, async () => {
      throw new Error("decoder stopped");
    });
    await worker.runOnce();
    expect(repo.getJob(job.id)).toMatchObject({
      state: "failed",
      message: "decoder stopped",
      attempt: 1,
    });
    expect(repo.retry(job.id).state).toBe("queued");
    repo.close();
  });

  it("atomically corroborates independently ingested demos only by privacy-stable token", async () => {
    const root = await mkdtemp(join(tmpdir(), "witchwatch-association-"));
    cleanup.push(root);
    const repo = new WorkbenchRepository();
    const token = `hmac-sha256:${"a".repeat(64)}`;
    const files = await Promise.all(
      ["first", "second"].map(async (name) => {
        const path = join(root, `${name}.dem`),
          bytes = Buffer.from(`HL2DEMO-${name}-independent-fixture`);
        await writeFile(path, bytes);
        repo.enqueue(
          { kind: "local", path, sha256: sha256(bytes), bytes: bytes.length },
          `associate-${name}`,
        );
        return { path, bytes };
      }),
    );
    let sequence = 0;
    const handler = createEngineJobHandler(repo, {
      artifactRoot: root,
      allowedHosts: ["cedapug.com"],
      analyze: async (demo) => {
        const index = sequence++,
          tick = 100,
          caseId = `case-${sha256(token).slice(0, 24)}`;
        return {
          schemaVersion: 1,
          demo: {
            sha256: demo.sha256,
            bytes: demo.bytes,
            mapName: `grid-${index}`,
          },
          cases: [
            {
              id: caseId,
              playerKey: token,
              status: "unreviewed",
              score: {
                status: "ranked-evidence",
                researchOnly: true,
                numericPriorityWithheld: true,
              },
              evidence: [{ id: `evidence-${index}`, tick }],
              windows: [
                {
                  startTick: tick - 2,
                  endTick: tick + 3,
                  payload: { observations: [{ tick }] },
                },
              ],
              versions: {
                parser: "controlled@1",
                schema: "observations/v1",
                detectors: ["aim-dynamics@1.0.0"],
                model: "none-ranked-evidence",
              },
              config: { id: "controlled-association" },
              map: { name: `grid-${index}`, assetVersion: "unavailable" },
              derivation: [`demo ${demo.sha256}`, `evidence-${index}`],
              limitations: ["Controlled real-shaped association fixture"],
              presentation: {
                schemaVersion: 1,
                id: caseId,
                alias: "Privacy-stable controlled player",
                identityLabel: "Privacy-stable player token",
                provenance: {
                  controlledFixture: true,
                  label: "Independent controlled demo",
                },
                demos: [
                  {
                    id: `demo-${index}`,
                    sha256: demo.sha256,
                    mapName: `grid-${index}`,
                    sourceLabel: "controlled",
                    quality: { value: 0.8, basis: ["controlled"] },
                    corroboration: "same-stable-player",
                  },
                ],
                evidence: [
                  {
                    id: `evidence-${index}`,
                    family: "aim",
                    title: "Controlled aim evidence",
                    tick,
                    tickRange: { start: tick - 1, end: tick + 1 },
                    quality: { value: 0.8, basis: ["controlled"] },
                    contribution: null,
                    explanation: "Controlled evidence",
                    counterevidence: ["Controlled benign explanation"],
                    limitations: ["Controlled fixture"],
                    demoSha256: demo.sha256,
                    window: {
                      startTick: tick - 2,
                      endTick: tick + 3,
                      contextSeconds: 5,
                    },
                  },
                ],
                association: {
                  kind: "stable-privacy-token",
                  stableToken: token,
                  corroboratingDemoCount: 0,
                  explanation: "Keyed-HMAC controlled token",
                },
                summary: {
                  encounterCount: 1,
                  independentSignalFamilies: ["aim"],
                },
              },
            },
          ],
        };
      },
    });
    await new LocalWorker(repo, handler).runOnce();
    const caseId = `case-${sha256(token).slice(0, 24)}`;
    repo.updateCaseStatus(caseId, "needs-context");
    repo.addNote(caseId, "Preserve this reviewer note across ingestion", 100);
    await new LocalWorker(repo, handler).runOnce();
    expect(repo.getCase(caseId)?.status).toBe("needs-context");
    expect(repo.listNotes(caseId)).toHaveLength(1);
    const presentation = repo.getCasePresentation(caseId);
    expect(presentation).toMatchObject({
      association: { kind: "stable-privacy-token", corroboratingDemoCount: 1 },
      summary: { encounterCount: 2 },
    });
    expect(presentation.demos.map(({ sha256 }) => sha256).sort()).toEqual(
      files.map(({ bytes }) => sha256(bytes)).sort(),
    );
    expect(repo.getCaseLineage(caseId)).toMatchObject({ sources: [{}, {}] });
    expect(repo.getWindow(caseId, 98, 103)).toHaveLength(2);
    expect(
      repo.getWindow(caseId, 98, 103, 3_000, sha256(files[1]!.bytes)),
    ).toMatchObject([{ demoSha256: sha256(files[1]!.bytes) }]);
    const api = createApi(repo, {
      allowedHosts: ["cedapug.com"],
      allowedLocalRoots: [root],
      maxLocalBytes: 1024,
    });
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    const address = api.address();
    if (!address || typeof address === "string")
      throw new Error("association API did not bind");
    const base = `http://127.0.0.1:${address.port}`;
    const detail = (await fetch(`${base}/api/cases/${caseId}`).then((value) =>
      value.json(),
    )) as { presentation: unknown };
    expect(detail.presentation).toEqual(repo.getCasePresentation(caseId));
    const secondDemoTelemetry = await fetch(
      `${base}/api/cases/${caseId}/telemetry?start=98&end=103&demo=${sha256(files[1]!.bytes)}`,
    ).then((value) => value.json());
    expect(secondDemoTelemetry).toMatchObject({
      chunks: [{ demoSha256: sha256(files[1]!.bytes) }],
    });
    const report = (await fetch(`${base}/api/cases/${caseId}/report`).then(
      (value) => value.json(),
    )) as { canonicalJson: string };
    expect(
      (JSON.parse(report.canonicalJson) as { presentation: unknown })
        .presentation,
    ).toEqual(detail.presentation);
    await new Promise<void>((resolve) => api.close(() => resolve()));
    repo.close();
  });

  it("terminates an active engine subprocess when the reviewer cancels", async () => {
    const root = await mkdtemp(join(tmpdir(), "witchwatch-cancel-worker-"));
    cleanup.push(root);
    const sourcePath = join(root, "cancel.dem"),
      bytes = Buffer.from("HL2DEMO-controlled-cancellation-fixture");
    await writeFile(sourcePath, bytes);
    const repo = new WorkbenchRepository();
    const job = repo.enqueue(
      {
        kind: "local",
        path: sourcePath,
        sha256: sha256(bytes),
        bytes: bytes.byteLength,
      },
      "controlled-cancellation",
    );
    const handler = createEngineJobHandler(repo, {
      artifactRoot: root,
      allowedHosts: ["cedapug.com"],
      commandForDemo: () => ({
        command: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
      }),
    });
    const running = new LocalWorker(repo, handler).runOnce();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(repo.cancel(job.id).state).toBe("cancelled");
    await expect(running).resolves.toBe(true);
    expect(repo.getJob(job.id)?.state).toBe("cancelled");
    repo.close();
  });

  it("force-kills an engine that ignores the time-limit termination signal", async () => {
    const root = await mkdtemp(join(tmpdir(), "witchwatch-timeout-worker-"));
    cleanup.push(root);
    const sourcePath = join(root, "timeout.dem"),
      pidPath = join(root, "engine.pid"),
      bytes = Buffer.from("HL2DEMO-controlled-timeout-fixture");
    await writeFile(sourcePath, bytes);
    const repo = new WorkbenchRepository();
    const job = repo.enqueue(
      {
        kind: "local",
        path: sourcePath,
        sha256: sha256(bytes),
        bytes: bytes.byteLength,
      },
      "controlled-timeout",
    );
    const handler = createEngineJobHandler(repo, {
      artifactRoot: root,
      allowedHosts: ["cedapug.com"],
      commandForDemo: () => ({
        command: process.execPath,
        args: [
          "-e",
          `require("node:fs").writeFileSync(${JSON.stringify(pidPath)},String(process.pid));process.on("SIGTERM",()=>{});setInterval(()=>{},1000)`,
        ],
      }),
      processLimits: { timeoutMs: 100, terminationGraceMs: 50 },
    });
    await new LocalWorker(repo, handler).runOnce();
    expect(repo.getJob(job.id)).toMatchObject({
      state: "failed",
      message: "Engine exceeded the local job time limit",
    });
    const pid = Number(await readFile(pidPath, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
    repo.close();
  });

  it("kills an engine before an output flood can be retained", async () => {
    const root = await mkdtemp(join(tmpdir(), "witchwatch-output-worker-"));
    cleanup.push(root);
    const sourcePath = join(root, "output.dem"),
      bytes = Buffer.from("HL2DEMO-controlled-output-fixture");
    await writeFile(sourcePath, bytes);
    const repo = new WorkbenchRepository();
    const job = repo.enqueue(
      {
        kind: "local",
        path: sourcePath,
        sha256: sha256(bytes),
        bytes: bytes.byteLength,
      },
      "controlled-output-flood",
    );
    const handler = createEngineJobHandler(repo, {
      artifactRoot: root,
      allowedHosts: ["cedapug.com"],
      commandForDemo: () => ({
        command: process.execPath,
        args: [
          "-e",
          `process.stdout.write("x".repeat(8192));setInterval(()=>{},1000)`,
        ],
      }),
      processLimits: { maxOutputBytes: 1_024, terminationGraceMs: 50 },
    });
    await new LocalWorker(repo, handler).runOnce();
    expect(repo.getJob(job.id)).toMatchObject({
      state: "failed",
      message: "Engine output exceeded the configured limit",
    });
    repo.close();
  });

  it("does not expose service credentials to the parser process", async () => {
    const root = await mkdtemp(join(tmpdir(), "witchwatch-env-worker-"));
    cleanup.push(root);
    const sourcePath = join(root, "environment.dem"),
      bytes = Buffer.from("HL2DEMO-controlled-environment-fixture"),
      demoSha256 = sha256(bytes);
    await writeFile(sourcePath, bytes);
    const repo = new WorkbenchRepository();
    const job = repo.enqueue(
      {
        kind: "local",
        path: sourcePath,
        sha256: demoSha256,
        bytes: bytes.byteLength,
      },
      "controlled-environment",
    );
    const result: EngineAnalysisResult = {
      schemaVersion: 1,
      demo: {
        sha256: demoSha256,
        mapName: "controlled_environment",
        bytes: bytes.byteLength,
      },
      cases: [],
    };
    const priorToken = process.env.WITCHWATCH_API_TOKEN;
    const priorPassword = process.env.WITCHWATCH_WEB_PASSWORD;
    process.env.WITCHWATCH_API_TOKEN = "must-not-reach-parser";
    process.env.WITCHWATCH_WEB_PASSWORD = "must-not-reach-parser";
    try {
      const handler = createEngineJobHandler(repo, {
        artifactRoot: root,
        allowedHosts: ["cedapug.com"],
        commandForDemo: () => ({
          command: process.execPath,
          args: [
            "-e",
            `if(process.env.WITCHWATCH_API_TOKEN||process.env.WITCHWATCH_WEB_PASSWORD)process.exit(42);process.stdout.write(${JSON.stringify(JSON.stringify(result))})`,
          ],
        }),
      });
      await new LocalWorker(repo, handler).runOnce();
      expect(repo.getJob(job.id)?.state).toBe("succeeded");
    } finally {
      if (priorToken === undefined) delete process.env.WITCHWATCH_API_TOKEN;
      else process.env.WITCHWATCH_API_TOKEN = priorToken;
      if (priorPassword === undefined)
        delete process.env.WITCHWATCH_WEB_PASSWORD;
      else process.env.WITCHWATCH_WEB_PASSWORD = priorPassword;
      repo.close();
    }
  });
});

const corroboratingCorpusDemos = [
  resolve(
    "../../data/sprint-4-e2e-corpus/915419_c2m3_coaster/915419_c2m3_coaster.dem",
  ),
  resolve(
    "../../data/sprint-4-e2e-corpus/915419_c2m4_barns/915419_c2m4_barns.dem",
  ),
] as const;

describe.runIf(corroboratingCorpusDemos.every((path) => existsSync(path)))(
  "real-corpus worker integration",
  () => {
    it("merges a real positive default bundle with a same-player zero-evidence demo", async () => {
      const root = await mkdtemp(join(tmpdir(), "witchwatch-real-worker-"));
      cleanup.push(root);
      const repo = new WorkbenchRepository();
      const handler = createEngineJobHandler(repo, {
        artifactRoot: root,
        allowedHosts: ["cedapug.com"],
        pseudonymKey: "witchwatch-dev-only-local-key-v1",
      });
      const jobs = [];
      for (const [index, path] of corroboratingCorpusDemos.entries()) {
        const bytes = await readFile(path);
        jobs.push(
          repo.enqueue(
            { kind: "local", path, sha256: sha256(bytes), bytes: bytes.length },
            `real-correlated-${index}`,
          ),
        );
        await new LocalWorker(repo, handler).runOnce();
        const completed = repo.getJob(jobs.at(-1)!.id);
        expect(
          completed?.state,
          completed?.message ?? "job has no message",
        ).toBe("succeeded");
      }
      const results = jobs.map(
        (job) =>
          repo.getJobAnalysis(job.id) as { engineResult: EngineAnalysisResult },
      );
      const positive = results[0]!.engineResult.cases.find(
        (item) => item.evidence.length > 0,
      );
      expect(positive).toBeDefined();
      const corroborating = results[1]!.engineResult.cases.find(
        (item) => item.id === positive!.id,
      );
      expect(corroborating).toBeDefined();
      expect(corroborating!.evidence).toHaveLength(0);
      expect(corroborating!.windows).toHaveLength(0);
      expect(corroborating!.score).toMatchObject({
        status: "insufficient-data",
      });
      const merged = repo.getCasePresentation(positive!.id);
      expect(merged).toMatchObject({
        association: {
          kind: "stable-privacy-token",
          corroboratingDemoCount: 1,
        },
      });
      expect(merged.demos).toHaveLength(2);
      expect(merged.evidence).toHaveLength(positive!.evidence.length);
      expect(JSON.parse(repo.getCase(positive!.id)!.scoreJson)).toMatchObject({
        status: "ranked-evidence",
      });
      expect(
        (repo.getCaseLineage(positive!.id) as { sources: unknown[] }).sources,
      ).toHaveLength(2);
      const serializedLineage = JSON.stringify(
        repo.getCaseLineage(positive!.id),
      );
      expect(serializedLineage).not.toContain("/workspace/");
      expect(serializedLineage).not.toContain(
        "witchwatch-dev-only-local-key-v1",
      );
      for (const job of jobs)
        expect(serializedLineage).toContain(
          (repo.getJobAnalysis(job.id) as { demoSha256: string }).demoSha256,
        );
      const api = createApi(repo, {
        allowedHosts: ["cedapug.com"],
        allowedLocalRoots: [resolve("../../data/sprint-4-e2e-corpus")],
        maxLocalBytes: 2 ** 31,
      });
      await new Promise<void>((resolveListen) =>
        api.listen(0, "127.0.0.1", resolveListen),
      );
      const address = api.address();
      if (!address || typeof address === "string")
        throw new Error("real API did not bind");
      const detail = (await fetch(
        `http://127.0.0.1:${address.port}/api/cases/${positive!.id}`,
      ).then((value) => value.json())) as { presentation: unknown };
      expect(detail.presentation).toEqual(merged);
      const report = (await fetch(
        `http://127.0.0.1:${address.port}/api/cases/${positive!.id}/report`,
      ).then((value) => value.json())) as { canonicalJson: string };
      expect(
        (JSON.parse(report.canonicalJson) as { presentation: unknown })
          .presentation,
      ).toEqual(merged);
      await new Promise<void>((resolveClose) =>
        api.close(() => resolveClose()),
      );
      repo.close();
    }, 180_000);
  },
);
