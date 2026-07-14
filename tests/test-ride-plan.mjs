import assert from "node:assert/strict";
import { buildNavigationGeometry } from "../packages/core/src/navigation/navigationRoute.js";
import {
  buildRidePlanCandidates,
  classifyApproach,
  createRidePlan,
  ridePlanNeedsDirectApproachPreview,
  ridePlanNeedsConnectorPreview,
  setupLocationQuality,
} from "../packages/core/src/navigation/ridePlan.js";
import { buildRouteAttestation } from "../packages/core/src/routing/routeAttestation.js";

const now = 10_000;
const geometry = buildNavigationGeometry([
  { lat: 32, lng: 35 },
  { lat: 32, lng: 35.02 },
  { lat: 32.01, lng: 35.02 },
]);
const route = {
  id: "catalog:test",
  canNavigate: true,
  geometry,
  points: [geometry[0], geometry.at(-1)],
  distanceMeters: geometry.at(-1).distanceFromStartMeters,
  routeShape: { type: "linear" },
  activeDataPoints: [],
  segmentSpans: [],
  routingValidation: buildRouteAttestation({
    validationContext: {
      baseRoutingSchemaVersion: 3,
      graphVersion: "fixture-v3",
      policyId: "il-bicycle-v1",
      policyDigest: "fixture-policy",
      routingContextDigest: "fixture-context",
    },
    traversalSlices: [{
      edgeShareId: 1,
      fromFraction: 0,
      toFraction: 1,
      distanceMeters: geometry.at(-1).distanceFromStartMeters,
      policyState: "allowed",
      policyReason: "fixture",
      oppositePolicyState: "allowed",
      oppositePolicyReason: "fixture",
    }],
    waypointOccurrences: [
      { id: "a", lat: 32, lng: 35, baseEdgeShareId: 1, baseEdgeFraction: 0 },
      { id: "b", lat: 32.01, lng: 35.02, baseEdgeShareId: 1, baseEdgeFraction: 1 },
    ],
    legBoundaries: [{ startTraversal: 0, endTraversal: 1 }],
    geometry,
  }),
};

assert.equal(setupLocationQuality(null, now), "unavailable");
assert.equal(setupLocationQuality({ lat: 32, lng: 35, accuracy: 5, timestamp: now - 31_000 }, now), "stale");
assert.equal(setupLocationQuality({ lat: 32, lng: 35, accuracy: 101, timestamp: now }, now), "inaccurate");
assert.equal(setupLocationQuality({ lat: 32, lng: 35, accuracy: 5, timestamp: now }, now), "fresh");

assert.equal(classifyApproach(null), "unknown");
assert.equal(classifyApproach(20, 5), "at");
assert.equal(classifyApproach(500, 5), "near");
assert.equal(classifyApproach(1500, 5), "far");

const fix = { lat: 32.0001, lng: 35.019, accuracy: 8, timestamp: now };
const candidates = buildRidePlanCandidates(route, fix);
assert.ok(candidates.nearest.progressMeters > 1000);
assert.equal(candidates.nearestRequiresConfirmation, true);

const official = createRidePlan(route, { direction: "forward", startMode: "official" }, fix, now);
assert.equal(official.startMode, "official");
assert.equal(official.skippedMeters, 0);
assert.equal(ridePlanNeedsConnectorPreview(official), true);
assert.equal(ridePlanNeedsDirectApproachPreview(official), false);

const tooFarPreview = {
  ...official,
  distanceToStartMeters: 10_001,
  approachTier: "far",
};
assert.equal(ridePlanNeedsConnectorPreview(tooFarPreview), false);
assert.equal(ridePlanNeedsDirectApproachPreview(tooFarPreview), true);

const nearest = createRidePlan(
  route,
  { direction: "forward", startMode: "nearest", startProgressMeters: null },
  fix,
  now,
);
assert.equal(nearest.startMode, "nearest");
assert.ok(nearest.skippedMeters > 1000);
assert.ok(nearest.guidedDistanceMeters < route.distanceMeters);
assert.equal(nearest.requiresSkipConfirmation, true);

const customWithNullProgress = createRidePlan(
  route,
  {
    direction: "forward",
    startMode: "custom",
    startProgressMeters: null,
    selectedPoint: geometry[1],
  },
  fix,
  now,
);
assert.equal(customWithNullProgress.startMode, "custom");
assert.ok(customWithNullProgress.startProgressMeters > 1000);

const restoredNearest = createRidePlan(
  route,
  {
    direction: "forward",
    startMode: "nearest",
    startProgressMeters: nearest.startProgressMeters,
  },
  { lat: 32, lng: 35, accuracy: 5, timestamp: now },
  now,
);
assert.equal(restoredNearest.startMode, "nearest");
assert.equal(
  Math.round(restoredNearest.startProgressMeters),
  Math.round(nearest.startProgressMeters),
  "restored nearest preserves the approved start progress instead of recomputing nearest",
);

const staleNearest = createRidePlan(
  route,
  { direction: "forward", startMode: "nearest" },
  { ...fix, timestamp: now - 31_000 },
  now,
);
assert.equal(staleNearest.startMode, "official", "stale location cannot auto-select nearest");

const reverse = createRidePlan(route, { direction: "reverse", startMode: "official" }, fix, now);
assert.equal(reverse.effectiveRoute.geometry[0].lat, route.geometry.at(-1).lat);
assert.equal(reverse.effectiveRoute.geometry[0].lng, route.geometry.at(-1).lng);

const curatedOneDirection = createRidePlan(
  {
    ...route,
    routingValidation: buildRouteAttestation({
      validationContext: route.routingValidation.validationContext,
      traversalSlices: route.routingValidation.traversalSlices,
      waypointOccurrences: route.routingValidation.waypointOccurrences,
      legBoundaries: route.routingValidation.legBoundaries,
      geometry,
      reverseConstraint: "curated-opposite-distinct-or-unavailable",
    }),
  },
  { direction: "reverse", startMode: "official" },
  fix,
  now,
);
assert.equal(curatedOneDirection.reverseAllowed, false);
assert.equal(curatedOneDirection.direction, "reverse");
assert.equal(curatedOneDirection.failure, "reverse-not-allowed");

const atStartFix = { lat: 32, lng: 35, accuracy: 5, timestamp: now };
const atStart = createRidePlan(
  route,
  { direction: "forward", startMode: "official", selectedPoint: null },
  atStartFix,
  now,
);
assert.equal(atStart.approachTier, "at");
assert.equal(ridePlanNeedsConnectorPreview(atStart), false);
assert.equal(ridePlanNeedsDirectApproachPreview(atStart), false);

console.log("test-ride-plan: OK");
