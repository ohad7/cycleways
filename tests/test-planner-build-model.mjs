import assert from "node:assert/strict";
import { getPlannerBuildModel } from "@cycleways/core/ui/routePlannerPresentation.js";

// Empty route: no stats, nothing downloadable.
const empty = getPlannerBuildModel({
  points: [],
  geometry: [],
  distance: 0,
  elevationGain: 0,
  elevationLoss: 0,
  selectedSegments: [],
  activeDataPoints: [],
});
assert.equal(empty.hasRoute, false);
assert.equal(empty.canDownload, false);
assert.deepEqual(empty.stats, []);

// Built route: exactly 3 stats, in order, no "CW segments" or "points".
const built = getPlannerBuildModel({
  points: [{}, {}],
  geometry: [{}, {}, {}],
  distance: 5230,
  elevationGain: 142,
  elevationLoss: 87,
  selectedSegments: ["a", "b", "c"],
  activeDataPoints: [{ id: "x" }],
});
assert.equal(built.hasRoute, true);
assert.equal(built.canDownload, true);
assert.equal(built.stats.length, 3);
assert.deepEqual(
  built.stats.map(([label]) => label),
  ["אורך", "טיפוס", "ירידה"],
);
assert.deepEqual(built.stats[0], ["אורך", "5.2 ק״מ"]);
assert.deepEqual(built.stats[1], ["טיפוס", "142 מ׳"]);
assert.deepEqual(built.stats[2], ["ירידה", "87 מ׳"]);
// No stat mentions CW segments.
assert.ok(!built.stats.some(([label]) => label.includes("CW")));
assert.equal(built.poiCount, 1);

console.log("test-planner-build-model: OK");
