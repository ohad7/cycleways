import assert from "node:assert/strict";
import { roundaboutsOnRoute } from "@cycleways/core/routing/roundaboutsOnRoute.js";
import { buildNavigationGeometry } from "@cycleways/core/navigation/navigationRoute.js";
import { buildRouteCues } from "@cycleways/core/navigation/navigationCues.js";

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

// Regression: this shared route exits a roundabout straight and turns right
// only 9 m later. A fixed 20 m exit sample used to cross the later turn and
// incorrectly classify the roundabout itself as right.
const closeTurnRoute = buildNavigationGeometry([
  { lat: 33.1851848, lng: 35.6200612 },
  { lat: 33.185248, lng: 35.620163 },
  { lat: 33.185517, lng: 35.620837 },
  { lat: 33.185645, lng: 35.621124 },
  { lat: 33.1859231, lng: 35.6213632 },
  { lat: 33.186003, lng: 35.621432 },
  { lat: 33.186454, lng: 35.621677 },
  { lat: 33.186476, lng: 35.62165 },
  { lat: 33.186503, lng: 35.621633 },
  { lat: 33.186534, lng: 35.621626 },
  { lat: 33.186565, lng: 35.621629 },
  { lat: 33.186594, lng: 35.621644 },
  { lat: 33.186617, lng: 35.621668 },
  { lat: 33.186633, lng: 35.621699 },
  { lat: 33.186641, lng: 35.621734 },
  { lat: 33.18664, lng: 35.621771 },
  { lat: 33.186631, lng: 35.621805 },
  { lat: 33.186834, lng: 35.621883 },
  { lat: 33.186897, lng: 35.621942 },
  { lat: 33.1867181, lng: 35.6224191 },
  { lat: 33.186543, lng: 35.622886 },
  { lat: 33.186386, lng: 35.623326 },
  { lat: 33.1860747, lng: 35.6241452 },
]);
const closeTurnRoundabout = {
  id: "osm-ways:323780427",
  classification: "roundabout",
  center: { lat: 33.1865402, lng: 35.6217462 },
  radiusM: 11.9,
  bbox: [35.6216255, 33.1864346, 35.6218725, 33.1866412],
  paths: [[
    [33.1865156, 35.6218702], [33.1865497, 35.6218725],
    [33.1865825, 35.6218614], [33.1866105, 35.6218383],
    [33.1866307, 35.6218054], [33.1866404, 35.6217708],
    [33.1866412, 35.6217343], [33.1866331, 35.621699],
    [33.1866167, 35.6216682], [33.1865935, 35.6216444],
    [33.1865649, 35.6216295], [33.1865339, 35.6216255],
    [33.1865033, 35.6216326], [33.1864758, 35.6216504],
    [33.186454, 35.621677], [33.186439, 35.6217134],
    [33.1864346, 35.6217536], [33.1864414, 35.6217933],
    [33.1864585, 35.6218284], [33.1864841, 35.621855],
    [33.1865156, 35.6218702],
  ]],
};
const closeTurnHits = roundaboutsOnRoute([closeTurnRoundabout], closeTurnRoute);
assert.equal(closeTurnHits.length, 1);
const closeTurnCues = buildRouteCues({
  geometry: closeTurnRoute,
  junctions: [
    ...closeTurnHits,
    { kind: "junction", lat: 33.186897, lng: 35.621942 },
  ],
});
assert.deepEqual(
  closeTurnCues.filter((cue) => cue.type === "roundabout").map((cue) => cue.direction),
  ["straight"],
);
assert.deepEqual(
  closeTurnCues.filter((cue) => cue.type === "turn").map((cue) => cue.direction),
  ["right"],
);
const closeRoundaboutCue = closeTurnCues.find((cue) => cue.type === "roundabout");
const closeRightTurnCue = closeTurnCues.find((cue) => cue.type === "turn");
assert.deepEqual(closeRoundaboutCue.thenManeuver, { type: "turn", direction: "right" });
assert.equal(closeRightTurnCue.compoundPreviousType, "roundabout");
assert.equal(
  closeRightTurnCue.compoundPreviousDistanceMeters,
  closeRoundaboutCue.distanceMeters,
);

console.log("roundabouts-on-route tests passed");
