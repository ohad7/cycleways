import assert from "node:assert/strict";
import RouteManager from "../packages/core/route-manager.js";
import { validateRouteAttestation } from "../packages/core/src/routing/routeAttestation.js";

const policy = {
  policyId: "il-bicycle-v1",
  policyDigest: "fixture-policy",
  strictTraversalPolicy: true,
};
const traversal = (forward = "allowed", reverse = "allowed") => ({
  policyId: policy.policyId,
  policyDigest: policy.policyDigest,
  forward,
  reverse,
  forwardReason: "fixture",
  reverseReason: "fixture",
});
const edge = (value) => ({
  source: "osm",
  routeClass: "road",
  cwAlignments: { forward: [], reverse: [] },
  bicycleTraversal: traversal(),
  ...value,
});

const manager = new RouteManager();
await manager.load(
  { type: "FeatureCollection", features: [] },
  {},
  {
    schemaVersion: 3,
    graphVersion: "parallel-v3",
    routingContract: policy,
    nodes: [
      { id: "west-lower", coord: [35, 33] },
      { id: "east-lower", coord: [35.01, 33] },
      { id: "east-upper", coord: [35.01, 33.00008] },
      { id: "west-upper", coord: [35, 33.00008] },
    ],
    edges: [
      edge({
        id: "road-99-eastbound",
        shareId: 370,
        from: "west-lower",
        to: "east-lower",
        distanceMeters: 930,
        coordinates: [[35, 33], [35.01, 33]],
        bicycleTraversal: traversal("allowed", "prohibited"),
      }),
      edge({
        id: "road-99-westbound",
        shareId: 19,
        from: "east-upper",
        to: "west-upper",
        distanceMeters: 930,
        coordinates: [[35.01, 33.00008], [35, 33.00008]],
        bicycleTraversal: traversal("allowed", "prohibited"),
      }),
      edge({
        id: "east-turn",
        shareId: 1001,
        from: "east-lower",
        to: "east-upper",
        distanceMeters: 9,
        coordinates: [[35.01, 33], [35.01, 33.00008]],
      }),
      edge({
        id: "west-turn",
        shareId: 1002,
        from: "west-upper",
        to: "west-lower",
        distanceMeters: 9,
        coordinates: [[35, 33.00008], [35, 33]],
      }),
    ],
  },
);

const A = { id: "A-outbound", lat: 33, lng: 35.009 };
const B = { id: "B", lat: 33, lng: 35.001 };
manager.recalculateRoute([A, B]);
let diagnostics = manager.getBaseRouteDiagnostics();
assert.equal(diagnostics.failure, null);
assert.equal(diagnostics.traversals[0].edgeShareId, 19);
assert.ok(
  diagnostics.traversals.every((value) => value.policyVerdict.allowed),
  "candidate selection never relaxes traversal policy",
);
assert.ok(
  diagnostics.traversals.every(
    (value) => !(value.edgeShareId === 370 && value.direction === "reverse"),
  ),
);

manager.recalculateRoute([A, B, { id: "A-return", lat: A.lat, lng: A.lng }]);
diagnostics = manager.getBaseRouteDiagnostics();
assert.equal(diagnostics.failure, null);
assert.equal(diagnostics.legs.length, 2);
assert.equal(diagnostics.legs[0].traversals[0].edgeShareId, 19);
assert.ok(
  diagnostics.legs[1].traversals.some(
    (value) => value.edgeShareId === 370 && value.direction === "forward",
  ),
  "the return occurrence may select the other carriageway",
);
assert.ok(
  diagnostics.traversals.every(
    (value) => !(value.edgeShareId === 370 && value.direction === "reverse"),
  ),
);

const routePoints = manager.getRouteInfo().points;
assert.deepEqual(validateRouteAttestation(manager.getRouteInfo().routingValidation), {
  ok: true,
  reason: null,
});
assert.equal(manager.getRouteInfo().routingValidation.exactReverseAllowed, false);
assert.equal(routePoints[0].baseEdgeId, "road-99-westbound");
assert.equal(routePoints[2].baseEdgeId, "road-99-eastbound");
assert.equal(routePoints[1].occurrenceId, "B");
assert.equal(routePoints[1].baseEdgeId, "road-99-eastbound");
const incomingAtB = diagnostics.legs[0].traversals.at(-1);
const outgoingAtB = diagnostics.legs[1].traversals[0];
assert.equal(incomingAtB.edgeShareId, outgoingAtB.edgeShareId);
assert.equal(incomingAtB.toFraction, outgoingAtB.fromFraction);

console.log("multi-candidate routing ok");
