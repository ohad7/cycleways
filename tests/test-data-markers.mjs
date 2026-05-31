import assert from "node:assert/strict";
import {
  dataMarkerFeatureCollection,
  dataMarkerFeaturesFromSegments,
  namespacedDataMarkerIconName,
} from "@cycleways/core/data/dataMarkers.js";

const segmentsData = {
  "Segment A": {
    data: [
      {
        type: "gate",
        information: "Gate information",
        location: [33.1, 35.6],
      },
      {
        type: "mud",
        information: "Mud information",
        location: [33.2, 35.7],
      },
      {
        type: "ignored",
        location: ["bad", 35.8],
      },
    ],
  },
};

const features = dataMarkerFeaturesFromSegments(segmentsData);
assert.equal(features.length, 2);
assert.deepEqual(features[0].geometry.coordinates, [35.6, 33.1]);
assert.equal(features[0].properties.dataPointId, "Segment A-0");
assert.equal(features[0].properties.icon, "barrier-11");
assert.equal(features[1].properties.icon, "wetland-11");

const collection = dataMarkerFeatureCollection(features, ["Segment A-1"]);
assert.equal(collection.type, "FeatureCollection");
assert.equal(collection.features[0].properties.active, false);
assert.equal(collection.features[1].properties.active, true);

const nativeCollection = dataMarkerFeatureCollection(features, [], {
  iconNamespace: "native-marker",
});
assert.equal(
  nativeCollection.features[0].properties.icon,
  "native-marker-barrier-11",
);
assert.equal(
  namespacedDataMarkerIconName("bank-11", "native-marker"),
  "native-marker-bank-11",
);

console.log("test-data-markers passed");
