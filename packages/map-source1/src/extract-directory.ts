import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  deriveMapArtifact,
  createMapCatalog,
  steamBuildIdFromManifest,
  writeJsonAtomically,
  writeMapArtifact,
  type SourceMapArtifact,
} from "./artifact.js";

const [mapsArgument, outputArgument, appManifestArgument] =
  process.argv.slice(2);
if (!mapsArgument || !outputArgument) {
  process.stderr.write(
    "Usage: map-source1 extract-all <maps-directory> <geometry-directory> [appmanifest_222860.acf]\n",
  );
  process.exitCode = 2;
} else {
  const mapsRoot = resolve(mapsArgument);
  const outputRoot = resolve(outputArgument);
  let steamBuildId: string | undefined;
  if (appManifestArgument) {
    const manifest = await readFile(resolve(appManifestArgument), "utf8");
    steamBuildId = steamBuildIdFromManifest(manifest);
  }

  const filenames = (await readdir(mapsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^[a-z0-9_]+\.bsp$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  if (filenames.length === 0)
    throw new RangeError("map directory contains no canonical BSP files");

  const artifacts: SourceMapArtifact[] = [];
  for (const filename of filenames) {
    const artifact = await deriveMapArtifact(
      join(mapsRoot, filename),
      steamBuildId
        ? { kind: "steam-dedicated-server", steamBuildId }
        : { kind: "local-bsp" },
    );
    await writeMapArtifact(
      join(outputRoot, `${artifact.provenance.map}.json`),
      artifact,
    );
    artifacts.push(artifact);
    process.stdout.write(
      `${artifact.provenance.map}: ${artifact.coverage.emittedTriangles} triangles\n`,
    );
  }

  await writeJsonAtomically(
    join(outputRoot, "catalog.json"),
    createMapCatalog(artifacts),
  );
  process.stdout.write(
    `Extracted ${artifacts.length} maps into ${outputRoot}\n`,
  );
}
