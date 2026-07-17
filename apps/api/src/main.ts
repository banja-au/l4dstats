import { WorkbenchRepository } from "@witchwatch/storage";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createApi } from "./server.js";
import { seedControlledWorkbench } from "./seed.js";
const port = Number(process.env.PORT ?? 8787),
  databasePath = process.env.WITCHWATCH_DB ?? "data/workbench.sqlite";
mkdirSync(dirname(databasePath), { recursive: true });
const repo = new WorkbenchRepository(databasePath);
repo.recoverStaleRunning(
  Number(process.env.WITCHWATCH_STALE_JOB_MS ?? 5 * 60 * 1000),
  { maxAttempts: Number(process.env.WITCHWATCH_MAX_JOB_ATTEMPTS ?? 3) },
);
if (process.env.WITCHWATCH_SEED_EXAMPLE === "true")
  seedControlledWorkbench(repo);
createApi(repo, {
  allowedHosts: (process.env.WITCHWATCH_ALLOWED_HOSTS ?? "cedapug.com").split(
    ",",
  ),
  allowedLocalRoots: (
    process.env.WITCHWATCH_LOCAL_ROOTS ?? "/data/inbox"
  ).split(","),
  maxLocalBytes: 2 * 1024 * 1024 * 1024,
}).listen(port, "0.0.0.0", () =>
  process.stdout.write(`WitchWatch API on ${port}\n`),
);
