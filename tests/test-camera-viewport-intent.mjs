import assert from "node:assert/strict";
import {
  NAVIGATION_CAMERA_DEFAULTS,
  cameraIntentForStage,
  cameraLookaheadMeters,
} from "@cycleways/core/navigation/cameraViewportIntent.js";

const state = {
  progress: { smoothedSpeedMps: 5 },
  approach: { approachProgress: { smoothedSpeedMps: 4 } },
};

const expected = {
  "approach-resolving": ["overview", "direct", 55, "points-fit"],
  "approach-too-far": ["overview", "direct", 55, "retain-frame"],
  "approach-guide": ["follow", "approach", 55, "corridor-fit"],
  "approach-guide-pre-turn": ["follow", "approach", 38, "corridor-fit"],
  "join-route": ["follow", "join", 42, "corridor-fit"],
  "reacquire-route": ["follow", "main", 35, "corridor-fit"],
  ride: ["follow", "main", 55, "corridor-fit"],
  "pre-turn": ["follow", "main", 38, "corridor-fit"],
  "off-route": ["follow", "rejoin", 38, "corridor-fit"],
  arrival: ["follow", "arrival", 33, "local"],
  "arrived-local": ["overview", "arrival", 0, "local"],
  "ride-summary": ["overview", "summary", 0, "summary"],
};

for (const [stage, [mode, role, pitch, zoomKind]] of Object.entries(expected)) {
  const intent = cameraIntentForStage(stage, state);
  assert.equal(intent.stage, stage);
  assert.equal(intent.viewportMode, mode, `${stage} mode`);
  assert.equal(intent.geometryRole, role, `${stage} geometry role`);
  assert.equal(intent.pitch, pitch, `${stage} pitch`);
  assert.equal(intent.zoomPolicy.kind, zoomKind, `${stage} zoom kind`);
  assert.ok(intent.pitch >= intent.pitchRange.min && intent.pitch <= intent.pitchRange.max);
}

assert.equal(cameraIntentForStage("approach-too-far", state).holdFrame, true);

assert.equal(cameraLookaheadMeters(0), NAVIGATION_CAMERA_DEFAULTS.lookaheadMinMeters);
assert.equal(cameraLookaheadMeters(20), NAVIGATION_CAMERA_DEFAULTS.lookaheadMaxMeters);
assert.equal(cameraLookaheadMeters(5), 250);

// --- O1/O2: off-route is a follow stage framing the rejoin corridor --------
{
  const shot = cameraIntentForStage("off-route", {});
  assert.equal(shot.viewportMode, "follow", "off-route follows the rider");
  assert.equal(shot.geometryRole, "rejoin");
  assert.equal(shot.bearingPolicy, "route");
  assert.ok(shot.pitch >= 35 && shot.pitch <= 40, `riding pitch, got ${shot.pitch}`);
  assert.equal(shot.zoomPolicy.kind, "corridor-fit");
  assert.equal(shot.zoomPolicy.minZoom, 14.5, "zoom floored, never an overview dive");
  assert.notEqual(shot.transition.kind, "immediate", "no hard cut");
  assert.ok(shot.transition.durationMs >= 400, "eased transition");
}

console.log("camera viewport intent tests passed");
