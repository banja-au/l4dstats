import {
  createAimDetector,
  createAwarenessDetector,
  DetectorRegistry,
  fireCadenceDetector,
  movementDetector,
  segmentEncounters,
  type DetectorContext,
  type DetectorResult,
} from "@witchwatch/detectors";

export interface FeatureRequest {
  readonly detectorId: string;
  readonly detectorVersion: string;
  readonly context: DetectorContext;
  readonly input: unknown;
  readonly maximumEncounterTickGap?: number;
}

const defaultRegistry = (): DetectorRegistry =>
  new DetectorRegistry()
    .register(createAimDetector())
    .register(createAwarenessDetector())
    .register(fireCadenceDetector)
    .register(movementDetector);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseFeatureRequest = (value: unknown): FeatureRequest => {
  if (!isRecord(value))
    throw new TypeError("feature request must be an object");
  if (
    typeof value.detectorId !== "string" ||
    typeof value.detectorVersion !== "string"
  )
    throw new TypeError("detectorId and detectorVersion must be strings");
  if (
    !isRecord(value.context) ||
    typeof value.context.playerEpochId !== "string" ||
    !isRecord(value.context.provenance)
  )
    throw new TypeError("context must contain playerEpochId and provenance");
  const provenance = value.context.provenance;
  for (const key of ["demoSha256", "observationArtifactSha256", "configSha256"])
    if (typeof provenance[key] !== "string")
      throw new TypeError(`context.provenance.${key} must be a string`);
  if (typeof provenance.observationSchemaVersion !== "number")
    throw new TypeError(
      "context.provenance.observationSchemaVersion must be a number",
    );
  if (
    value.maximumEncounterTickGap !== undefined &&
    (typeof value.maximumEncounterTickGap !== "number" ||
      !Number.isInteger(value.maximumEncounterTickGap) ||
      value.maximumEncounterTickGap < 0)
  )
    throw new TypeError(
      "maximumEncounterTickGap must be a non-negative integer",
    );
  return value as unknown as FeatureRequest;
};

export const exploreFeatures = (
  request: FeatureRequest,
): DetectorResult & {
  readonly encounters: ReturnType<typeof segmentEncounters>;
} => {
  const detector = defaultRegistry().get(
    request.detectorId,
    request.detectorVersion,
  );
  if (!detector)
    throw new RangeError(
      `unknown detector ${request.detectorId}@${request.detectorVersion}`,
    );
  const result = detector.run(request.input, request.context);
  return {
    ...result,
    encounters: segmentEncounters(
      result.evidence,
      request.maximumEncounterTickGap ?? 2,
    ),
  };
};

export const detectorCards = () => defaultRegistry().cards();
