import assert from "node:assert/strict";
import {
  deriveNetworkJunctionCandidates,
  joinNetworkJunctionReviews,
  networkJunctionGeoJson,
  normalizeNetworkJunctionRegistry,
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
  edge("arm-a-exit", "r1", "a", { policy: oneWay }),
  edge("arm-b", "r2", "b", { policy: oneWay }),
  edge("arm-c", "c", "r3", { policy: oneWay }),
  edge("corridor-a", "x", "a"),
] };
const roundabout = { id: "osm-ways:7", classification: "roundabout", memberWayIds: [7], center: { lng: 0, lat: 0 }, bbox: [-1, -1, 1, 1], fingerprint: "sha256:test" };
const overlay = { segments: {
  1: { segmentId: 1, segmentName: "A", alignments: { aToB: { draft: {
    realization: { edgeRefs: [{ edgeId: "arm-a", direction: "forward", sequenceIndex: 0 }] },
    validation: { status: "valid", ok: true },
  } } } },
  2: {
    segmentId: 2,
    segmentName: "Arm-boundary segment",
    endpoints: { a: { coordinate: [0, 0] }, b: { coordinate: [0.001, 0.001] } },
    alignments: {
      aToB: { published: { disposition: "accepted", realization: { type: "explicit", edgeRefs: [{ edgeId: "corridor-a", direction: "forward", sequenceIndex: 0 }] } } },
      bToA: { published: { disposition: "accepted", realization: { type: "reverseOf", alignmentKey: "aToB" } } },
    },
  },
} };
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
assert.deepEqual(candidates.junctions[0].armAttachments.map(({ segmentId, endpoint }) => ({ segmentId, endpoint })), [
  { segmentId: 2, endpoint: "b" },
]);
assert.equal(candidates.junctions[0].attachments.filter((item) => item.source === "arm-attachment").length, 2);
assert.equal(candidates.junctions[0].publication.status, "detected");
assert.ok(candidates.junctions[0].publication.issues.some((issue) => issue.code === "junction_name_required"));

const movement = candidates.junctions[0].movements[0];
const joined = joinNetworkJunctionReviews(candidates, { schemaVersion: 1, reviews: {
  [candidates.junctions[0].id]: { movements: { [movement.id]: { status: "selected", junctionFingerprint: "sha256:stale" } } },
} });
assert.equal(joined.blockingIssues[0].code, "stale_movement_review");
assert.ok(networkJunctionGeoJson(joinNetworkJunctionReviews(candidates, { schemaVersion: 1, reviews: {} }), graph).arrows.features.length > 0);

const customGraph = { edges: [
  edge("outside-a", "x", "a"),
  edge("sidewalk", "a", "b"),
  edge("outside-b", "b", "y"),
] };
const customOverlay = { segments: {
  10: {
    segmentId: 10, segmentName: "West", endpoints: { a: { coordinate: [0, 0] }, b: { coordinate: [0.001, 0.001] } },
    alignments: {
      aToB: { published: { disposition: "accepted", realization: { type: "explicit", edgeRefs: [{ edgeId: "outside-a", direction: "forward", sequenceIndex: 0 }] } } },
      bToA: { published: { disposition: "accepted", realization: { type: "reverseOf", alignmentKey: "aToB" } } },
    },
  },
  11: {
    segmentId: 11, segmentName: "East", endpoints: { a: { coordinate: [0, 0] }, b: { coordinate: [0.001, 0.001] } },
    alignments: {
      aToB: { published: { disposition: "accepted", realization: { type: "explicit", edgeRefs: [{ edgeId: "outside-b", direction: "reverse", sequenceIndex: 0 }] } } },
      bToA: { published: { disposition: "accepted", realization: { type: "reverseOf", alignmentKey: "aToB" } } },
    },
  },
} };
const customRegistry = normalizeNetworkJunctionRegistry({ schemaVersion: 1, junctions: {
  "junction-custom-test": {
    name: "Test bicycle junction",
    status: "detected",
    navigationKind: "intersection",
    source: { type: "custom", internalEdgeIds: ["sidewalk"] },
  },
} });
const customCandidates = deriveNetworkJunctionCandidates({
  graph: customGraph,
  overlay: customOverlay,
  curatedJunctions: customRegistry,
});
assert.equal(customCandidates.junctions.length, 1);
assert.equal(customCandidates.junctions[0].kind, "custom_bicycle");
assert.equal(customCandidates.junctions[0].armAttachments.length, 2);
assert.equal(customCandidates.junctions[0].summary.legalMovements, 2);
assert.equal(customCandidates.junctions[0].publication.canPublish, true);

