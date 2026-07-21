import assert from "node:assert/strict";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseArguments,
  runBenchmark,
  scoreQuality,
  summarize,
} from "./benchmark.mjs";

const root = mkdtempSync(join(tmpdir(), "demo-benchmark-"));
const demoA = join(root, "private-a.dem");
const demoB = join(root, "private-b.dem");
writeFileSync(demoA, "a");
writeFileSync(demoB, "bb");
const release = join(root, "target/release");
mkdirSync(release, { recursive: true });
const fake = resolve(
  fileURLToPath(new URL("fixtures/fake-parser.mjs", import.meta.url)),
);
const rust = join(release, "fake-parser.mjs");
cpSync(fake, rust);
chmodSync(rust, 0o755);
const command = JSON.stringify([process.execPath, fake, "{demo}"]);
const nativeCommand = JSON.stringify([rust, "{demo}"]);
const result = await runBenchmark({
  demos: [demoA, demoB],
  mode: "stage",
  warmups: 1,
  repetitions: 3,
  timeoutMilliseconds: 5_000,
  outputCapBytes: 1_024,
  nativeCommand,
  nativeArtifact: rust,
  nativeVersion: "0.2.0",
  nativeBuildSha256: "a".repeat(64),
  thresholds: {},
});
assert.equal(result.fixtures.length, 2);
assert.equal(JSON.stringify(result).includes("private-a"), false);
assert.equal(result.schemaVersion, 3);
assert.equal(result.results.corpusWallMilliseconds.min > 0, true);
assert.equal(Object.keys(result.results.perDemoWallMilliseconds).length, 2);
assert.equal(result.results.throughputBytesPerSecond.median > 0, true);
assert.equal(result.thresholds.passed, true);
assert.equal(result.qualityScore.average, null);
assert.deepEqual(
  scoreQuality(
    {
      corpusWallMilliseconds: { median: 80 },
      maxRssKiB: { median: 100 },
      throughputBytesPerSecond: { median: 125 },
    },
    {
      maxMedianWallMilliseconds: 100,
      maxMedianRssKiB: 100,
      minMedianThroughputBytesPerSecond: 100,
    },
    4.6,
  ),
  {
    methodology: "release-threshold-headroom/v1",
    interpretation:
      "4.0 meets a configured threshold; 5.0 is at least 25% better",
    dimensions: [
      { name: "median-wall-time", observed: 80, threshold: 100, score: 5 },
      { name: "median-rss", observed: 100, threshold: 100, score: 4 },
      { name: "median-throughput", observed: 125, threshold: 100, score: 5 },
    ],
    average: 4.667,
    minimumRequired: 4.6,
    passed: true,
  },
);
assert.deepEqual(summarize([1, 2, 3, 4]), {
  min: 1,
  max: 4,
  mean: 2.5,
  median: 2.5,
  p95: 4,
});
assert.throws(
  () =>
    parseArguments([], {
      L4DSTATS_BENCH_DEMOS: "not-json",
    }),
  SyntaxError,
);
await assert.rejects(
  runBenchmark({
    demos: [demoA],
    mode: "stage",
    warmups: 0,
    repetitions: 1,
    timeoutMilliseconds: 5_000,
    outputCapBytes: 1,
    nativeCommand,
    nativeArtifact: rust,
    thresholds: {},
  }),
  /output cap/,
);
await assert.rejects(
  runBenchmark({
    demos: [demoA],
    mode: "stage",
    warmups: 0,
    repetitions: 1,
    timeoutMilliseconds: 5_000,
    outputCapBytes: 1_024,
    nativeCommand: command,
    nativeArtifact: fake,
    thresholds: {},
  }),
  /target\/release/,
);
process.env.FAKE_BENCH_DELAY_MS = "100";
await assert.rejects(
  runBenchmark({
    demos: [demoA],
    mode: "stage",
    warmups: 0,
    repetitions: 1,
    timeoutMilliseconds: 10,
    outputCapBytes: 1_024,
    nativeCommand,
    nativeArtifact: rust,
    thresholds: {},
  }),
  /timeout/,
);
delete process.env.FAKE_BENCH_DELAY_MS;

const addon = join(root, "demo-source1-node.node");
writeFileSync(addon, "native-addon-placeholder");
const endToEnd = await runBenchmark({
  demos: [demoA],
  mode: "end-to-end",
  warmups: 0,
  repetitions: 1,
  timeoutMilliseconds: 5_000,
  outputCapBytes: 1_024,
  nativeCommand: command,
  nativeArtifact: addon,
  thresholds: {},
});
assert.equal(endToEnd.command.executable, basename(process.execPath));
assert.equal(endToEnd.command.artifact.kind, "node-addon");
assert.equal(endToEnd.command.artifact.file, basename(addon));
assert.equal(
  endToEnd.command.artifact.bytes,
  Buffer.byteLength("native-addon-placeholder"),
);
assert.match(endToEnd.command.artifact.sha256, /^[a-f0-9]{64}$/);

await assert.rejects(
  runBenchmark({
    demos: [demoA],
    mode: "stage",
    warmups: 0,
    repetitions: 1,
    timeoutMilliseconds: 5_000,
    outputCapBytes: 1_024,
    nativeCommand,
    nativeArtifact: rust,
    thresholds: { maxMedianWallMilliseconds: 0.0001 },
  }),
  /native benchmark regression/,
);
await assert.rejects(
  runBenchmark({
    demos: [demoA],
    mode: "stage",
    warmups: 0,
    repetitions: 1,
    timeoutMilliseconds: 5_000,
    outputCapBytes: 1_024,
    nativeCommand,
    nativeArtifact: rust,
    thresholds: {},
    minQualityScore: 4.9,
  }),
  /quality score unavailable\/5 is below required 4\.9\/5/,
);
process.stdout.write("demo benchmark tests: ok\n");
