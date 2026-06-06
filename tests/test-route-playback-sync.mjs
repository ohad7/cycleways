import assert from "node:assert/strict";
import { createLinearRoutePlaybackSync } from "../src/components/featured/routePlaybackSync.js";

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
