export interface Prediction {
  readonly playerKey: string;
  readonly probability: number;
  readonly label: 0 | 1;
}
export interface ReliabilityBin {
  readonly lower: number;
  readonly upper: number;
  readonly count: number;
  readonly meanPrediction: number | null;
  readonly observedRate: number | null;
}
export interface PrPoint {
  readonly threshold: number;
  readonly precision: number;
  readonly recall: number;
  readonly truePositive: number;
  readonly falsePositive: number;
}

const checked = (rows: readonly Prediction[]): void => {
  if (rows.length === 0) throw new RangeError("predictions are empty");
  for (const row of rows)
    if (
      !Number.isFinite(row.probability) ||
      row.probability < 0 ||
      row.probability > 1
    )
      throw new RangeError("probability must be in [0,1]");
};
export const brierScore = (rows: readonly Prediction[]): number => {
  checked(rows);
  return (
    rows.reduce((s, r) => s + (r.probability - r.label) ** 2, 0) / rows.length
  );
};
export const logLoss = (rows: readonly Prediction[]): number => {
  checked(rows);
  const e = 1e-15;
  return (
    -rows.reduce(
      (s, r) =>
        s +
        r.label * Math.log(Math.max(e, r.probability)) +
        (1 - r.label) * Math.log(Math.max(e, 1 - r.probability)),
      0,
    ) / rows.length
  );
};
export const reliability = (
  rows: readonly Prediction[],
  binCount = 10,
): {
  readonly bins: readonly ReliabilityBin[];
  readonly ece: number;
  readonly maximumGap: number;
} => {
  checked(rows);
  if (!Number.isInteger(binCount) || binCount <= 0)
    throw new RangeError("binCount must be positive");
  const bins: ReliabilityBin[] = [];
  let ece = 0,
    maximumGap = 0;
  for (let i = 0; i < binCount; i++) {
    const members = rows.filter(
      (r) => Math.min(binCount - 1, Math.floor(r.probability * binCount)) === i,
    );
    const meanPrediction = members.length
      ? members.reduce((s, r) => s + r.probability, 0) / members.length
      : null;
    const observedRate = members.length
      ? members.reduce((s, r) => s + r.label, 0) / members.length
      : null;
    if (meanPrediction !== null && observedRate !== null) {
      const gap = Math.abs(meanPrediction - observedRate);
      ece += (gap * members.length) / rows.length;
      maximumGap = Math.max(maximumGap, gap);
    }
    bins.push({
      lower: i / binCount,
      upper: (i + 1) / binCount,
      count: members.length,
      meanPrediction,
      observedRate,
    });
  }
  return { bins, ece, maximumGap };
};
export const precisionRecallCurve = (
  rows: readonly Prediction[],
): readonly PrPoint[] => {
  checked(rows);
  const sorted = [...rows].sort(
    (a, b) =>
      b.probability - a.probability || a.playerKey.localeCompare(b.playerKey),
  );
  const positives = sorted.reduce((s, r) => s + r.label, 0);
  let tp = 0,
    fp = 0;
  const output: PrPoint[] = [];
  for (let i = 0; i < sorted.length; ) {
    const threshold = sorted[i]!.probability;
    let j = i;
    while (j < sorted.length && sorted[j]!.probability === threshold) {
      if (sorted[j]!.label) tp++;
      else fp++;
      j++;
    }
    output.push({
      threshold,
      precision: tp / (tp + fp),
      recall: positives ? tp / positives : 0,
      truePositive: tp,
      falsePositive: fp,
    });
    i = j;
  }
  return output;
};
export const falsePositivesPer1000 = (
  rows: readonly Prediction[],
  threshold: number,
): number => {
  checked(rows);
  const negative = rows.filter((r) => r.label === 0);
  if (!negative.length)
    throw new RangeError("false-positive rate requires negative players");
  return (
    (negative.filter((r) => r.probability >= threshold).length /
      negative.length) *
    1000
  );
};
export const prevalenceAwarePpv = (
  sensitivity: number,
  specificity: number,
  prevalence: number,
): number | null => {
  for (const [n, v] of [
    ["sensitivity", sensitivity],
    ["specificity", specificity],
    ["prevalence", prevalence],
  ] as const)
    if (!Number.isFinite(v) || v < 0 || v > 1)
      throw new RangeError(`${n} must be in [0,1]`);
  const denominator =
    sensitivity * prevalence + (1 - specificity) * (1 - prevalence);
  return denominator === 0 ? null : (sensitivity * prevalence) / denominator;
};

const rng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};
export const playerBootstrap = (
  rows: readonly Prediction[],
  statistic: (sample: readonly Prediction[]) => number,
  options: {
    readonly replicates: number;
    readonly seed: number;
    readonly level: number;
  },
): {
  readonly lower: number;
  readonly upper: number;
  readonly level: number;
  readonly values: readonly number[];
} => {
  checked(rows);
  if (
    !Number.isInteger(options.replicates) ||
    options.replicates <= 0 ||
    !(options.level > 0 && options.level < 1)
  )
    throw new RangeError("invalid bootstrap options");
  const groups = [...new Set(rows.map((r) => r.playerKey))].sort();
  const byPlayer = new Map(
    groups.map((key) => [key, rows.filter((r) => r.playerKey === key)]),
  );
  const random = rng(options.seed);
  const values: number[] = [];
  for (let n = 0; n < options.replicates; n++) {
    const sample: Prediction[] = [];
    for (let i = 0; i < groups.length; i++)
      sample.push(
        ...byPlayer.get(groups[Math.floor(random() * groups.length)]!)!,
      );
    values.push(statistic(sample));
  }
  values.sort((a, b) => a - b);
  const alpha = (1 - options.level) / 2;
  return {
    lower: values[Math.floor(alpha * (values.length - 1))]!,
    upper: values[Math.ceil((1 - alpha) * (values.length - 1))]!,
    level: options.level,
    values,
  };
};
