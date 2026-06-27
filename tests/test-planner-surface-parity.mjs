import assert from "node:assert/strict";
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
console.log("test-planner-surface-parity: OK");
