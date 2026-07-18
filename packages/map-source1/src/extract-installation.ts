import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  createMapCatalog,
  deriveMapArtifact,
  steamBuildIdFromManifest,
  writeJsonAtomically,
  writeMapArtifact,
  type SourceMapArtifact,
} from "./artifact.js";
import {
  assertCompleteOfficialCampaignInstallation,
  discoverInstalledCampaignBsps,
} from "./installation.js";

const [installationArgument, outputArgument, appManifestArgument] =
  process.argv.slice(2);
if (!installationArgument || !outputArgument) {
  process.stderr.write(
    "Usage: map-source1 extract-installation <l4d2-installation> <geometry-directory> [appmanifest_222860.acf]\n",
  );
  process.exitCode = 2;
} else {
  const outputRoot = resolve(outputArgument);
  let steamBuildId: string | undefined;
  if (appManifestArgument)
    steamBuildId = steamBuildIdFromManifest(
      await readFile(resolve(appManifestArgument), "utf8"),
    );
  const sources = await discoverInstalledCampaignBsps(installationArgument);
  if (sources.length === 0)
    throw new RangeError("installation contains no official campaign BSPs");
  assertCompleteOfficialCampaignInstallation(sources);
  const artifacts: SourceMapArtifact[] = [];
  for (const source of sources) {
    const artifact = await deriveMapArtifact(source.path, {
      kind: "steam-dedicated-server",
      contentRoot: source.contentRoot,
      ...(steamBuildId ? { steamBuildId } : {}),
    });
    await writeMapArtifact(join(outputRoot, `${source.map}.json`), artifact);
    artifacts.push(artifact);
    process.stdout.write(
      `${source.map} (${source.contentRoot}): ${artifact.coverage.emittedTriangles} triangles\n`,
    );
  }
  await writeJsonAtomically(
    join(outputRoot, "catalog.json"),
    createMapCatalog(artifacts),
  );
  process.stdout.write(
    `Extracted ${artifacts.length} campaign maps into ${outputRoot}\n`,
  );
}
