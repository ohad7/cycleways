import assert from "node:assert/strict";
import { navigationRouteFromRouteState } from "@cycleways/core/navigation/navigationRoute.js";
import {
  createRouteProgressTracker,
  traveledCoordinates,
} from "@cycleways/core/navigation/routeProgress.js";

// A straight ~931 m route heading due east along lat 33.10. Three vertices,
// each leg ~465.8 m. Used for deterministic projection/progress assertions.
function straightRoute() {
  return navigationRouteFromRouteState(
    {
      points: [
        { id: "start", lat: 33.1, lng: 35.6 },
        { id: "end", lat: 33.1, lng: 35.61 },
      ],
      selectedSegments: [],
      geometry: [
        { lat: 33.1, lng: 35.6 },
        { lat: 33.1, lng: 35.605 },
        { lat: 33.1, lng: 35.61 },
      ],
      distance: 931.5,
    },
    { param: "straight-token" },
  );
}

const near = (a, b, tol) => Math.abs(a - b) <= tol;

// --- Basic progress projection -------------------------------------------
{
  const tracker = createRouteProgressTracker(straightRoute());

  const start = tracker.update({
    lat: 33.1,
    lng: 35.6,
    accuracy: 5,
    speed: 3,
    timestamp: 1000,
  });
  assert.equal(start.onRoute, true, "start is on route");
  assert.equal(start.offRoute, false, "start not off route");
  assert.ok(near(start.progressMeters, 0, 1), "start progress ~0");
  assert.ok(near(start.fraction, 0, 0.01), "start fraction ~0");
  assert.ok(near(start.remainingMeters, 931.5, 2), "start remaining ~total");
  assert.ok(start.crossTrackMeters < 1, "start cross-track ~0");

  const mid = tracker.update({
    lat: 33.1,
    lng: 35.605,
    accuracy: 5,
    speed: 3,
    timestamp: 2000,
  });
  assert.ok(near(mid.progressMeters, 465.8, 2), "mid progress ~half");
  assert.ok(near(mid.fraction, 0.5, 0.01), "mid fraction ~0.5");
  assert.ok(near(mid.remainingMeters, 465.8, 2), "mid remaining ~half");

  const end = tracker.update({
    lat: 33.1,
    lng: 35.61,
    accuracy: 5,
    speed: 3,
    timestamp: 3000,
  });
  assert.ok(near(end.progressMeters, 931.5, 2), "end progress ~total");
  assert.ok(near(end.fraction, 1, 0.01), "end fraction ~1");
  assert.ok(end.remainingMeters < 2, "end remaining ~0");
}

// --- Cross-track while still on route -------------------------------------
{
  const tracker = createRouteProgressTracker(straightRoute());
  const off = tracker.update({
    lat: 33.1001, // ~11 m north of the line
    lng: 35.605,
    accuracy: 5,
    speed: 3,
    timestamp: 1000,
  });
  assert.ok(near(off.crossTrackMeters, 11.1, 2), "cross-track ~11 m");
  assert.equal(off.onRoute, true, "11 m off centre is still on route");
  assert.equal(off.offRoute, false, "11 m off centre is not off-route");
  assert.ok(near(off.progressMeters, 465.8, 3), "progress unaffected by lateral");

  // Snapped point sits on the route line (used for the progress line + marker).
  assert.ok(off.snappedPoint, "snapped point present");
  assert.ok(near(off.snappedPoint.lat, 33.1, 0.0001), "snapped onto the line (lat)");
  assert.ok(near(off.snappedPoint.lng, 35.605, 0.0002), "snapped at mid (lng)");
  assert.ok(Number.isInteger(off.snappedIndex), "snapped segment index present");
}

