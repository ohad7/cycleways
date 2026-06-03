import assert from "node:assert/strict";
import {
  dataMarkerFeatureCollection,
  dataMarkerFeaturesFromActiveDataPoints,
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

{
  // dataMarkerFeaturesFromActiveDataPoints: location-guard rejection, fallback
  // id derivation, and segmentName passthrough.
  const activeDataPoints = [
    // Rejected: missing location.
    { type: "gate", information: "no location" },
    // Rejected: bad (non-finite) location coordinate.
    { type: "gate", location: ["bad", 35.6] },
    // Rejected: too-short location array.
    { type: "gate", location: [33.1] },
    // Accepted: explicit id wins.
    { id: "explicit-id", type: "cafe", location: [33.1, 35.6], segmentName: "Seg X" },
    // Accepted: fallback id uses segmentName + index.
    { type: "mud", location: [33.2, 35.7], segmentName: "Seg Y" },
    // Accepted: fallback id uses "active" when segmentName is absent.
    { type: "water", location: [33.3, 35.8] },
  ];

  const features = dataMarkerFeaturesFromActiveDataPoints(activeDataPoints);
  // Only the 3 valid-location points survive the guard.
  assert.equal(features.length, 3);

  // Explicit id passthrough.
  assert.equal(features[0].id, "explicit-id");
  assert.equal(features[0].properties.dataPointId, "explicit-id");
  assert.equal(features[0].properties.segmentName, "Seg X");
  // Coordinates are emitted as [lng, lat] from the [lat, lng] location.
  assert.deepEqual(features[0].geometry.coordinates, [35.6, 33.1]);

  // Fallback id: `${segmentName}-${index}` where index is the original index
  // in activeDataPoints (4 here), not the filtered output index.
  assert.equal(features[1].id, "Seg Y-4");
  assert.equal(features[1].properties.dataPointId, "Seg Y-4");
  assert.equal(features[1].properties.segmentName, "Seg Y");

  // Fallback id with no segmentName uses the "active" prefix.
  assert.equal(features[2].id, "active-5");
  assert.equal(features[2].properties.dataPointId, "active-5");

  // Non-array input is tolerated and yields no features.
  assert.deepEqual(dataMarkerFeaturesFromActiveDataPoints(null), []);
  assert.deepEqual(dataMarkerFeaturesFromActiveDataPoints(undefined), []);
}
console.log("data-marker active-data-point tests passed");

console.log("test-data-markers passed");
