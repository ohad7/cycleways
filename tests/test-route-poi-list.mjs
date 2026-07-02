import assert from "node:assert/strict";
import { routePoiList } from "@cycleways/core/data/routePoiList.js";

const activeDataPoints = [
  {
    id: "poi-b",
    type: "viewpoint",
    name: "תצפית",
    information: "נוף יפה",
    images: [
      { photo: "public-data/poi-images/b.webp", thumbnail: "public-data/poi-images/b-thumb.webp" },
    ],
    routeProgressMeters: 800,
  },
  {
    // A warning -> excluded from the POI list (shown separately on web).
    id: "warn-1",
    type: "gate",
    name: "שער",
    information: "שער חקלאי",
    routeProgressMeters: 400,
  },
  {
    id: "poi-a",
    type: "water",
    name: "ברזיה",
    information: "מי שתייה",
    images: [{ photo: "public-data/poi-images/a.webp" }], // no thumbnail -> photo
    routeProgressMeters: 200,
  },
  {
    id: "poi-c",
    type: "rest",
    name: "מנוחה",
    information: "ספסל",
    // no images, no progress -> sorts last, imagePath null
  },
];

const list = routePoiList(activeDataPoints);

// Warnings excluded; ordered by route progress; null-progress last.
assert.deepEqual(
  list.map((p) => p.id),
  ["poi-a", "poi-b", "poi-c"],
  "non-warning POIs, ordered by route progress",
);

assert.equal(list[0].name, "ברזיה");
assert.equal(list[0].imagePath, "public-data/poi-images/a.webp", "falls back to photo");
assert.equal(list[1].imagePath, "public-data/poi-images/b-thumb.webp", "prefers thumbnail");
assert.equal(list[2].imagePath, null, "no image -> null");
assert.equal(list[0].information, "מי שתייה");

// Empty / non-array input -> [].
assert.deepEqual(routePoiList(null), []);
assert.deepEqual(routePoiList([]), []);

console.log("route POI list tests passed");
