import assert from "node:assert/strict";
import {
  cameraCorridorBearing,
  cameraCorridorForProgress,
  cameraDominantBearing,
  cameraManeuverCorridor,
  cameraTargetZoom,
  nextAppliedZoom,
  shouldReframeOverview,
} from "@cycleways/core/navigation/cameraViewport.js";
import { precomputeArcLength } from "@cycleways/core/utils/geometry.js";

const geometry = [
  { lat: 33.1, lng: 35.6 },
  { lat: 33.1, lng: 35.605 },
  { lat: 33.105, lng: 35.605 },
];
const arc = precomputeArcLength(geometry);

{
  const corridor = cameraCorridorForProgress(geometry, 300, {
    behindMeters: 30,
    lookaheadMeters: 400,
  });
  assert.ok(corridor.length >= 3, "corridor preserves the L-turn vertex");
  const corridorArc = precomputeArcLength(corridor);
  assert.ok(corridorArc.totalDistMeters > 420 && corridorArc.totalDistMeters < 440);
}

{
  const cueMeters = arc.cumDist[1];
  const corridor = cameraManeuverCorridor(geometry, cueMeters - 70, cueMeters, {
    postManeuverMeters: 100,
  });
  assert.ok(corridor.at(-1).lat > 33.1005, "maneuver includes geometry after decision");
}

assert.ok(Math.abs(cameraCorridorBearing(geometry, 0) - 90) < 2);
assert.ok(Math.abs(cameraDominantBearing(geometry) - 0) < 2);

{
  const small = cameraTargetZoom({
    geometry: cameraCorridorForProgress(geometry, 100, { lookaheadMeters: 150 }),
    viewport: { usableWidth: 350, usableHeight: 500 },
    pitch: 55,
    bearing: 90,
    minZoom: 12,
    maxZoom: 18,
  });
  const long = cameraTargetZoom({
    geometry,
    viewport: { usableWidth: 350, usableHeight: 500 },
    pitch: 55,
    bearing: 90,
    minZoom: 12,
    maxZoom: 18,
  });
  assert.ok(long < small, "longer corridor zooms out");
}

assert.equal(nextAppliedZoom({ current: 16, target: 16.1, dtMs: 1000 }), 16);
assert.equal(nextAppliedZoom({ current: 16, target: 17, dtMs: 1000 }), 16.7);
assert.deepEqual(
  shouldReframeOverview(null, {}),
  { reframe: true, reason: "initial" },
);
assert.deepEqual(
  shouldReframeOverview(
    { geometryKey: "a", viewportKey: "v", rider: geometry[0] },
    { geometryKey: "a", viewportKey: "v", rider: { ...geometry[0] } },
  ),
  { reframe: false, reason: "stable" },
);

console.log("camera viewport tests passed");
