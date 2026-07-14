import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createShardedRouteSession } from "../packages/core/src/routing/shardedRouteSession.js";

const require = createRequire(import.meta.url);
const RouteManager = require("../packages/core/route-manager.js");
const policy = {
  baseRoutingSchemaVersion: 3,
  policyId: "il-bicycle-v1",
  policyDigest: "fixture-policy",
  routingContextDigest: "fixture-context",
  strictTraversalPolicy: true,
};
const traversal = {
  policyId: policy.policyId,
  policyDigest: policy.policyDigest,
  forward: "allowed",
  reverse: "allowed",
  forwardReason: "fixture",
  reverseReason: "fixture",
};
const shard = {
  id: "only",
  sourceRoutingSchemaVersion: 3,
  nodes: [
    { id: "west", coord: [35, 33] },
    { id: "east", coord: [35.01, 33] },
  ],
  edges: [
    {
      id: "two-way",
      shareId: 7,
      from: "west",
      to: "east",
      distanceMeters: 930,
      coordinates: [[35, 33], [35.01, 33]],
      source: "osm",
      routeClass: "local_road",
      bicycleTraversal: traversal,
      cwAlignments: { forward: [], reverse: [] },
    },
  ],
};
const manifest = {
  sourceRoutingSchemaVersion: 3,
  graphVersion: "fixture-v3",
  policyId: policy.policyId,
  policyDigest: policy.policyDigest,
  routingContract: policy,
  scheme: { shardSizeDegrees: 1 },
  shards: [{ id: "only", bounds: [34, 32, 36, 34] }],
};
const cwBaseIndex = {
  schemaVersion: 2,
  segments: {
    7: {
      segmentId: 7,
      alignments: {
        aToB: {
          disposition: "accepted",
          edgeRefs: [[7, 0]],
          shardIds: ["only"],
        },
        bToA: { disposition: "unavailable" },
      },
    },
  },
};
const session = await createShardedRouteSession(
  RouteManager,
  { type: "FeatureCollection", features: [] },
  {},
  manifest,
  async () => shard,
  { paddingShards: 0, cwBaseIndex },
);

const A = { id: "A", lat: 33, lng: 35.001 };
const B = { id: "B", lat: 33, lng: 35.009 };
const initial = await session.restorePoints([A, B]);
assert.ok(initial.routingValidation);
const initialFingerprint = initial.routingValidation.contentFingerprint;

const returnProposal = await session.appendReturnToStart();
assert.equal(returnProposal.ok, true);
assert.equal(returnProposal.requiresReview, true);
assert.equal(session.currentRouteFingerprint(), initialFingerprint);
assert.equal(session.manager.getRouteInfo().points.length, 2);
const acceptedReturn = session.acceptRouteProposal(returnProposal.id);
assert.equal(acceptedReturn.ok, true);
assert.equal(acceptedReturn.snapshot.points.length, 3);
assert.equal(
  acceptedReturn.snapshot.routingValidation.legBoundaries[1].purpose,
  "return",
);

const oppositeProposal = await session.planOppositeDirection();
assert.equal(oppositeProposal.ok, true);
assert.equal(oppositeProposal.purpose, "opposite-direction");
assert.equal(session.dismissRouteProposal(oppositeProposal.id), true);
assert.equal(session.manager.getRouteInfo().points.length, 3);

const staleProposal = await session.planOppositeDirection();
session.invalidateRouteProposals();
assert.deepEqual(session.acceptRouteProposal(staleProposal.id), {
  ok: false,
  failure: "route-proposal-stale",
});

const curated = await session.routeFromAcceptedAlignment(7, "aToB");
assert.equal(curated.ok, true);
assert.equal(curated.snapshot.routingValidation.derivation, "curated-alignment");
assert.equal(curated.snapshot.routingValidation.traversalSlices[0].edgeShareId, 7);
assert.deepEqual(await session.routeFromAcceptedAlignment(7, "bToA"), {
  ok: false,
  failure: "alignment-unavailable",
});

console.log("route direction commands ok");
