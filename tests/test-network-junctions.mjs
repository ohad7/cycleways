import assert from "node:assert/strict";
import {
  deriveNetworkJunctionCandidates,
  joinNetworkJunctionReviews,
  networkJunctionGeoJson,
} from "../editor/lib/networkJunctions.mjs";

const allowed = { policyId: "test", policyDigest: "test", forward: "allowed", reverse: "allowed", forwardReason: "test", reverseReason: "test" };
const oneWay = { ...allowed, reverse: "prohibited", reverseReason: "osm-oneway" };
const edge = (id, fromNodeId, toNodeId, { roundabout = false, policy = allowed } = {}) => ({
  id, fromNodeId, toNodeId, distanceMeters: 10,
  coordinates: [[0, 0], [0.001, 0.001]],
  tags: roundabout ? { osmId: 7, junction: "roundabout" } : {},
  bicycleTraversalShadow: policy,
});
const graph = { edges: [
  edge("ring-1", "r1", "r2", { roundabout: true, policy: oneWay }),
  edge("ring-2", "r2", "r3", { roundabout: true, policy: oneWay }),
  edge("ring-3", "r3", "r1", { roundabout: true, policy: oneWay }),
  edge("arm-a", "a", "r1", { policy: oneWay }),
  edge("arm-b", "r2", "b", { policy: oneWay }),
  edge("arm-c", "c", "r3", { policy: oneWay }),
] };
const roundabout = { id: "osm-ways:7", classification: "roundabout", memberWayIds: [7], center: { lng: 0, lat: 0 }, bbox: [-1, -1, 1, 1], fingerprint: "sha256:test" };
const overlay = { segments: { 1: { segmentId: 1, segmentName: "A", alignments: { aToB: { draft: {
  realization: { edgeRefs: [{ edgeId: "arm-a", direction: "forward", sequenceIndex: 0 }] },
  validation: { status: "valid", ok: true },
} } } } } };
const candidates = deriveNetworkJunctionCandidates({
  graph,
  roundaboutCandidates: { roundabouts: [roundabout] },
  roundaboutReviews: { reviews: { "osm-ways:7": { status: "accepted" } } },
  overlay,
});
assert.equal(candidates.junctions.length, 1);
assert.equal(candidates.junctions[0].id, "junction-osm-ways:7");
assert.ok(candidates.junctions[0].internalEdgeIds.includes("arm-a"));
assert.ok(candidates.junctions[0].ports.some((port) => port.usage === "entry"));
assert.ok(candidates.junctions[0].movements.every((movement) => movement.status !== "ambiguous"));

const movement = candidates.junctions[0].movements[0];
const joined = joinNetworkJunctionReviews(candidates, { schemaVersion: 1, reviews: {
  [candidates.junctions[0].id]: { movements: { [movement.id]: { status: "selected", junctionFingerprint: "sha256:stale" } } },
} });
assert.equal(joined.blockingIssues[0].code, "stale_movement_review");
assert.ok(networkJunctionGeoJson(joinNetworkJunctionReviews(candidates, { schemaVersion: 1, reviews: {} }), graph).arrows.features.length > 0);
console.log("network junction derivation and review joining ok");
