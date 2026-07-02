import assert from "node:assert/strict";
import { createVideoSync } from "../packages/core/src/featured/videoSync.js";
import {
  buildCumulativeDistances,
  pointAtFraction,
} from "../packages/core/src/domain/routeGeometryMath.js";

const simpleRoute = [
  { lat: 33.0, lng: 35.0 },
  { lat: 33.0, lng: 35.01 },
];

// Valid keyframes — should succeed
const sync = createVideoSync({
  keyframes: [
    { t: 0, lat: 33.0, lng: 35.0 },
    { t: 10, lat: 33.0, lng: 35.01 },
  ],
  videoDuration: 10,
  routeGeometry: simpleRoute,
});
assert.ok(sync, "createVideoSync returns a non-null object");

// Empty keyframes — must throw
assert.throws(
  () =>
    createVideoSync({
      keyframes: [],
      videoDuration: 10,
      routeGeometry: simpleRoute,
    }),
  /at least 2 keyframes/i,
);

// Not sorted by t — must throw
assert.throws(
  () =>
    createVideoSync({
      keyframes: [
        { t: 10, lat: 33.0, lng: 35.01 },
        { t: 0, lat: 33.0, lng: 35.0 },
      ],
      videoDuration: 10,
      routeGeometry: simpleRoute,
    }),
  /sorted by t/i,
);

// First t must be >= 0 (negative rejected)
assert.throws(
  () =>
    createVideoSync({
      keyframes: [
        { t: -1, lat: 33.0, lng: 35.0 },
        { t: 10, lat: 33.0, lng: 35.01 },
      ],
      videoDuration: 10,
      routeGeometry: simpleRoute,
    }),
  /first keyframe.*t >= 0/i,
);

// Last t must be <= videoDuration (past-end rejected)
assert.throws(
  () =>
    createVideoSync({
      keyframes: [
        { t: 0, lat: 33.0, lng: 35.0 },
        { t: 11, lat: 33.0, lng: 35.01 },
      ],
      videoDuration: 10,
      routeGeometry: simpleRoute,
    }),
  /last keyframe.*videoDuration/i,
);

// Sparse coverage (first > 0, last < duration) is accepted; runtime adds
// virtual route start/end anchors so the video begins at 0m and ends at 100%.
const sparseSync = createVideoSync({
  keyframes: [
    { t: 2, lat: 33.0, lng: 35.0 },
    { t: 8, lat: 33.0, lng: 35.01 },
  ],
  videoDuration: 10,
  routeGeometry: simpleRoute,
});
const before = sparseSync.timeToPosition(0);
assert.ok(Math.abs(before.lng - 35.0) < 1e-9, "t=0 anchors to route start");
assert.equal(before.fraction, 0, "t=0 fraction is route start");
const after = sparseSync.timeToPosition(10);
assert.ok(Math.abs(after.lng - 35.01) < 1e-9, "t=duration anchors to route end");
assert.equal(after.fraction, 1, "t=duration fraction is route end");

// If an imprecise t=0 keyframe snaps down-route, the virtual boundary still
// wins so the opening distance reads 0m.
const impreciseStartSync = createVideoSync({
  keyframes: [
    { t: 0, lat: 33.0, lng: 35.005 },
    { t: 10, lat: 33.0, lng: 35.01 },
  ],
  videoDuration: 10,
  routeGeometry: simpleRoute,
});
const impreciseStart = impreciseStartSync.timeToPosition(0);
assert.equal(impreciseStart.fraction, 0);
assert.equal(impreciseStartSync.positionToTime(0), 0);

// Route too short (< 2 points) — must throw
assert.throws(
  () =>
    createVideoSync({
      keyframes: [
        { t: 0, lat: 33.0, lng: 35.0 },
        { t: 10, lat: 33.0, lng: 35.0 },
      ],
      videoDuration: 10,
      routeGeometry: [{ lat: 33.0, lng: 35.0 }],
    }),
  /route.*at least 2/i,
);

// timeToPosition along a straight east-west route
const straightRoute = [
  { lat: 33.0, lng: 35.0 },
  { lat: 33.0, lng: 35.001 },
  { lat: 33.0, lng: 35.002 },
];

const straightSync = createVideoSync({
  keyframes: [
    { t: 0, lat: 33.0, lng: 35.0 },
    { t: 10, lat: 33.0, lng: 35.002 },
  ],
  videoDuration: 10,
  routeGeometry: straightRoute,
});

const start = straightSync.timeToPosition(0);
assert.ok(Math.abs(start.lat - 33.0) < 1e-9);
assert.ok(Math.abs(start.lng - 35.0) < 1e-9);
assert.ok(Math.abs(start.fraction - 0) < 1e-6);

const mid = straightSync.timeToPosition(5);
assert.ok(Math.abs(mid.lat - 33.0) < 1e-9);
assert.ok(Math.abs(mid.lng - 35.001) < 1e-6);
assert.ok(Math.abs(mid.fraction - 0.5) < 1e-3);

