import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getPlannerBuildModel } from "@cycleways/core/ui/routePlannerPresentation.js";

// Guardrail: the planner build summary is exactly 3 stats and never the
// detailed desktop set. If someone re-introduces a "CW segments"/"points"
// stat into the shared planner model, this fails.
const model = getPlannerBuildModel({
  points: [{}, {}], geometry: [{}, {}], distance: 1000,
  elevationGain: 10, elevationLoss: 5, selectedSegments: ["a"], activeDataPoints: [],
});
assert.equal(model.stats.length, 3);
assert.ok(!model.stats.some(([label]) => label.includes("CW") || label.includes("נקודות")));

const mobileBuildScreen = readFileSync("apps/mobile/src/screens/BuildScreen.jsx", "utf8");
assert.match(
  mobileBuildScreen,
  /state\.assets\.cwAlignmentGeometryData/,
  "mobile merges exact alignment geometry into the normal CW network source",
);
assert.match(
  mobileBuildScreen,
  /filter=\{\["==", \["get", "showDirectionArrow"\], true\]\}/,
  "mobile direction arrows are limited to separated or one-way physical features",
);
assert.doesNotMatch(
  mobileBuildScreen,
  /<ShapeSource id="cw-directional-alignments"/,
  "mobile no longer paints physical CW geometry as a separate teal diagnostic source",
);
console.log("test-planner-surface-parity: OK");
