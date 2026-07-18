import type { DemoStats, JobAnalysis } from "./api";
import { parseL4d2MapName } from "./campaign-metadata";

export interface ReconstructedMapScore {
  demoSha256: string;
  mapName: string;
  teamA: number;
  teamB: number | null;
  chapterA: number;
  chapterB: number | null;
  complete: boolean;
  confirmation:
    | "next-map-opening"
    | "two-round-demo"
    | "live-survivor-score"
    | "partial-terminal";
}

function terminalBoundaryFromLiveScores(value: DemoStats): number[] | null {
  const timeline = value.match?.scoreTimeline;
  const opening = timeline?.[0]?.campaignScores;
  if (
    !timeline?.length ||
    !opening ||
    opening.length < 2 ||
    opening[0] === null ||
    opening[1] === null
  )
    return null;
  const liveMax = [0, 0];
  for (const point of timeline)
    for (let team = 0; team < 2; team++)
      if (point.survivorScores[team] !== null)
        liveMax[team] = Math.max(liveMax[team]!, point.survivorScores[team]!);
  return [opening[0]! + liveMax[0]!, opening[1]! + liveMax[1]!];
}

export function reconstructVersusScores(
  stats: readonly DemoStats[],
  analyses: readonly JobAnalysis[],
): ReconstructedMapScore[] {
  const rows: ReconstructedMapScore[] = [];
  let previousComplete = [0, 0];
  stats.forEach((value, index) => {
    const terminal = value.match?.campaignScores;
    if (
      !terminal ||
      terminal.length < 2 ||
      terminal[0] === null ||
      terminal[1] === null
    )
      return;
    const currentMap = parseL4d2MapName(
      analyses[index]?.engineResult.demo.mapName ?? "",
    );
    const nextMap = parseL4d2MapName(
      analyses[index + 1]?.engineResult.demo.mapName ?? "",
    );
    const adjacentChapter = Boolean(
      currentMap &&
        nextMap &&
        currentMap.campaignCode === nextMap.campaignCode &&
        nextMap.chapter === currentMap.chapter + 1,
    );
    const nextOpening = adjacentChapter
      ? stats[index + 1]?.match?.scoreTimeline?.[0]?.campaignScores
      : undefined;
    const confirmedByNext = Boolean(
      nextOpening &&
        nextOpening.length >= 2 &&
        nextOpening[0] !== null &&
        nextOpening[1] !== null,
    );
    const confirmedInDemo = (value.match?.roundEnds ?? 0) >= 2;
    const complete = confirmedByNext || confirmedInDemo;
    const liveBoundary = confirmedInDemo
      ? terminalBoundaryFromLiveScores(value)
      : null;
    const recoveredFromLiveScore = Boolean(
      liveBoundary?.some((score, team) => score > terminal[team]!),
    );
    const boundary = confirmedByNext
      ? nextOpening!
      : liveBoundary
        ? terminal.map((score, team) => Math.max(score!, liveBoundary[team]!))
        : terminal;
    const teamA = boundary[0]!;
    const teamB = complete ? boundary[1]! : null;
    rows.push({
      demoSha256: analyses[index]?.demoSha256 ?? `map-${index + 1}`,
      mapName: analyses[index]?.engineResult.demo.mapName ?? `Map ${index + 1}`,
      teamA,
      teamB,
      chapterA: Math.max(0, teamA - previousComplete[0]!),
      chapterB:
        teamB === null ? null : Math.max(0, teamB - previousComplete[1]!),
      complete,
      confirmation: confirmedByNext
        ? "next-map-opening"
        : recoveredFromLiveScore
          ? "live-survivor-score"
          : confirmedInDemo
            ? "two-round-demo"
            : "partial-terminal",
    });
    if (complete) previousComplete = [teamA, teamB ?? previousComplete[1]!];
  });
  return rows;
}
