export interface Vector2 {
  readonly x: number;
  readonly y: number;
}
export interface Vector3 extends Vector2 {
  readonly z: number;
}

const EPSILON = 1e-9;
export const add = (a: Vector3, b: Vector3): Vector3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});
export const subtract = (a: Vector3, b: Vector3): Vector3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
export const scale = (v: Vector3, factor: number): Vector3 => ({
  x: v.x * factor,
  y: v.y * factor,
  z: v.z * factor,
});
export const dot = (a: Vector3, b: Vector3): number =>
  a.x * b.x + a.y * b.y + a.z * b.z;
export const magnitude = (v: Vector3): number => Math.hypot(v.x, v.y, v.z);
export const distance = (a: Vector3, b: Vector3): number =>
  magnitude(subtract(a, b));
export const normalize = (v: Vector3): Vector3 | undefined => {
  const n = magnitude(v);
  return n <= EPSILON ? undefined : scale(v, 1 / n);
};
export const normalizeDegrees = (degrees: number): number =>
  ((((degrees + 180) % 360) + 360) % 360) - 180;
export const angularDifference = (from: number, to: number): number =>
  normalizeDegrees(to - from);
export const directionFromAngles = (pitch: number, yaw: number): Vector3 => {
  const p = (pitch * Math.PI) / 180,
    y = (yaw * Math.PI) / 180,
    cp = Math.cos(p);
  return { x: cp * Math.cos(y), y: cp * Math.sin(y), z: -Math.sin(p) };
};

export interface Aabb {
  readonly min: Vector3;
  readonly max: Vector3;
}
export interface Segment {
  readonly start: Vector3;
  readonly end: Vector3;
}
export const validAabb = (box: Aabb): boolean =>
  box.min.x <= box.max.x && box.min.y <= box.max.y && box.min.z <= box.max.z;

/** Closed segment/AABB intersection using the slab method. Touching counts as intersection. */
export const segmentIntersectsAabb = (segment: Segment, box: Aabb): boolean => {
  if (!validAabb(box)) return false;
  const delta = subtract(segment.end, segment.start);
  let near = 0,
    far = 1;
  for (const axis of ["x", "y", "z"] as const) {
    const origin = segment.start[axis],
      direction = delta[axis];
    if (Math.abs(direction) <= EPSILON) {
      if (origin < box.min[axis] || origin > box.max[axis]) return false;
      continue;
    }
    let a = (box.min[axis] - origin) / direction,
      b = (box.max[axis] - origin) / direction;
    if (a > b) [a, b] = [b, a];
    near = Math.max(near, a);
    far = Math.min(far, b);
    if (near > far) return false;
  }
  return true;
};

export interface Occluder {
  readonly id: string;
  readonly bounds: Aabb;
  readonly active?: boolean;
}
export interface OcclusionScene {
  readonly staticOccluders?: readonly Occluder[];
  readonly dynamicOccluders?: readonly Occluder[];
  readonly staticGeometryAvailable: boolean;
  readonly dynamicStateAvailable: boolean;
  readonly assetVersion?: string;
}
export type VisibilityQuality = "authoritative" | "partial" | "unavailable";
export interface VisibilityResult {
  readonly visible?: boolean;
  readonly quality: VisibilityQuality;
  readonly blockedBy: readonly string[];
  readonly prerequisites: readonly string[];
  readonly limitations: readonly string[];
}
export const traceVisibility = (
  segment: Segment,
  scene: OcclusionScene,
): VisibilityResult => {
  if (
    ![segment.start, segment.end].every(
      (v) =>
        Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z),
    )
  )
    return {
      quality: "unavailable",
      blockedBy: [],
      prerequisites: ["finite endpoints"],
      limitations: ["invalid position telemetry"],
    };
  if (!scene.staticGeometryAvailable)
    return {
      quality: "unavailable",
      blockedBy: [],
      prerequisites: ["versioned static map geometry"],
      limitations: ["visibility was not inferred without map assets"],
    };
  if (!scene.assetVersion)
    return {
      quality: "unavailable",
      blockedBy: [],
      prerequisites: ["static map asset version"],
      limitations: [
        "unversioned geometry cannot support reproducible visibility",
      ],
    };
  const staticHits = (scene.staticOccluders ?? [])
    .filter(
      (o) => o.active !== false && segmentIntersectsAabb(segment, o.bounds),
    )
    .map((o) => o.id);
  const dynamicHits = scene.dynamicStateAvailable
    ? (scene.dynamicOccluders ?? [])
        .filter(
          (o) => o.active !== false && segmentIntersectsAabb(segment, o.bounds),
        )
        .map((o) => o.id)
    : [];
  const quality = scene.dynamicStateAvailable ? "authoritative" : "partial";
  return {
    visible: staticHits.length + dynamicHits.length === 0,
    quality,
    blockedBy: [...staticHits, ...dynamicHits],
    prerequisites: [
      "versioned static map geometry",
      ...(scene.dynamicStateAvailable ? ["dynamic occluder state"] : []),
    ],
    limitations: scene.dynamicStateAvailable
      ? []
      : ["doors and other dynamic occluders were unavailable"],
  };
};

