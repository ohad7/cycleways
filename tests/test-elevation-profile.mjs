import assert from "node:assert/strict";
import {
  buildElevationProfile,
  findClosestElevationPoint,
} from "@cycleways/core/ui/elevationProfile.js";

const geometry = [
  { lat: 33.10, lng: 35.58, elevation: 80 },
  { lat: 33.11, lng: 35.585, elevation: 120 },
  { lat: 33.12, lng: 35.59, elevation: 160 },
  { lat: 33.13, lng: 35.595, elevation: 110 },
  { lat: 33.14, lng: 35.60, elevation: 90 },
];

const profile = buildElevationProfile(geometry);
assert.ok(profile, "profile should be built for valid geometry");
assert.ok(Array.isArray(profile.elevationData) && profile.elevationData.length > 0, "elevationData present");
assert.ok(Array.isArray(profile.clusterPaths) && profile.clusterPaths.length > 0, "clusterPaths present");
assert.ok(typeof profile.outlinePath === "string" && profile.outlinePath.startsWith("M"), "outlinePath is an SVG path");
for (const p of profile.elevationData) {
  assert.ok(p.distancePercent >= 0 && p.distancePercent <= 100, "distancePercent in [0,100]");
  assert.ok(Number.isFinite(p.elevation), "elevation finite");
  assert.ok(p.coord && Number.isFinite(p.coord.lat) && Number.isFinite(p.coord.lng), "coord present");
}
for (const c of profile.clusterPaths) {
  assert.ok(typeof c.d === "string" && c.d.includes("Z"), "cluster path closed");
  assert.ok(typeof c.color === "string" && c.color.startsWith("#"), "cluster has color");
}
const mid = findClosestElevationPoint(profile.elevationData, 50);
assert.ok(mid && Math.abs(mid.distancePercent - 50) < 5, "closest point near 50%");
assert.equal(buildElevationProfile([]), null, "empty geometry -> null");
assert.equal(buildElevationProfile([{ lat: 1, lng: 1, elevation: 10 }]), null, "single point -> null");
assert.equal(buildElevationProfile([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }]), null, "missing elevation -> null");
assert.equal(findClosestElevationPoint([], 50), null, "empty elevationData -> null");
console.log("✅ test-elevation-profile passed");
