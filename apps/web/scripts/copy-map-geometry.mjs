import { copyFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const source = resolve(
  new URL("../../../map-geometry", import.meta.url).pathname,
);
const target = resolve(
  new URL("../dist/map-geometry", import.meta.url).pathname,
);
const names = (await readdir(source)).filter((name) => name.endsWith(".json"));
const maps = names.filter((name) => name !== "catalog.json");
if (maps.length !== 57 || !names.includes("catalog.json"))
  throw new Error(
    `Expected 57 map geometry files and catalog.json; found ${maps.length} maps`,
  );
const catalog = JSON.parse(
  await readFile(join(source, "catalog.json"), "utf8"),
);
if (!Array.isArray(catalog.maps) || catalog.maps.length !== 57)
  throw new Error("Map geometry catalog is incomplete");
for (const name of maps) {
  const info = await stat(join(source, name));
  if (!info.isFile() || info.size < 1 || info.size > 5 * 1024 * 1024)
    throw new Error(`Map geometry asset is outside its size bound: ${name}`);
}
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await Promise.all(
  names.map((name) => copyFile(join(source, name), join(target, name))),
);
console.log(`Copied ${maps.length} bounded map geometry assets and catalog`);
