import assert from "node:assert/strict";
import {
  initialJourneyPlaybackState,
  journeyLifecycleLabel,
  journeyPlaybackPatch,
  journeyRequiresRideIntro,
} from "../apps/mobile/src/navigation/journeyHarnessState.js";

const resolved = {
  name: "journey",
  entryMode: "ride-intro",
  fixes: [{ timestamp: 0 }, { timestamp: 1000 }],
};
const intro = {
  id: "intro",
  label: "Intro",
  phase: "pre-start",
  startAction: "hold",
  expectedStage: "intro-start-facing",
};
const session = {
  id: "ride",
  label: "Ride",
  phase: "post-start",
  startAction: "require-confirm",
  expectedStage: "ride",
};

assert.equal(journeyRequiresRideIntro(resolved), true);
assert.equal(journeyRequiresRideIntro({ entryMode: "session" }), false);

const introState = initialJourneyPlaybackState({ resolved, bookmark: intro, mode: "cam" });
assert.equal(introState.lifecycle, "waiting-for-start");
assert.equal(introState.waitingForStart, true);
assert.equal(introState.expectedStage, "intro-start-facing");
assert.match(journeyLifecycleLabel(introState), /HOLD/);

const sessionState = initialJourneyPlaybackState({ resolved, bookmark: session, mode: "cam" });
assert.match(journeyLifecycleLabel(sessionState), /TAP THE REAL START BUTTON/);

const rebuilding = { ...sessionState, ...journeyPlaybackPatch({ running: true, warming: true }) };
assert.equal(rebuilding.lifecycle, "rebuilding");
assert.equal(rebuilding.waitingForStart, false);
assert.equal(journeyLifecycleLabel(rebuilding), "REBUILDING SESSION STATE");

const holding = { ...sessionState, ...journeyPlaybackPatch({ completed: true }) };
assert.equal(holding.lifecycle, "hold");
assert.equal(journeyLifecycleLabel(holding), "HOLD");

console.log("journey harness state tests passed");
