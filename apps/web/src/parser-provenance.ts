import type { JobAnalysis } from "./api";

export function parserProvenanceLabel(
  analyses: readonly JobAnalysis[],
): string {
  const labels = new Set(
    analyses.map((analysis) => {
      const parser = analysis.engineResult.demo.parser;
      if (!parser) return "Legacy analysis · parser provenance unavailable";
      if ((parser as { engine?: unknown }).engine !== "rust-native")
        return "Legacy analysis · unsupported parser provenance";
      return `Rust native ${parser.coreVersion} · build ${parser.buildSha256?.slice(0, 8) ?? "unavailable"}`;
    }),
  );
  return labels.size === 1
    ? [...labels][0]!
    : "Mixed parser lineage · inspect individual analyses";
}
