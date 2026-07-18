import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import process from "node:process";

const [dumpDirectory, witchwatchPath, commitPath] = process.argv.slice(2);
if (!dumpDirectory || !witchwatchPath || !commitPath) {
  process.stderr.write(
    "Usage: node scripts/compare-untitled-framing.mjs <dump-directory> <witchwatch-corpus.json> <untitled-parser.commit>\n",
  );
  process.exitCode = 2;
} else {
  const witchwatch = JSON.parse(await readFile(witchwatchPath, "utf8"));
  const commit = (await readFile(commitPath, "utf8")).trim();
  const dumps = (await readdir(dumpDirectory))
    .filter((name) => name.endsWith("--demo-dump.txt"))
    .sort();
  const byFixture = new Map(
    witchwatch.demos.map((demo) => [demo.fixture, demo]),
  );
  const commandKinds = {
    SIGNON: "signon",
    PACKET: "packet",
    SYNCTICK: "sync-tick",
    CONSOLECMD: "console-command",
    USERCMD: "user-command",
    DATATABLES: "data-tables",
    STOP: "stop",
    CUSTOMDATA: "custom-data",
    STRINGTABLES: "string-tables",
  };
  const results = [];

  function field(text, label) {
    const match = text.match(new RegExp(`^${label}: (.*)$`, "m"));
    if (!match) throw new Error(`reference dump omitted ${label}`);
    return match[1].trim();
  }

  for (const dumpName of dumps) {
    const bytes = await readFile(join(dumpDirectory, dumpName));
    const text = bytes.toString("utf8").replace(/^\uFEFF/, "");
    const fixture = field(text, "file name");
    const demo = byFixture.get(fixture);
    if (!demo) throw new Error(`no WitchWatch result for ${fixture}`);
    const frames = [...text.matchAll(/^\[(-?\d+)\] ([A-Z]+) \(\d+\)$/gm)].map(
      (match) => {
        const kind = commandKinds[match[2]];
        if (!kind) throw new Error(`unsupported reference command ${match[2]}`);
        return { tick: Number(match[1]), kind };
      },
    );
    const commandCounts = {};
    for (const frame of frames)
      commandCounts[frame.kind] = (commandCounts[frame.kind] ?? 0) + 1;
    const sequenceSha256 = createHash("sha256")
      .update(frames.map((frame) => `${frame.tick}\t${frame.kind}\n`).join(""))
      .digest("hex");
    const comparisons = {
      stamp: field(text, "file stamp") === demo.header.stamp,
      demoProtocol:
        Number(field(text, "demo protocol")) === demo.header.demoProtocol,
      networkProtocol:
        Number(field(text, "network protocol")) === demo.header.networkProtocol,
      serverName:
        createHash("sha256")
          .update(field(text, "server name"))
          .digest("hex") === demo.headerLabelSha256.serverName,
      clientName:
        createHash("sha256")
          .update(field(text, "client name"))
          .digest("hex") === demo.headerLabelSha256.clientName,
      mapName: field(text, "map name") === demo.header.mapName,
      gameDirectory:
        field(text, "game directory") === demo.header.gameDirectory,
      // UntitledParser renders this System.Single using .NET's shortest
      // round-trippable representation. Reparse both values as IEEE-754
      // float32 so formatting differences cannot hide or invent a bit change.
      playbackTime:
        Math.fround(Number(field(text, "playback time"))) ===
        Math.fround(demo.header.playbackTimeSeconds),
      playbackTicks:
        Number(field(text, "tick count")) === demo.header.playbackTicks,
      playbackFrames:
        Number(field(text, "frame count")) === demo.header.playbackFrames,
      signonLength:
        Number(field(text, "sign on length")) === demo.header.signonLength,
      commandCounts:
        JSON.stringify(
          Object.fromEntries(Object.entries(commandCounts).sort()),
        ) === JSON.stringify(demo.commandCounts),
      commandOrderAndTicks: sequenceSha256 === demo.commandSequenceSha256,
      finalCommand: frames.at(-1)?.kind === "stop",
    };
    const failures = Object.entries(comparisons)
      .filter(([, passed]) => !passed)
      .map(([name]) => name);
    results.push({
      fixture,
      demoSha256: demo.sha256,
      referenceDumpSha256: createHash("sha256").update(bytes).digest("hex"),
      commandSequenceSha256: sequenceSha256,
      commands: frames.length,
      passed: failures.length === 0,
      failures,
    });
    byFixture.delete(fixture);
  }

  const missingReferenceDumps = [...byFixture.keys()].sort();
  const failed = results.filter((result) => !result.passed).length;
  const report = {
    schemaVersion: 1,
    reference: {
      name: "UncraftedName/UntitledParser",
      commit,
      runtime: ".NET 7.0.410 linux-arm64",
    },
    comparisonSemantics: {
      playbackTimeSeconds: "exact IEEE-754 float32 value after round trip",
    },
    comparedFields: [
      "header common fields",
      "command counts",
      "command order",
      "command ticks",
      "final stop position",
    ],
    summary: {
      demos: results.length,
      passed: results.length - failed,
      failed,
      missingReferenceDumps,
    },
    results,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (failed || missingReferenceDumps.length) process.exitCode = 1;
}
