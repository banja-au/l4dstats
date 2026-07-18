import type { MapVector3 } from "./index.js";

export interface CoordinateBounds {
  readonly min: MapVector3;
  readonly max: MapVector3;
}

export function measureCoordinateAlignment(
  points: readonly MapVector3[],
  bounds: CoordinateBounds,
) {
  let inside = 0;
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const point of points) {
    for (const axis of ["x", "y", "z"] as const) {
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
    if (
      point.x >= bounds.min.x &&
      point.x <= bounds.max.x &&
      point.y >= bounds.min.y &&
      point.y <= bounds.max.y &&
      point.z >= bounds.min.z &&
      point.z <= bounds.max.z
    )
      inside++;
  }
  return {
    observed: points.length,
    inside,
    insideRate: points.length === 0 ? null : inside / points.length,
    observedBounds: points.length === 0 ? null : { min, max },
  };
}
