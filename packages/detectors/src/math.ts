import type { Angles, Vector3 } from "./types.js";

export const wrapDegrees = (angle: number): number =>
  ((((angle + 180) % 360) + 360) % 360) - 180;
export const angularDelta = (from: Angles, to: Angles): Angles => ({
  pitch: wrapDegrees(to.pitch - from.pitch),
  yaw: wrapDegrees(to.yaw - from.yaw),
});
export const angularDistance = (a: Angles, b: Angles): number => {
  const d = angularDelta(a, b);
  return Math.hypot(d.pitch, d.yaw);
};
export const anglesTo = (from: Vector3, to: Vector3): Angles => {
  const dx = to.x - from.x,
    dy = to.y - from.y,
    dz = to.z - from.z;
  const horizontal = Math.hypot(dx, dy);
  return {
    pitch: wrapDegrees((-Math.atan2(dz, horizontal) * 180) / Math.PI),
    yaw: wrapDegrees((Math.atan2(dy, dx) * 180) / Math.PI),
  };
};
