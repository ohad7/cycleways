import assert from "node:assert/strict";
import { deriveRidePlanJourneyFixes } from "../apps/mobile/src/navigation/journeyHarnessState.js";
import {
  NAV_ACTIONS,
  createNavigationSession,
} from "@cycleways/core/navigation/navigationSession.js";
import {
  createRidePlan,
  ridePlanNeedsConnectorPreview,
} from "@cycleways/core/navigation/ridePlan.js";
import { scenarios } from "@cycleways/core/navigation/scenarios/index.js";
import { resolveScenario } from "@cycleways/core/navigation/scenarios/resolve.js";

const resolved = resolveScenario(
  scenarios.find((scenario) => scenario.name === "journey-guided-approach"),
);
const setupPoint = resolved.navigationRoute.geometry.find(
  (point) => point.distanceFromStartMeters > 1000,
);
const setupFix = {
  lat: setupPoint.lat,
  lng: setupPoint.lng,
  accuracy: 5,
  speed: 0,
  timestamp: 0,
};
const official = createRidePlan(
  resolved.navigationRoute,
  { direction: "forward", startMode: "official" },
  setupFix,
  setupFix.timestamp,
);
const nearest = createRidePlan(
  resolved.navigationRoute,
  { direction: "forward", startMode: "nearest", startProgressMeters: null },
  setupFix,
  setupFix.timestamp,
);

assert.ok(official.distanceToStartMeters > 500);
assert.equal(ridePlanNeedsConnectorPreview(official), true);
assert.equal(nearest.approachTier, "at");
assert.ok(nearest.distanceToStartMeters < 1);
assert.equal(ridePlanNeedsConnectorPreview(nearest), false);
assert.notEqual(nearest.effectiveRoute.id, official.effectiveRoute.id);

const fixes = deriveRidePlanJourneyFixes(nearest, {
  mode: "cam",
  startTimestamp: setupFix.timestamp,
});
assert.ok(fixes.length >= 2);
const session = createNavigationSession(nearest.effectiveRoute);
session.dispatch({ type: NAV_ACTIONS.START });
session.dispatch({ type: NAV_ACTIONS.PERMISSION_GRANTED });
const started = session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fixes[0] });
assert.equal(started.status, "navigating");
assert.equal(started.progress.hasAcquiredRoute, true);
assert.equal(started.approach.ownershipTier, "unknown");
assert.notEqual(started.cueEvent?.acquisition, "join-route");

console.log("journey start-choice tests passed");