export interface OverviewTransform {
  readonly origin: Vector2;
  readonly scale: number;
  readonly rotationDegrees?: number;
  readonly flipY?: boolean;
}
export const worldToOverview = (
  world: Vector2,
  transform: OverviewTransform,
): Vector2 => {
  if (!Number.isFinite(transform.scale) || transform.scale <= 0)
    throw new RangeError("overview scale must be positive and finite");
  const x = (world.x - transform.origin.x) / transform.scale,
    y = (world.y - transform.origin.y) / transform.scale;
  const angle = ((transform.rotationDegrees ?? 0) * Math.PI) / 180;
  const rotated = {
    x: x * Math.cos(angle) - y * Math.sin(angle),
    y: x * Math.sin(angle) + y * Math.cos(angle),
  };
  return { x: rotated.x, y: transform.flipY ? -rotated.y : rotated.y };
};
export const overviewToWorld = (
  point: Vector2,
  transform: OverviewTransform,
): Vector2 => {
  if (!Number.isFinite(transform.scale) || transform.scale <= 0)
    throw new RangeError("overview scale must be positive and finite");
  const y = transform.flipY ? -point.y : point.y;
  const angle = (-(transform.rotationDegrees ?? 0) * Math.PI) / 180;
  const x2 = point.x * Math.cos(angle) - y * Math.sin(angle),
    y2 = point.x * Math.sin(angle) + y * Math.cos(angle);
  return {
    x: x2 * transform.scale + transform.origin.x,
    y: y2 * transform.scale + transform.origin.y,
  };
};
export interface MapFloor {
  readonly id: string;
  readonly minZ: number;
  readonly maxZ: number;
  readonly transform: OverviewTransform;
}
export type FloorResult =
  | {
      readonly status: "resolved";
      readonly floor: MapFloor;
      readonly point: Vector2;
    }
  | { readonly status: "unavailable"; readonly reason: string }
  | { readonly status: "ambiguous"; readonly floorIds: readonly string[] };
export const locateFloor = (
  world: Vector3,
  floors: readonly MapFloor[],
): FloorResult => {
  const matches = floors.filter((f) => f.minZ <= world.z && world.z <= f.maxZ);
  if (matches.length === 0)
    return {
      status: "unavailable",
      reason: "position is outside all configured floor ranges",
    };
  if (matches.length > 1)
    return { status: "ambiguous", floorIds: matches.map((f) => f.id) };
  return {
    status: "resolved",
    floor: matches[0]!,
    point: worldToOverview(world, matches[0]!.transform),
  };
};

export interface TickClockSegment {
  readonly startTick: number;
  readonly endTick: number;
  readonly startDemoSeconds: number;
  readonly secondsPerTick: number;
  readonly paused?: boolean;
}
export type TickTimeResult =
  | {
      readonly status: "available";
      readonly demoSeconds: number;
      readonly quality: "observed" | "derived";
    }
  | { readonly status: "unavailable"; readonly reason: string };
