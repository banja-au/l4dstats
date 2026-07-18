import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { measureCoordinateAlignment } from "./alignment.js";
import type { SourceMapArtifact } from "./artifact.js";
import { projectNativeDemoAlignment } from "./native-demo-alignment.js";

const [geometryArgument, ...demoArguments] = process.argv.slice(2);
if (!geometryArgument || demoArguments.length === 0) {
  process.stderr.write(
    "Usage: map-source1 validate-demo-alignment <geometry-directory> <demo.dem> [demo.dem ...]\n",
  );
  process.exitCode = 2;
} else {
  const geometryRoot = resolve(geometryArgument);
  const reports = [];
  for (const demoArgument of demoArguments) {
    const bytes = await readFile(resolve(demoArgument));
    const projected = await projectNativeDemoAlignment(bytes);
    const artifact = JSON.parse(
      await readFile(join(geometryRoot, `${projected.mapName}.json`), "utf8"),
    ) as SourceMapArtifact;
    if (artifact.provenance.map !== projected.mapName)
      throw new RangeError("demo map name does not match geometry provenance");
    const alignment = measureCoordinateAlignment(
      projected.positions,
      artifact.bounds,
    );
    if (alignment.observed === 0)
      throw new RangeError("demo contains no observed player positions");
    reports.push({ map: projected.mapName, ...alignment });
  }
  process.stdout.write(`${JSON.stringify({ demos: reports })}\n`);
}
