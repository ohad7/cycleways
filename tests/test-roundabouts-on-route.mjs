import assert from "node:assert/strict";
import { roundaboutsOnRoute } from "@cycleways/core/routing/roundaboutsOnRoute.js";
import { buildNavigationGeometry } from "@cycleways/core/navigation/navigationRoute.js";

const candidate = {
  id: "r1",
  classification: "roundabout",
  center: { lat: 33, lng: 35.002 },
  radiusM: 30,
  bbox: [35.001, 32.99995, 35.003, 33.00005],
  paths: [[[33, 35.001], [33, 35.003]]],
};

const straight = buildNavigationGeometry([
  { lat: 33, lng: 35 },
  { lat: 33, lng: 35.004 },
]);
const hits = roundaboutsOnRoute([candidate], straight);
assert.equal(hits.length, 1);
assert.equal(hits[0].complete, true);
assert.ok(hits[0].entryMeters > 0 && hits[0].exitMeters < straight.at(-1).distanceFromStartMeters);

const perpendicular = buildNavigationGeometry([
  { lat: 32.999, lng: 35.002 },
  { lat: 33.001, lng: 35.002 },
]);
assert.equal(roundaboutsOnRoute([candidate], perpendicular).length, 0);

const repeated = buildNavigationGeometry([
  { lat: 33, lng: 35 },
  { lat: 33, lng: 35.004 },
  { lat: 33.001, lng: 35.004 },
  { lat: 33.001, lng: 35 },
  { lat: 33, lng: 35 },
  { lat: 33, lng: 35.004 },
]);
assert.equal(roundaboutsOnRoute([candidate], repeated).length, 2);

const startsInside = buildNavigationGeometry([
  { lat: 33, lng: 35.002 },
  { lat: 33, lng: 35.004 },
]);
assert.equal(roundaboutsOnRoute([candidate], startsInside)[0].complete, false);

const mini = {
  id: "m1",
  classification: "mini_roundabout",
  center: { lat: 33, lng: 35.002 },
  radiusM: 10,
  bbox: [35.0018, 32.9998, 35.0022, 33.0002],
  paths: [],
};
assert.equal(roundaboutsOnRoute([mini], straight).length, 1);
assert.deepEqual(roundaboutsOnRoute(null, straight), []);

console.log("roundabouts-on-route tests passed");
