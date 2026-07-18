import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const compose = readFileSync("compose.yaml", "utf8");
const dockerfile = readFileSync("Dockerfile.dev", "utf8");

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

requireCondition(
  packageJson.scripts["native:prepare"] ===
    "bash scripts/prepare-native-parser.sh",
  "root native:prepare must use the stamped native parser preparation script",
);
for (const script of ["dev", "dev:cli"])
  requireCondition(
    packageJson.scripts[script]?.includes("pnpm native:prepare"),
    `${script} must prepare the native parser before startup`,
  );
requireCondition(
  /worker:[\s\S]*?command: bash -lc "pnpm native:prepare && pnpm --filter @witchwatch\/worker dev"/.test(
    compose,
  ),
  "development worker must prepare the native parser before startup",
);
for (const obsolete of [
  "demo-source1-node-modules",
  "l4d2-schema-node-modules",
])
  requireCondition(
    !compose.includes(obsolete),
    `obsolete development volume remains: ${obsolete}`,
  );
requireCondition(
  dockerfile.includes("COPY scripts/prepare-native-parser.sh"),
  "development image must include the native preparation contract",
);
process.stdout.write("Development native parser startup contract passed.\n");
