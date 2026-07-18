import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_OUTPUT_CAP = 16 * 1024 * 1024;

export async function runBenchmark(options) {
  validateOptions(options);
  const fixtures = options.demos.map((path, index) => {
    try {
      const bytes = readFileSync(path);
      return {
        path: resolve(path),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.byteLength,
      };
    } catch {
      throw new Error(`failed to read explicit demo at index ${index}`);
    }
  });
  const command = parseCommand(options.nativeCommand, "Native");
  const artifact = requireNativeArtifact(options.mode, options.nativeArtifact);
  const commandProvenance = {
    executable: basename(command[0]),
    executableSha256: hashFile(resolveExecutable(command[0])),
    templateSha256: sha256(JSON.stringify(command)),
    declaredVersion: options.nativeVersion ?? null,
    declaredBuildSha256: options.nativeBuildSha256 ?? null,
    artifact,
  };
  const measurements = [];
  for (let warmup = 0; warmup < options.warmups; warmup += 1)
    await runCorpusOnce(fixtures, command, options, false);
  for (let repetition = 0; repetition < options.repetitions; repetition += 1)
    measurements.push(await runCorpusOnce(fixtures, command, options, true));
  const results = summarizeMeasurements(measurements, fixtures);
  const thresholds = evaluateThresholds(results, options.thresholds);
  if (!thresholds.passed)
    throw new Error(
      `native benchmark regression: ${thresholds.failures.join("; ")}`,
    );
  const result = {
    schemaVersion: 2,
    mode: options.mode,
    generatedAt: new Date().toISOString(),
    config: {
      warmups: options.warmups,
      repetitions: options.repetitions,
      timeoutMilliseconds: options.timeoutMilliseconds,
      outputCapBytes: options.outputCapBytes,
      sequential: true,
    },
    environment: environmentProvenance(),
    command: commandProvenance,
    fixtures: fixtures.map(({ sha256, bytes }) => ({ sha256, bytes })),
    results,
    thresholds,
  };
  return result;
}

async function runCorpusOnce(fixtures, template, options, retain) {
  const started = process.hrtime.bigint();
  const demos = [];
  let cpuUserSeconds = 0;
  let cpuSystemSeconds = 0;
  let maxRssKiB = null;
  for (const fixture of fixtures) {
    const command = substitute(template, fixture.path);
    const measured = await runBounded(command, options);
    if (retain)
      demos.push({
        demoSha256: fixture.sha256,
        wallMilliseconds: measured.wallMilliseconds,
        cpuUserSeconds: measured.cpuUserSeconds,
        cpuSystemSeconds: measured.cpuSystemSeconds,
        maxRssKiB: measured.maxRssKiB,
        outputSha256: measured.outputSha256,
      });
    cpuUserSeconds += measured.cpuUserSeconds ?? 0;
    cpuSystemSeconds += measured.cpuSystemSeconds ?? 0;
    if (measured.maxRssKiB !== null)
      maxRssKiB = Math.max(maxRssKiB ?? 0, measured.maxRssKiB);
  }
  return {
    wallMilliseconds: Number(process.hrtime.bigint() - started) / 1e6,
    cpuUserSeconds: maxRssKiB === null ? null : cpuUserSeconds,
    cpuSystemSeconds: maxRssKiB === null ? null : cpuSystemSeconds,
    maxRssKiB,
    demos,
  };
}

async function runBounded(command, options) {
  const useGnuTime = existsSync("/usr/bin/time");
  const timeRoot = useGnuTime
    ? mkdtempSync(resolve(tmpdir(), "demo-bench-"))
    : null;
  const timePath = timeRoot ? resolve(timeRoot, "usage.txt") : null;
  const executable = useGnuTime ? "/usr/bin/time" : command[0];
  const args = useGnuTime
    ? ["-f", "%U\n%S\n%M", "-o", timePath, "--", ...command]
    : command.slice(1);
  const started = process.hrtime.bigint();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    const outputHash = createHash("sha256");
    let outputBytes = 0;
    const capture = (chunk) => {
      outputBytes += chunk.byteLength;
      outputHash.update(chunk);
      if (outputBytes > options.outputCapBytes) child.kill("SIGKILL");
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    const timer = setTimeout(
      () => child.kill("SIGKILL"),
      options.timeoutMilliseconds,
    );
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      const wallMilliseconds = Number(process.hrtime.bigint() - started) / 1e6;
      const usage =
        timePath && existsSync(timePath) ? parseGnuTime(timePath) : null;
      if (timeRoot) rmSync(timeRoot, { recursive: true });
      if (outputBytes > options.outputCapBytes)
        reject(new Error("benchmark child exceeded output cap"));
      else if (
        signal === "SIGKILL" &&
        wallMilliseconds >= options.timeoutMilliseconds
      )
        reject(new Error("benchmark child exceeded timeout"));
      else if (code !== 0)
        reject(
          new Error(
            `benchmark child failed code=${code ?? "null"} signal=${signal ?? "none"}`,
          ),
        );
      else {
        resolvePromise({
          wallMilliseconds,
          cpuUserSeconds: usage?.cpuUserSeconds ?? null,
          cpuSystemSeconds: usage?.cpuSystemSeconds ?? null,
          maxRssKiB: usage?.maxRssKiB ?? null,
          outputSha256: outputHash.digest("hex"),
        });
      }
    });
  });
}

