import assert from "node:assert/strict";
import RouteManager from "../packages/core/route-manager.js";
import {
  bicycleTraversalVerdict,
  validateTraversalSlices,
} from "../packages/core/src/routing/bicycleTraversalPolicy.js";

const policy = { strict: true, policyId: "il-bicycle-v1", policyDigest: "policy-digest" };
const traversal = (forward, reverse) => ({
  policyId: policy.policyId,
  policyDigest: policy.policyDigest,
  forward,
  reverse,
  forwardReason: "fixture",
  reverseReason: "fixture",
});

{
  const edge = { id: "oneway", bicycleTraversal: traversal("allowed", "prohibited") };
  assert.equal(bicycleTraversalVerdict(edge, 0, 100, policy).allowed, true);
  const reverse = bicycleTraversalVerdict(edge, 100, 0, policy);
  assert.equal(reverse.allowed, false);
  assert.equal(reverse.direction, "reverse");
  assert.equal(reverse.state, "prohibited");
  assert.equal(bicycleTraversalVerdict(edge, 50, 50, policy).allowed, true);
  assert.equal(bicycleTraversalVerdict({}, 0, 100, policy).reason, "missing-traversal-policy");
}

{
  const edge = { id: "x", shareId: 3, bicycleTraversal: traversal("allowed", "conditional") };
  const validation = validateTraversalSlices([{ edge, fromDistance: 10, toDistance: 0 }], policy);
  assert.equal(validation.ok, false);
  assert.equal(validation.violations[0].state, "conditional");
}

const manager = new RouteManager();
await manager.load(
  { type: "FeatureCollection", features: [] },
  {},
  {
    schemaVersion: 3,
    graphVersion: "fixture-v3",
    routingContract: { ...policy, strictTraversalPolicy: true },
    nodes: [
      { id: "west", coord: [35, 33] },
      { id: "east", coord: [35.01, 33] },
    ],
    edges: [
      {
        id: "west-to-east",
        shareId: 1,
        from: "west",
        to: "east",
        distanceMeters: 930,
        coordinates: [[35, 33], [35.01, 33]],
        source: "osm",
        routeClass: "road",
        cwSegmentIds: [174],
        bicycleTraversal: traversal("allowed", "prohibited"),
      },
      {
        id: "east-to-west",
        shareId: 2,
        from: "east",
        to: "west",
        distanceMeters: 930,
        coordinates: [[35.01, 33.00008], [35, 33.00008]],
        source: "osm",
        routeClass: "road",
        cwSegmentIds: [174],
        bicycleTraversal: traversal("allowed", "prohibited"),
      },
    ],
  },
);

assert.equal(
  manager.restoreBaseRouteFromPayload({
    type: "base_route_v4",
    routePoints: [
      { baseEdgeShareId: 1, baseEdgeFraction: 1 },
      { baseEdgeShareId: 1, baseEdgeFraction: 0 },
    ],
    legs: [{ edgeShareIds: [1], directions: ["reverse"] }],
  }),
  false,
);

manager.recalculateRoute([
  { id: "east", lat: 33, lng: 35.01 },
  { id: "west", lat: 33, lng: 35 },
]);
let diagnostics = manager.getBaseRouteDiagnostics();
assert.equal(diagnostics.failure, null);
assert.deepEqual(
  diagnostics.traversals.filter((item) => item.distanceMeters > 0.01).map((item) => [item.edgeShareId, item.direction]),
  [[2, "forward"]],
);

manager.recalculateRoute([
  { id: "west", lat: 33, lng: 35 },
  { id: "east", lat: 33, lng: 35.01 },
  { id: "west-return", lat: 33, lng: 35 },
]);
diagnostics = manager.getBaseRouteDiagnostics();
assert.equal(diagnostics.failure, null);
assert.deepEqual(
  diagnostics.legs.map((leg) =>
    leg.traversals.filter((item) => item.distanceMeters > 0.01).map((item) => item.edgeShareId),
  ),
  [[1], [2]],
);

console.log("bicycle traversal runtime ok");
