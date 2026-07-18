import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, "apps/worker/dist/parser-no-network");
const source = resolve(root, "scripts/parser-no-network.c");
if (process.platform !== "linux") {
  rmSync(output, { force: true });
  process.stdout.write(
    "Parser seccomp launcher is Linux-only; build skipped.\n",
  );
  process.exit(0);
}
mkdirSync(dirname(output), { recursive: true });
execFileSync(process.env.CC ?? "cc", [
  "-O2",
  "-Wall",
  "-Wextra",
  "-Werror",
  source,
  "-o",
  output,
]);
process.stdout.write(`Built parser seccomp launcher at ${output}.\n`);
