import process from "node:process";

const allowed = new Set([
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "CC-BY-4.0",
  "ISC",
  "MIT",
  "MIT OR Apache-2.0",
  "MPL-2.0",
  "OFL-1.1",
]);

let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;

let inventory;
try {
  inventory = JSON.parse(input);
} catch {
  process.stderr.write("Dependency license inventory was not valid JSON.\n");
  process.exitCode = 1;
  process.exit();
}

const observed = Object.keys(inventory).sort();
const rejected = observed.filter((license) => !allowed.has(license));
if (rejected.length) {
  process.stderr.write(
    `Unreviewed dependency license categories: ${rejected.join(", ")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Dependency license gate passed: ${observed.join(", ")}\n`,
  );
}