const parallelGraph = { edges: [
  edge("outside-west", "x", "west"),
  edge("upper", "west", "east"),
  edge("lower", "east", "west"),
  edge("outside-east", "east", "y"),
] };
const parallelOverlay = { segments: {
  20: {
    segmentId: 20,
    segmentName: "West active",
    lifecycleStatus: "active",
    navigable: true,
    endpoints: { a: { coordinate: [0, 0] }, b: { coordinate: [0.001, 0.001] } },
    alignments: {
      aToB: { published: { disposition: "accepted", realization: { type: "explicit", edgeRefs: [{ edgeId: "outside-west", direction: "forward", sequenceIndex: 0 }] } } },
      bToA: { published: { disposition: "accepted", realization: { type: "reverseOf", alignmentKey: "aToB" } } },
    },
  },
  21: {
    segmentId: 21,
    segmentName: "East active",
    lifecycleStatus: "active",
    navigable: true,
    endpoints: { a: { coordinate: [0, 0] }, b: { coordinate: [0.001, 0.001] } },
    alignments: {
      aToB: { published: { disposition: "accepted", realization: { type: "explicit", edgeRefs: [{ edgeId: "outside-east", direction: "reverse", sequenceIndex: 0 }] } } },
      bToA: { published: { disposition: "accepted", realization: { type: "reverseOf", alignmentKey: "aToB" } } },
    },
  },
  22: {
    segmentId: 22,
    segmentName: "Deprecated duplicate",
    lifecycleStatus: "deprecated",
    navigable: false,
    endpoints: { a: { coordinate: [0, 0] }, b: { coordinate: [0.001, 0.001] } },
    alignments: {
      aToB: { published: { disposition: "accepted", realization: { type: "explicit", edgeRefs: [{ edgeId: "outside-west", direction: "forward", sequenceIndex: 0 }] } } },
      bToA: { published: { disposition: "accepted", realization: { type: "reverseOf", alignmentKey: "aToB" } } },
    },
  },
} };
const parallelRegistry = normalizeNetworkJunctionRegistry({ schemaVersion: 1, junctions: {
  "junction-custom-parallel": {
    name: "Parallel bicycle junction",
    status: "detected",
    navigationKind: "intersection",
    source: { type: "custom", internalEdgeIds: ["upper", "lower"] },
  },
} });
const parallel = deriveNetworkJunctionCandidates({
  graph: parallelGraph,
  overlay: parallelOverlay,
  curatedJunctions: parallelRegistry,
}).junctions[0];
assert.equal(parallel.publication.canPublish, true);
assert.equal(parallel.attachmentIssues.length, 0);
assert.deepEqual(parallel.armAttachments.map((item) => item.segmentId).sort((a, b) => a - b), [20, 21]);
assert.ok(parallel.attachments.some((attachment) => attachment.alternative));
const parallelPorts = new Map(parallel.ports.map((port) => [port.id, port]));
for (const movement of parallel.movements.filter((item) => item.status !== "unavailable")) {
  const entry = parallelPorts.get(movement.entryPortId);
  const exit = parallelPorts.get(movement.exitPortId);
  assert.equal(movement.edgeRefs[0].edgeId, entry.edgeId);
  assert.equal(movement.edgeRefs[0].direction, entry.direction);
  assert.equal(movement.edgeRefs.at(-1).edgeId, exit.edgeId);
  assert.equal(movement.edgeRefs.at(-1).direction, exit.direction);
}

const customRoundaboutRegistry = normalizeNetworkJunctionRegistry({ schemaVersion: 1, junctions: {
  "junction-custom-roundabout": {
    name: "Test bicycle roundabout",
    status: "detected",
    navigationKind: "roundabout",
    source: { type: "custom", internalEdgeIds: ["sidewalk"] },
  },
} });
const customRoundaboutCandidates = deriveNetworkJunctionCandidates({
  graph: customGraph,
  overlay: customOverlay,
  curatedJunctions: customRoundaboutRegistry,
});
assert.deepEqual(customRoundaboutCandidates.junctions[0].ringEdgeIds, ["sidewalk"]);
const customRoundaboutGeoJson = networkJunctionGeoJson(
  joinNetworkJunctionReviews(customRoundaboutCandidates, { schemaVersion: 1, reviews: {} }),
  customGraph,
);
assert.equal(customRoundaboutGeoJson.internalEdges.features[0].properties.ring, true);
console.log("network junction derivation and review joining ok");
