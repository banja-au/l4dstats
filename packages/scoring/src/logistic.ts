import type {
  FeatureSpec,
  LogisticModel,
  ModelRow,
  PlattModel,
  TrainingConfig,
} from "./types.js";

export const sigmoid = (x: number): number =>
  x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));

export const stableLogLoss = (logit: number, label: 0 | 1): number =>
  Math.max(logit, 0) - logit * label + Math.log1p(Math.exp(-Math.abs(logit)));

const values = (row: ModelRow, specs: readonly FeatureSpec[]): number[] =>
  specs.map((spec) => {
    const value = row.features[spec.id];
    if (value === undefined) {
      throw new Error(`missing feature ${spec.id}; values are never imputed`);
    }
    if (!Number.isFinite(value))
      throw new TypeError(`feature ${spec.id} must be finite`);
    return (
      (Math.min(spec.maximum, Math.max(spec.minimum, value)) - spec.mean) /
      spec.scale
    );
  });

export const fitLogistic = (
  rows: readonly ModelRow[],
  specs: readonly FeatureSpec[],
  config: TrainingConfig,
): LogisticModel => {
  if (rows.length === 0) throw new RangeError("training rows are empty");
  if (
    !Number.isInteger(config.iterations) ||
    config.iterations <= 0 ||
    !(config.learningRate > 0) ||
    config.l2 < 0
  )
    throw new RangeError("invalid training config");
  for (const spec of specs)
    if (!(spec.scale > 0) || !Number.isFinite(spec.scale))
      throw new RangeError(`invalid scale for ${spec.id}`);
  const ordered = [...rows].sort((a, b) =>
    a.playerKey.localeCompare(b.playerKey),
  );
  let intercept = 0;
  const coefficients = specs.map(() => 0);
  for (let iteration = 0; iteration < config.iterations; iteration++) {
    let interceptGradient = 0;
    const gradients = coefficients.map(() => 0);
    for (const row of ordered) {
      const xs = values(row, specs);
      const logit =
        intercept + xs.reduce((sum, x, i) => sum + x * coefficients[i]!, 0);
      const error = sigmoid(logit) - row.label;
      interceptGradient += error;
      for (let i = 0; i < gradients.length; i++)
        gradients[i] = gradients[i]! + error * xs[i]!;
    }
    intercept -= (config.learningRate * interceptGradient) / ordered.length;
    for (let i = 0; i < coefficients.length; i++)
      coefficients[i] =
        coefficients[i]! -
        config.learningRate *
          (gradients[i]! / ordered.length + config.l2 * coefficients[i]!);
  }
  return { intercept, coefficients, features: [...specs] };
};

export const rawLogit = (
  model: LogisticModel,
  features: Readonly<Record<string, number>>,
): number => {
  const row: ModelRow = {
    playerKey: "apply",
    playerGroupId: "apply",
    fixtureFamilyId: "apply",
    serverId: "apply",
    timeBucket: "apply",
    split: "test",
    features,
    label: 0,
    labelProvenance: "synthetic-controlled",
  };
  return (
    model.intercept +
    values(row, model.features).reduce(
      (sum, x, i) => sum + x * model.coefficients[i]!,
      0,
    )
  );
};

export const fitPlatt = (
  logits: readonly number[],
  labels: readonly (0 | 1)[],
  config: TrainingConfig,
): PlattModel => {
  if (logits.length === 0 || logits.length !== labels.length)
    throw new RangeError(
      "calibration arrays must be non-empty and equal length",
    );
  let slope = 1,
    intercept = 0;
  for (let iteration = 0; iteration < config.iterations; iteration++) {
    let gs = 0,
      gi = 0;
    for (let i = 0; i < logits.length; i++) {
      if (!Number.isFinite(logits[i]!))
        throw new TypeError("calibration logit must be finite");
      const error = sigmoid(slope * logits[i]! + intercept) - labels[i]!;
      gs += error * logits[i]!;
      gi += error;
    }
    slope = Math.max(0, slope - (config.learningRate * gs) / logits.length);
    intercept -= (config.learningRate * gi) / logits.length;
  }
  return { slope, intercept };
};

export const calibratedProbability = (
  platt: PlattModel,
  logit: number,
): number => sigmoid(platt.slope * logit + platt.intercept);
