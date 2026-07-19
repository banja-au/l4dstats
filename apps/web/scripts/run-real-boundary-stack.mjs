import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
const root = process.env.L4DSTATS_E2E_ROOT;
if (!root) throw new Error("L4DSTATS_E2E_ROOT is required");
process.once("exit", () => rmSync(root, { recursive: true, force: true }));
const database = `${root}/workbench.sqlite`;
const artifacts = `${root}/artifacts`;
const localGeometryRoot = [
  process.env.L4DSTATS_GEOMETRY_ROOT,
  "/tmp/l4d2-geometry-all",
  "/tmp/l4d2-geometry",
].find((candidate) => candidate && existsSync(`${candidate}/catalog.json`));

const common = {
  ...process.env,
  L4DSTATS_DB: database,
  L4DSTATS_ARTIFACT_ROOT: artifacts,
  L4DSTATS_WORKER_HEARTBEAT: `${root}/worker-heartbeat.json`,
  L4DSTATS_LOCAL_ROOTS: "/workspace/data",
  L4DSTATS_PSEUDONYM_KEY: "playwright-stable-integration-key",
  ...(localGeometryRoot ? { L4DSTATS_GEOMETRY_ROOT: localGeometryRoot } : {}),
};
const children = [];
children.push(
  spawn("./apps/api/node_modules/.bin/tsx", ["apps/api/src/main.ts"], {
    cwd: "/workspace",
    env: { ...common, L4DSTATS_SEED_EXAMPLE: "false" },
    stdio: "inherit",
  }),
);
let apiReady = false;
for (let attempt = 0; attempt < 100; attempt += 1) {
  try {
    if ((await fetch("http://127.0.0.1:8787/health")).ok) {
      apiReady = true;
      break;
    }
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
if (!apiReady) throw new Error("real-boundary API did not become ready");
children.push(
  spawn("./apps/worker/node_modules/.bin/tsx", ["apps/worker/src/main.ts"], {
    cwd: "/workspace",
    env: common,
    stdio: "inherit",
  }),
);

let stopping = false;
function stop() {
  stopping = true;
  for (const child of children) if (child.pid) child.kill("SIGTERM");
}
process.once("exit", stop);
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
process.once("SIGHUP", stop);
await new Promise((resolve, reject) => {
  for (const child of children)
    child.once("exit", (code) => {
      if (stopping || code === 0) {
        resolve();
        return;
      }
      stop();
      reject(new Error(`real boundary process exited ${code}`));
    });
});
