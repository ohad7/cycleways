import assert from "node:assert/strict";
import { precomputeArcLength, pointAndBearingAtDistance } from "@cycleways/core/utils/geometry.js";

const geometry = [
  { lat: 33.1, lng: 35.6 },
  { lat: 33.1, lng: 35.61 }, // due east
];
const arc = precomputeArcLength(geometry);
{
  const mid = pointAndBearingAtDistance(arc, geometry, arc.totalDistMeters / 2);
  assert.ok(Math.abs(mid.point.lat - 33.1) < 1e-9, "stays on latitude");
  assert.ok(Math.abs(mid.point.lng - 35.605) < 1e-4, "midpoint lng");
  assert.ok(Math.abs(mid.bearingDeg - 90) < 1, "due-east bearing ~90");
}
{
  const clampLo = pointAndBearingAtDistance(arc, geometry, -50);
  assert.deepEqual(clampLo.point, { lat: 33.1, lng: 35.6 }, "clamp below 0");
  const clampHi = pointAndBearingAtDistance(arc, geometry, 1e9);
  assert.ok(Math.abs(clampHi.point.lng - 35.61) < 1e-9, "clamp above total");
}
console.log("test-navigation-smoothing OK");
