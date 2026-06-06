import assert from "node:assert/strict";
import {
  buildVariableSpeedTimeline,
  createLinearRoutePlaybackSync,
  createVariableSpeedRoutePlaybackSync,
} from "../src/components/featured/routePlaybackSync.js";

const route = [
  { lat: 33.0, lng: 35.0 },
  { lat: 33.0, lng: 35.001 },
  { lat: 33.0, lng: 35.002 },
];

const sync = createLinearRoutePlaybackSync({
  durationSeconds: 20,
  routeGeometry: route,
});

assert.equal(sync.durationSeconds, 20);

const start = sync.timeToPosition(0);
assert.equal(start.fraction, 0);
assert.ok(Math.abs(start.lat - 33.0) < 1e-9);
assert.ok(Math.abs(start.lng - 35.0) < 1e-9);

const mid = sync.timeToPosition(10);
assert.ok(Math.abs(mid.fraction - 0.5) < 1e-6);
assert.ok(Math.abs(mid.lng - 35.001) < 1e-6);

const end = sync.timeToPosition(20);
assert.equal(end.fraction, 1);
assert.ok(Math.abs(end.lng - 35.002) < 1e-9);

assert.equal(sync.timeToPosition(-5).fraction, 0);
assert.equal(sync.timeToPosition(99).fraction, 1);

assert.equal(sync.positionToTime(0), 0);
assert.equal(sync.positionToTime(0.5), 10);
assert.equal(sync.positionToTime(1), 20);
assert.equal(sync.positionToTime(-1), 0);
assert.equal(sync.positionToTime(2), 20);
assert.equal(sync.positionToTime(Number.NaN), 0);

const onRoute = sync.snapClickToRoute({ lat: 33.0, lng: 35.001 });
assert.ok(onRoute, "expected on-route click to snap");
assert.ok(onRoute.distanceMeters < 5);
assert.ok(Math.abs(onRoute.fraction - 0.5) < 1e-3);
assert.ok(Math.abs(onRoute.lat - 33.0) < 1e-9);
assert.ok(Math.abs(onRoute.lng - 35.001) < 1e-6);

const far = sync.snapClickToRoute({ lat: 34.0, lng: 36.0 });
assert.equal(far, null);

const loose = sync.snapClickToRoute({ lat: 33.0005, lng: 35.001 }, 200);
assert.ok(loose, "expected larger threshold to accept nearby click");

const noCueTimeline = buildVariableSpeedTimeline({
  baseDurationSeconds: 100,
  routeDistanceMeters: 10_000,
  cueFractions: [],
  cueMaxFraction: 0.1,
  cueMaxMeters: 1000,
  fastRate: 2,
});
assert.equal(noCueTimeline.durationSeconds, 50);
assert.equal(noCueTimeline.fractionToTime(1), 50);
assert.equal(noCueTimeline.timeToFraction(25), 0.5);

const cueTimeline = buildVariableSpeedTimeline({
  baseDurationSeconds: 100,
  routeDistanceMeters: 10_000,
  cueFractions: [0.5],
  cueMaxFraction: 0.1,
  cueMaxMeters: 1000,
  fastRate: 2,
});
assert.equal(cueTimeline.durationSeconds, 60);
assert.equal(cueTimeline.fractionToTime(0.4), 20);
assert.equal(cueTimeline.fractionToTime(0.5), 30);
assert.equal(cueTimeline.timeToFraction(30), 0.5);
assert.equal(cueTimeline.fractionToTime(1), 60);

const variableSync = createVariableSpeedRoutePlaybackSync({
  baseDurationSeconds: 100,
  routeGeometry: route,
  routeDistanceMeters: 10_000,
  cueSlides: [{ routeFraction: 0.5 }],
  cueMaxFraction: 0.1,
  cueMaxMeters: 1000,
  fastRate: 2,
});
assert.equal(variableSync.durationSeconds, 60);
assert.ok(Math.abs(variableSync.timeToPosition(30).fraction - 0.5) < 1e-6);
assert.equal(variableSync.positionToTime(0.5), 30);

assert.throws(
  () =>
    createLinearRoutePlaybackSync({
      durationSeconds: 0,
      routeGeometry: route,
    }),
  /duration.*positive/i,
);

assert.throws(
  () =>
    createLinearRoutePlaybackSync({
      durationSeconds: 20,
      routeGeometry: [{ lat: 33.0, lng: 35.0 }],
    }),
  /geometry.*at least 2/i,
);

console.log("route playback sync tests passed");
