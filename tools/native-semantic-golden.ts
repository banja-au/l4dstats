import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { prepareNativeDemoProjection } from "../apps/cli/src/native-demo-provider.js";
import type { PreparedDemoProjection } from "../apps/cli/src/evidence-bundle.js";

const HASH = /^[a-f0-9]{64}$/;
const CONTRACT = "prepared-demo-projection/v1-minus-parser-lineage";

interface Entry {
  demoSha256: string;
  bytes: number;
  preparedSemanticSha256: string;
}

interface Manifest {
  schemaVersion: 1;
  semanticContract: typeof CONTRACT;
  provenance: {
    basis: "historical-typescript-parity-plus-current-native-regression";
    historicalParity: "22/22 PreparedDemoProjection equality recorded in sprint-rust-parser-execution.md";
    generator: "native-provider";
  };
  demos: Entry[];
}

export function preparedSemanticSha256(
  prepared: PreparedDemoProjection,
): string {
  const {
    parser: _parser,
    parserVersion: _parserVersion,
    ...semantic
  } = prepared;
  const hash = createHash("sha256");
  appendCanonical(hash, semantic);
  return hash.digest("hex");
}

function appendCanonical(
  hash: ReturnType<typeof createHash>,
  value: unknown,
): void {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined)
      throw new TypeError("semantic projection contains unsupported undefined");
    hash.update(encoded);
    return;
  }
  if (Array.isArray(value)) {
    hash.update("[");
    value.forEach((child, index) => {
      if (index) hash.update(",");
      appendCanonical(hash, child === undefined ? null : child);
    });
    hash.update("]");
    return;
  }
  hash.update("{");
  let emitted = 0;
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (child === undefined) continue;
    if (emitted++) hash.update(",");
    hash.update(JSON.stringify(key));
    hash.update(":");
    appendCanonical(hash, child);
  }
  hash.update("}");
}

export async function buildManifest(
  paths: readonly string[],
): Promise<Manifest> {
  const demos: Entry[] = [];
  for (const path of paths) {
    const bytes = await readFile(path);
    const prepared = await prepareNativeDemoProjection(bytes, {
      pseudonymKey: "l4dstats-semantic-golden-v1",
    });
    demos.push({
      demoSha256: prepared.demoSha256,
      bytes: bytes.byteLength,
      preparedSemanticSha256: preparedSemanticSha256(prepared),
    });
  }
  demos.sort((left, right) => left.demoSha256.localeCompare(right.demoSha256));
  if (new Set(demos.map(({ demoSha256 }) => demoSha256)).size !== demos.length)
    throw new Error("duplicate demo content was supplied");
  return {
    schemaVersion: 1,
    semanticContract: CONTRACT,
    provenance: {
      basis: "historical-typescript-parity-plus-current-native-regression",
      historicalParity:
        "22/22 PreparedDemoProjection equality recorded in sprint-rust-parser-execution.md",
      generator: "native-provider",
    },
    demos,
  };
}

export function parseManifest(value: unknown): Manifest {
  if (
    !record(value) ||
    exactKeys(value, [
      "demos",
      "provenance",
      "schemaVersion",
      "semanticContract",
    ]) === false
  )
    throw new TypeError("native semantic manifest fields are invalid");
  if (value.schemaVersion !== 1 || value.semanticContract !== CONTRACT)
    throw new TypeError("native semantic manifest version is unsupported");
  const provenance = value.provenance;
  if (
    !record(provenance) ||
    !exactKeys(provenance, ["basis", "generator", "historicalParity"]) ||
    provenance.basis !==
      "historical-typescript-parity-plus-current-native-regression" ||
    provenance.generator !== "native-provider" ||
    provenance.historicalParity !==
      "22/22 PreparedDemoProjection equality recorded in sprint-rust-parser-execution.md"
  )
    throw new TypeError("native semantic manifest provenance is invalid");
  if (!Array.isArray(value.demos) || value.demos.length !== 22)
    throw new TypeError(
      "native semantic manifest must contain exactly 22 demos",
    );
  const demos = value.demos.map((entry, index): Entry => {
    if (
      !record(entry) ||
      !exactKeys(entry, ["bytes", "demoSha256", "preparedSemanticSha256"])
    )
      throw new TypeError(`native semantic manifest entry ${index} is invalid`);
    if (
      typeof entry.demoSha256 !== "string" ||
      !HASH.test(entry.demoSha256) ||
      typeof entry.preparedSemanticSha256 !== "string" ||
      !HASH.test(entry.preparedSemanticSha256) ||
      !Number.isSafeInteger(entry.bytes) ||
      Number(entry.bytes) <= 0
    )
      throw new TypeError(
        `native semantic manifest entry ${index} values are invalid`,
      );
    return {
      demoSha256: entry.demoSha256,
      bytes: Number(entry.bytes),
      preparedSemanticSha256: entry.preparedSemanticSha256,
    };
  });
  const sorted = [...demos].sort((a, b) =>
    a.demoSha256.localeCompare(b.demoSha256),
  );
  if (
    JSON.stringify(demos) !== JSON.stringify(sorted) ||
    new Set(demos.map((entry) => entry.demoSha256)).size !== 22
  )
    throw new TypeError(
      "native semantic manifest demos must be unique and sorted",
    );
  return {
    schemaVersion: 1,
    semanticContract: CONTRACT,
    provenance: provenance as Manifest["provenance"],
    demos,
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...keys].sort())
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args.shift();
  const manifestFlag = args.shift();
  const manifestPath = args.shift();
  if (
    !["generate", "verify"].includes(mode ?? "") ||
    manifestFlag !== "--manifest" ||
    !manifestPath
  )
    throw new Error(
      "usage: native-semantic-golden <generate|verify> --manifest <file> --demo <file> [--demo <file> ...]",
    );
  const paths: string[] = [];
  while (args.length) {
    if (args.shift() !== "--demo" || !args[0])
      throw new Error("every input must use --demo <file>");
    paths.push(args.shift()!);
  }
  if (paths.length !== 22)
    throw new Error("exactly 22 explicit demo paths are required");
  const actual = await buildManifest(paths);
  if (mode === "generate") {
    await writeFile(manifestPath, `${JSON.stringify(actual, null, 2)}\n`, {
      flag: "wx",
    });
    return;
  }
  const expected = parseManifest(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error("native semantic golden mismatch");
  process.stdout.write(
    `Verified ${actual.demos.length} privacy-safe native semantic goldens.\n`,
  );
}

if (process.argv[1]?.endsWith("native-semantic-golden.ts"))
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
