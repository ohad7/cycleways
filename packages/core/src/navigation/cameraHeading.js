// Camera heading governor for navigation. The map frame is the rider's
// spatial anchor, so it must not chase every bearing change the way the puck
// arrow does: deviations within GPS/compass noise never rotate it, moderate
// deviations rotate it only after persisting for a few seconds (a transient
// wobble that comes back never moves the map), and only a sharp turn rotates
// it immediately. The caller animates toward the returned heading; this
// module only decides WHEN the heading target is allowed to move.
import { bearingDelta } from "../utils/geometry.js";

const DEFAULTS = {
  persistMs: 3000, // a moderate deviation must hold this long before adoption
  minDeltaDeg: 15, // below this the map never rotates
  snapDeltaDeg: 45, // beyond this (a real turn) it rotates immediately
};

export function createCameraHeadingGovernor(options = {}) {
  const opts = { ...DEFAULTS, ...options };
  if (opts.minDeltaDeg >= opts.snapDeltaDeg) {
    throw new Error("camera heading: minDeltaDeg must be below snapDeltaDeg");
  }
  let heading = null;
  let deviatingSinceMs = null;

  return {
    // (targetDeg, nowMs) -> heading the camera should aim at right now.
    // Non-finite targets hold the current heading.
    update(targetDeg, nowMs) {
      // No coercion: Number.isFinite(null) is false (Number(null) would be 0).
      if (!Number.isFinite(targetDeg)) {
        deviatingSinceMs = null;
        return heading;
      }
      const target = targetDeg;
      if (heading === null) {
        heading = target;
        return heading;
      }
      const delta = bearingDelta(heading, target);
      if (delta <= opts.minDeltaDeg) {
        deviatingSinceMs = null;
        return heading;
      }
      if (delta > opts.snapDeltaDeg) {
        heading = target;
        deviatingSinceMs = null;
        return heading;
      }
      if (deviatingSinceMs === null) {
        deviatingSinceMs = nowMs;
        return heading;
      }
      if (nowMs - deviatingSinceMs >= opts.persistMs) {
        heading = target;
        deviatingSinceMs = null;
      }
      return heading;
    },
    reset() {
      heading = null;
      deviatingSinceMs = null;
    },
  };
}
