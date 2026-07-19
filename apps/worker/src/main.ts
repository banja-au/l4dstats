import { WorkbenchRepository } from "@l4dstats/storage";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { LocalWorker } from "./worker.js";
import { createEngineJobHandler } from "./engine.js";
import { startWorkerHeartbeat } from "./heartbeat.js";
const databasePath = process.env.L4DSTATS_DB ?? "data/workbench.sqlite";
mkdirSync(dirname(databasePath), { recursive: true });
const repo = new WorkbenchRepository(databasePath);
const heartbeat = startWorkerHeartbeat(
  process.env.L4DSTATS_WORKER_HEARTBEAT ??
    "/var/lib/l4dstats/worker-heartbeat.json",
);
const worker = new LocalWorker(
  repo,
  createEngineJobHandler(repo, {
    artifactRoot: process.env.L4DSTATS_ARTIFACT_ROOT ?? "/var/lib/l4dstats",
    allowedHosts: (process.env.L4DSTATS_ALLOWED_HOSTS ?? "cedapug.com").split(
      ",",
    ),
    pseudonymKey:
      process.env.L4DSTATS_PSEUDONYM_KEY ?? "l4dstats-dev-only-local-key-v1",
  }),
);
const timer = setInterval(() => void worker.runOnce(), 500);
process.once("SIGTERM", () => {
  clearInterval(timer);
  heartbeat.stop();
  repo.close();
});
