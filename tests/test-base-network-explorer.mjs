import assert from "node:assert/strict";
import {
  baseNetworkLineColorExpression,
  baseNetworkMapFilter,
  baseNetworkRenderProperties,
  effectiveTraversalStates,
  filterBaseNetworkFeatures,
  groupBaseNetworkSubjects,
  indexCyclewaysEdges,
  summarizeBaseNetwork,
  traversalCategory,
} from "../editor/lib/base-network-explorer.mjs";

function edge(edgeId, osmWayId, properties = {}) {
  return {
    type: "Feature",
    id: edgeId,
    properties: {
      edgeId,
      osmWayId,
      source: "osm",
      highway: "track",
      bicycleTraversal: { forward: "allowed", reverse: "allowed" },
      ...properties,
    },
    geometry: { type: "LineString", coordinates: [[35, 33], [35.001, 33.001]] },
  };
}

const features = [
  edge("no-1", 10, {
    name: "Restricted track",
    bicycle: "no",
    foot: "yes",
    bicycleTraversal: {
      forward: "prohibited",
      reverse: "prohibited",
      forwardReason: "explicit-access-prohibited",
      reverseReason: "explicit-access-prohibited",
    },
  }),
  edge("no-2", 10, {
    name: "Restricted track",
    bicycle: "no",
    foot: "yes",
    bicycleTraversal: {
      forward: "prohibited",
      reverse: "prohibited",
      forwardReason: "explicit-access-prohibited",
      reverseReason: "explicit-access-prohibited",
    },
  }),
  edge("one-way", 11, {
    oneway: "yes",
    bicycleTraversal: { forward: "allowed", reverse: "prohibited" },
  }),
  edge("conditional", 12, {
    bicycleTraversal: {
      forward: "conditional",
      reverse: "conditional",
      forwardReason: "explicit-access-conditional",
      reverseReason: "explicit-access-conditional",
    },
  }),
  edge("unknown", 13, {
    bicycleTraversal: { forward: "unknown", reverse: "unknown" },
  }),
  edge("override", 14),
  edge("manual-1", null, {
    source: "manual",
    manualEdgeId: "manual-1",
  }),
];

assert.equal(traversalCategory(features[0].properties), "blocked");
assert.equal(traversalCategory(features[2].properties), "direction_limited");
assert.equal(traversalCategory(features[3].properties), "conditional");
assert.equal(traversalCategory(features[4].properties), "unknown");

const renderProperties = baseNetworkRenderProperties(features[0].properties, [{ osmWayId: 10 }]);
assert.equal(renderProperties.explorerRawBicycle, "no");
assert.equal(renderProperties.explorerTraversalCategory, "blocked");
assert.equal(renderProperties.explorerHasOverride, true);

const acceptedDirections = new Set(["no-1|forward", "no-1|reverse"]);
assert.deepEqual(
  effectiveTraversalStates(features[0].properties, acceptedDirections),
  { forward: "allowed", reverse: "allowed" },
);
const effectiveNo = {
  ...features[0],
  properties: {
    ...features[0].properties,
    ...baseNetworkRenderProperties(features[0].properties, [], acceptedDirections),
  },
};
assert.equal(effectiveNo.properties.explorerTraversalCategory, "bidirectional");
assert.equal(effectiveNo.properties.explorerBaseTraversalCategory, "blocked");
assert.equal(effectiveNo.properties.explorerCwPrecedenceForward, true);
assert.deepEqual(
  effectiveTraversalStates(features[2].properties, new Set(["one-way|reverse"])),
  { forward: "allowed", reverse: "prohibited" },
  "accepted CW membership must not erase one-way direction evidence",
);

assert.deepEqual(
  filterBaseNetworkFeatures(features, "bicycle_no").map((feature) => feature.properties.edgeId),
  ["no-1", "no-2"],
);
assert.deepEqual(
  filterBaseNetworkFeatures(features, "prohibited_both").map((feature) => feature.properties.edgeId),
  ["no-1", "no-2"],
);
assert.deepEqual(
  filterBaseNetworkFeatures(features, "conditional").map((feature) => feature.properties.edgeId),
  ["conditional"],
);
assert.deepEqual(filterBaseNetworkFeatures([effectiveNo], "prohibited_both"), []);
assert.deepEqual(
  filterBaseNetworkFeatures(features, "reviewed_overrides", [{ osmWayId: 14 }]).map(
    (feature) => feature.properties.edgeId,
  ),
  ["override"],
);
assert.deepEqual(
  filterBaseNetworkFeatures(features, "manual").map((feature) => feature.properties.edgeId),
  ["manual-1"],
);

const overlay = {
  segments: {
    19: {
      segmentId: 19,
      segmentName: "CW 19",
      edgeRefs: [{ edgeId: "no-1" }, { edgeId: "no-2" }],
    },
  },
};
const grouped = groupBaseNetworkSubjects(
  filterBaseNetworkFeatures(features, "bicycle_no"),
  indexCyclewaysEdges(overlay),
);
assert.equal(grouped.length, 1, "split source edges must group into one OSM-way subject");
assert.equal(grouped[0].osmWayId, 10);
assert.deepEqual(grouped[0].edgeIds, ["no-1", "no-2"]);
assert.deepEqual(grouped[0].cwSegments, [{ segmentId: 19, segmentName: "CW 19" }]);

const summary = summarizeBaseNetwork(features, "bicycle_no", [], overlay);
assert.equal(summary.edgeCount, 2);
assert.equal(summary.subjectCount, 1);
assert.equal(summary.cwSegmentCount, 1);

assert.deepEqual(baseNetworkMapFilter("bicycle_no"), [
  "==",
  ["get", "explorerRawBicycle"],
  "no",
]);
assert.equal(baseNetworkMapFilter("all"), null);
assert.ok(Array.isArray(baseNetworkLineColorExpression("traversal")));
assert.equal(baseNetworkLineColorExpression("neutral"), "#2563eb");

console.log("Base Network explorer helpers ok");
