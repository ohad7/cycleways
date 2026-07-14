import { buildRouteAttestation } from "../../packages/core/src/routing/routeAttestation.js";

const FIXTURE_VALIDATION_CONTEXT = Object.freeze({
  baseRoutingSchemaVersion: 3,
  graphVersion: "navigation-test-fixture-v3",
  policyId: "il-bicycle-v1",
  policyDigest: "navigation-test-policy",
  routingContextDigest: "navigation-test-context",
});

/**
 * Attach synthetic, internally consistent traversal evidence to navigation-only
 * fixtures. Routing-engine tests use real traversals instead; this helper keeps
 * session/cue tests focused on navigation behavior under the strict V3 contract.
 */
export function withFixtureRoutingValidation(routeState, options = {}) {
  if (routeState?.routingValidation) return routeState;
  const geometry = Array.isArray(routeState?.geometry) ? routeState.geometry : [];
  if (geometry.length < 2) return routeState;
  const suppliedPoints = Array.isArray(routeState?.points) ? routeState.points : [];
  const endpoints = suppliedPoints.length >= 2
    ? [suppliedPoints[0], suppliedPoints.at(-1)]
    : [geometry[0], geometry.at(-1)];
  const oppositePolicyState = options.exactReverseAllowed === false
    ? "prohibited"
    : "allowed";
  const routingValidation = buildRouteAttestation({
    validationContext: FIXTURE_VALIDATION_CONTEXT,
    traversalSlices: [
      {
        edgeShareId: Number(options.edgeShareId) || 1,
        fromFraction: 0,
        toFraction: 1,
        distanceMeters: Math.max(1, Number(routeState?.distance) || 1000),
        policyState: "allowed",
        policyReason: "navigation-test-fixture",
        oppositePolicyState,
        oppositePolicyReason: "navigation-test-fixture",
        cwMembership: [],
        oppositeCwMembership: [],
        shardIds: ["navigation-test-shard"],
      },
    ],
    waypointOccurrences: endpoints.map((point, index) => ({
      id: point?.id || `fixture-waypoint-${index}`,
      lat: Number(point?.lat),
      lng: Number(point?.lng),
      baseEdgeShareId: Number(options.edgeShareId) || 1,
      baseEdgeFraction: index,
    })),
    legBoundaries: [{
      purpose: "ordinary",
      fromOccurrence: 0,
      toOccurrence: 1,
      startTraversal: 0,
      endTraversal: 1,
    }],
    geometry,
    derivation: "navigation-test-fixture",
  });
  return { ...routeState, routingValidation };
}
