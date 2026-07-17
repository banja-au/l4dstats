import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
const root = process.env.WITCHWATCH_E2E_ROOT;
if (!root) throw new Error("WITCHWATCH_E2E_ROOT is required");
process.once("exit", () => rmSync(root, { recursive: true, force: true }));
const database = `${root}/workbench.sqlite`;
const artifacts = `${root}/artifacts`;

const common = {
  ...process.env,
  WITCHWATCH_DB: database,
  WITCHWATCH_ARTIFACT_ROOT: artifacts,
  WITCHWATCH_LOCAL_ROOTS: "/workspace/data",
  WITCHWATCH_PSEUDONYM_KEY: "playwright-stable-integration-key",
};
const children = [];
children.push(
  spawn("./apps/api/node_modules/.bin/tsx", ["apps/api/src/main.ts"], {
    cwd: "/workspace",
    env: { ...common, WITCHWATCH_SEED_EXAMPLE: "false" },
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
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
process.once("SIGHUP", stop);
await new Promise((resolve, reject) => {
  for (const child of children)
    child.once("exit", (code) =>
      stopping || code === 0
        ? resolve()
        : reject(new Error(`real boundary process exited ${code}`)),
    );
});
