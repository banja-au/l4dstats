import { join, resolve } from "node:path";
import {
  assertCompleteOfficialCampaignInstallation,
  discoverInstalledCampaignBsps,
} from "./installation.js";
import { validateMapArtifact } from "./validate.js";

const [installationArgument, geometryArgument] = process.argv.slice(2);
if (!installationArgument || !geometryArgument) {
  process.stderr.write(
    "Usage: map-source1 validate-installation <l4d2-installation> <geometry-directory>\n",
  );
  process.exitCode = 2;
} else {
  const geometryRoot = resolve(geometryArgument);
  const sources = await discoverInstalledCampaignBsps(installationArgument);
  if (sources.length === 0)
    throw new RangeError("installation contains no official campaign BSPs");
  assertCompleteOfficialCampaignInstallation(sources);
  const reports = [];
  for (const source of sources)
    reports.push(
      await validateMapArtifact(
        source.path,
        join(geometryRoot, `${source.map}.json`),
        source.map,
      ),
    );
  process.stdout.write(`${JSON.stringify({ maps: reports })}\n`);
}
