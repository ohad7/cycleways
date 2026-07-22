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
const COURSE_WINDOW_METERS = 20; // displacement window for the smoothed course
const SPEED_WINDOW_MS = 3000; // smoothed rider speed = mean fix speed over this
const WRONG_WAY_CONFIRM_MS = 4000; // sustained disagreement before warning
// Quiet window after acquisition: the proximity latch can fire while the
// rider is still physically finishing the approach (moving toward the start,
// against the route's local bearing). No wrong-way judgment until this
// settles; a genuine backward start is still warned right afterwards.
const WRONG_WAY_ACQUISITION_GRACE_MS = 12000;
const COURSE_HISTORY_LIMIT = 240; // ~4 min at 1 Hz

function metersPerDegLng(lat) {
  return METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

// Project point P onto segment a->b in a local equirectangular metric frame
// centred at `a`. Returns { t, crossTrackMeters } where t is clamped to [0, 1].
export function projectToSegment(p, a, b) {
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
  return {
    t,
    crossTrackMeters: Math.sqrt(dx * dx + dy * dy),
    snapped: { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) },
  };
}

// Completed-portion coordinates for the navigation progress line: every route
// vertex already passed (0..snappedIndex) plus the current snapped point.
export function traveledCoordinates(geometry, snappedIndex, snappedPoint) {
  if (
    !Array.isArray(geometry) ||
    snappedIndex === null ||
    snappedIndex === undefined ||
    !snappedPoint
  ) {
    return [];
  }
  const path = [];
  for (let i = 0; i <= snappedIndex && i < geometry.length; i++) {
    path.push({ lat: geometry[i].lat, lng: geometry[i].lng });
  }
  path.push({ lat: snappedPoint.lat, lng: snappedPoint.lng });
  return path;
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
  const segmentSpans = Array.isArray(navigationRoute?.segmentSpans)
    ? navigationRoute.segmentSpans
    : [];
  const guidanceSpans = navigationRoute?.guidanceMode === "guidance-v1"
    && Array.isArray(navigationRoute?.guidanceSpans)
    ? navigationRoute.guidanceSpans
    : [];

  function emptyGuidanceContext() {
    return {
      currentGuidanceIdentity: null,
      currentGuidanceName: null,
      currentGuidanceSpokenName: null,
      currentGuidanceKind: null,
      currentGuidanceRole: null,
      currentOnCycleways: false,
      nextGuidanceIdentity: null,
      nextGuidanceName: null,
      distanceToNextGuidanceMeters: null,
    };
  }

  function guidanceContext(progressMeters) {
    if (guidanceSpans.length === 0) return emptyGuidanceContext();
    let idx = guidanceSpans.findIndex(
      (span) => progressMeters >= span.startMeters && progressMeters < span.endMeters,
    );
    if (idx < 0) idx = guidanceSpans.length - 1;
    let current = guidanceSpans[idx];
    if (current?.networkRole === "junction" && !current.guidanceIdentity) {
      const before = [...guidanceSpans.slice(0, idx)].reverse().find(
        (span) => span.guidanceIdentity,
      );
      const after = guidanceSpans.slice(idx + 1).find(
        (span) => span.guidanceIdentity,
      );
      if (before?.guidanceIdentity && before.guidanceIdentity === after?.guidanceIdentity) {
        current = before;
      }
    }
    let next = null;
    for (let i = idx + 1; i < guidanceSpans.length; i += 1) {
      const candidate = guidanceSpans[i];
      if (!candidate.guidanceIdentity) continue;
      if (candidate.guidanceIdentity === current?.guidanceIdentity) continue;
      next = candidate;
      break;
    }
    return {
      currentGuidanceIdentity: current?.guidanceIdentity || null,
      currentGuidanceName: current?.name || null,
      currentGuidanceSpokenName: current?.spokenName || null,
      currentGuidanceKind: current?.kind || null,
      currentGuidanceRole: current?.role || null,
      currentOnCycleways: current?.onCycleways === true,
      nextGuidanceIdentity: next?.guidanceIdentity || null,
      nextGuidanceName: next?.name || null,
      distanceToNextGuidanceMeters: next
        ? Math.max(0, Number(next.startMeters) - progressMeters)
        : null,
    };
  }

  function segmentContext(progressMeters) {
    if (segmentSpans.length === 0) {
      return {
        currentSpanIndex: null, currentSegmentName: null, currentOnNetwork: false,
        currentRouteClass: null, nextSegmentName: null, distanceToNextSegmentMeters: null,
        ...guidanceContext(progressMeters),
      };
    }
    let idx = segmentSpans.findIndex(
      (s) => progressMeters >= s.startMeters && progressMeters < s.endMeters,
    );
    if (idx < 0) idx = segmentSpans.length - 1;
    const cur = segmentSpans[idx];
    let nextName = null;
    let nextStart = null;
    for (let i = idx + 1; i < segmentSpans.length; i++) {
      if (segmentSpans[i].name) { nextName = segmentSpans[i].name; nextStart = segmentSpans[i].startMeters; break; }
    }
    return {
      currentSpanIndex: idx,
      currentSegmentName: cur.name,
      currentOnNetwork: cur.onNetwork,
      currentRouteClass: cur.routeClass,
      nextSegmentName: nextName,
      distanceToNextSegmentMeters: nextStart === null ? null : Math.max(0, nextStart - progressMeters),
      ...guidanceContext(progressMeters),
    };
  }

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
  let seededSearchPending = false;
  // Acquisition gate: latches true once the rider comes within the on-route
  // threshold of the geometry; stays true for the rest of the session.
  let acquired = false;
  // Wrong-way state: recent raw fixes (for the smoothed course), the
  // timestamp the sustained-disagreement dwell started, and when the route
  // was acquired (for the post-acquisition grace window).
  let courseHistory = [];
  let wrongWaySince = null;
  let acquiredAtMs = null;

  function reset() {
    offRouteState = "on";
    candidateSince = null;
    recoverSince = null;
    lastProgressMeters = null;
    prevFix = null;
    acquired = false;
    seededSearchPending = false;
    courseHistory = [];
    wrongWaySince = null;
    acquiredAtMs = null;
  }

  function seed({ progressMeters, acquired: seedAcquired = true } = {}) {
    const progress = Number(progressMeters);
    lastProgressMeters = Number.isFinite(progress)
      ? Math.max(0, Math.min(totalMeters, progress))
      : null;
    seededSearchPending = lastProgressMeters !== null;
    acquired = seedAcquired === true;
    offRouteState = "on";
    candidateSince = null;
    recoverSince = null;
    prevFix = null;
    courseHistory = [];
    wrongWaySince = null;
  }

  function snapshot() {
    return {
      version: 1,
      offRouteState,
      candidateSince,
      recoverSince,
      lastProgressMeters,
      prevFix,
      seededSearchPending,
      acquired,
      courseHistory,
      wrongWaySince,
      acquiredAtMs,
    };
  }

  function restore(snapshotState = {}) {
    if (!snapshotState || snapshotState.version !== 1) return false;
    offRouteState =
      snapshotState.offRouteState === "candidate" ||
      snapshotState.offRouteState === "off"
        ? snapshotState.offRouteState
        : "on";
    candidateSince = Number.isFinite(Number(snapshotState.candidateSince))
      ? Number(snapshotState.candidateSince)
      : null;
    recoverSince = Number.isFinite(Number(snapshotState.recoverSince))
      ? Number(snapshotState.recoverSince)
      : null;
    lastProgressMeters = Number.isFinite(Number(snapshotState.lastProgressMeters))
      ? Math.max(0, Math.min(totalMeters, Number(snapshotState.lastProgressMeters)))
      : null;
    prevFix = snapshotState.prevFix && Number.isFinite(Number(snapshotState.prevFix.lat)) &&
      Number.isFinite(Number(snapshotState.prevFix.lng))
      ? { ...snapshotState.prevFix }
      : null;
    seededSearchPending = snapshotState.seededSearchPending === true;
    acquired = snapshotState.acquired === true;
    courseHistory = Array.isArray(snapshotState.courseHistory)
      ? snapshotState.courseHistory
          .filter(
            (entry) =>
              Number.isFinite(Number(entry?.lat)) &&
              Number.isFinite(Number(entry?.lng)) &&
              Number.isFinite(Number(entry?.timestamp)),
          )
          .slice(-COURSE_HISTORY_LIMIT)
          .map((entry) => ({
            lat: Number(entry.lat),
            lng: Number(entry.lng),
            timestamp: Number(entry.timestamp),
            speed: Number.isFinite(Number(entry.speed)) ? Number(entry.speed) : null,
          }))
      : [];
    wrongWaySince = Number.isFinite(Number(snapshotState.wrongWaySince))
      ? Number(snapshotState.wrongWaySince)
      : null;
    acquiredAtMs = Number.isFinite(Number(snapshotState.acquiredAtMs))
      ? Number(snapshotState.acquiredAtMs)
      : null;
    return true;
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
      const legMeters = b.distanceFromStartMeters - a.distanceFromStartMeters;
      let allowedStartMeters = a.distanceFromStartMeters;
      let allowedEndMeters = b.distanceFromStartMeters;
      let clippedA = a;
      let clippedB = b;
      if (rangeMin !== null && legMeters > 0) {
        allowedStartMeters = Math.max(allowedStartMeters, rangeMin);
        allowedEndMeters = Math.min(allowedEndMeters, rangeMax);
        if (allowedEndMeters < allowedStartMeters) continue;
        const startT = (allowedStartMeters - a.distanceFromStartMeters) / legMeters;
        const endT = (allowedEndMeters - a.distanceFromStartMeters) / legMeters;
        clippedA = {
          lat: a.lat + startT * (b.lat - a.lat),
          lng: a.lng + startT * (b.lng - a.lng),
        };
        clippedB = {
          lat: a.lat + endT * (b.lat - a.lat),
          lng: a.lng + endT * (b.lng - a.lng),
        };
      }
      const proj = projectToSegment(fix, clippedA, clippedB);
      if (best === null || proj.crossTrackMeters < best.crossTrackMeters) {
        best = {
          index: i,
          crossTrackMeters: proj.crossTrackMeters,
          progressMeters:
            allowedStartMeters + proj.t * (allowedEndMeters - allowedStartMeters),
          snapped: proj.snapped,
        };
      }
    }
    return best;
  }

  // Earliest on-route candidate: among projections within the threshold, the
  // smallest progressMeters wins. Standing on a loop's shared start/end picks
  // the start leg; an out-and-back's shared corridor picks the outbound leg.
  function findEarliestWithin(fix, thresholdMeters) {
    let best = null;
    for (let i = 0; i < geometry.length - 1; i++) {
      const a = geometry[i];
      const b = geometry[i + 1];
      const legMeters = b.distanceFromStartMeters - a.distanceFromStartMeters;
      if (!Number.isFinite(legMeters) || legMeters <= 0) continue;
      const proj = projectToSegment(fix, a, b);
      if (proj.crossTrackMeters > thresholdMeters) continue;
      const progressMeters = a.distanceFromStartMeters + proj.t * legMeters;
      if (best === null || progressMeters < best.progressMeters) {
        best = {
          index: i,
          crossTrackMeters: proj.crossTrackMeters,
          progressMeters,
          snapped: proj.snapped,
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

  // General direction of travel: bearing from the most recent fix at least
  // COURSE_WINDOW_METERS away. Consecutive-fix displacement (courseDeg) is
  // jitter-dominated at riding speed — GPS error per fix rivals the distance
  // covered between fixes — so the wrong-way check needs this longer baseline.
  function smoothedCourse(fix) {
    if ((fix.speed ?? Infinity) < MIN_COURSE_SPEED_MPS) return null;
    for (let i = courseHistory.length - 1; i >= 0; i--) {
      if (getDistance(courseHistory[i], fix) >= COURSE_WINDOW_METERS) {
        return computeBearing(courseHistory[i], fix);
      }
    }
    return null;
  }

  // Mean of finite fix speeds over the last SPEED_WINDOW_MS (including the
  // current fix): steady enough for a readout, responsive enough to feel live.
  function smoothedSpeed(nowMs) {
    const speeds = [];
    for (let i = courseHistory.length - 1; i >= 0; i--) {
      const entry = courseHistory[i];
      if (nowMs - entry.timestamp > SPEED_WINDOW_MS) break;
      if (Number.isFinite(entry.speed)) speeds.push(entry.speed);
    }
    if (speeds.length === 0) return null;
    return speeds.reduce((sum, s) => sum + s, 0) / speeds.length;
  }

  function recordCourseFix(fix) {
    courseHistory.push({
      lat: fix.lat,
      lng: fix.lng,
      timestamp: fix.timestamp,
      speed: Number.isFinite(fix.speed) ? fix.speed : null,
    });
    if (courseHistory.length > COURSE_HISTORY_LIMIT) courseHistory.shift();
  }

  // Wrong-way: the general direction must disagree with the route bearing by
  // more than WRONG_WAY_DELTA_DEG, sustained for WRONG_WAY_CONFIRM_MS, before
  // the rider is warned. Parallel paths and jitter never qualify; an actual
  // turn-around does within a few seconds.
  function updateWrongWay(fix, bearingToNextDeg, course) {
    if (
      acquiredAtMs !== null &&
      fix.timestamp - acquiredAtMs < WRONG_WAY_ACQUISITION_GRACE_MS
    ) {
      wrongWaySince = null;
      return false;
    }
    const delta =
      course !== null && bearingToNextDeg !== null
        ? bearingDelta(course, bearingToNextDeg)
        : null;
    if (delta === null || delta <= WRONG_WAY_DELTA_DEG) {
      wrongWaySince = null;
      return false;
    }
    if (wrongWaySince === null) wrongWaySince = fix.timestamp;
    return fix.timestamp - wrongWaySince >= WRONG_WAY_CONFIRM_MS;
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
    const requireStartAcquisition = navigationRoute?.requiresStartAcquisition === true;
    const distanceToRouteStart =
      geometry.length > 0 ? getDistance(fix, geometry[0]) : 0;
    if (!acquired && requireStartAcquisition) {
      best = findEarliestWithin(fix, enterThreshold) || findNearest(fix, null, null);
    } else if (lastProgressMeters === null) {
      best = findNearest(fix, null, null);
    } else {
      const w = opts.searchWindowMeters;
      best = findNearest(
        fix,
        lastProgressMeters - w,
        lastProgressMeters + w,
      );
      if (
        !seededSearchPending &&
        (best === null || best.crossTrackMeters > enterThreshold)
      ) {
        const globalBest = findNearest(fix, null, null);
        const jumpMeters =
          globalBest && Number.isFinite(lastProgressMeters)
            ? Math.abs(globalBest.progressMeters - lastProgressMeters)
            : 0;
        if (!acquired || jumpMeters <= w * 4) {
          best = globalBest;
        }
      }
    }
    seededSearchPending = false;

    if (!acquired) {
      // Acquisition: latch true once within the on-route threshold of the line.
      if (best && best.crossTrackMeters <= enterThreshold) {
        acquired = true;
        lastProgressMeters = best.progressMeters;
        // The approach leg's course says nothing about on-route direction —
        // it regularly points against the route's first meters. Restart
        // direction judgment from the acquisition point.
        courseHistory = [];
        wrongWaySince = null;
        acquiredAtMs = fix.timestamp;
      } else {
        // Still approaching: do not advance progress or flag off-route.
        const approachSmoothedCourse = smoothedCourse(fix);
        prevFix = fix;
        recordCourseFix(fix);
        const approachSmoothedSpeed = smoothedSpeed(fix.timestamp);
        const startBearing =
          geometry.length > 0 ? computeBearing(fix, geometry[0]) : null;
        return {
          onRoute: false,
          offRoute: false,
          hasAcquiredRoute: false,
          crossTrackMeters: best ? best.crossTrackMeters : 0,
          progressMeters: 0,
          fraction: 0,
          remainingMeters: totalMeters,
          bearingToNextDeg: null,
          courseDeg: riderCourse(fix),
          smoothedCourseDeg: approachSmoothedCourse,
          smoothedSpeedMps: approachSmoothedSpeed,
          headingAgreementDeg: null,
          wrongWay: false,
          distanceToRouteStart,
          guidanceTargetPoint: geometry.length > 0
            ? { lat: geometry[0].lat, lng: geometry[0].lng }
            : null,
          guidanceTargetProgressMeters: 0,
          guidanceDistanceMeters: distanceToRouteStart,
          guidanceBearingDeg: startBearing,
          snappedPoint: null,
          snappedIndex: null,
          currentSpanIndex: null,
          currentSegmentName: null,
          currentOnNetwork: false,
          currentRouteClass: null,
          nextSegmentName: null,
          distanceToNextSegmentMeters: null,
        };
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
    const smoothedCourseDeg = smoothedCourse(fix);
    const wrongWay = updateWrongWay(fix, bearingToNextDeg, smoothedCourseDeg);

    const guidanceBearingDeg = best ? computeBearing(fix, best.snapped) : null;

    prevFix = fix;
    recordCourseFix(fix);
    const smoothedSpeedMps = smoothedSpeed(fix.timestamp);

    return {
      onRoute: !offRoute,
      offRoute,
      hasAcquiredRoute: true,
      crossTrackMeters,
      progressMeters,
      fraction: totalMeters > 0 ? progressMeters / totalMeters : 0,
      remainingMeters: Math.max(0, totalMeters - progressMeters),
      bearingToNextDeg,
      courseDeg,
      smoothedCourseDeg,
      smoothedSpeedMps,
      headingAgreementDeg,
      wrongWay,
      distanceToRouteStart,
      guidanceTargetPoint: best ? { lat: best.snapped.lat, lng: best.snapped.lng } : null,
      guidanceTargetProgressMeters: best ? best.progressMeters : null,
      guidanceDistanceMeters: crossTrackMeters,
      guidanceBearingDeg,
      snappedPoint: best ? best.snapped : null,
      snappedIndex: best ? best.index : null,
      ...segmentContext(progressMeters),
    };
  }

  return { update, reset, seed, snapshot, restore };
}
