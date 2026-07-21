import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.mjs";

const demoPath = process.env.L4DSTATS_NODE_REAL_DEMO;
if (!demoPath) {
  process.stdout.write(
    "demo-source1-node real demo: skipped (no explicit path)\n",
  );
} else {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const require = createRequire(import.meta.url);
  const binding = require(resolve(root, "dist/demo-source1-node.node"));
  const demo = await readFile(demoPath);
  const encoded = await binding.projectDemo(
    demo,
    Buffer.from("node-addon-real-demo-test-key"),
    config(),
  );
  assert.equal(Buffer.isBuffer(encoded), true);
  assert.equal(encoded.byteLength <= 256 * 1024 * 1024, true);
  const artifact = JSON.parse(encoded.toString("utf8"));
  assert.equal(artifact.version, 2);
  assert.equal(artifact.bytesConsumed, demo.byteLength);
  assert.equal(artifact.stopped, true);
  assert.equal(typeof artifact.projection.demoSha256, "string");
  assert.equal(Array.isArray(artifact.projection.observations.rows), true);
  const encodedAgain = await binding.projectDemo(
    demo,
    Buffer.from("node-addon-real-demo-test-key"),
    config(),
  );
  assert.deepEqual(encodedAgain, encoded);
  await assert.rejects(
    binding.projectDemo(
      demo,
      Buffer.from("node-addon-real-demo-test-key"),
      config({ maxOutputBytes: 1 }),
    ),
    /SERIALIZATION_FAILED.*output limit/,
  );
  process.stdout.write("demo-source1-node real demo: ok\n");
}
