import {
  present,
  evidenceSchemaVersion,
  provenanceFor,
  skipped,
  type Detector,
  type DetectorCard,
  type DetectorContext,
  type DetectorResult,
  type Field,
} from "./types.js";

export interface InformationAudit {
  readonly tick: number;
  readonly alignmentDegrees: Field<number>;
  readonly lineOfSight: Field<boolean>;
  readonly lineOfSightAuthority: Field<"bsp-trace" | "engine-event">;
  readonly audible: Field<boolean>;
  readonly previouslyKnown: Field<boolean>;
  readonly dynamicOccludersResolved: Field<boolean>;
}

export const awarenessCard: DetectorCard = {
  id: "hidden-alignment",
  version: "1.0.0",
  title: "Audited hidden-target alignment",
  kind: "awareness",
  prerequisites: [
    "authoritative line-of-sight trace",
    "dynamic occluder resolution",
    "audibility audit",
    "prior-information audit",
    "target alignment",
  ],
  failureModes: [
    "missing map collision",
    "unmodeled callouts",
    "sound propagation differs from distance",
    "target-selection ambiguity",
  ],
  interpretation:
    "Surfaces close alignment only after the recorded information channels have been explicitly ruled out.",
};

export const createAwarenessDetector = (
  maximumAlignmentDegrees = 3,
): Detector<readonly InformationAudit[]> => ({
  card: awarenessCard,
  run(audits, context): DetectorResult {
    if (audits.length === 0)
      return skipped(
        awarenessCard.id,
        "empty-input",
        "No information-audit samples were supplied.",
      );
    const required = [
      "alignmentDegrees",
      "lineOfSight",
      "lineOfSightAuthority",
      "audible",
      "previouslyKnown",
      "dynamicOccludersResolved",
    ] as const;
    const complete = audits.filter((audit) =>
      required.every(
        (key) =>
          audit[key].availability !== "unavailable" &&
          audit[key].value !== undefined,
      ),
    );
    const missing = required.filter((key) =>
      audits.some(
        (audit) =>
          audit[key].availability === "unavailable" ||
          audit[key].value === undefined,
      ),
    );
    if (complete.length === 0)
      return skipped(
        awarenessCard.id,
        "missing-prerequisite",
        "No sample has a complete authoritative visibility and information audit.",
        missing,
      );
    const candidates = complete.filter(
      (a) =>
        !a.lineOfSight.value &&
        a.dynamicOccludersResolved.value &&
        !a.audible.value &&
        !a.previouslyKnown.value &&
        a.alignmentDegrees.value! <= maximumAlignmentDegrees,
    );
    if (candidates.length === 0)
      return skipped(
        awarenessCard.id,
        "no-candidate",
        "No close hidden alignment remained after the authoritative information audit.",
        missing,
      );
    return {
      evidence: candidates.map((audit) => ({
        schemaVersion: evidenceSchemaVersion,
        id: `${awarenessCard.id}:${context.playerEpochId}:${audit.tick}`,
        playerEpochId: context.playerEpochId,
        kind: "awareness",
        tickRange: { start: audit.tick, end: audit.tick },
        rawFeatures: {
          alignmentDegrees: audit.alignmentDegrees.value!,
          lineOfSight: false,
          lineOfSightAuthority: audit.lineOfSightAuthority.value!,
          audible: false,
          previouslyKnown: false,
          dynamicOccludersResolved: true,
        },
        effect: {
          value: maximumAlignmentDegrees - audit.alignmentDegrees.value!,
          unit: "degrees inside audit boundary",
          baseline: `${maximumAlignmentDegrees} degree exploratory boundary`,
        },
        contributionPlaceholder: null,
        quality: {
          value: 0.85,
          basis: [
            "authoritative visibility source",
            "audibility and prior knowledge audited",
            "dynamic occluders resolved",
          ],
        },
        explanation: `View alignment was ${audit.alignmentDegrees.value!.toFixed(2)}° from a target while the recorded visibility, audibility, and prior-knowledge channels were negative.`,
        limitations: awarenessCard.failureModes,
        counterevidence: [
          "Team voice communication is not represented.",
          "Coincidental crosshair placement remains plausible.",
          "A single audited alignment is weak evidence.",
        ],
        provenance: provenanceFor(context, awarenessCard),
      })),
      skipped: missing.length
        ? [
            {
              detectorId: awarenessCard.id,
              code: "missing-prerequisite",
              explanation: "Incomplete audit samples were excluded.",
              unavailableFields: missing,
            },
          ]
        : [],
    };
  },
});
