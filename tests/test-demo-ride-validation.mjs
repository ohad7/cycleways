import assert from "node:assert/strict";
import { validateDemoRideAgainstRoute } from "@cycleways/core/navigation/demoRideValidation.js";
import { demoScenarioFromBundle } from "@cycleways/core/navigation/demoScenario.js";
import { evaluateNavigationReplay } from "../scripts/demo-studio/pipeline.mjs";

const routeState = { geometry: [{ lat: 33, lng: 35 }, { lat: 33.01, lng: 35.01 }], points: [], selectedSegments: [], segmentSpans: [] };
const fixes = [
  { lat: 33, lng: 35, timestamp: 0, speed: 2, heading: 0, accuracy: 8 },
  { lat: 33.005, lng: 35.005, timestamp: 1000, speed: 2, heading: 0, accuracy: 8 },
  { lat: 33.01, lng: 35.01, timestamp: 2000, speed: 2, heading: 0, accuracy: 8 },
];
assert.equal(validateDemoRideAgainstRoute(fixes, routeState).pass, true);
const scenario = demoScenarioFromBundle({
  schemaVersion: 1,
  id: "ride-one",
  routeState,
  fixes,
  capture: { proof: { inMs: 0, outMs: 2000, preRollMs: 0 } },
  expectations: {},
  provenance: {},
});
assert.equal(scenario.track.fixes.length, 3);
assert.equal(evaluateNavigationReplay({ timeline: [{ timestamp: 1, status: "navigating", voiceText: "Turn" }] }, { forbiddenStatuses: ["error"], allowOffRoute: false, requireVoice: true }).pass, true);
assert.equal(evaluateNavigationReplay({ timeline: [{ timestamp: 1, status: "off-route" }] }, { allowOffRoute: false }).pass, false);
assert.equal(evaluateNavigationReplay({ timeline: [{ timestamp: 1, status: "navigating" }] }, { requireVoice: true }).pass, false);

console.log("demo ride validation tests passed");
