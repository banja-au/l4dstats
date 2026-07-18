import { cpSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const crateRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(crateRoot, "../..");
if (!process.argv.includes("--copy-only")) {
  const result = spawnSync(
    "cargo",
    ["build", "--release", "--package", "demo-source1-node"],
    { cwd: repositoryRoot, stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const extension =
  process.platform === "darwin"
    ? "dylib"
    : process.platform === "win32"
      ? "dll"
      : "so";
const source = resolve(
  repositoryRoot,
  "target/release",
  `libdemo_source1_node.${extension}`,
);
const output = resolve(crateRoot, "dist/demo-source1-node.node");
mkdirSync(dirname(output), { recursive: true });
cpSync(source, output);
process.stdout.write(`${output}\n`);
