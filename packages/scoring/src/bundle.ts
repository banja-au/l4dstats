import { createHash } from "node:crypto";
import type { HashedBundle, ModelBundle } from "./types.js";

const normalized = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalized);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, normalized(v)]),
    );
  if (typeof value === "number" && !Number.isFinite(value))
    throw new TypeError("bundle contains a non-finite number");
  return value;
};
export const canonicalJson = (value: unknown): string =>
  `${JSON.stringify(normalized(value), null, 2)}\n`;
export const hashBytes = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
export const hashBundle = (bundle: ModelBundle): HashedBundle => {
  const json = canonicalJson(bundle);
  return { sha256: hashBytes(json), json, bundle };
};
export const verifyBundle = (
  expectedSha256: string,
  json: string,
): ModelBundle => {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256))
    throw new TypeError("invalid expected bundle hash");
  if (hashBytes(json) !== expectedSha256)
    throw new Error("model bundle hash mismatch");
  const value = JSON.parse(json) as ModelBundle;
  if (
    value.schemaVersion !== 1 ||
    value.controlledFixtureOnly !== true ||
    typeof value.operatingPointAccepted !== "boolean" ||
    !value.limitations.includes("research-only") ||
    !value.limitations.includes("reference-validation-pending")
  )
    throw new Error("invalid or unsafe model bundle");
  if (
    value.lineage?.scoreContractVersion !== 1 ||
    !/^[a-f0-9]{64}$/.test(value.lineage.splitManifestSha256) ||
    value.lineage.reproductionCommand !== "pnpm scoring:evaluate" ||
    !value.lineage.featureConfigVersion ||
    !value.lineage.sourceRevision ||
    !value.lineage.runtime ||
    Object.keys(value.lineage.dependencies ?? {}).length === 0
  )
    throw new Error("model bundle lineage is incomplete");
  if (
    value.logistic.coefficients.length !== value.logistic.features.length ||
    !Number.isFinite(value.logistic.intercept) ||
    value.logistic.coefficients.some(
      (coefficient) => !Number.isFinite(coefficient),
    ) ||
    !Number.isFinite(value.platt.slope) ||
    value.platt.slope < 0 ||
    !Number.isFinite(value.platt.intercept)
  )
    throw new Error("invalid model parameters");
  return value;
};
