import { readFile } from "node:fs/promises";

const turbo = JSON.parse(await readFile("turbo.json", "utf8"));
const declared = new Set(turbo.tasks?.dev?.env ?? []);
const required = [
  "CHOKIDAR_USEPOLLING",
  "WITCHWATCH_API_TOKEN",
  "WITCHWATCH_API_URL",
  "WITCHWATCH_WEB_PASSWORD",
  "WITCHWATCH_WEB_USERNAME",
];
const missing = required.filter((name) => !declared.has(name));
if (missing.length)
  throw new Error(
    `Turbo dev task strips required environment variables: ${missing.join(", ")}`,
  );
process.stdout.write("Development environment contract passed.\n");
