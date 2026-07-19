#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BackfillState } from "./state.js";
import { L4D2CenterSource } from "./l4d2center.js";
import { HostedPublisher } from "./publisher.js";
import { runBackfill } from "./orchestrator.js";

interface Options {
  concurrency: number;
  maxDemos: number;
  state: string;
  objects: string;
}

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function workspacePath(value: string): string {
  return resolve(REPOSITORY_ROOT, value);
}

function positiveInteger(flag: string, value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

export function parseArguments(args: string[]): Options {
  const options: Options = {
    concurrency: 2,
    maxDemos: 20,
    state: process.env.L4DSTATS_BACKFILL_DB ?? "data/backfill/state.sqlite",
    objects:
      process.env.L4DSTATS_BACKFILL_OBJECT_ROOT ?? "data/backfill/objects",
  };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--concurrency")
      options.concurrency = positiveInteger(flag, args[++index]);
    else if (flag === "--max-demos")
      options.maxDemos = positiveInteger(flag, args[++index]);
    else if (flag === "--state") options.state = args[++index] ?? "";
    else if (flag === "--objects") options.objects = args[++index] ?? "";
    else if (flag === "--help") {
      process.stdout.write(
        `Usage: pnpm backfill [options]\n\n  --concurrency N  Parallel downloads/parsers (default 2)\n  --max-demos N    Maximum source demos attempted (default 20)\n  --state PATH     Local checkpoint SQLite path\n  --objects PATH   Local content-addressed object root\n`,
      );
      process.exit(0);
    } else throw new Error(`unknown argument: ${flag}`);
  }
  if (!options.state || !options.objects)
    throw new Error("state and objects paths are required");
  return options;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const started = Date.now();
  const log = (message: string) =>
    process.stdout.write(`[${new Date().toISOString()}] ${message}\n`);
  const pseudonymKey = process.env.L4DSTATS_PSEUDONYM_KEY;
  if (!pseudonymKey) throw new Error("L4DSTATS_PSEUDONYM_KEY is required");
  const state = new BackfillState(workspacePath(options.state));
  log(
    `backfill starting: concurrency=${options.concurrency}, maxDemos=${options.maxDemos}, state=${workspacePath(options.state)}, objects=${workspacePath(options.objects)}`,
  );
  const publisher = new HostedPublisher(process.env, log);
  try {
    const summary = await runBackfill({
      state,
      source: new L4D2CenterSource(globalThis.fetch, log),
      publisher,
      objectRoot: workspacePath(options.objects),
      pseudonymKey,
      concurrency: options.concurrency,
      maxDemos: options.maxDemos,
      log,
    });
    log(
      `backfill finished in ${((Date.now() - started) / 1_000).toFixed(1)}s: ${JSON.stringify(summary)}`,
    );
    if (summary.failed > 0) process.exitCode = 1;
  } finally {
    publisher.close();
    state.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href
)
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