export const tickToDemoTime = (
  tick: number,
  segments: readonly TickClockSegment[],
): TickTimeResult => {
  const segment = segments.find(
    (s) => s.startTick <= tick && tick <= s.endTick,
  );
  if (!segment)
    return {
      status: "unavailable",
      reason: "tick is outside known clock segments",
    };
  if (segment.paused)
    return {
      status: "available",
      demoSeconds: segment.startDemoSeconds,
      quality: "observed",
    };
  if (!(segment.secondsPerTick > 0) || !Number.isFinite(segment.secondsPerTick))
    return { status: "unavailable", reason: "tick interval is invalid" };
  return {
    status: "available",
    demoSeconds:
      segment.startDemoSeconds +
      (tick - segment.startTick) * segment.secondsPerTick,
    quality: "derived",
  };
};

export interface Sighting {
  readonly observerId: string;
  readonly targetId: string;
  readonly tick: number;
  readonly quality: VisibilityQuality;
}
export type KnowledgeResult = {
  readonly known: boolean;
  readonly quality: VisibilityQuality;
  readonly ageTicks?: number;
  readonly reason: string;
};
export const priorSightingKnowledge = (
  observerId: string,
  targetId: string,
  tick: number,
  memoryTicks: number,
  sightings: readonly Sighting[],
): KnowledgeResult => {
  if (
    !Number.isInteger(tick) ||
    !Number.isInteger(memoryTicks) ||
    memoryTicks < 0
  )
    return {
      known: false,
      quality: "unavailable",
      reason: "invalid tick or memory window",
    };
  const prior = sightings
    .filter(
      (s) =>
        s.observerId === observerId &&
        s.targetId === targetId &&
        s.tick <= tick &&
        s.quality !== "unavailable",
    )
    .sort((a, b) => b.tick - a.tick)[0];
  if (!prior)
    return {
      known: false,
      quality: "unavailable",
      reason: "no quality-qualified prior sighting",
    };
  const ageTicks = tick - prior.tick;
  return ageTicks <= memoryTicks
    ? {
        known: true,
        quality: prior.quality,
        ageTicks,
        reason: "target was recently sighted",
      }
    : {
        known: false,
        quality: prior.quality,
        ageTicks,
        reason: "prior sighting is outside the configured knowledge window",
      };
};

export interface AudibilityInput {
  readonly source?: Vector3;
  readonly listener?: Vector3;
  readonly maxDistance?: number;
  readonly eventAuthoritative: boolean;
  readonly attenuationModelVersion?: string;
}
export type AudibilityResult =
  | {
      readonly status: "available";
      readonly audible: boolean;
      readonly distance: number;
      readonly quality: "proxy";
      readonly limitations: readonly string[];
    }
  | { readonly status: "unavailable"; readonly reason: string };
export const audibilityProxy = (input: AudibilityInput): AudibilityResult => {
  if (!input.eventAuthoritative)
    return {
      status: "unavailable",
      reason: "sound-producing event was not authoritative",
    };
  if (!input.source || !input.listener)
    return {
      status: "unavailable",
      reason: "source or listener position was unavailable",
    };
  if (
    ![input.source, input.listener].every(
      (point) =>
        Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        Number.isFinite(point.z),
    )
  )
    return {
      status: "unavailable",
      reason: "source or listener position was invalid",
    };
  if (!input.attenuationModelVersion)
    return {
      status: "unavailable",
      reason: "versioned attenuation proxy was not configured",
    };
  if (
    !(
      input.maxDistance !== undefined &&
      input.maxDistance >= 0 &&
      Number.isFinite(input.maxDistance)
    )
  )
    return {
      status: "unavailable",
      reason: "audibility radius was unavailable or invalid",
    };
  const d = distance(input.source, input.listener);
  return {
    status: "available",
    audible: d <= input.maxDistance,
    distance: d,
    quality: "proxy",
    limitations: [
      "distance proxy does not model occlusion, mix, masking, or player audio settings",
    ],
  };
};