const end = straightSync.timeToPosition(10);
assert.ok(Math.abs(end.lat - 33.0) < 1e-9);
assert.ok(Math.abs(end.lng - 35.002) < 1e-9);
assert.ok(Math.abs(end.fraction - 1) < 1e-6);

// Clamping: t outside [0, duration]
const clampLow = straightSync.timeToPosition(-1);
assert.equal(clampLow.fraction, 0);
const clampHigh = straightSync.timeToPosition(99);
assert.equal(clampHigh.fraction, 1);

// Sparse keyframes on an L-shape: marker stays on the path, not in lat/lng space
const lRoute = [
  { lat: 33.0, lng: 35.0 },
  { lat: 33.0, lng: 35.01 },   // 1 km east
  { lat: 33.01, lng: 35.01 },  // 1 km north
];
const lSync = createVideoSync({
  keyframes: [
    { t: 0, lat: 33.0, lng: 35.0 },
    { t: 10, lat: 33.01, lng: 35.01 },
  ],
  videoDuration: 10,
  routeGeometry: lRoute,
});
// At t=5 (halfway through video, halfway along route by length),
// the marker should be at the corner of the L, not at the lat/lng midpoint.
const lMid = lSync.timeToPosition(5);
assert.ok(
  Math.abs(lMid.lng - 35.01) < 1e-3,
  `expected lng near corner (35.01), got ${lMid.lng}`,
);
assert.ok(
  Math.abs(lMid.lat - 33.0) < 1e-3,
  `expected lat near corner (33.0), got ${lMid.lat}`,
);

// positionToTime should be the inverse of timeToPosition (round-trip)
const roundtripSync = createVideoSync({
  keyframes: [
    { t: 0, lat: 33.0, lng: 35.0 },
    { t: 4, lat: 33.0, lng: 35.001 },
    { t: 10, lat: 33.0, lng: 35.002 },
  ],
  videoDuration: 10,
  routeGeometry: straightRoute,
});

for (const t of [0, 1.5, 4, 7, 10]) {
  const pos = roundtripSync.timeToPosition(t);
  const tBack = roundtripSync.positionToTime(pos.fraction);
  assert.ok(
    Math.abs(tBack - t) < 0.01,
    `round-trip at t=${t} got ${tBack}`,
  );
}

// Clamping
assert.equal(roundtripSync.positionToTime(-0.5), 0);
assert.equal(roundtripSync.positionToTime(1.5), 10);

// snapClickToRoute
const clickSync = createVideoSync({
  keyframes: [
    { t: 0, lat: 33.0, lng: 35.0 },
    { t: 10, lat: 33.0, lng: 35.002 },
  ],
  videoDuration: 10,
  routeGeometry: [
    { lat: 33.0, lng: 35.0 },
    { lat: 33.0, lng: 35.002 },
  ],
});

// Click essentially on the route midpoint
const onRoute = clickSync.snapClickToRoute({ lat: 33.0, lng: 35.001 });
assert.ok(onRoute, "expected snap to succeed for on-route click");
assert.ok(onRoute.distanceMeters < 5, "snap distance should be near zero");
assert.ok(Math.abs(onRoute.fraction - 0.5) < 1e-3);

// Click far away — default 80m threshold should reject
const farAway = clickSync.snapClickToRoute({ lat: 34.0, lng: 36.0 });
assert.equal(farAway, null, "expected null for click far from route");

// Custom larger threshold accepts a moderately-distant click
const loose = clickSync.snapClickToRoute(
  { lat: 33.0005, lng: 35.001 }, // ~55m north of the route at midpoint
  200,
);
assert.ok(loose, "expected loose threshold to accept the click");

// Optional keyframe fractions preserve loop-seam intent when coordinates are
// geometrically ambiguous between the start and end of a route.
const seamRoute = [
  { lat: 33.0, lng: 35.0 },
  { lat: 33.0, lng: 35.004 },
  { lat: 33.004, lng: 35.004 },
  { lat: 33.004, lng: 35.0 },
  { lat: 33.0, lng: 35.0001 },
];
const seamCumulative = buildCumulativeDistances(seamRoute);
const lateSeamPoint = pointAtFraction(seamRoute, seamCumulative, 0.996);
const seamSync = createVideoSync({
  keyframes: [
    { t: 0, lat: seamRoute[0].lat, lng: seamRoute[0].lng, fraction: 0 },
    { t: 10, lat: lateSeamPoint.lat, lng: lateSeamPoint.lng, fraction: 0.996 },
  ],
  videoDuration: 10,
  routeGeometry: seamRoute,
});
const lateSeam = seamSync.timeToPosition(10);
assert.ok(lateSeam.fraction > 0.99, `expected late seam fraction, got ${lateSeam.fraction}`);

assert.throws(
  () =>
    createVideoSync({
      keyframes: [
        { t: 0, lat: 33.0, lng: 35.0, fraction: -0.1 },
        { t: 10, lat: 33.0, lng: 35.002, fraction: 1 },
      ],
      videoDuration: 10,
      routeGeometry: straightRoute,
    }),
  /fraction.*between 0 and 1/i,
);

console.log("videoSync validation tests passed");
