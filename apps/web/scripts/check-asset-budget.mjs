import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const distRoot = join(webRoot, "dist");
const kib = 1024;
// Keep bounded headroom above the July 2026 production baseline. JavaScript
// includes the complete English and Spanish catalogs so either locale works on
// the first paint and offline; their measured gzip cost is about 5.5 KiB.
// These limits still fail material first-load regressions in both parse and
// compressed transfer bytes.
const budgets = {
  total: 1370 * kib,
  javascript: 415 * kib,
  css: 99 * kib,
  transferTotal: 1025 * kib,
  transferJavascript: 125 * kib,
  transferCss: 21 * kib,
  hero: 230 * kib,
  backdrop: 150 * kib,
  brand: 75 * kib,
  infected: 480 * kib,
  html: 8 * kib,
};

async function filesBelow(directory) {
  return (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map(async (entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? filesBelow(path) : [path];
      }),
    )
  ).flat();
}

const files = await filesBelow(distRoot);
const measured = await Promise.all(
  files.map(async (path) => ({
    path: relative(distRoot, path),
    bytes: (await stat(path)).size,
    extension: extname(path),
    gzipBytes: gzipSync(await readFile(path)).byteLength,
  })),
);
const sizeOf = (predicate) =>
  measured.filter(predicate).reduce((total, file) => total + file.bytes, 0);
const totals = {
  total: sizeOf(() => true),
  javascript: sizeOf((file) => file.extension === ".js"),
  css: sizeOf((file) => file.extension === ".css"),
  transferTotal: measured.reduce((total, file) => total + file.gzipBytes, 0),
  transferJavascript: measured
    .filter((file) => file.extension === ".js")
    .reduce((total, file) => total + file.gzipBytes, 0),
  transferCss: measured
    .filter((file) => file.extension === ".css")
    .reduce((total, file) => total + file.gzipBytes, 0),
  hero: sizeOf((file) => file.path === "art/boomer-trace.webp"),
  backdrop: sizeOf((file) => file.path === "art/dark-carnival.webp"),
  brand: sizeOf((file) =>
    ["art/infected-mark.webp", "favicon.png"].includes(file.path),
  ),
  infected: sizeOf((file) => file.path.startsWith("art/si/")),
  html: sizeOf((file) => file.extension === ".html"),
};

const failures = Object.entries(budgets).flatMap(([category, limit]) =>
  totals[category] > limit
    ? [`${category}: ${totals[category]} bytes exceeds ${limit} bytes`]
    : [],
);
if (totals.hero === 0)
  failures.push("hero: expected art/boomer-trace.webp in production output");
if (totals.backdrop === 0)
  failures.push(
    "backdrop: expected art/dark-carnival.webp in production output",
  );
if (totals.brand === 0)
  failures.push("brand: expected infected-mark and favicon assets");
if (measured.filter((file) => file.path.startsWith("art/si/")).length !== 8)
  failures.push("infected: expected all eight realistic infected portraits");

for (const category of Object.keys(budgets))
  process.stdout.write(
    `${category.padEnd(10)} ${String(totals[category]).padStart(7)} / ${budgets[category]} bytes\n`,
  );
if (failures.length) {
  process.stderr.write(`Asset budget failed:\n- ${failures.join("\n- ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Production first-load asset budget passed.\n");
}
