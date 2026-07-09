import assert from "node:assert/strict";
import { buildApproachLeg } from "@cycleways/core/navigation/approachLeg.js";
import { buildRouteCues } from "@cycleways/core/navigation/navigationCues.js";

assert.equal(buildApproachLeg({ geometry: [] }), null);
assert.equal(buildApproachLeg({ geometry: [{ lat: 33.1, lng: 35.6 }] }), null);

const leg = buildApproachLeg(
  {
    geometry: [
      { lat: 33.1, lng: 35.6 },
      { lat: 33.1005, lng: 35.6005 },
      { lat: 33.1, lng: 35.601 },
    ],
    distanceMeters: 180,
  },
  { id: "approach:test", target: { lat: 33.1, lng: 35.601 } },
);

assert.ok(leg, "valid connector geometry builds an approach leg");
assert.equal(leg.route.id, "approach:test");
assert.equal(leg.route.canNavigate, true);
assert.equal(leg.route.requiresStartAcquisition, false);
assert.equal(leg.distanceMeters, 180);
assert.equal(leg.route.distanceMeters, 180);
assert.equal(leg.geometry.length, 3);
assert.equal(leg.geometry.every((point) => point.leg === "approach"), true);
assert.equal(leg.geometry[0].distanceFromStartMeters, 0);
assert.ok(
  leg.geometry[2].distanceFromStartMeters > leg.geometry[1].distanceFromStartMeters,
  "approach geometry has monotonic progress",
);
assert.equal(leg.route.approachTarget.lat, 33.1);

const cues = buildRouteCues(leg.route);
assert.equal(cues[0].type, "start");
assert.equal(cues[cues.length - 1].type, "arrive");

const derived = buildApproachLeg({
  geometry: [
    { lat: 33.1, lng: 35.6 },
    { lat: 33.1, lng: 35.601 },
  ],
});
assert.ok(derived.distanceMeters > 0, "distance falls back to geometry length");

console.log("approach-leg OK");
