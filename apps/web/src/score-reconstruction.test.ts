import { describe, expect, it } from "vitest";
import type { DemoStats, JobAnalysis } from "./api";
import { reconstructVersusScores } from "./score-reconstruction";

const demo = (campaignScores: number[], opening: number[]): DemoStats =>
  ({
    match: {
      campaignScores,
      roundEnds: 1,
      scoreTimeline: [
        {
          tick: 1,
          timeSeconds: 0,
          campaignScores: opening,
          chapterScores: [0, 0],
          survivorScores: [],
          survivorDistances: [],
          teamsFlipped: false,
          secondHalf: false,
        },
      ],
    },
  }) as unknown as DemoStats;

const terminalDemo = (
  campaignScores: number[],
  opening: number[],
  survivorScoreTimeline: number[][],
): DemoStats =>
  ({
    match: {
      campaignScores,
      roundEnds: 2,
      scoreTimeline: survivorScoreTimeline.map((survivorScores, index) => ({
        tick: index + 1,
        timeSeconds: index,
        campaignScores: index === 0 ? opening : campaignScores,
        chapterScores: [0, 0],
        survivorScores,
        survivorDistances: [],
        teamsFlipped: index > 1,
        secondHalf: index > 1,
      })),
    },
  }) as unknown as DemoStats;

const analysis = (mapName: string): JobAnalysis =>
  ({ engineResult: { demo: { mapName } } }) as unknown as JobAnalysis;

describe("Versus score reconstruction", () => {
  it("does not turn a missing required team score into zero", () => {
    const incomplete = demo([525, 0], [0, 0]);
    incomplete.match!.campaignScores = [525, null];
    expect(
      reconstructVersusScores([incomplete], [analysis("c4m1_milltown_a")]),
    ).toEqual([]);
  });

  it("uses following-map boundaries and leaves the terminal half incomplete", () => {
    const rows = reconstructVersusScores(
      [
        demo([525, 0], [0, 0]),
        demo([1237, 122], [525, 122]),
        demo([1485, 461], [1237, 461]),
        demo([2409, 698], [1485, 698]),
      ],
      [
        analysis("c4m1_milltown_a"),
        analysis("c4m2_sugarmill_a"),
        analysis("c4m3_sugarmill_b"),
        analysis("c4m4_milltown_b"),
      ],
    );
    expect(rows).toMatchObject([
      { teamA: 525, teamB: 122, chapterA: 525, chapterB: 122, complete: true },
      { teamA: 1237, teamB: 461, chapterA: 712, chapterB: 339, complete: true },
      { teamA: 1485, teamB: 698, chapterA: 248, chapterB: 237, complete: true },
      {
        teamA: 2409,
        teamB: null,
        chapterA: 924,
        chapterB: null,
        complete: false,
      },
    ]);
  });

  it("does not use a non-adjacent selected map as a confirmation boundary", () => {
    const rows = reconstructVersusScores(
      [demo([525, 0], [0, 0]), demo([1485, 461], [1237, 461])],
      [analysis("c4m1_milltown_a"), analysis("c4m3_sugarmill_b")],
    );
    expect(rows[0]).toMatchObject({
      teamA: 525,
      teamB: null,
      chapterA: 525,
      chapterB: null,
      complete: false,
    });
  });

  it("recovers an uncommitted terminal side from the live Survivor score", () => {
    const rows = reconstructVersusScores(
      [
        demo([810, 317], [703, 317]),
        terminalDemo(
          [1_129, 425],
          [810, 425],
          [
            [0, 0],
            [319, 0],
            [0, 108],
          ],
        ),
      ],
      [analysis("c2m3_coaster"), analysis("c2m4_barns")],
    );
    expect(rows[1]).toMatchObject({
      teamA: 1_129,
      teamB: 533,
      chapterA: 319,
      chapterB: 108,
      complete: true,
      confirmation: "live-survivor-score",
    });
  });
});
