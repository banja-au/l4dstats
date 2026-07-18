import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface InstalledCampaignBsp {
  readonly map: string;
  readonly path: string;
  readonly contentRoot: string;
}

export const officialCampaignChapterCount = 57;

const CONTENT_ROOTS_BY_PRECEDENCE = [
  "update",
  "left4dead2_dlc3",
  "left4dead2_dlc2",
  "left4dead2_dlc1",
  "left4dead2",
] as const;

const CHAPTERS_PER_OFFICIAL_CAMPAIGN = new Map<number, number>([
  [1, 4],
  [2, 5],
  [3, 4],
  [4, 5],
  [5, 5],
  [6, 3],
  [7, 3],
  [8, 5],
  [9, 2],
  [10, 5],
  [11, 5],
  [12, 5],
  [13, 4],
  [14, 2],
]);

/** Select only the c1-c14 campaign chapter namespace shipped by L4D2. */
export function isOfficialCampaignBsp(filename: string): boolean {
  const match = /^c([0-9]+)m([0-9]+)_[a-z0-9_]+\.bsp$/i.exec(filename);
  if (!match || filename.toLowerCase().endsWith("_sndscape.bsp")) return false;
  const campaign = Number(match[1]);
  const chapter = Number(match[2]);
  const chapterCount = CHAPTERS_PER_OFFICIAL_CAMPAIGN.get(campaign);
  return chapterCount !== undefined && chapter >= 1 && chapter <= chapterCount;
}

/**
 * Resolve installed campaign BSPs using the SearchPaths precedence declared by
 * the stock L4D2 gameinfo: update, DLC3, DLC2, DLC1, then the base game.
 */
export async function discoverInstalledCampaignBsps(
  installationArgument: string,
): Promise<readonly InstalledCampaignBsp[]> {
  const installation = resolve(installationArgument);
  const selected = new Map<string, InstalledCampaignBsp>();
  for (const contentRoot of CONTENT_ROOTS_BY_PRECEDENCE) {
    const maps = join(installation, contentRoot, "maps");
    let entries;
    try {
      entries = await readdir(maps, { withFileTypes: true });
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      )
        continue;
      throw error;
    }
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (!entry.isFile() || !isOfficialCampaignBsp(entry.name)) continue;
      const map = entry.name.slice(0, -4).toLowerCase();
      if (!selected.has(map))
        selected.set(map, {
          map,
          path: join(maps, entry.name),
          contentRoot,
        });
    }
  }
  return [...selected.values()].sort((left, right) =>
    left.map.localeCompare(right.map, "en", { numeric: true }),
  );
}

export function assertCompleteOfficialCampaignInstallation(
  sources: readonly InstalledCampaignBsp[],
): void {
  const keys = new Map<string, string>();
  for (const source of sources) {
    const match = /^c([0-9]+)m([0-9]+)_/.exec(source.map);
    if (!match) throw new RangeError(`invalid official map name ${source.map}`);
    const key = `c${Number(match[1])}m${Number(match[2])}`;
    const existing = keys.get(key);
    if (existing && existing !== source.map)
      throw new RangeError(
        `official chapter ${key} resolves to both ${existing} and ${source.map}`,
      );
    keys.set(key, source.map);
  }
  const missing: string[] = [];
  for (const [campaign, chapterCount] of CHAPTERS_PER_OFFICIAL_CAMPAIGN)
    for (let chapter = 1; chapter <= chapterCount; chapter++) {
      const key = `c${campaign}m${chapter}`;
      if (!keys.has(key)) missing.push(key);
    }
  if (missing.length > 0 || keys.size !== officialCampaignChapterCount)
    throw new RangeError(
      `official campaign installation is incomplete; missing ${missing.join(", ") || "unknown chapters"}`,
    );
}
