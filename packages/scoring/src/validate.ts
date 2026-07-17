import type { ModelRow, ScoringEvidence } from "./types.js";

export const finite = (value: number, name: string): number => {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
};

export const validateEvidence = (items: readonly ScoringEvidence[]): void => {
  const detectorVersions = new Map<string, string>();
  for (const item of items) {
    if (!item.id || !item.playerKey || !item.encounterId || !item.demoSha256)
      throw new TypeError("evidence identifiers must be non-empty");
    finite(item.strength, "strength");
    if (item.strength < 0)
      throw new RangeError("strength must be non-negative");
    for (const [name, value] of [
      ["quality", item.quality],
      ["reconstructionQuality", item.reconstructionQuality],
    ] as const)
      if (finite(value, name) < 0 || value > 1)
        throw new RangeError(`${name} must be in [0,1]`);
    if (
      !Number.isInteger(item.tickRange.start) ||
      !Number.isInteger(item.tickRange.end) ||
      item.tickRange.start < 0 ||
      item.tickRange.end < item.tickRange.start
    )
      throw new RangeError("tick range is invalid");
    const priorVersion = detectorVersions.get(item.detectorId);
    if (priorVersion && priorVersion !== item.detectorVersion)
      throw new Error(`mixed detector versions for ${item.detectorId}`);
    detectorVersions.set(item.detectorId, item.detectorVersion);
  }
};

export const validateSplitIsolation = (rows: readonly ModelRow[]): void => {
  if (rows.length === 0) throw new RangeError("dataset is empty");
  const player = new Map<string, ModelRow["split"]>();
  const strata = new Map<string, ModelRow["split"]>();
  const fixtureFamilies = new Map<string, ModelRow["split"]>();
  const playerKeys = new Set<string>();
  const splits = new Set<ModelRow["split"]>(["train", "calibration", "test"]);
  const provenance = new Set<ModelRow["labelProvenance"]>([
    "controlled-configuration",
    "consented-clean",
    "blinded-review",
    "synthetic-controlled",
  ]);
  for (const row of rows) {
    if (
      !row.playerKey ||
      !row.playerGroupId ||
      !row.fixtureFamilyId ||
      !row.serverId ||
      !row.timeBucket
    )
      throw new TypeError("dataset identifiers must be non-empty");
    if (playerKeys.has(row.playerKey))
      throw new Error(`duplicate player row: ${row.playerKey}`);
    playerKeys.add(row.playerKey);
    if (!splits.has(row.split))
      throw new TypeError("unsupported dataset split");
    if (row.label !== 0 && row.label !== 1)
      throw new TypeError("controlled label must be 0 or 1");
    if (!provenance.has(row.labelProvenance))
      throw new TypeError("unsupported label provenance");
    if (Object.keys(row.features).length === 0)
      throw new TypeError("player feature record is empty");
    const priorPlayer = player.get(row.playerGroupId);
    if (priorPlayer && priorPlayer !== row.split)
      throw new Error(`player split leakage: ${row.playerGroupId}`);
    player.set(row.playerGroupId, row.split);
    const priorFixtureFamily = fixtureFamilies.get(row.fixtureFamilyId);
    if (priorFixtureFamily && priorFixtureFamily !== row.split)
      throw new Error(`fixture-family split leakage: ${row.fixtureFamilyId}`);
    fixtureFamilies.set(row.fixtureFamilyId, row.split);
    const stratum = `${row.serverId}\u0000${row.timeBucket}`;
    const priorStratum = strata.get(stratum);
    if (priorStratum && priorStratum !== row.split)
      throw new Error(
        `server/time split leakage: ${row.serverId}/${row.timeBucket}`,
      );
    strata.set(stratum, row.split);
    for (const [id, value] of Object.entries(row.features))
      finite(value, `feature ${id}`);
  }
};
