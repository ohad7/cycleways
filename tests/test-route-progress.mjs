import assert from "node:assert/strict";
import { navigationRouteFromRouteState } from "@cycleways/core/navigation/navigationRoute.js";
import { createRouteProgressTracker } from "@cycleways/core/navigation/routeProgress.js";

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

console.log("route progress tests passed");
