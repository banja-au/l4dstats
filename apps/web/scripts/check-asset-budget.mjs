import { readdir, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const distRoot = join(webRoot, "dist");
const kib = 1024;
const budgets = {
  total: 520 * kib,
  javascript: 250 * kib,
  css: 45 * kib,
  hero: 230 * kib,
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
  })),
);
const sizeOf = (predicate) =>
  measured.filter(predicate).reduce((total, file) => total + file.bytes, 0);
const totals = {
  total: sizeOf(() => true),
  javascript: sizeOf((file) => file.extension === ".js"),
  css: sizeOf((file) => file.extension === ".css"),
  hero: sizeOf((file) => file.path === "art/bloated-infected-hero.jpg"),
  html: sizeOf((file) => file.extension === ".html"),
};

const failures = Object.entries(budgets).flatMap(([category, limit]) =>
  totals[category] > limit
    ? [`${category}: ${totals[category]} bytes exceeds ${limit} bytes`]
    : [],
);
if (totals.hero === 0)
  failures.push(
    "hero: expected art/bloated-infected-hero.jpg in production output",
  );

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
