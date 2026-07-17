import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { projectL4d2PlayerObservations } from "../src/entity-projection";
import { collectL4d2UserInfoTimeline } from "../src/userinfo-identity";

const corpusRoot = resolve("../../data/sprint-1-corpus/extracted");

function findDemos(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory()
        ? findDemos(path)
        : entry.isFile() && entry.name.endsWith(".dem")
          ? [path]
          : [];
    })
    .sort();
}

function requireCondition(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

requireCondition(existsSync(corpusRoot), `corpus not found: ${corpusRoot}`);
const paths = findDemos(corpusRoot);
requireCondition(
  paths.length === 10,
  `expected 10 demos, found ${paths.length}`,
);

const summaries = paths.map((path) => {
  const bytes = readFileSync(path);
  const demoSha256 = createHash("sha256").update(bytes).digest("hex");
  const identityTimeline = collectL4d2UserInfoTimeline(bytes, {
    pseudonymKey: "witchwatch-corpus-test-key-only",
  });
  const result = projectL4d2PlayerObservations(bytes, {
    demoSha256,
    userInfo: identityTimeline.mappings,
  });
  const { coverage } = result;
  requireCondition(
    result.playerEpochs.length >= 8,
    `${demoSha256}: fewer than 8 player epochs`,
  );
  const humanUserIds = new Set(
    identityTimeline.mappings
      .filter(({ stableIdentityToken }) => stableIdentityToken !== undefined)
      .map(({ userId }) => userId),
  );
  const humanEpochs = result.playerEpochs.filter(
    ({ userId }) =>
      userId.availability === "observed" && humanUserIds.has(userId.value),
  );
  requireCondition(
    humanEpochs.length > 0,
    `${demoSha256}: no data-backed human epochs`,
  );
  requireCondition(
    humanEpochs.every(
      ({ steamId }) =>
        steamId.availability === "observed" &&
        /^hmac-sha256:[a-f\d]{64}$/.test(steamId.value),
    ),
    `${demoSha256}: human epoch lacks a privacy-safe identity token`,
  );
  requireCondition(
    coverage.observationsEmitted > 0,
    `${demoSha256}: no observations`,
  );
  requireCondition(
    coverage.fieldAvailability.position.observed ===
      coverage.observationsEmitted,
    `${demoSha256}: incomplete position coverage`,
  );
  requireCondition(
    coverage.fieldAvailability.eyeAngles.derived ===
      coverage.observationsEmitted,
    `${demoSha256}: incomplete eye-angle coverage`,
  );
  requireCondition(
    coverage.fieldAvailability.buttons.unavailable ===
      coverage.observationsEmitted,
    `${demoSha256}: buttons were not explicitly unavailable`,
  );
  const summary = {
    demoSha256,
    epochs: result.playerEpochs.length,
    frames: coverage.framesVisited,
    observations: coverage.observationsEmitted,
    weaponObserved: coverage.fieldAvailability.weapon.observed,
    weaponUnavailable: coverage.fieldAvailability.weapon.unavailable,
    privacyBoundHumanEpochs: humanEpochs.length,
  };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  return summary;
});

const total = summaries.reduce(
  (sum, item) => ({
    demos: sum.demos + 1,
    epochs: sum.epochs + item.epochs,
    frames: sum.frames + item.frames,
    observations: sum.observations + item.observations,
    weaponObserved: sum.weaponObserved + item.weaponObserved,
    weaponUnavailable: sum.weaponUnavailable + item.weaponUnavailable,
    privacyBoundHumanEpochs:
      sum.privacyBoundHumanEpochs + item.privacyBoundHumanEpochs,
  }),
  {
    demos: 0,
    epochs: 0,
    frames: 0,
    observations: 0,
    weaponObserved: 0,
    weaponUnavailable: 0,
    privacyBoundHumanEpochs: 0,
  },
);
process.stdout.write(`${JSON.stringify({ status: "pass", total })}\n`);
