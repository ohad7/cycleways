import assert from "node:assert/strict";
import {
  CROSSING_FRACTION_SCALE,
  buildCrossingFromGuideline,
  normalizeCrossingGuideline,
} from "../editor/lib/crossing-guideline.mjs";
import { crossingIssue } from "../editor/lib/crossingReview.mjs";

const edge = (id, from, to, reverse = "allowed") => ({
  id,
  fromNodeId: `${id}-from`,
  toNodeId: `${id}-to`,
  coordinates: [from, to],
  sourceGeometryDigest: `digest-${id}`,
  bicycleTraversalShadow: { forward: "allowed", reverse },
});
const graph = {
  metadata: { bicycleTraversalShadowPolicyDigest: "policy-1" },
  edges: [
    edge("edge-a", [35, 33], [35.001, 33]),
    edge("edge-b", [35.001, 33], [35.002, 33]),
  ],
};
const shareRegistry = { edges: { "edge-a": 11, "edge-b": 12 } };
const match = {
  summary: { coverageRatio: 1, gapCount: 0, continuityGapCount: 0 },
  preview: {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { kind: "matchedEdge", edgeId: "edge-a", direction: "forward", sequenceIndex: 0 } },
      { type: "Feature", properties: { kind: "matchedEdge", edgeId: "edge-b", direction: "forward", sequenceIndex: 1 } },
    ],
  },
};

assert.deepEqual(normalizeCrossingGuideline([[35.00025, 33], [35.00175, 33]]), {
  type: "LineString",
  coordinates: [[35.00025, 33], [35.00175, 33]],
});

const proposal = buildCrossingFromGuideline({
  guideline: [[35.00025, 33], [35.00175, 33]],
  match,
  graph,
  shareRegistry,
  crossedRoadName: "Test road",
});
assert.equal(proposal.crossing.representation, "edge-path");
assert.equal(proposal.crossing.mappings.length, 2);
assert.equal(crossingIssue(proposal.crossing), null);
assert.deepEqual(proposal.crossing.mappings[0].match.before, []);
assert.deepEqual(proposal.crossing.mappings[0].match.after, []);
assert.deepEqual(proposal.crossing.mappings[0].match.action, [
  { edgeShareId: 11, fromFractionQ: 250_000, toFractionQ: CROSSING_FRACTION_SCALE },
  { edgeShareId: 12, fromFractionQ: 0, toFractionQ: 750_000 },
]);
assert.deepEqual(proposal.crossing.mappings[1].match.action, [
  { edgeShareId: 12, fromFractionQ: 750_000, toFractionQ: 0 },
  { edgeShareId: 11, fromFractionQ: CROSSING_FRACTION_SCALE, toFractionQ: 250_000 },
]);

const oneWayGraph = structuredClone(graph);
oneWayGraph.edges[1].bicycleTraversalShadow.reverse = "prohibited";
const oneWay = buildCrossingFromGuideline({
  guideline: [[35.00025, 33], [35.00175, 33]],
  match,
  graph: oneWayGraph,
  shareRegistry,
});
assert.equal(oneWay.crossing.mappings.length, 1, "reverse mapping is omitted when any opposite traversal is illegal");

await assert.rejects(
  async () => buildCrossingFromGuideline({
    guideline: [[35.00025, 33.001], [35.00175, 33.001]],
    match,
    graph,
    shareRegistry,
  }),
  /endpoint is .* m from the matched base path/,
);

console.log("crossing guideline tests passed");
