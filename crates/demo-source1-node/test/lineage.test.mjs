import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(root, "../..");
const compute = resolve(root, "scripts/compute-build-sha256.sh");
const first = spawnSync(compute, [repositoryRoot], { encoding: "utf8" });
const second = spawnSync(compute, [repositoryRoot], { encoding: "utf8" });
assert.equal(first.status, 0, first.stderr);
assert.equal(second.status, 0, second.stderr);
const computed = first.stdout.trim();
assert.match(computed, /^[a-f0-9]{64}$/);
assert.notEqual(computed, "0".repeat(64));
assert.equal(second.stdout.trim(), computed);

const require = createRequire(import.meta.url);
const binding = require(resolve(root, "dist/demo-source1-node.node"));
const embedded = binding.bindingMetadata().buildSha256;
assert.match(embedded, /^[a-fA-F0-9]{64}$/);
const expected = process.env.WITCHWATCH_EXPECT_NATIVE_BUILD_SHA256;
if (expected !== undefined) {
  assert.match(expected, /^[a-f0-9]{64}$/);
  assert.notEqual(expected, "0".repeat(64));
  assert.equal(embedded, expected);
}
process.stdout.write("demo-source1-node lineage tests: ok\n");
