import assert from "node:assert/strict";
import { validateSourceGeojson } from "../editor/server.mjs";

function sourceWithMarker(marker) {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          id: 1,
          name: "Segment with POI",
          status: "active",
          quality: {
            overall: 3,
            safety: 3,
            comfort: 3,
            scenery: 3,
          },
          data: [marker],
        },
        geometry: {
          type: "LineString",
          coordinates: [
            [35.6, 33.1],
            [35.61, 33.11],
          ],
        },
      },
    ],
  };
}

validateSourceGeojson(
  sourceWithMarker({
    type: "cafe",
    id: "segment-cafe",
    name: "Segment cafe",
    information: "Short stop description",
    description: "Longer stop description.",
    photo: "/images/background.png",
    thumbnail: "/images/background.png",
    gallery: true,
    website: "https://example.com",
    phone: "050-000-0000",
    hours: "08:00-16:00",
    location: [33.105, 35.605],
  }),
);

assert.throws(
  () =>
    validateSourceGeojson(
      sourceWithMarker({
        type: "viewpoint",
        information: "No id",
        photo: "/images/background.png",
        location: [33.105, 35.605],
      }),
    ),
  /stable id/,
);

assert.throws(
  () =>
    validateSourceGeojson(
      sourceWithMarker({
        type: "viewpoint",
        id: "viewpoint-no-image",
        name: "Viewpoint",
        gallery: true,
        location: [33.105, 35.605],
      }),
    ),
  /no image/,
);

assert.throws(
  () =>
    validateSourceGeojson(
      sourceWithMarker({
        type: "restaurant",
        id: "bad-restaurant",
        name: 123,
        photo: "/images/background.png",
        location: [33.105, 35.605],
      }),
    ),
  /invalid name/,
);

console.log("editor POI validation tests passed");

// images[] is accepted when shaped correctly
validateSourceGeojson(
  sourceWithMarker({
    type: "cafe",
    id: "segment-cafe-multi",
    name: "Segment cafe",
    images: [
      { photo: "/images/background.png", thumbnail: "/images/background.png" },
      { photo: "/images/background_grass.png" },
    ],
    location: [33.105, 35.605],
  }),
);

// images entries must have a string photo
assert.throws(
  () =>
    validateSourceGeojson(
      sourceWithMarker({
        type: "cafe",
        id: "bad-images",
        name: "Bad",
        images: [{ thumbnail: "/images/background.png" }],
        location: [33.105, 35.605],
      }),
    ),
  /image/i,
);

// a gallery POI with empty images[] and no legacy photo is rejected (no image)
assert.throws(
  () =>
    validateSourceGeojson(
      sourceWithMarker({
        type: "viewpoint",
        id: "empty-images",
        name: "Empty",
        gallery: true,
        images: [],
        location: [33.105, 35.605],
      }),
    ),
  /no image/,
);

console.log("editor POI images[] validation tests passed");
