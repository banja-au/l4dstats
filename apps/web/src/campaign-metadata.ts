import type { JobAnalysis } from "./api";

export const OFFICIAL_L4D2_CAMPAIGNS = {
  c1: "Dead Center",
  c2: "Dark Carnival",
  c3: "Swamp Fever",
  c4: "Hard Rain",
  c5: "The Parish",
  c6: "The Passing",
  c7: "The Sacrifice",
  c8: "No Mercy",
  c9: "Crash Course",
  c10: "Death Toll",
  c11: "Dead Air",
  c12: "Blood Harvest",
  c13: "Cold Stream",
  c14: "The Last Stand",
} as const;

export type OfficialCampaignCode = keyof typeof OFFICIAL_L4D2_CAMPAIGNS;

export interface L4d2MapMetadata {
  campaignCode: string;
  campaignName: string | null;
  chapter: number;
}

export function parseL4d2MapName(mapName: string): L4d2MapMetadata | null {
  const basename = mapName.trim().split(/[\\/]/).at(-1) ?? "";
  const match = /^(c\d+)m(\d+)(?:_|$)/i.exec(basename);
  if (!match) return null;

  const campaignCode = match[1]!.toLowerCase();
  const chapter = Number.parseInt(match[2]!, 10);
  if (!Number.isSafeInteger(chapter) || chapter < 1) return null;

  return {
    campaignCode,
    campaignName:
      OFFICIAL_L4D2_CAMPAIGNS[campaignCode as OfficialCampaignCode] ?? null,
    chapter,
  };
}

function analysisChapter(analysis: JobAnalysis): number | null {
  return (
    parseL4d2MapName(analysis.engineResult.demo.mapName)?.chapter ??
    analysis.engineResult.demo.session?.chapter ??
    null
  );
}

/**
 * Orders maps by their embedded cXmY chapter. Array position is the final,
 * stable fallback because server counters can be discontinuous or unavailable.
 */
export function orderGameAnalyses(analyses: JobAnalysis[]): JobAnalysis[] {
  return analyses
    .map((analysis, index) => ({ analysis, index }))
    .sort((left, right) => {
      const leftChapter = analysisChapter(left.analysis);
      const rightChapter = analysisChapter(right.analysis);
      if (leftChapter !== null && rightChapter !== null)
        return leftChapter - rightChapter || left.index - right.index;
      if (leftChapter !== null) return -1;
      if (rightChapter !== null) return 1;
      return left.index - right.index;
    })
    .map(({ analysis }) => analysis);
}

export function gameCampaignName(analyses: JobAnalysis[]): string | null {
  for (const analysis of analyses) {
    const metadata = parseL4d2MapName(analysis.engineResult.demo.mapName);
    if (metadata?.campaignName) return metadata.campaignName;
  }
  return null;
}