function parseGnuTime(path) {
  const [user, system, rss] = readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map(Number);
  if (![user, system, rss].every(Number.isFinite)) return null;
  return { cpuUserSeconds: user, cpuSystemSeconds: system, maxRssKiB: rss };
}

export function summarize(values) {
  if (values.length === 0) throw new Error("cannot summarize no values");
  const sorted = [...values].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    min: sorted[0],
    max: sorted.at(-1),
    mean: total / sorted.length,
    median:
      sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2,
    p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)],
  };
}

function summarizeMeasurements(measurements, fixtures) {
  const corpusBytes = fixtures.reduce((sum, fixture) => sum + fixture.bytes, 0);
  const result = {
    corpusWallMilliseconds: summarize(
      measurements.map((value) => value.wallMilliseconds),
    ),
    perDemoWallMilliseconds: {},
    cpuUserSeconds: optionalSummary(
      measurements.map((value) => value.cpuUserSeconds),
    ),
    cpuSystemSeconds: optionalSummary(
      measurements.map((value) => value.cpuSystemSeconds),
    ),
    maxRssKiB: optionalSummary(measurements.map((value) => value.maxRssKiB)),
    throughputBytesPerSecond: summarize(
      measurements.map(
        (value) => corpusBytes / (value.wallMilliseconds / 1_000),
      ),
    ),
  };
  for (const demo of measurements[0].demos)
    result.perDemoWallMilliseconds[demo.demoSha256] = summarize(
      measurements.map(
        (measurement) =>
          measurement.demos.find(
            (candidate) => candidate.demoSha256 === demo.demoSha256,
          ).wallMilliseconds,
      ),
    );
  return result;
}

function optionalSummary(values) {
  return values.some((value) => value === null) ? null : summarize(values);
}

function evaluateThresholds(results, thresholds = {}) {
  const failures = [];
  if (
    thresholds.maxMedianWallMilliseconds !== undefined &&
    results.corpusWallMilliseconds.median > thresholds.maxMedianWallMilliseconds
  )
    failures.push("median wall time exceeded threshold");
  if (
    thresholds.maxMedianRssKiB !== undefined &&
    (results.maxRssKiB === null ||
      results.maxRssKiB.median > thresholds.maxMedianRssKiB)
  )
    failures.push("median RSS exceeded threshold or was unavailable");
  if (
    thresholds.minMedianThroughputBytesPerSecond !== undefined &&
    results.throughputBytesPerSecond.median <
      thresholds.minMedianThroughputBytesPerSecond
  )
    failures.push("median throughput fell below threshold");
  return { configured: thresholds, passed: failures.length === 0, failures };
}

function validateOptions(options) {
  if (!Array.isArray(options.demos) || options.demos.length === 0)
    throw new Error("at least one explicit --demo is required");
  if (!Number.isSafeInteger(options.warmups) || options.warmups < 0)
    throw new Error("warmups must be a nonnegative integer");
  if (!Number.isSafeInteger(options.repetitions) || options.repetitions < 1)
    throw new Error("repetitions must be a positive integer");
  if (!["stage", "end-to-end"].includes(options.mode))
    throw new Error("invalid mode");
  if (
    !Number.isSafeInteger(options.timeoutMilliseconds) ||
    options.timeoutMilliseconds < 1
  )
    throw new Error("timeoutMilliseconds must be a positive integer");
  if (
    !Number.isSafeInteger(options.outputCapBytes) ||
    options.outputCapBytes < 1
  )
    throw new Error("outputCapBytes must be a positive integer");
  for (const [name, value] of Object.entries(options.thresholds ?? {}))
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
      throw new Error(`${name} must be a positive finite number`);
  if (
    options.nativeBuildSha256 !== undefined &&
    !/^[a-f0-9]{64}$/.test(options.nativeBuildSha256)
  )
    throw new Error("nativeBuildSha256 must be 64 lowercase hex characters");
}

