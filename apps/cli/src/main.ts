#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { decodeDemo, DemoParseError } from "@witchwatch/demo-source1";
import {
  detectorCards,
  exploreFeatures,
  parseFeatureRequest,
} from "./explore.js";
import {
  comparePlaybackCheckpoints,
  exportPlaybackCheckpoints,
  parsePlaybackExportRequest,
  type PlaybackCheckpointExport,
  type PlaybackReference,
} from "./playback-validation.js";
import { stableJson, summarizeDemo, type DemoInspection } from "./report.js";
import { buildEvidenceBundle } from "./evidence-bundle.js";
import {
  parseControlledDataset,
  writeCalibrationArtifacts,
} from "./scoring.js";

const inspect = async (path: string): Promise<DemoInspection> => {
  const bytes = await readFile(path);
  const decoded = decodeDemo(bytes);
  return summarizeDemo(
    decoded,
    createHash("sha256").update(bytes).digest("hex"),
    bytes.byteLength,
  );
};

const findDemos = async (root: string): Promise<string[]> => {
  const found: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".dem"))
        found.push(path);
    }
  };
  await visit(root);
  return found;
};

const usage = (): never => {
  throw new Error(
    "Usage: witchwatch inspect <demo.dem> | evidence-bundle <demo.dem> | corpus <directory> | features <request.json> | detectors | calibrate <dataset.json> <output-directory> | playback-export <demo.dem> <request.json> | playback-compare <export.json> <reference.json>",
  );
};

const main = async (): Promise<void> => {
  const [command, input, ...extra] = process.argv.slice(2);
  const commandName = command ?? usage();
  if (commandName === "detectors") {
    if (input !== undefined || extra.length > 0) usage();
    process.stdout.write(
      stableJson({ schemaVersion: 1, detectors: detectorCards() }),
    );
    return;
  }
  const target = input ?? usage();
  if (commandName === "calibrate") {
    if (extra.length !== 1) usage();
    const dataset = parseControlledDataset(
      JSON.parse(await readFile(resolve(target), "utf8")),
    );
    process.stdout.write(
      stableJson(await writeCalibrationArtifacts(dataset, resolve(extra[0]!))),
    );
    return;
  }
  if (commandName === "playback-export") {
    if (extra.length !== 1) usage();
    const request = parsePlaybackExportRequest(
      JSON.parse(await readFile(resolve(extra[0]!), "utf8")),
    );
    process.stdout.write(
      stableJson(
        exportPlaybackCheckpoints(await readFile(resolve(target)), request),
      ),
    );
    return;
  }
  if (commandName === "playback-compare") {
    if (extra.length !== 1) usage();
    const observedBytes = await readFile(resolve(target));
    const referenceBytes = await readFile(resolve(extra[0]!));
    const report = comparePlaybackCheckpoints(
      JSON.parse(observedBytes.toString("utf8")) as PlaybackCheckpointExport,
      JSON.parse(referenceBytes.toString("utf8")) as PlaybackReference,
      observedBytes,
      referenceBytes,
    );
    process.stdout.write(stableJson(report));
    if (!report.passed) process.exitCode = 2;
    return;
  }
  if (extra.length > 0) usage();
  if (commandName === "features") {
    const request = parseFeatureRequest(
      JSON.parse(await readFile(resolve(target), "utf8")),
    );
    process.stdout.write(stableJson(exploreFeatures(request)));
    return;
  }
  if (commandName === "inspect") {
    process.stdout.write(stableJson(await inspect(resolve(target))));
    return;
  }
  if (commandName === "evidence-bundle") {
    const pseudonymKey = process.env.WITCHWATCH_PSEUDONYM_KEY;
    if (!pseudonymKey)
      throw new Error(
        "WITCHWATCH_PSEUDONYM_KEY is required for evidence-bundle",
      );
    process.stdout.write(
      stableJson(
        buildEvidenceBundle(await readFile(resolve(target)), {
          pseudonymKey,
          onProgress: (progress, message) =>
            process.stderr.write(
              `WITCHWATCH_PROGRESS ${JSON.stringify({ progress, message })}\n`,
            ),
        }),
      ),
    );
    return;
  }
  if (commandName === "corpus") {
    const root = resolve(target);
    const paths = await findDemos(root);
    const demos = [];
    for (const path of paths)
      demos.push({ fixture: basename(path), ...(await inspect(path)) });
    process.stdout.write(
      stableJson({
        schemaVersion: 1,
        demoCount: demos.length,
        demos,
      }),
    );
    return;
  }
  usage();
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof DemoParseError ? error.code : "CLI_ERROR";
  process.stderr.write(stableJson({ error: { code, message } }));
  process.exitCode = 1;
});
