import { WorkbenchRepository } from "@witchwatch/storage";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createApi } from "./server.js";
import { seedControlledWorkbench } from "./seed.js";
const port = Number(process.env.PORT ?? 8787),
  databasePath = process.env.WITCHWATCH_DB ?? "data/workbench.sqlite";
const apiToken = process.env.WITCHWATCH_API_TOKEN;
if (apiToken && Buffer.byteLength(apiToken, "utf8") < 32)
  throw new Error("WITCHWATCH_API_TOKEN must contain at least 32 bytes");
mkdirSync(dirname(databasePath), { recursive: true });
const repo = new WorkbenchRepository(databasePath);
repo.recoverStaleRunning(
  Number(process.env.WITCHWATCH_STALE_JOB_MS ?? 5 * 60 * 1000),
  { maxAttempts: Number(process.env.WITCHWATCH_MAX_JOB_ATTEMPTS ?? 3) },
);
if (process.env.WITCHWATCH_SEED_EXAMPLE === "true")
  seedControlledWorkbench(repo);
createApi(
  repo,
  {
    allowedHosts: (process.env.WITCHWATCH_ALLOWED_HOSTS ?? "cedapug.com").split(
      ",",
    ),
    allowedLocalRoots: (
      process.env.WITCHWATCH_LOCAL_ROOTS ?? "/data/inbox"
    ).split(","),
    maxLocalBytes: 2 * 1024 * 1024 * 1024,
  },
  {
    uploadRoot: process.env.WITCHWATCH_UPLOAD_ROOT ?? "data/uploads",
    geometryRoot: process.env.WITCHWATCH_GEOMETRY_ROOT ?? "data/geometry",
    mutationRateLimit: {
      requests: Number(process.env.WITCHWATCH_MUTATION_RATE_LIMIT ?? 120),
      windowMs: Number(
        process.env.WITCHWATCH_MUTATION_RATE_WINDOW_MS ?? 60_000,
      ),
    },
    authFailureRateLimit: {
      requests: Number(process.env.WITCHWATCH_AUTH_FAILURE_LIMIT ?? 20),
      windowMs: Number(
        process.env.WITCHWATCH_AUTH_FAILURE_WINDOW_MS ?? 5 * 60_000,
      ),
    },
    ...(apiToken ? { apiToken } : {}),
    workerHeartbeatPath:
      process.env.WITCHWATCH_WORKER_HEARTBEAT ??
      "/var/lib/witchwatch/worker-heartbeat.json",
  },
).listen(port, "0.0.0.0", () =>
  process.stdout.write(`L4DStats API on ${port}\n`),
);