function parseCommand(encoded, label) {
  let command;
  try {
    command = JSON.parse(encoded);
  } catch {
    throw new Error(`${label} command must be a JSON argv array`);
  }
  if (
    !Array.isArray(command) ||
    command.length === 0 ||
    command.some((value) => typeof value !== "string" || value.length === 0)
  )
    throw new Error(`${label} command must be a non-empty JSON string array`);
  if (!command.some((value) => value.includes("{demo}")))
    throw new Error(`${label} command must include {demo}`);
  return command;
}

function substitute(command, demoPath) {
  return command.map((value) => value.replaceAll("{demo}", demoPath));
}

function requireNativeArtifact(mode, path) {
  if (typeof path !== "string" || path.length === 0)
    throw new Error("WITCHWATCH_NATIVE_BENCH_ARTIFACT is required");
  const absolute = resolve(path);
  let metadata;
  try {
    metadata = statSync(absolute);
  } catch {
    throw new Error("Native benchmark artifact could not be read");
  }
  if (!metadata.isFile())
    throw new Error("Native benchmark artifact must be a regular file");

  let kind;
  if (mode === "stage") {
    const components = absolute.split(/[\\/]/);
    const releaseIndex = components.lastIndexOf("release");
    if (releaseIndex < 1 || components[releaseIndex - 1] !== "target")
      throw new Error("Native stage artifact must be beneath target/release");
    if ((metadata.mode & 0o111) === 0)
      throw new Error("Native stage artifact must be executable");
    kind = "release-executable";
  } else {
    if (!absolute.endsWith(".node"))
      throw new Error("Native end-to-end artifact must be a .node addon");
    kind = "node-addon";
  }

  return {
    file: basename(absolute),
    bytes: metadata.size,
    sha256: hashFile(absolute),
    kind,
  };
}

function resolveExecutable(path) {
  if (path.includes("/") || path.includes("\\")) return resolve(path);
  const result = spawnSync("which", [path], {
    encoding: "utf8",
    timeout: 5_000,
  });
  return result.status === 0 ? result.stdout.trim() : resolve(path);
}

function hashFile(path) {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function environmentProvenance() {
  return {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    cpuModel: process.report?.getReport().header.cpus?.[0]?.model ?? null,
    logicalCpuCount: process.report?.getReport().header.cpus?.length ?? null,
    rustc: versionOf("rustc"),
    cargo: versionOf("cargo"),
    gnuTime: existsSync("/usr/bin/time"),
  };
}

function versionOf(command) {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function parseArguments(argv, env = process.env) {
  const demos = [];
  let mode = "stage";
  let warmups = 1;
  let repetitions = 5;
  let timeoutMilliseconds = DEFAULT_TIMEOUT_MS;
  let outputCapBytes = DEFAULT_OUTPUT_CAP;
  const thresholds = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--demo") demos.push(argv[++index]);
    else if (value === "--mode") mode = argv[++index];
    else if (value === "--warmups") warmups = Number(argv[++index]);
    else if (value === "--repetitions") repetitions = Number(argv[++index]);
    else if (value === "--timeout-ms")
      timeoutMilliseconds = Number(argv[++index]);
    else if (value === "--output-cap-bytes")
      outputCapBytes = Number(argv[++index]);
    else if (value === "--max-median-wall-ms")
      thresholds.maxMedianWallMilliseconds = Number(argv[++index]);
    else if (value === "--max-median-rss-kib")
      thresholds.maxMedianRssKiB = Number(argv[++index]);
    else if (value === "--min-median-throughput-bps")
      thresholds.minMedianThroughputBytesPerSecond = Number(argv[++index]);
    else throw new Error(`unknown argument ${value}`);
  }
  if (demos.length === 0 && env.WITCHWATCH_BENCH_DEMOS)
    demos.push(...JSON.parse(env.WITCHWATCH_BENCH_DEMOS));
  return {
    demos,
    mode,
    warmups,
    repetitions,
    timeoutMilliseconds,
    outputCapBytes,
    nativeCommand: env.WITCHWATCH_NATIVE_BENCH_COMMAND,
    nativeArtifact: env.WITCHWATCH_NATIVE_BENCH_ARTIFACT,
    nativeVersion: env.WITCHWATCH_NATIVE_BENCH_VERSION,
    nativeBuildSha256: env.WITCHWATCH_NATIVE_BENCH_BUILD_SHA256,
    thresholds,
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  runBenchmark(parseArguments(process.argv.slice(2)))
    .then((result) =>
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
    )
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : error}\n`,
      );
      process.exitCode = 1;
    });
}
