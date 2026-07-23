import assert from "node:assert/strict";
import { validateDemoRideAgainstRoute } from "@cycleways/core/navigation/demoRideValidation.js";
import { demoScenarioFromBundle } from "@cycleways/core/navigation/demoScenario.js";
import {
  evaluateNavigationReplay,
  routeFitExclusions,
  scopeRideValidation,
  subtractBlockedCoverage,
  validationScopeForCapture,
} from "../scripts/demo-studio/pipeline.mjs";

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

const scope = validationScopeForCapture({
  proof: { inMs: 10_000, outMs: 30_000, preRollMs: 2_000 },
  showcases: [{ inMs: 10_000, outMs: 15_000 }, { inMs: 25_000, outMs: 30_000 }],
});
assert.deepEqual(scope, {
  captureEnvelope: { inMs: 8_000, outMs: 30_000 },
  showcases: [{ inMs: 10_000, outMs: 15_000 }, { inMs: 25_000, outMs: 30_000 }],
});

const noisySource = validateDemoRideAgainstRoute([
  { lat: 34, lng: 35, timestamp: 0 },
  { lat: 33, lng: 35, timestamp: 6_000 },
  { lat: 33.005, lng: 35.005, timestamp: 10_000 },
  { lat: 33.006, lng: 35.006, timestamp: 11_000 },
], routeState);
assert.equal(noisySource.pass, false, "the complete source contains an early route outlier and GPS gap");
const cleanEdit = scopeRideValidation(noisySource, {
  captureEnvelope: { inMs: 9_000, outMs: 12_000 },
  showcases: [{ inMs: 10_000, outMs: 12_000 }],
});
assert.equal(cleanEdit.pass, true, "source defects before the capture envelope do not block the edit");
assert.deepEqual(cleanEdit.sourceDiagnostics.nonBlockingGateCodes.sort(), ["gps-gaps", "route-fit-max"]);
assert.equal(cleanEdit.metrics.gaps.length, 0);
const boundaryCleanEdit = scopeRideValidation(noisySource, {
  captureEnvelope: { inMs: 6_000, outMs: 12_000 },
  showcases: [{ inMs: 6_000, outMs: 12_000 }],
});
assert.equal(boundaryCleanEdit.metrics.gaps.length, 0, "a GPS gap ending exactly at the capture in-point is outside the edit");

const mixedFixes = [
  { lat: 34, lng: 36, timestamp: 0, sourceId: "clip-001" },
  { lat: 34.0001, lng: 36.0001, timestamp: 1000, sourceId: "clip-001" },
  { lat: 34.0002, lng: 36.0002, timestamp: 2000, sourceId: "clip-001" },
  { lat: 33, lng: 35, timestamp: 5000, sourceId: "clip-002" },
  { lat: 33.005, lng: 35.005, timestamp: 6000, sourceId: "clip-002" },
  { lat: 33.01, lng: 35.01, timestamp: 7000, sourceId: "clip-002" },
];
const mixedValidation = validateDemoRideAgainstRoute(mixedFixes, routeState);
const routeExclusions = routeFitExclusions(mixedFixes, mixedValidation, [
  { id: "clip-001", timeline: { inMs: 0, outMs: 3000 } },
  { id: "clip-002", timeline: { inMs: 3000, outMs: 8000 } },
]);
assert.equal(routeExclusions.length, 1);
assert.deepEqual(
  {
    code: routeExclusions[0].code,
    sourceId: routeExclusions[0].sourceId,
    fromMs: routeExclusions[0].fromMs,
    toMs: routeExclusions[0].toMs,
    sampleCount: routeExclusions[0].sampleCount,
  },
  { code: "route-mismatch", sourceId: "clip-001", fromMs: 0, toMs: 3000, sampleCount: 3 },
);
assert.deepEqual(
  subtractBlockedCoverage([
    { sourceId: "clip-001", inMs: 0, outMs: 3000 },
    { sourceId: "clip-002", inMs: 3000, outMs: 8000 },
  ], routeExclusions),
  [{ sourceId: "clip-002", inMs: 3000, outMs: 8000 }],
);

const scopedReplay = evaluateNavigationReplay({ timeline: [
  { timestamp: 1_000, status: "off-route", offRoute: true, voiceText: "Early warning" },
  { timestamp: 9_500, status: "navigating", voiceText: "Pre-roll only" },
  { timestamp: 10_500, status: "navigating", voiceText: "Showcase cue" },
] }, { allowOffRoute: false, requireVoice: true }, {
  captureEnvelope: { inMs: 9_000, outMs: 12_000 },
  showcases: [{ inMs: 10_000, outMs: 12_000 }],
});
assert.equal(scopedReplay.pass, true);
assert.equal(scopedReplay.gates.find((gate) => gate.code === "off-route").actual, 0);
assert.equal(scopedReplay.sourceDiagnostics.offRouteOutsideCaptureCount, 1);
assert.deepEqual(scopedReplay.voiceEvents.map((event) => event.text), ["Showcase cue"]);

const voiceOnlyBetweenCuts = evaluateNavigationReplay({ timeline: [
  { timestamp: 20_000, status: "navigating", voiceText: "Cut from the final edit" },
] }, { requireVoice: true }, scope);
assert.equal(voiceOnlyBetweenCuts.pass, false, "presentation gates inspect the final showcase cuts, not the hidden middle");
assert.equal(voiceOnlyBetweenCuts.gates.find((gate) => gate.code === "voice-present").actual, 0);

console.log("demo ride validation tests passed");
