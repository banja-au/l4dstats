import { sha256, type WorkbenchRepository } from "@witchwatch/storage";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    .join(",")}}`;
}
export function exportReport(
  repo: WorkbenchRepository,
  caseId: string,
): { manifest: unknown; sha256: string; canonicalJson: string } {
  const item = repo.getCase(caseId);
  if (!item) throw new Error("case not found");
  const manifest = {
    schemaVersion: 1,
    case: {
      id: item.id,
      playerKey: item.playerKey,
      status: item.status,
      score: JSON.parse(item.scoreJson),
    },
    lineage: repo.getCaseLineage(caseId),
    presentation: repo.getCasePresentation(caseId),
    reviewNotes: repo.listNotes(caseId),
    auditEvents: repo.auditEvents(caseId),
  };
  const canonicalJson = canonical(manifest);
  return { manifest, sha256: sha256(canonicalJson), canonicalJson };
}
