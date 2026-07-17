import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateControlledDataset,
  parseControlledDataset,
  writeCalibrationArtifacts,
} from "./scoring";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

const fixture = async () =>
  parseControlledDataset(
    JSON.parse(
      await readFile(
        new URL(
          "../../../packages/scoring/fixtures/controlled-v1.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );

describe("controlled calibration CLI boundary", () => {
  it("rejects datasets without mandatory governance limitations", () => {
    expect(() =>
      parseControlledDataset({ schemaVersion: 1, metadata: {}, rows: [] }),
    ).toThrow(/governance metadata/);
  });

  it("publishes byte-identical immutable bundle and report artifacts", async () => {
    const dataset = await fixture();
    expect(evaluateControlledDataset(dataset)).toEqual(
      evaluateControlledDataset(dataset),
    );
    const directory = await mkdtemp(join(tmpdir(), "witchwatch-scoring-"));
    directories.push(directory);
    const first = await writeCalibrationArtifacts(dataset, directory);
    const second = await writeCalibrationArtifacts(dataset, directory);
    expect(first).toEqual(second);
    expect(first.usefulOperatingPoint).toBe(true);
    expect(first.calibrationAccepted).toBe(true);
    expect(await readFile(first.modelPath, "utf8")).toContain(
      "reference-validation-pending",
    );
    expect(await readFile(first.reportPath, "utf8")).toContain(
      "controlled-fixture-results-do-not-establish-population-validity",
    );
  });
});
