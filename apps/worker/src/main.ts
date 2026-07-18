import { WorkbenchRepository } from "@witchwatch/storage";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { LocalWorker } from "./worker.js";
import { createEngineJobHandler } from "./engine.js";
import { startWorkerHeartbeat } from "./heartbeat.js";
const databasePath = process.env.WITCHWATCH_DB ?? "data/workbench.sqlite";
mkdirSync(dirname(databasePath), { recursive: true });
const repo = new WorkbenchRepository(databasePath);
const heartbeat = startWorkerHeartbeat(
  process.env.WITCHWATCH_WORKER_HEARTBEAT ??
    "/var/lib/witchwatch/worker-heartbeat.json",
);
const worker = new LocalWorker(
  repo,
  createEngineJobHandler(repo, {
    artifactRoot: process.env.WITCHWATCH_ARTIFACT_ROOT ?? "/var/lib/witchwatch",
    allowedHosts: (process.env.WITCHWATCH_ALLOWED_HOSTS ?? "cedapug.com").split(
      ",",
    ),
    pseudonymKey:
      process.env.WITCHWATCH_PSEUDONYM_KEY ??
      "witchwatch-dev-only-local-key-v1",
  }),
);
const timer = setInterval(() => void worker.runOnce(), 500);
process.once("SIGTERM", () => {
  clearInterval(timer);
  heartbeat.stop();
  repo.close();
});
