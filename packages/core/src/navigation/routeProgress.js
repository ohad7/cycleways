// Route progress engine (design D4 / implementation-plan Phase 4).
//
// Pure, stateful updater: createRouteProgressTracker(navigationRoute) -> { update(fix), reset() }.
// `fix = { lat, lng, accuracy, heading, speed, timestamp }`. No wall clock / RAF
// inside — timestamps are fed in so the engine is fully fixture-testable.
//
// Projection is done in a local metric frame (lng scaled by cos(lat)) so the
// along-segment fraction that drives cumulative progress is unbiased. Leg
// lengths come from the NavigationRoute geometry's haversine `distanceFromStartMeters`.

import { getDistance } from "../utils/distance.js";
import { bearingDelta, computeBearing } from "../utils/geometry.js";

const METERS_PER_DEG_LAT = 111320;
const MIN_COURSE_SPEED_MPS = 1; // below this, GPS course/heading is unreliable
const WRONG_WAY_DELTA_DEG = 120; // course vs route bearing beyond this = wrong-way

function metersPerDegLng(lat) {
  return METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

// Project point P onto segment a->b in a local equirectangular metric frame
// centred at `a`. Returns { t, crossTrackMeters } where t is clamped to [0, 1].
function projectToSegment(p, a, b) {
  const mLng = metersPerDegLng(a.lat);
  const bx = (b.lng - a.lng) * mLng;
  const by = (b.lat - a.lat) * METERS_PER_DEG_LAT;
  const px = (p.lng - a.lng) * mLng;
  const py = (p.lat - a.lat) * METERS_PER_DEG_LAT;

  const lenSq = bx * bx + by * by;
  let t = 0;
  if (lenSq > 0) {
    t = (px * bx + py * by) / lenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }
  const dx = px - t * bx;
  const dy = py - t * by;
  return { t, crossTrackMeters: Math.sqrt(dx * dx + dy * dy) };
}

const DEFAULTS = {
  offRouteEnterMeters: 30,
  offRouteExitMeters: 15,
  accuracyFactor: 1, // off-route threshold = enter + accuracyFactor * accuracy
  confirmMs: 4000, // dwell beyond the enter threshold before confirming off-route
  recoverMs: 3000, // dwell back inside the exit threshold before recovering
  searchWindowMeters: 250, // forward/back cursor window for nearest-segment search
};

export function createRouteProgressTracker(navigationRoute, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const geometry = Array.isArray(navigationRoute?.geometry)
    ? navigationRoute.geometry
    : [];
  const totalMeters =
    geometry.length > 0
      ? geometry[geometry.length - 1].distanceFromStartMeters
      : 0;

  // Off-route hysteresis: "on" -> "candidate" -> "off" -> (recover) -> "on".
  // Dwell timers use the injected fix timestamps; a single far/near spike never
  // flips the state on its own.
  let offRouteState = "on";
  let candidateSince = null;
  let recoverSince = null;
  // Progress cursor: nearest-segment search is windowed around the last known
  // progress so loop / out-and-back routes that pass near themselves do not snap
  // progress backward across the overlap. Null until the first (acquisition) fix.
  let lastProgressMeters = null;
  let prevFix = null;

  function reset() {
    offRouteState = "on";
    candidateSince = null;
    recoverSince = null;
    lastProgressMeters = null;
    prevFix = null;
  }

  // Nearest segment whose progress range intersects [rangeMin, rangeMax]
  // (rangeMin === null means search the whole route).
  function findNearest(fix, rangeMin, rangeMax) {
    let best = null;
    for (let i = 0; i < geometry.length - 1; i++) {
      const a = geometry[i];
      const b = geometry[i + 1];
      if (
        rangeMin !== null &&
        (b.distanceFromStartMeters < rangeMin ||
          a.distanceFromStartMeters > rangeMax)
      ) {
        continue;
      }
      const proj = projectToSegment(fix, a, b);
      if (best === null || proj.crossTrackMeters < best.crossTrackMeters) {
        const legMeters = b.distanceFromStartMeters - a.distanceFromStartMeters;
        best = {
          index: i,
          crossTrackMeters: proj.crossTrackMeters,
          progressMeters: a.distanceFromStartMeters + proj.t * legMeters,
        };
      }
    }
    return best;
  }

  // Rider course: prefer displacement between consecutive fixes while moving;
  // fall back to reported heading; unknown when stopped (GPS course is noise).
  function riderCourse(fix) {
    if (
      (fix.speed ?? Infinity) >= MIN_COURSE_SPEED_MPS &&
      prevFix &&
      getDistance(prevFix, fix) > 0.5
    ) {
      return computeBearing(prevFix, fix);
    }
    if ((fix.speed ?? 0) >= MIN_COURSE_SPEED_MPS && Number.isFinite(fix.heading)) {
      return fix.heading;
    }
    return null;
  }

  function updateOffRoute(crossTrackMeters, enterThreshold, timestamp) {
    const exitThreshold = opts.offRouteExitMeters;
    if (offRouteState === "off") {
      if (crossTrackMeters < exitThreshold) {
        if (recoverSince === null) recoverSince = timestamp;
        if (timestamp - recoverSince >= opts.recoverMs) {
          offRouteState = "on";
          candidateSince = null;
          recoverSince = null;
        }
      } else {
        recoverSince = null;
      }
      return offRouteState === "off";
    }

    // "on" or "candidate"
    if (crossTrackMeters > enterThreshold) {
      if (offRouteState === "on") {
        offRouteState = "candidate";
        candidateSince = timestamp;
      } else if (timestamp - candidateSince >= opts.confirmMs) {
        offRouteState = "off";
        recoverSince = null;
      }
    } else {
      offRouteState = "on";
      candidateSince = null;
    }
    return offRouteState === "off";
  }

  function update(fix) {
    const enterThreshold =
      opts.offRouteEnterMeters + opts.accuracyFactor * (fix.accuracy || 0);

    // Windowed forward-cursor search; fall back to a global search on
    // acquisition, when the window finds nothing, or when the windowed match is
    // beyond the on-route threshold (lost / re-acquiring).
    let best;
    if (lastProgressMeters === null) {
      best = findNearest(fix, null, null);
    } else {
      const w = opts.searchWindowMeters;
      best = findNearest(
        fix,
        lastProgressMeters - w,
        lastProgressMeters + w,
      );
      if (best === null || best.crossTrackMeters > enterThreshold) {
        best = findNearest(fix, null, null);
      }
    }

    const progressMeters = best ? best.progressMeters : 0;
    const crossTrackMeters = best ? best.crossTrackMeters : 0;
    if (best) lastProgressMeters = progressMeters;
    const offRoute = updateOffRoute(crossTrackMeters, enterThreshold, fix.timestamp);

    // Bearing of the route just ahead (the segment the rider projects onto).
    const bearingToNextDeg =
      best && best.index < geometry.length - 1
        ? computeBearing(geometry[best.index], geometry[best.index + 1])
        : null;

    const courseDeg = riderCourse(fix);
    const headingAgreementDeg =
      courseDeg !== null && bearingToNextDeg !== null
        ? bearingDelta(courseDeg, bearingToNextDeg)
        : null;
    const wrongWay =
      headingAgreementDeg !== null && headingAgreementDeg > WRONG_WAY_DELTA_DEG;

    const distanceToRouteStart =
      geometry.length > 0 ? getDistance(fix, geometry[0]) : 0;

    prevFix = fix;

    return {
      onRoute: !offRoute,
      offRoute,
      crossTrackMeters,
      progressMeters,
      fraction: totalMeters > 0 ? progressMeters / totalMeters : 0,
      remainingMeters: Math.max(0, totalMeters - progressMeters),
      bearingToNextDeg,
      courseDeg,
      headingAgreementDeg,
      wrongWay,
      distanceToRouteStart,
    };
  }

  return { update, reset };
}
