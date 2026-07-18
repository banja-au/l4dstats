import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { engineCommand } from "../apps/worker/dist/engine.js";

if (process.platform !== "linux") {
  process.stdout.write("Parser seccomp integration is Linux-only; skipped.\n");
  process.exit(0);
}
const candidates = [
  "/workspace/tmp/fresh-counter-audit/916532_c8m1_apartment.dem",
  "/workspace/data/sprint-4-e2e-corpus/915419_c2m3_coaster/915419_c2m3_coaster.dem",
];
const demo = candidates.find(existsSync);
if (!demo) throw new Error("real parser-sandbox corpus demo is unavailable");
const invocation = engineCommand(demo, true);
const execute = promisify(execFile);
const { stdout } = await execute(invocation.command, invocation.args, {
  cwd: "/workspace",
  env: {
    HOME: process.env.HOME,
    LANG: process.env.LANG ?? "C.UTF-8",
    NODE_ENV: "production",
    NODE_OPTIONS: "--conditions=production",
    PATH: process.env.PATH,
    WITCHWATCH_PSEUDONYM_KEY: "parser-sandbox-integration-key",
  },
  maxBuffer: 16 * 1024 * 1024,
  timeout: 5 * 60_000,
});
const result = JSON.parse(stdout);
if (
  result.schemaVersion !== 1 ||
  result.demo?.stats?.competitive?.derivationVersion !== 6 ||
  !Array.isArray(result.demo?.stats?.players) ||
  result.demo.stats.players.length < 8 ||
  typeof result.demo.mapName !== "string"
)
  throw new Error("sandboxed real parser returned an invalid evidence bundle");
process.stdout.write(
  `Sandboxed real parser passed for ${result.demo.mapName}: ${result.demo.stats.players.length} epochs, derivation v6.\n`,
);
