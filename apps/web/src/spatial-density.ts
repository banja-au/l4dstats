export interface DensityBounds {
  min: { x: number; y: number };
  max: { x: number; y: number };
}

export interface DensityPoint {
  x: number;
  y: number;
}

export interface NormalizedDensityGrid {
  columns: number;
  rows: number;
  values: Float32Array;
  maximum: number;
  sampleCount: number;
}

/**
 * A bounded Gaussian KDE in Source world coordinates. Each cohort contributes
 * total weight 1, so duplicating every sample does not make a cohort brighter.
 */
export function buildNormalizedDensityGrid(
  points: readonly DensityPoint[],
  bounds: DensityBounds,
  columns: number,
  rows: number,
  bandwidthUnits: number,
): NormalizedDensityGrid {
  if (columns < 1 || rows < 1 || bandwidthUnits <= 0)
    throw new RangeError(
      "density grid dimensions and bandwidth must be positive",
    );
  const values = new Float32Array(columns * rows);
  if (!points.length)
    return { columns, rows, values, maximum: 0, sampleCount: 0 };
  const width = Math.max(1, bounds.max.x - bounds.min.x);
  const height = Math.max(1, bounds.max.y - bounds.min.y);
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  const cutoff = bandwidthUnits * 3;
  const inverseTwoSigmaSquared = 1 / (2 * bandwidthUnits * bandwidthUnits);
  const sampleWeight = 1 / points.length;
  for (const point of points) {
    const minColumn = Math.max(
      0,
      Math.floor((point.x - cutoff - bounds.min.x) / cellWidth),
    );
    const maxColumn = Math.min(
      columns - 1,
      Math.ceil((point.x + cutoff - bounds.min.x) / cellWidth),
    );
    const minRow = Math.max(
      0,
      Math.floor((point.y - cutoff - bounds.min.y) / cellHeight),
    );
    const maxRow = Math.min(
      rows - 1,
      Math.ceil((point.y + cutoff - bounds.min.y) / cellHeight),
    );
    for (let row = minRow; row <= maxRow; row += 1) {
      const y = bounds.min.y + (row + 0.5) * cellHeight;
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const x = bounds.min.x + (column + 0.5) * cellWidth;
        const distanceSquared = (x - point.x) ** 2 + (y - point.y) ** 2;
        const index = row * columns + column;
        values[index] =
          (values[index] ?? 0) +
          Math.exp(-distanceSquared * inverseTwoSigmaSquared) * sampleWeight;
      }
    }
  }
  let maximum = 0;
  for (const value of values) maximum = Math.max(maximum, value);
  return { columns, rows, values, maximum, sampleCount: points.length };
}

export function densityDifference(
  left: NormalizedDensityGrid,
  right: NormalizedDensityGrid,
): Float32Array {
  if (
    left.columns !== right.columns ||
    left.rows !== right.rows ||
    left.values.length !== right.values.length
  )
    throw new RangeError("density grids must have identical dimensions");
  return Float32Array.from(
    left.values,
    (value, index) => value - (right.values[index] ?? 0),
  );
}