// --- Accuracy inflation keeps noisy-but-close fixes on route --------------
{
  const tracker = createRouteProgressTracker(straightRoute());
  // ~33 m off centre, but reported accuracy 20 m -> threshold 30 + 20 = 50 m.
  const noisy = tracker.update({
    lat: 33.1003,
    lng: 35.605,
    accuracy: 20,
    speed: 3,
    timestamp: 1000,
  });
  assert.ok(near(noisy.crossTrackMeters, 33.4, 3), "noisy cross-track ~33 m");
  assert.equal(noisy.offRoute, false, "accuracy inflation absorbs the noise");
  assert.equal(noisy.onRoute, true, "still on route under inflated threshold");
}

// --- Off-route enter/confirm/recover with dwell ---------------------------
{
  const tracker = createRouteProgressTracker(straightRoute(), {
    confirmMs: 4000,
    recoverMs: 3000,
  });
  const farFix = (timestamp) => ({
    lat: 33.101, // ~111 m north of the line
    lng: 35.605,
    accuracy: 5,
    speed: 3,
    timestamp,
  });
  const nearFix = (timestamp) => ({
    lat: 33.10005, // ~5 m off centre
    lng: 35.605,
    accuracy: 5,
    speed: 3,
    timestamp,
  });

  // Acquire the route first (acquisition gate must latch before off-route is meaningful).
  tracker.update(nearFix(100));

  // Single far fix: candidate, not yet confirmed (no flap on a GPS spike).
  const candidate = tracker.update(farFix(1000));
  assert.ok(candidate.crossTrackMeters > 100, "far fix cross-track > 100 m");
  assert.equal(candidate.offRoute, false, "single far fix is not confirmed off");

  // Sustained beyond the confirm dwell: confirmed off-route.
  const confirmed = tracker.update(farFix(6000));
  assert.equal(confirmed.offRoute, true, "sustained far fix confirms off-route");
  assert.equal(confirmed.onRoute, false, "confirmed off-route is not on route");

  // Back near the line but within the recover dwell: still off (no flap back).
  const recovering = tracker.update(nearFix(7000));
  assert.equal(recovering.offRoute, true, "still off during recover dwell");

  // Sustained near the line beyond the recover dwell: recovered.
  const recovered = tracker.update(nearFix(11000));
  assert.equal(recovered.offRoute, false, "sustained near fix recovers");
  assert.equal(recovered.onRoute, true, "recovered back on route");
}

// --- Out-and-back: cursor keeps progress local across the overlap ---------
// Outbound east along lat 33.100, turnaround, return west ~8 m north on a
// parallel line. A GPS fix near the west end nudged south lands between the two
// lines (slightly closer to the outbound line). A global nearest-min would snap
// progress back to ~0; the windowed forward cursor must keep it near the end.
{
  const outAndBack = navigationRouteFromRouteState(
    {
      points: [
        { id: "start", lat: 33.1, lng: 35.6 },
        { id: "end", lat: 33.10007, lng: 35.6 },
      ],
      selectedSegments: [],
      geometry: [
        { lat: 33.1, lng: 35.6 }, // 0
        { lat: 33.1, lng: 35.605 }, // ~466
        { lat: 33.1, lng: 35.61 }, // ~931 turnaround
        { lat: 33.10007, lng: 35.605 }, // ~1397 (return, ~8 m north)
        { lat: 33.10007, lng: 35.6 }, // ~1863 end
      ],
      distance: 1863,
    },
    { param: "out-and-back-token" },
  );

  const tracker = createRouteProgressTracker(outAndBack);
  const f = (lat, lng, timestamp) => ({
    lat,
    lng,
    accuracy: 5,
    speed: 3,
    timestamp,
  });

  // Walk forward so the cursor is established near the end of the return leg.
  tracker.update(f(33.1, 35.6, 1000)); // ~0
  tracker.update(f(33.1, 35.605, 2000)); // ~466
  tracker.update(f(33.1, 35.61, 3000)); // ~931
  tracker.update(f(33.10007, 35.605, 4000)); // ~1397
  const beforeAmbiguous = tracker.update(f(33.10007, 35.602, 5000)); // ~1677
  assert.ok(
    beforeAmbiguous.progressMeters > 1500,
    "cursor advanced onto the return leg",
  );

  // Ambiguous fix near the west end, nudged ~3 m south of the return line so it
  // is actually closer to the outbound line. Cursor must keep progress high.
  const ambiguous = tracker.update(f(33.10003, 35.601, 6000));
  assert.ok(
    ambiguous.progressMeters > 1500,
    `cursor stays on the return leg (got ${ambiguous.progressMeters.toFixed(0)} m)`,
  );
}

