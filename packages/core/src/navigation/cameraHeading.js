// Camera heading governor for navigation. The map frame is the rider's
// spatial anchor, so it must not chase every bearing change the way the puck
// arrow does: deviations within GPS/compass noise never rotate it, moderate
// deviations rotate it only after persisting for a few seconds (a transient
// wobble that comes back never moves the map), and only a sharp turn rotates
// it immediately. The caller animates toward the returned heading; this
// module only decides WHEN the heading target is allowed to move.
import { bearingDelta, computeBearing } from "../utils/geometry.js";
import {
  cameraCorridorBearing,
  cameraDominantBearing,
} from "./cameraViewport.js";

const ROUTE_BEARING_CONFIDENCE_CROSS_TRACK_M = 3;
const ROUTE_BEARING_DISAGREE_DEG = 60;

// Which bearing the follow camera should aim at, per navigation state. The
// map frame is route-up whenever the route is trusted, aims at the route
// start while approaching, and returns null off-route: the rider is
// maneuvering to get back, so the map must hold perfectly still (the puck
// arrow and the rejoin guidance carry the live direction). Any direction
// signal followed while off-route — even a smoothed one — rotates the frame
// exactly when the rider most needs a stable reference. (The full-state
// entry point, `cameraHeadingTargetForState`, relaxes this once a guided
// rejoin leg is active: the frame then steers along that leg instead.)
export function cameraHeadingTarget(progress) {
  if (!progress) return null;
  if (progress.offRoute === true) return null;
  if (progress.hasAcquiredRoute !== true) {
    return Number.isFinite(progress.guidanceBearingDeg)
      ? progress.guidanceBearingDeg
      : null;
  }
  const routeBearing = Number.isFinite(progress.bearingToNextDeg)
    ? progress.bearingToNextDeg
    : null;
  const riderCourse = Number.isFinite(progress.smoothedCourseDeg)
    ? progress.smoothedCourseDeg
    : progress.courseDeg;
  if (
    routeBearing !== null &&
    Number.isFinite(riderCourse) &&
    Number(progress.crossTrackMeters) > ROUTE_BEARING_CONFIDENCE_CROSS_TRACK_M &&
    bearingDelta(riderCourse, routeBearing) > ROUTE_BEARING_DISAGREE_DEG
  ) {
    return null;
  }
  return routeBearing;
}

export function cameraHeadingTargetForState(state, cameraShot = null) {
  const stage = cameraShot?.stage || null;
  if (stage === "arrived-local" || stage === "ride-summary") return null;

  if (stage === "off-route") {
    // Guided rejoin leg active: steer along it like an approach leg.
    // No leg: hold perfectly still — the puck carries the live direction.
    const approachProgress = state?.approach?.approachProgress || null;
    if (
      Array.isArray(state?.approach?.approachLegGeometry) &&
      state.approach.approachLegGeometry.length >= 2
    ) {
      const corridorBearing = cameraCorridorBearing(
        state.approach.approachLegGeometry,
        approachProgress?.progressMeters,
      );
      if (Number.isFinite(corridorBearing)) return corridorBearing;
      if (Number.isFinite(approachProgress?.bearingToNextDeg)) {
        return approachProgress.bearingToNextDeg;
      }
    }
    return null;
  }

  if (stage === "approach-guide" || stage === "approach-guide-pre-turn") {
    const approachProgress = state?.approach?.approachProgress || null;
    const corridorBearing = cameraCorridorBearing(
      state?.approach?.approachLegGeometry,
      approachProgress?.progressMeters,
    );
    if (Number.isFinite(corridorBearing)) return corridorBearing;
    return Number.isFinite(approachProgress?.bearingToNextDeg)
      ? approachProgress.bearingToNextDeg
      : null;
  }

  if (stage === "approach-too-far" || stage === "approach-start") {
    const latestFix = state?.latestFix || null;
    const target = state?.approach?.target?.point || null;
    if (latestFix && target) return computeBearing(latestFix, target);
    return Number.isFinite(state?.progress?.guidanceBearingDeg)
      ? state.progress.guidanceBearingDeg
      : null;
  }

  if (stage === "join-route") {
    const transition = state?.cameraTransition || null;
    if (Number.isFinite(transition?.sourceBearing)) return transition.sourceBearing;
    const sourceBearing = cameraDominantBearing(transition?.sourceGeometry);
    if (Number.isFinite(sourceBearing)) return sourceBearing;
  }

  if (
    stage === "ride" ||
    stage === "pre-turn" ||
    stage === "arrival" ||
    stage === "reacquire-route" ||
    stage === "join-route"
  ) {
    const held = cameraHeadingTarget(state?.progress || null);
    if (held === null) return null;
    const corridorBearing = cameraCorridorBearing(
      state?.route?.geometry,
      state?.progress?.progressMeters,
    );
    if (Number.isFinite(corridorBearing)) return corridorBearing;
  }

  return cameraHeadingTarget(state?.progress || null);
}

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
