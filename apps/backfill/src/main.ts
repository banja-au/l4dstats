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
  settleMinutes: number;
}

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function workspacePath(value: string): string {
  return resolve(REPOSITORY_ROOT, value);
}

export function publicBaseUrl(environment: NodeJS.ProcessEnv): string {
  const configured = environment.L4DSTATS_PUBLIC_BASE_URL;
  if (configured) return new URL(configured).origin;
  const hostname = environment.PRODUCTION_HOSTNAME;
  if (!hostname)
    throw new Error(
      "PRODUCTION_HOSTNAME or L4DSTATS_PUBLIC_BASE_URL is required",
    );
  return new URL(`https://${hostname}`).origin;
}

export function importedGameUrls(
  gameIds: readonly string[],
  environment: NodeJS.ProcessEnv,
): string[] {
  const baseUrl = publicBaseUrl(environment);
  return [...new Set(gameIds)]
    .sort()
    .map((gameId) => `${baseUrl}/game/${gameId}/overview`);
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
    settleMinutes: positiveInteger(
      "L4DSTATS_SETTLE_MINUTES",
      process.env.L4DSTATS_SETTLE_MINUTES ?? "60",
    ),
  };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--concurrency")
      options.concurrency = positiveInteger(flag, args[++index]);
    else if (flag === "--max-demos")
      options.maxDemos = positiveInteger(flag, args[++index]);
    else if (flag === "--state") options.state = args[++index] ?? "";
    else if (flag === "--objects") options.objects = args[++index] ?? "";
    else if (flag === "--settle-minutes")
      options.settleMinutes = positiveInteger(flag, args[++index]);
    else if (flag === "--help") {
      process.stdout.write(
        `Usage: pnpm backfill [options]\n\n  --concurrency N    Parallel source games (default 2)\n  --max-demos N      Target demo cap; source games are never split (default 20)\n  --settle-minutes N Source game quiet period before import (default 60)\n  --state PATH       Local checkpoint SQLite path\n  --objects PATH     Local content-addressed object root\n`,
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
  const shutdown = new AbortController();
  const stop = (signal: NodeJS.Signals) => {
    if (shutdown.signal.aborted) return;
    log(
      `${signal} received; cancelling active work and cleaning local demo bytes`,
    );
    shutdown.abort(new Error(signal));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const pseudonymKey = process.env.L4DSTATS_PSEUDONYM_KEY;
  if (!pseudonymKey) throw new Error("L4DSTATS_PSEUDONYM_KEY is required");
  const state = new BackfillState(workspacePath(options.state));
  log(
    `backfill starting: concurrency=${options.concurrency}, maxDemos=${options.maxDemos}, settleMinutes=${options.settleMinutes}, state=${workspacePath(options.state)}, objects=${workspacePath(options.objects)}`,
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
      settleMinutes: options.settleMinutes,
      log,
      signal: shutdown.signal,
    });
    log(
      `backfill finished in ${((Date.now() - started) / 1_000).toFixed(1)}s: ${JSON.stringify(summary)}`,
    );
    if (summary.gameIds.length > 0) {
      process.stdout.write("\nImported game URLs:\n");
      for (const url of importedGameUrls(summary.gameIds, process.env))
        process.stdout.write(`${url}\n`);
      process.stdout.write("\n");
    } else {
      log("no games were imported in this run");
    }
    if (summary.failed > 0) process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
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