// --- Out-and-back: off-route drift near another leg must not jump progress ---
{
  const outAndBack = navigationRouteFromRouteState(
    {
      points: [
        { id: "start", lat: 33.1, lng: 35.6 },
        { id: "end", lat: 33.101, lng: 35.6 },
      ],
      selectedSegments: [],
      geometry: [
        { lat: 33.1, lng: 35.6 },
        { lat: 33.1, lng: 35.61 },
        { lat: 33.101, lng: 35.61 },
        { lat: 33.101, lng: 35.6 },
      ],
      distance: 1975,
    },
    { param: "wide-out-and-back-token" },
  );

  const tracker = createRouteProgressTracker(outAndBack);
  const f = (lat, lng, timestamp) => ({
    lat,
    lng,
    accuracy: 5,
    speed: 3,
    timestamp,
  });

  tracker.update(f(33.1, 35.6, 1000));
  tracker.update(f(33.1, 35.61, 2000));
  tracker.update(f(33.101, 35.61, 3000));
  const beforeDrift = tracker.update(f(33.101, 35.602, 4000));
  assert.ok(beforeDrift.progressMeters > 1700, "cursor is on the return leg");

  // This fix is near the outbound leg but far from the return leg window. A
  // global nearest search would snap progress back near the start.
  const drift = tracker.update(f(33.1001, 35.601, 5000));
  assert.ok(
    drift.progressMeters > 1600,
    `off-route drift stays near return-leg progress (got ${drift.progressMeters.toFixed(0)} m)`,
  );
  assert.ok(drift.crossTrackMeters > 80, "drift is measured against the local return leg");
}

// --- Next-geometry bearing + distance to route start ----------------------
{
  const tracker = createRouteProgressTracker(straightRoute());
  const atStart = tracker.update({
    lat: 33.1,
    lng: 35.6,
    accuracy: 5,
    speed: 0,
    timestamp: 1000,
  });
  assert.ok(near(atStart.bearingToNextDeg, 90, 2), "route heads due east (~90)");
  assert.ok(atStart.distanceToRouteStart < 1, "at start: ~0 to route start");

  const offStart = createRouteProgressTracker(straightRoute()).update({
    lat: 33.10045, // ~50 m north of the start
    lng: 35.6,
    accuracy: 5,
    speed: 0,
    timestamp: 1000,
  });
  assert.ok(
    near(offStart.distanceToRouteStart, 50, 4),
    "50 m from start is reported for the approach state",
  );
}

// --- Wrong-way detection, low-speed safe ----------------------------------
{
  const tracker = createRouteProgressTracker(straightRoute());
  // Heading east along the route: not wrong-way.
  tracker.update({ lat: 33.1, lng: 35.604, accuracy: 5, speed: 3, timestamp: 1000 });
  const forward = tracker.update({
    lat: 33.1,
    lng: 35.605,
    accuracy: 5,
    speed: 3,
    timestamp: 2000,
  });
  assert.equal(forward.wrongWay, false, "moving east along route is not wrong-way");

  // Now moving west (against the route): wrong-way.
  const backward = tracker.update({
    lat: 33.1,
    lng: 35.604,
    accuracy: 5,
    speed: 3,
    timestamp: 3000,
  });
  assert.ok(near(backward.courseDeg, 270, 5), "course is ~west (270)");
  assert.equal(backward.wrongWay, true, "moving west against route is wrong-way");

  // Stationary jitter (speed < 1 m/s): course unknown, never flag wrong-way.
  const stopped = tracker.update({
    lat: 33.1,
    lng: 35.604,
    accuracy: 5,
    speed: 0.2,
    timestamp: 4000,
  });
  assert.equal(stopped.courseDeg, null, "no course when stopped");
  assert.equal(stopped.wrongWay, false, "stopped is never wrong-way");
}

