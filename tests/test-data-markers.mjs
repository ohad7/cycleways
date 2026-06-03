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
        type: "cafe",
        id: "coffee-stop",
        name: "Coffee stop",
        information: "Coffee information",
        description: "Longer coffee stop description",
        photo: "/images/background.png",
        thumbnail: "/images/background.png",
        gallery: true,
        location: [33.3, 35.8],
      },
      {
        type: "ignored",
        location: ["bad", 35.8],
      },
    ],
  },
};

const features = dataMarkerFeaturesFromSegments(segmentsData);
assert.equal(features.length, 3);
assert.deepEqual(features[0].geometry.coordinates, [35.6, 33.1]);
assert.equal(features[0].properties.dataPointId, "Segment A-0");
assert.equal(features[0].properties.icon, "barrier-11");
assert.equal(features[1].properties.icon, "wetland-11");
assert.equal(features[2].id, "coffee-stop");
assert.equal(features[2].properties.dataPointId, "coffee-stop");
assert.equal(features[2].properties.name, "Coffee stop");
assert.equal(features[2].properties.photo, "/images/background.png");
assert.equal(features[2].properties.thumbnail, "/images/background.png");
assert.equal(features[2].properties.gallery, true);
assert.equal(features[2].properties.label, "בית קפה");
assert.equal(features[2].properties.color, "#b07a3f");
// Non-warning POI types render emoji via a per-type icon-image, not the
// generic marker-11 / text-field (astral emoji glyphs crash Mapbox).
assert.equal(features[2].properties.icon, "poi-emoji-cafe");

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

{
  const features = dataMarkerFeaturesFromSegments({
    "Seg images": {
      data: [
        {
          id: "multi",
          type: "cafe",
          name: "Multi cafe",
          location: [33.1, 35.6],
          images: [
            { photo: "a.webp", thumbnail: "a-t.webp" },
            { photo: "b.webp", thumbnail: "b-t.webp" },
          ],
        },
      ],
    },
  });
  const f = features.find((feat) => feat.properties.dataPointId === "multi");
  assert.equal(f.properties.photo, "a.webp");
  assert.equal(f.properties.thumbnail, "a-t.webp");
  assert.equal(f.properties.emoji, "☕");
}
console.log("data-marker images tests passed");

console.log("test-data-markers passed");
