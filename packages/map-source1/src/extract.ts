import { deriveMapArtifact, writeMapArtifact } from "./artifact.js";

const [inputArgument, outputArgument] = process.argv.slice(2);
if (!inputArgument || !outputArgument) {
  process.stderr.write(
    "Usage: map-source1 extract <map.bsp> <geometry.json>\n",
  );
  process.exitCode = 2;
} else {
  const artifact = await deriveMapArtifact(inputArgument);
  await writeMapArtifact(outputArgument, artifact);
  process.stdout.write(`${outputArgument}\n`);
}