// --- traveledCoordinates: completed path for the progress line ------------
{
  const geometry = straightRoute().geometry;

  // Mid of the first segment: [v0, snapped].
  const a = traveledCoordinates(geometry, 0, { lat: 33.1, lng: 35.605 });
  assert.equal(a.length, 2, "two points up to the snapped mid");
  assert.deepEqual(a[0], { lat: 33.1, lng: 35.6 }, "starts at route start");
  assert.deepEqual(a[1], { lat: 33.1, lng: 35.605 }, "ends at the snapped point");

  // Into the second segment: [v0, v1, snapped].
  const b = traveledCoordinates(geometry, 1, { lat: 33.1, lng: 35.608 });
  assert.equal(b.length, 3, "includes the passed vertex");
  assert.deepEqual(b[2], { lat: 33.1, lng: 35.608 });

  // No progress yet -> empty (nothing to draw).
  assert.deepEqual(traveledCoordinates(geometry, null, null), []);
}

// --- seeded cursor resumes on the intended branch --------------------------
{
  const tracker = createRouteProgressTracker(straightRoute());
  tracker.seed({ progressMeters: 600, acquired: true });
  const progress = tracker.update({
    lat: 33.1002,
    lng: 35.6068,
    accuracy: 6,
    speed: 4,
    timestamp: 1000,
  });
  assert.equal(progress.hasAcquiredRoute, true, "seed marks the route acquired");
  assert.ok(
    Math.abs(progress.progressMeters - 600) < 120,
    `seeded projection remains near 600 m (got ${progress.progressMeters})`,
  );

  const bounded = createRouteProgressTracker(straightRoute());
  bounded.seed({ progressMeters: 600, acquired: true });
  const atEnd = bounded.update({
    lat: 33.1,
    lng: 35.61,
    accuracy: 6,
    speed: 4,
    timestamp: 1000,
  });
  assert.ok(
    atEnd.progressMeters <= 850.1,
    "the first seeded projection is clipped to the cursor search window",
  );
}

// --- acquisition gate ---
import { computeBearing as _cb } from "@cycleways/core/utils/geometry.js";
{
  const tracker = createRouteProgressTracker(straightRoute());
  // First fix ~557 m north of the route: must NOT acquire or advance.
  const far = tracker.update({ lat: 33.105, lng: 35.6, accuracy: 8, speed: 4, timestamp: 1000 });
  assert.equal(far.hasAcquiredRoute, false, "far first fix is not acquired");
  assert.equal(far.progressMeters, 0, "no progress before acquisition");
  assert.equal(far.offRoute, false, "approaching is not off-route");
  assert.ok(far.guidanceDistanceMeters > 500, "guidance distance to start is reported");
  assert.ok(Number.isFinite(far.guidanceBearingDeg), "guidance bearing is reported");
  assert.deepEqual(far.guidanceTargetPoint, { lat: 33.1, lng: 35.6 }, "targets route start");

  // Arrive at the start: acquire and begin progress.
  const near = tracker.update({ lat: 33.1, lng: 35.6, accuracy: 8, speed: 4, timestamp: 4000 });
  assert.equal(near.hasAcquiredRoute, true, "acquired at the route");
  // Move along: progress advances and stays acquired.
  const mid = tracker.update({ lat: 33.1, lng: 35.605, accuracy: 8, speed: 4, timestamp: 7000 });
  assert.equal(mid.hasAcquiredRoute, true, "acquisition latches");
  assert.ok(mid.progressMeters > 400, "progress advances after acquisition");
}

