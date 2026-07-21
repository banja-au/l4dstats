import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const binding = require(resolve(root, "dist/demo-source1-node.node"));
const metadata = binding.bindingMetadata();
assert.deepEqual(metadata, {
  bindingApiVersion: 2,
  framingSummaryVersion: 1,
  projectConfigVersion: 2,
  compactArtifactWireVersion: 3,
  parserConfigId: "source1-l4d2-2100-v2",
  buildSha256: metadata.buildSha256,
  bindingCrateVersion: "0.2.0",
  coreCrateVersion: "0.2.0",
  nodeApiVersion: 8,
});
assert.match(metadata.buildSha256, /^[a-fA-F0-9]{64}$/);
await assert.rejects(
  binding.decodeFramingSummary(Buffer.alloc(0)),
  /TRUNCATED@0/,
);
assert.throws(() => binding.decodeFramingSummary("not bytes"), /Buffer/i);
assert.throws(
  () =>
    binding.projectDemo(Buffer.alloc(0), Buffer.alloc(16), Buffer.from("{}")),
  /PROJECT_ERROR:.*binding-config/,
);
assert.throws(
  () => binding.projectDemo(Buffer.alloc(0), Buffer.alloc(15), config()),
  /between 16 and 64 bytes/,
);
assert.throws(
  () =>
    binding.projectDemo(
      Buffer.alloc(2),
      Buffer.alloc(16),
      config({ maxInputBytes: 1 }),
    ),
  /input exceeds configured byte limit/,
);
await assert.rejects(
  binding.projectDemo(Buffer.from("HL2DEMO"), Buffer.alloc(16), config()),
  /PROJECT_ERROR:.*"code":"DECODE_FAILED".*"stage":"framing".*"offset":0/,
);
assert.throws(
  () => binding.projectDemo("not bytes", Buffer.alloc(16), config()),
  /Buffer/i,
);
process.stdout.write("demo-source1-node load tests: ok\n");
