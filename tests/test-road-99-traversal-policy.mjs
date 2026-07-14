import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const RouteManager = require("../packages/core/route-manager.js");
const corridor = JSON.parse(
  await readFile(
    new URL("./fixtures/bicycle-traversal/road-99-corridor.json", import.meta.url),
    "utf8",
  ),
);
const A = corridor.endpoints.A;
const B = corridor.endpoints.B;
const parallelA = corridor.parallelProjectionForA;
const policy = {
  strict: true,
  policyId: "il-bicycle-v1",
  policyDigest: "road-99-fixture-policy",
};
const bicycleTraversal = {
  policyId: policy.policyId,
  policyDigest: policy.policyDigest,
  forward: "allowed",
  reverse: "prohibited",
  forwardReason: "osm-oneway-forward",
  reverseReason: "osm-oneway-reverse",
};
const manager = new RouteManager();
await manager.load(
  { type: "FeatureCollection", features: [] },
  {},
  {
    schemaVersion: 3,
    graphVersion: "road-99-fixture-v3",
    routingContract: {
      ...policy,
      baseRoutingSchemaVersion: 3,
      routingContextDigest: "road-99-fixture-v3",
      strictTraversalPolicy: true,
    },
    nodes: [
      { id: "east-a-to-b", coord: [parallelA.lng, parallelA.lat] },
      { id: "west-turn", coord: [B.lng, B.lat] },
      { id: "east-b-to-a", coord: [A.lng, A.lat] },
    ],
    edges: [
      {
        id: corridor.physicalEdges.aToB.edgeId,
        shareId: corridor.physicalEdges.aToB.edgeShareId,
        from: "east-a-to-b",
        to: "west-turn",
        distanceMeters: corridor.physicalEdges.aToB.lengthMeters,
        coordinates: [
          [parallelA.lng, parallelA.lat],
          [B.lng, B.lat],
        ],
        source: "osm",
        routeClass: "trunk",
        bicycleTraversal,
        cwAlignments: {
          forward: [{ segmentId: 174, alignmentKey: "aToB", sequenceIndex: 0 }],
          reverse: [],
        },
      },
      {
        id: corridor.physicalEdges.bToA.edgeId,
        shareId: corridor.physicalEdges.bToA.edgeShareId,
        from: "west-turn",
        to: "east-b-to-a",
        distanceMeters: corridor.physicalEdges.bToA.lengthMeters,
        coordinates: [
          [B.lng, B.lat],
          [A.lng, A.lat],
        ],
        source: "osm",
        routeClass: "trunk",
        bicycleTraversal,
        cwAlignments: {
          forward: [{ segmentId: 174, alignmentKey: "bToA", sequenceIndex: 0 }],
          reverse: [],
        },
      },
    ],
  },
);

assert.equal(
  manager.restoreBaseRouteFromPayload({
    type: "base_route_v4",
    routePoints: [
      { baseEdgeShareId: 370, baseEdgeFraction: 1 },
      { baseEdgeShareId: 370, baseEdgeFraction: 0 },
    ],
    legs: [{ edgeShareIds: [370], directions: ["reverse"] }],
  }),
  false,
  "the historical Road 99 reverse traversal is rejected",
);

function plan(points) {
  manager.clearRoute();
  manager.recalculateRoute(points);
  const diagnostics = manager.getBaseRouteDiagnostics();
  assert.equal(diagnostics.failure, null);
  assert.ok(
    diagnostics.traversals.every((traversal) =>
      traversal.distanceMeters <= 0.01 || traversal.policyVerdict.allowed,
    ),
  );
  assert.ok(
    diagnostics.traversals.every(
      (traversal) => !(traversal.edgeShareId === 370 && traversal.direction === "reverse"),
    ),
  );
  return diagnostics;
}

assert.deepEqual(
  plan([{ ...A, id: "A" }, { ...B, id: "B" }]).traversals
    .filter((value) => value.distanceMeters > 1)
    .map((value) => [value.edgeShareId, value.direction]),
  [[19, "forward"]],
);
assert.deepEqual(
  plan([{ ...B, id: "B" }, { ...A, id: "A" }]).traversals
    .filter((value) => value.distanceMeters > 1)
    .map((value) => [value.edgeShareId, value.direction]),
  [[370, "forward"]],
);
assert.deepEqual(
  plan([
    { ...A, id: "A-out" },
    { ...B, id: "B-turn" },
    { ...A, id: "A-return" },
  ]).legs.map((leg) =>
    leg.traversals
      .filter((value) => value.distanceMeters > 1)
      .map((value) => [value.edgeShareId, value.direction]),
  ),
  [[[19, "forward"]], [[370, "forward"]]],
);

console.log("Road 99 traversal policy ok");
