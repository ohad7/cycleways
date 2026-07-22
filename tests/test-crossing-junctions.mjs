import assert from "node:assert/strict";
import {
  buildCrossingReviewSites,
  buildJunctionCrossingProposal,
  decorateCrossingReview,
} from "../editor/lib/crossing-junctions.mjs";
import { crossingIssue } from "../editor/lib/crossingReview.mjs";

const graph = {
  metadata: { bicycleTraversalShadowPolicyDigest: "policy-1" },
  edges: [
    edge("approach", "n0", "n1", [[35, 33], [35.001, 33]], "residential"),
    edge("cross", "n1", "n2", [[35.001, 33], [35.001, 33.001]], "secondary"),
    edge("depart", "n2", "n3", [[35.001, 33.001], [35.002, 33.001]], "cycleway"),
  ],
};
const shareRegistry = { schemaVersion: 1, edges: { approach: 1, cross: 2, depart: 3 } };
const junction = {
  id: "junction-test",
  name: "Test junction",
  navigationKind: "intersection",
  topologyFingerprint: "sha256:topology",
  boundary: [34.999, 32.999, 35.003, 33.002],
  movements: [
    movement("two-edge", [ref("approach", "forward", 0), ref("cross", "forward", 1)]),
    movement("three-edge", [
      ref("approach", "forward", 0),
      ref("cross", "forward", 1),
      ref("depart", "forward", 2),
    ]),
  ],
};

const joined = {
  items: [{
    state: "pending",
    review: null,
    candidate: {
      id: "crossing-test",
      kind: "side-change",
      center: { lat: 33.0005, lng: 35.001 },
      bbox: [35.0009, 33, 35.0011, 33.001],
      crossedRoad: { name: "Test road" },
      evidence: ["osm-crossing-tag"],
      mappings: [{
        id: "candidate-mapping",
        match: {
          before: [{ edgeShareId: 1, fromFractionQ: 0, toFractionQ: 1_000_000 }],
          action: [{ edgeShareId: 2, fromFractionQ: 0, toFractionQ: 1_000_000 }],
          after: [{ edgeShareId: 3, fromFractionQ: 0, toFractionQ: 1_000_000 }],
        },
      }],
    },
  }, {
    state: "pending",
    review: null,
    candidate: {
      id: "crossing-test-nearby",
      kind: "side-change",
      center: { lat: 33.0015, lng: 35.002 },
      bbox: [35.0019, 33.001, 35.0021, 33.002],
      crossedRoad: { name: "Test road" },
      evidence: ["motor-road-incidence"],
      mappings: [{
        id: "candidate-mapping-nearby",
        match: {
          before: [{ edgeShareId: 1, fromFractionQ: 0, toFractionQ: 1_000_000 }],
          action: [{ edgeShareId: 2, fromFractionQ: 0, toFractionQ: 1_000_000 }],
          after: [{ edgeShareId: 3, fromFractionQ: 0, toFractionQ: 1_000_000 }],
        },
      }],
    },
  }],
  manualItems: [],
};
const siteResult = buildCrossingReviewSites({ joined, junctionItems: [{ candidate: junction }], shareRegistry });
assert.equal(siteResult.reviewSites.length, 1);
assert.equal(siteResult.reviewSites[0].id, "junction:junction-test");
assert.equal(siteResult.reviewSites[0].junctionId, "junction-test");
assert.deepEqual(siteResult.reviewSites[0].bbox, junction.boundary);
assert.deepEqual(siteResult.reviewSites[0].crossingIds, ["crossing-test", "crossing-test-nearby"]);
assert.deepEqual(siteResult.reviewSites[0].movementIds, ["three-edge", "two-edge"]);
assert.equal(siteResult.reviewSites[0].state, "needs-review");
const decorated = decorateCrossingReview(joined, siteResult);
assert.equal(decorated.items[0].candidate.context.junctionId, "junction-test");
assert.equal(decorated.items[1].candidate.reviewSiteId, "junction:junction-test");

const transition = buildJunctionCrossingProposal({
  junction,
  movementId: "two-edge",
  graph,
  shareRegistry,
  continuationDirection: "left",
});
assert.equal(transition.representation, "junction-transition");
assert.equal(transition.guidancePolicy, "user-option");
assert.equal(transition.mappings[0].match.action.length, 0);
assert.equal(transition.mappings[0].entry.lat, transition.mappings[0].exit.lat);
assert.equal(transition.mappings[0].entry.lng, transition.mappings[0].exit.lng);
assert.equal(crossingIssue(transition), null);

const actionPath = buildJunctionCrossingProposal({
  junction,
  movementId: "three-edge",
  graph,
  shareRegistry,
  continuationDirection: "right",
});
assert.equal(actionPath.representation, "action-path");
assert.equal(actionPath.guidancePolicy, "always");
assert.deepEqual(actionPath.mappings[0].match.action.map((slice) => slice.edgeShareId), [2]);
assert.equal(crossingIssue(actionPath), null);

assert.throws(
  () => buildJunctionCrossingProposal({
    junction: { ...junction, navigationKind: "roundabout" },
    movementId: "two-edge",
    graph,
    shareRegistry,
    continuationDirection: "left",
  }),
  /roundabout-adjacent/,
);

console.log("crossing junction review sites and proposals ok");

function edge(id, fromNodeId, toNodeId, coordinates, highway) {
  return {
    id,
    fromNodeId,
    toNodeId,
    coordinates,
    distanceMeters: 10,
    sourceGeometryDigest: `digest-${id}`,
    tags: { highway, name: highway === "secondary" ? "Test road" : null },
    bicycleTraversalShadow: { forward: "allowed", reverse: "allowed" },
  };
}

function ref(edgeId, direction, sequenceIndex) {
  return { edgeId, direction, sequenceIndex };
}

function movement(id, edgeRefs) {
  return {
    id,
    entryPortId: `${id}-entry`,
    exitPortId: `${id}-exit`,
    status: "unique",
    edgeRefs,
  };
}
