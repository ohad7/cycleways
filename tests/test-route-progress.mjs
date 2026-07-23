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

// --- Wrong-way detection: smoothed course + confirmation dwell ------------
// wrongWay compares the rider's general direction (displacement over the last
// >=20 m, immune to per-fix jitter) against the route bearing, and only warns
// after the disagreement is sustained ~4 s. courseDeg stays instantaneous.
{
  const mPerDegLng = 111320 * Math.cos((33.1 * Math.PI) / 180);
  const eastFix = (meters, timestamp, overrides = {}) => ({
    lat: 33.1,
    lng: 35.6 + meters / mPerDegLng,
    accuracy: 5,
    speed: 5,
    timestamp,
    ...overrides,
  });

  // Jittery forward ride: along-track jitter of ±8 m makes consecutive-fix
  // displacement point backwards on alternate fixes, but the general direction
  // is east the whole time — never wrong-way.
  {
    const tracker = createRouteProgressTracker(straightRoute());
    for (let i = 0; i < 40; i++) {
      const jitter = i % 2 === 0 ? 8 : -8;
      const result = tracker.update(eastFix(i * 5 + jitter, 1000 + i * 1000));
      assert.equal(
        result.wrongWay,
        false,
        `jittery forward ride is never wrong-way (fix ${i})`,
      );
    }
  }

  // Turn-around: ride 200 m east, then reverse. A single backward fix must not
  // warn; sustained backward riding must warn within ~10 fixes; riding forward
  // again clears the warning.
  {
    const tracker = createRouteProgressTracker(straightRoute());
    let t = 1000;
    for (let i = 0; i <= 40; i++) {
      tracker.update(eastFix(i * 5, (t = 1000 + i * 1000)));
    }

    const single = tracker.update(eastFix(195, (t += 1000)));
    assert.ok(near(single.courseDeg, 270, 5), "instantaneous course is ~west");
    assert.equal(single.wrongWay, false, "a single backward fix does not warn");

    const westResults = [];
    for (let k = 2; k <= 12; k++) {
      westResults.push(tracker.update(eastFix(200 - k * 5, (t += 1000))));
    }
    assert.ok(
      westResults.slice(0, 3).every((r) => r.wrongWay === false),
      "no warning while the turn-around is still ambiguous (first ~20 m)",
    );
    assert.equal(
      westResults[westResults.length - 1].wrongWay,
      true,
      "sustained riding against the route warns",
    );

    const backPos = 200 - 12 * 5;
    const eastAgain = [];
    for (let j = 1; j <= 10; j++) {
      eastAgain.push(tracker.update(eastFix(backPos + j * 5, (t += 1000))));
    }
    assert.equal(
      eastAgain[eastAgain.length - 1].wrongWay,
      false,
      "riding forward again clears the warning",
    );
  }

  // Stationary jitter (speed < 1 m/s): course unknown, never flag wrong-way.
  {
    const tracker = createRouteProgressTracker(straightRoute());
    tracker.update(eastFix(0, 1000));
    const stopped = tracker.update(eastFix(5, 2000, { speed: 0.2 }));
    assert.equal(stopped.courseDeg, null, "no course when stopped");
    assert.equal(stopped.wrongWay, false, "stopped is never wrong-way");
    assert.equal(stopped.smoothedCourseDeg, null, "no smoothed course when stopped");
  }

  // Acquisition resets direction judgment: the approach leg's course says
  // nothing about on-route direction (it regularly points against the route's
  // first meters), so the course history restarts at acquisition — no
  // smoothed course, and no wrong-way, until the rider has covered a course
  // window ON the route.
  {
    const tracker = createRouteProgressTracker(straightRoute());
    const northFix = (offsetMeters, timestamp) => ({
      lat: 33.1 + offsetMeters / 111320,
      lng: 35.6,
      accuracy: 5,
      speed: 5,
      timestamp,
    });
    // Ride south toward the route start from 98 m north; acquisition latches
    // at 33 m offset (inside the 35 m threshold).
    let t = 1000;
    let acquisitionSeen = false;
    for (let offset = 98; offset >= 33; offset -= 5) {
      const result = tracker.update(northFix(offset, (t += 1000)));
      acquisitionSeen = result.hasAcquiredRoute;
    }
    assert.equal(acquisitionSeen, true, "acquired near the start");
    // The next fixes are still within one course window of the acquisition
    // point: direction judgment must not yet exist, whatever the approach
    // course was.
    for (const offset of [28, 23, 18]) {
      const result = tracker.update(northFix(offset, (t += 1000)));
      assert.equal(
        result.smoothedCourseDeg,
        null,
        `course history restarted at acquisition (offset ${offset})`,
      );
      assert.equal(result.wrongWay, false, "no wrong-way while settling");
    }
  }

  // Post-acquisition grace: proximity acquisition can latch while the rider
  // is still physically finishing the approach (moving toward the start,
  // against the route's local bearing). Wrong-way stays quiet for a grace
  // window after acquisition; a genuine backward start is still warned, just
  // calmly (~15 s in).
  {
    const tracker = createRouteProgressTracker(straightRoute());
    let t = 1000;
    const results = [];
    // Acquire mid-route at 400 m and immediately ride west, against the route.
    for (let k = 0; k <= 20; k++) {
      results.push(tracker.update(eastFix(400 - k * 5, (t += 1000))));
    }
    assert.equal(results[0].hasAcquiredRoute, true, "acquired mid-route");
    assert.ok(
      results.slice(0, 11).every((r) => r.wrongWay === false),
      "no wrong-way warning inside the post-acquisition grace window",
    );
    assert.equal(
      results[results.length - 1].wrongWay,
      true,
      "a genuine backward start is still warned after the grace window",
    );
  }

  // smoothedCourseDeg: the general direction of travel, exposed for consumers
  // that must not chase per-fix noise (e.g. the off-route camera). Under the
  // same along-track jitter that flips courseDeg backwards, it stays ~east.
  {
    const tracker = createRouteProgressTracker(straightRoute());
    for (let i = 0; i < 30; i++) {
      const jitter = i % 2 === 0 ? 8 : -8;
      const result = tracker.update(eastFix(i * 5 + jitter, 1000 + i * 1000));
      if (i >= 8) {
        assert.ok(
          Number.isFinite(result.smoothedCourseDeg) &&
            near(result.smoothedCourseDeg, 90, 25),
          `smoothed course stays ~east under jitter (fix ${i}: ${result.smoothedCourseDeg})`,
        );
      }
    }
  }
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

// --- guidance context collapses internal segments and skips same identity ---
{
  const base = straightRoute();
  const total = base.geometry.at(-1).distanceFromStartMeters;
  const route = {
    ...base,
    guidanceMode: "guidance-v1",
    guidanceSpans: [
      {
        startMeters: 0,
        endMeters: 300,
        guidanceIdentity: "way:road-9974",
        name: "כביש 9974",
        spokenName: "כביש תשעת אלפים תשע מאות שבעים וארבע",
        role: "named-way",
        kind: "road",
        onCycleways: true,
      },
      {
        startMeters: 300,
        endMeters: 600,
        guidanceIdentity: "way:road-9974",
        name: "כביש 9974",
        role: "named-way",
        kind: "road",
        onCycleways: true,
      },
      {
        startMeters: 600,
        endMeters: total,
        guidanceIdentity: "way:cycleway-99",
        name: "שביל אופניים 99",
        role: "named-way",
        kind: "cycleway",
        onCycleways: true,
      },
    ],
  };
  const tracker = createRouteProgressTracker(route);
  const progress = tracker.update({
    lat: 33.1,
    lng: 35.602,
    accuracy: 5,
    speed: 4,
    timestamp: 1000,
  });
  assert.equal(progress.currentGuidanceIdentity, "way:road-9974");
  assert.equal(progress.currentGuidanceName, "כביש 9974");
  assert.equal(progress.nextGuidanceIdentity, "way:cycleway-99");
  assert.equal(progress.nextGuidanceName, "שביל אופניים 99");
  assert.ok(progress.distanceToNextGuidanceMeters > 350);

  const classOnlyProgress = createRouteProgressTracker({
    ...route,
    guidancePresentationPolicy: "class-only",
  }).update({
    lat: 33.1,
    lng: 35.602,
    accuracy: 5,
    speed: 4,
    timestamp: 1000,
  });
  assert.equal(classOnlyProgress.currentGuidanceName, "כביש");
  assert.equal(classOnlyProgress.currentGuidanceSpokenName, "כביש");
  assert.equal(classOnlyProgress.nextGuidanceName, "שביל אופניים");
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

// --- smoothedSpeedMps: 3 s average of fix speeds --------------------------
{
  const mPerDegLng = 111320 * Math.cos((33.1 * Math.PI) / 180);
  const fix = (meters, timestamp, speed) => ({
    lat: 33.1,
    lng: 35.6 + meters / mPerDegLng,
    accuracy: 5,
    speed,
    timestamp,
  });
  const tracker = createRouteProgressTracker(straightRoute());
  tracker.update(fix(0, 1000, 4));
  tracker.update(fix(5, 2000, 5));
  const third = tracker.update(fix(10, 3000, 6));
  assert.ok(
    Math.abs(third.smoothedSpeedMps - 5) < 0.01,
    `average of 4,5,6 over 3 s is 5, got ${third.smoothedSpeedMps}`,
  );
  // Older fixes fall out of the window.
  const fourth = tracker.update(fix(15, 5500, 8));
  assert.ok(
    Math.abs(fourth.smoothedSpeedMps - 7) < 0.01,
    `only the 6 (t=3000) and 8 (t=5500) are within 3 s, got ${fourth.smoothedSpeedMps}`,
  );
  // No finite speeds in the window -> null.
  const noSpeed = tracker.update({
    lat: 33.1,
    lng: 35.6 + 20 / mPerDegLng,
    accuracy: 5,
    timestamp: 20000,
  });
  assert.equal(noSpeed.smoothedSpeedMps, null, "no finite speed -> null");
}

// --- R6: earliest-candidate acquisition -----------------------------------
// A rider standing +200m along the route acquires there instead of being
// held for the start point.
{
  const route = {
    requiresStartAcquisition: true,
    geometry: [
      { lat: 33.1, lng: 35.6, distanceFromStartMeters: 0 },
      { lat: 33.1, lng: 35.61, distanceFromStartMeters: 931 },
      { lat: 33.1, lng: 35.62, distanceFromStartMeters: 1862 },
    ],
  };
  const tracker = createRouteProgressTracker(route);
  // ~200m east of the start, on the line.
  const p = tracker.update({ lat: 33.1, lng: 35.60215, accuracy: 5, timestamp: 1_000 });
  assert.equal(p.hasAcquiredRoute, true, "mid-route join acquires");
  assert.ok(Math.abs(p.progressMeters - 200) < 30, `progress ~200m, got ${p.progressMeters}`);
}

// On a loop (start == end) standing at the shared point picks progress 0,
// not the far end.
{
  const route = {
    requiresStartAcquisition: true,
    geometry: [
      { lat: 33.1, lng: 35.6, distanceFromStartMeters: 0 },
      { lat: 33.1, lng: 35.61, distanceFromStartMeters: 931 },
      { lat: 33.105, lng: 35.61, distanceFromStartMeters: 1487 },
      { lat: 33.105, lng: 35.6, distanceFromStartMeters: 2418 },
      { lat: 33.1, lng: 35.6, distanceFromStartMeters: 2974 },
    ],
  };
  const tracker = createRouteProgressTracker(route);
  const p = tracker.update({ lat: 33.1, lng: 35.6, accuracy: 5, timestamp: 1_000 });
  assert.equal(p.hasAcquiredRoute, true, "loop start acquires");
  assert.ok(p.progressMeters < 100, `loop picks the start leg, got ${p.progressMeters}`);
}

// On an out-and-back shared corridor, the earliest qualifying projection is
// the outbound leg rather than the geometrically identical return leg.
{
  const route = {
    requiresStartAcquisition: true,
    geometry: [
      { lat: 33.1, lng: 35.6, distanceFromStartMeters: 0 },
      { lat: 33.1, lng: 35.61, distanceFromStartMeters: 931 },
      { lat: 33.1, lng: 35.62, distanceFromStartMeters: 1862 },
      { lat: 33.1, lng: 35.61, distanceFromStartMeters: 2793 },
      { lat: 33.1, lng: 35.6, distanceFromStartMeters: 3724 },
    ],
  };
  const tracker = createRouteProgressTracker(route);
  const p = tracker.update({ lat: 33.1, lng: 35.61, accuracy: 5, timestamp: 1_000 });
  assert.equal(p.hasAcquiredRoute, true, "out-and-back corridor acquires");
  assert.ok(
    Math.abs(p.progressMeters - 931) < 30,
    `outbound projection wins, got ${p.progressMeters}`,
  );
}

// Far from the route: still not acquired.
{
  const route = {
    requiresStartAcquisition: true,
    geometry: [
      { lat: 33.1, lng: 35.6, distanceFromStartMeters: 0 },
      { lat: 33.1, lng: 35.61, distanceFromStartMeters: 931 },
    ],
  };
  const tracker = createRouteProgressTracker(route);
  const p = tracker.update({ lat: 33.15, lng: 35.6, accuracy: 5, timestamp: 1_000 });
  assert.equal(p.hasAcquiredRoute, false, "off-route fix does not acquire");
}

console.log("route progress tests passed");
