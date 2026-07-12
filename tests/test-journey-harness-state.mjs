import assert from "node:assert/strict";
import {
  deriveRidePlanJourneyFixes,
  initialJourneyPlaybackState,
  journeyLifecycleLabel,
  journeyPlaybackPatch,
  journeyRequiresRideIntro,
  shouldAcceptNativeLocationUpdate,
} from "../apps/mobile/src/navigation/journeyHarnessState.js";

assert.equal(shouldAcceptNativeLocationUpdate({ journeyActive: false }), true);
assert.equal(
  shouldAcceptNativeLocationUpdate({ journeyActive: true }),
  false,
  "native GPS cannot overwrite an active journey's deterministic location",
);

const derivedFixes = deriveRidePlanJourneyFixes(
  {
    approachTier: "at",
    effectiveRoute: {
      canNavigate: true,
      geometry: [
        { lat: 33.1, lng: 35.6, distanceFromStartMeters: 0 },
        { lat: 33.1, lng: 35.602, distanceFromStartMeters: 186 },
      ],
    },
  },
  { mode: "cam", startTimestamp: 5000 },
);
assert.ok(derivedFixes.length >= 2);
assert.equal(derivedFixes[0].timestamp, 5000);
assert.ok(derivedFixes.at(-1).timestamp <= 20_000, "CAM branch is a short inspection run");
assert.deepEqual(
  deriveRidePlanJourneyFixes({ approachTier: "near", effectiveRoute: { canNavigate: true } }),
  [],
  "only an already-reached selected start can discard the approach fixture",
);

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
assert.equal(journeyLifecycleLabel(introState), "BEFORE START · WAITING");

const sessionState = initialJourneyPlaybackState({ resolved, bookmark: session, mode: "cam" });
assert.match(journeyLifecycleLabel(sessionState), /TAP THE REAL START BUTTON/);

const rebuilding = { ...sessionState, ...journeyPlaybackPatch({ running: true, warming: true }) };
assert.equal(rebuilding.lifecycle, "rebuilding");
assert.equal(rebuilding.waitingForStart, false);
assert.equal(journeyLifecycleLabel(rebuilding), "REBUILDING SESSION STATE");

const holding = { ...sessionState, ...journeyPlaybackPatch({ completed: true }) };
assert.equal(holding.lifecycle, "hold");
assert.equal(journeyLifecycleLabel(holding), "BOOKMARK REACHED · FROZEN");

console.log("journey harness state tests passed");