// --- segment context ---
{
  const base = straightRoute();
  const route = { ...base, segmentSpans: [
    { startMeters: 0, endMeters: 465, name: "First", cwSegmentId: 1, onNetwork: true, routeClass: "cycleway" },
    { startMeters: 465, endMeters: base.geometry[base.geometry.length-1].distanceFromStartMeters, name: "Second", cwSegmentId: 2, onNetwork: true, routeClass: "cycleway" },
  ]};
  const tracker = createRouteProgressTracker(route);
  tracker.update({ lat: 33.1, lng: 35.6, accuracy: 5, speed: 4, timestamp: 1000 }); // acquire at start
  const p = tracker.update({ lat: 33.1, lng: 35.602, accuracy: 5, speed: 4, timestamp: 4000 });
  assert.equal(p.currentSpanIndex, 0, "currentSpanIndex is 0 for first span");
  assert.equal(p.currentSegmentName, "First", "reports current segment");
  assert.equal(p.currentOnNetwork, true);
  assert.equal(p.nextSegmentName, "Second", "reports next named segment");
  assert.ok(p.distanceToNextSegmentMeters > 0, "distance to next segment");
}

// --- segment context: approaching (pre-acquisition) path has all null/false ---
{
  const base = straightRoute();
  const route = { ...base, segmentSpans: [
    { startMeters: 0, endMeters: 465, name: "First", cwSegmentId: 1, onNetwork: true, routeClass: "cycleway" },
    { startMeters: 465, endMeters: base.geometry[base.geometry.length-1].distanceFromStartMeters, name: "Second", cwSegmentId: 2, onNetwork: true, routeClass: "cycleway" },
  ]};
  const tracker = createRouteProgressTracker(route);
  // Fix far from route: not yet acquired (approaching state)
  const approaching = tracker.update({ lat: 33.105, lng: 35.6, accuracy: 8, speed: 4, timestamp: 1000 });
  assert.equal(approaching.hasAcquiredRoute, false, "approaching: not yet acquired");
  assert.equal(approaching.currentSpanIndex, null, "approaching: currentSpanIndex null");
  assert.equal(approaching.currentSegmentName, null, "approaching: currentSegmentName null");
  assert.equal(approaching.currentOnNetwork, false, "approaching: currentOnNetwork false");
  assert.equal(approaching.currentRouteClass, null, "approaching: currentRouteClass null");
  assert.equal(approaching.nextSegmentName, null, "approaching: nextSegmentName null");
  assert.equal(approaching.distanceToNextSegmentMeters, null, "approaching: distanceToNextSegmentMeters null");
}

// --- segment context: empty segmentSpans returns all null/false, no throw ---
{
  const base = straightRoute();
  const route = { ...base, segmentSpans: [] }; // explicit empty spans
  const tracker = createRouteProgressTracker(route);
  tracker.update({ lat: 33.1, lng: 35.6, accuracy: 5, speed: 4, timestamp: 1000 }); // acquire at start
  const p = tracker.update({ lat: 33.1, lng: 35.605, accuracy: 5, speed: 4, timestamp: 4000 }); // mid-route
  assert.equal(p.hasAcquiredRoute, true, "empty-spans route is acquired");
  assert.equal(p.currentSpanIndex, null, "empty spans: currentSpanIndex null");
  assert.equal(p.currentSegmentName, null, "empty spans: currentSegmentName null");
  assert.equal(p.currentOnNetwork, false, "empty spans: currentOnNetwork false");
  assert.equal(p.currentRouteClass, null, "empty spans: currentRouteClass null");
  assert.equal(p.nextSegmentName, null, "empty spans: nextSegmentName null");
  assert.equal(p.distanceToNextSegmentMeters, null, "empty spans: distanceToNextSegmentMeters null");
}

console.log("route progress tests passed");
