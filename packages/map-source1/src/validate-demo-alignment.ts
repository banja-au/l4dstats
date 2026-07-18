import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { decodeDemo } from "@witchwatch/demo-source1";
import { projectL4d2PlayerObservations } from "@witchwatch/l4d2-schema";
import { measureCoordinateAlignment } from "./alignment.js";
import type { SourceMapArtifact } from "./artifact.js";
import type { MapVector3 } from "./index.js";

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
    const decoded = decodeDemo(bytes);
    const artifact = JSON.parse(
      await readFile(
        join(geometryRoot, `${decoded.header.mapName}.json`),
        "utf8",
      ),
    ) as SourceMapArtifact;
    if (artifact.provenance.map !== decoded.header.mapName)
      throw new RangeError("demo map name does not match geometry provenance");
    const points: MapVector3[] = [];
    projectL4d2PlayerObservations(bytes, {
      demoSha256: createHash("sha256").update(bytes).digest("hex"),
      userInfo: [],
      onObservation: ({ observation }) => {
        if (observation.position.value) points.push(observation.position.value);
      },
    });
    const alignment = measureCoordinateAlignment(points, artifact.bounds);
    if (alignment.observed === 0)
      throw new RangeError("demo contains no observed player positions");
    reports.push({ map: decoded.header.mapName, ...alignment });
  }
  process.stdout.write(`${JSON.stringify({ demos: reports })}\n`);
}
