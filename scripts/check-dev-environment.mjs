import { readFile } from "node:fs/promises";

const turbo = JSON.parse(await readFile("turbo.json", "utf8"));
const compose = await readFile("compose.yaml", "utf8");
const declared = new Set(turbo.tasks?.dev?.env ?? []);
const required = [
  "CHOKIDAR_USEPOLLING",
  "L4DSTATS_API_TOKEN",
  "L4DSTATS_API_URL",
  "L4DSTATS_WEB_PASSWORD",
  "L4DSTATS_WEB_USERNAME",
];
const missing = required.filter((name) => !declared.has(name));
if (missing.length)
  throw new Error(
    `Turbo dev task strips required environment variables: ${missing.join(", ")}`,
  );
if (
  !compose.includes(
    "L4DSTATS_GEOMETRY_ROOTS: /var/lib/l4dstats/geometry:/workspace/map-geometry",
  )
)
  throw new Error(
    "Development Compose must prefer local geometry and fall back to the committed subset",
  );
process.stdout.write("Development environment contract passed.\n");
