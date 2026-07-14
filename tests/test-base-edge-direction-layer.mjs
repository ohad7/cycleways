import assert from "node:assert/strict";
import {
  buildBaseEdgeDirectionLayer,
  summarizeBaseEdgeDirectionLayer,
} from "../editor/lib/base-edge-direction-layer.mjs";

function edge(id, coordinates, forward, reverse, properties = {}) {
  return {
    type: "Feature",
    id,
    properties: {
      id,
      edgeId: id,
      source: "osm",
      bicycleTraversal: { forward, reverse },
      ...properties,
    },
    geometry: { type: "LineString", coordinates },
  };
}

const forwardCoordinates = [[35, 33], [35.001, 33]];
const reverseCoordinates = [[35.002, 33], [35.003, 33]];
const collection = buildBaseEdgeDirectionLayer(
  {
    type: "FeatureCollection",
    features: [
      edge("forward-only", forwardCoordinates, "allowed", "prohibited", { osmWayId: 1 }),
      edge("reverse-only", reverseCoordinates, "prohibited", "allowed", { osmWayId: 2 }),
      edge("two-way", [[35.004, 33], [35.005, 33]], "allowed", "allowed", { osmWayId: 3 }),
      edge("unknown-reverse", [[35.006, 33], [35.007, 33]], "allowed", "unknown", { osmWayId: 4 }),
      edge("override-me", [[35.008, 33], [35.009, 33]], "allowed", "allowed", { osmWayId: 5 }),
    ],
  },
  {
    type: "FeatureCollection",
    features: [
      edge("manual-new", [[35.01, 33], [35.011, 33]], "unknown", "unknown", {
        source: "manual",
        manualEdgeId: "manual-new",
        bicycleTraversal: {
          forward: "prohibited",
          reverse: "allowed",
          reviewed: true,
        },
      }),
    ],
  },
  {
    overrides: [
      {
        osmWayId: 5,
        states: { forward: "prohibited", reverse: "allowed" },
      },
    ],
  },
);

assert.deepEqual(
  collection.features.map((feature) => feature.properties.edgeId),
  ["forward-only", "reverse-only", "unknown-reverse", "override-me", "manual-new"],
);
assert.deepEqual(collection.features[0].geometry.coordinates, forwardCoordinates);
assert.equal(collection.features[0].properties.directionLabel, "A → B");
assert.deepEqual(collection.features[1].geometry.coordinates, [...reverseCoordinates].reverse());
assert.equal(collection.features[1].properties.directionLabel, "B → A");
assert.equal(collection.features[2].properties.directionLayerClass, "needs-review");
assert.equal(collection.features[3].properties.directionEvidenceSource, "reviewed-override");
assert.equal(collection.features[3].properties.directionEvidenceStaged, true);
assert.equal(collection.features[4].properties.directionEvidenceSource, "manual-review");
assert.deepEqual(summarizeBaseEdgeDirectionLayer(collection), {
  total: 5,
  confirmedOneWay: 4,
  needsReview: 1,
});

console.log("Base edge direction layer ok");
