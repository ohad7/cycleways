import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import {
  createRouteManager,
  addPoint,
} from "@cycleways/core/routing/routeActions.js";
import {
  galleryImageSlides,
  isGalleryEligiblePoi,
  nearestSlideIndexByFraction,
  normalizePoiImages,
  poiIcon,
  poiMarkerIconName,
  primaryPoiImage,
} from "@cycleways/core/data/poiTypes.js";
import { getRouteWarningPresentation } from "@cycleways/core/ui/routePlannerPresentation.js";

const require = createRequire(import.meta.url);
const RouteManager = require("../packages/core/route-manager.js");

const geoJsonData = JSON.parse(
  await readFile(new URL("./bike_roads_test.geojson", import.meta.url)),
);

// build a test segments file inline with a stable-id POI on a segment we know
// the route will traverse (segment id 15 — "דרך המנפטה" — see
// tests/test-react-route-actions.mjs).
const baseSegments = JSON.parse(
  await readFile(new URL("./segments-test.json", import.meta.url)),
);
const segmentName = "דרך המנפטה";
baseSegments[segmentName] = {
  ...baseSegments[segmentName],
  data: [
    {
      type: "cafe",
      id: "cafe-test-1",
      name: "Test cafe",
      information: "test cafe",
      photo: "/attached_assets/background.png",
      location: [33.11124, 35.586584],
    },
  ],
};

const manager = await createRouteManager(
  RouteManager,
  geoJsonData,
  baseSegments,
);
// Adding points to cross the segment — coordinates pulled from existing test
let snapshot = addPoint(
  manager,
  { lat: 33.128051854432194, lng: 35.583601947688756 },
  baseSegments,
);
snapshot = addPoint(
  manager,
  { lat: 33.11076673723811, lng: 35.57875100376203 },
  baseSegments,
);

assert.ok(
  snapshot.selectedSegments.includes(segmentName),
  `expected route to cross ${segmentName}, got ${JSON.stringify(snapshot.selectedSegments)}`,
);

// The test segment may or may not be on the route; the important behavior:
// if a data point has an id, the resulting activeDataPoint must carry that id.
let matched = 0;
for (const dp of snapshot.activeDataPoints) {
  if (dp.segmentName === segmentName) {
    assert.equal(dp.id, "cafe-test-1");
    assert.equal(dp.name, "Test cafe");
    assert.ok(Number.isFinite(dp.routeProgressMeters));
    assert.ok(dp.routeProgressMeters >= 0);
    assert.ok(Number.isFinite(dp.routeFraction));
    assert.ok(dp.routeFraction >= 0 && dp.routeFraction <= 1);
    assert.equal(isGalleryEligiblePoi(dp), true);
    matched += 1;
  }
}
assert.ok(
  matched > 0,
  "expected at least one activeDataPoint from the seeded segment",
);

// Sanity: a POI without an explicit id still falls back to the synthesized id
const fallbackSegmentName = "כביש גישה אגמון החולה";
const fallbackBaseSegments = JSON.parse(
  await readFile(new URL("./segments-test.json", import.meta.url)),
);
fallbackBaseSegments[fallbackSegmentName] = {
  ...fallbackBaseSegments[fallbackSegmentName],
  data: [
    {
      type: "viewpoint",
      information: "no-id viewpoint",
      location: [33.11124, 35.586584],
    },
  ],
};
const fallbackManager = await createRouteManager(
  RouteManager,
  geoJsonData,
  fallbackBaseSegments,
);
let fallbackSnapshot = addPoint(
  fallbackManager,
  { lat: 33.128051854432194, lng: 35.583601947688756 },
  fallbackBaseSegments,
);
fallbackSnapshot = addPoint(
  fallbackManager,
  { lat: 33.11076673723811, lng: 35.57875100376203 },
  fallbackBaseSegments,
);
for (const dp of fallbackSnapshot.activeDataPoints) {
  if (dp.segmentName === fallbackSegmentName) {
    assert.equal(dp.id, `${fallbackSegmentName}-0`);
  }
}

const warningPresentation = getRouteWarningPresentation([
  { segmentName: "מקטע בדיקה", type: "mud" },
  { segmentName: "מקטע בדיקה", type: "gate" },
  { segmentName: "עצירה", type: "cafe" },
]);
assert.equal(warningPresentation.count, 3);
assert.equal(warningPresentation.toggleLabel, "⚠️ מידע חשוב (3)");
assert.equal(warningPresentation.groups.length, 2);
assert.equal(warningPresentation.groups[0].label, "אזהרות");
assert.equal(warningPresentation.groups[0].backgroundColor, "#FF5722");
assert.deepEqual(warningPresentation.groups[0].icons, ["⚠️", "🚧"]);
assert.equal(warningPresentation.groups[1].label, "בית קפה");
assert.equal(warningPresentation.groups[1].backgroundColor, "#b07a3f");
assert.deepEqual(warningPresentation.groups[1].icons, ["☕"]);

const selectedMarkerPresentation = getRouteWarningPresentation([], {
  segmentName: "נקודה",
  type: "slope",
});
assert.equal(selectedMarkerPresentation.count, 1);
assert.equal(selectedMarkerPresentation.toggleLabel, "⚠️ מידע חשוב");
assert.equal(selectedMarkerPresentation.groups[0].label, "שיפוע");

assert.equal(
  isGalleryEligiblePoi({ type: "viewpoint", photo: "/photo.jpg" }),
  true,
);
assert.equal(
  isGalleryEligiblePoi({ type: "viewpoint", thumbnail: "/thumb.jpg", gallery: false }),
  false,
);
assert.equal(
  isGalleryEligiblePoi({ type: "warning", photo: "/warning.jpg" }),
  false,
);

// images[] passthrough, filtering invalid entries
assert.deepEqual(
  normalizePoiImages({
    images: [
      { photo: "a.webp", thumbnail: "a-thumb.webp" },
      { photo: "b.webp" },
      { thumbnail: "no-photo.webp" }, // dropped: no photo
      "nope", // dropped: not an object
    ],
  }),
  [
    { photo: "a.webp", thumbnail: "a-thumb.webp" },
    { photo: "b.webp", thumbnail: "b.webp" },
  ],
);

// legacy photo/thumbnail synthesized into a single entry
assert.deepEqual(normalizePoiImages({ photo: "c.webp", thumbnail: "c-t.webp" }), [
  { photo: "c.webp", thumbnail: "c-t.webp" },
]);
assert.deepEqual(normalizePoiImages({ photo: "d.webp" }), [
  { photo: "d.webp", thumbnail: "d.webp" },
]);

// nothing -> empty
assert.deepEqual(normalizePoiImages({ type: "warning" }), []);
assert.deepEqual(normalizePoiImages(null), []);

// primaryPoiImage returns images[0] or null
assert.deepEqual(primaryPoiImage({ photo: "c.webp" }), {
  photo: "c.webp",
  thumbnail: "c.webp",
});
assert.equal(primaryPoiImage({ type: "gate" }), null);

console.log("normalizePoiImages tests passed");

const points = [
  {
    id: "mid",
    type: "cafe",
    name: "Mid cafe",
    information: "info",
    description: "desc",
    routeProgressMeters: 500,
    routeFraction: 0.5,
    images: [
      { photo: "mid-1.webp", thumbnail: "mid-1-t.webp" },
      { photo: "mid-2.webp", thumbnail: "mid-2-t.webp" },
    ],
  },
  {
    id: "start",
    type: "viewpoint",
    name: "Start view",
    routeProgressMeters: 10,
    routeFraction: 0.1,
    photo: "start.webp", // legacy single image
  },
  { id: "warn", type: "gate", routeProgressMeters: 5 }, // not gallery eligible
  { id: "nogal", type: "cafe", gallery: false, routeProgressMeters: 1, photo: "x.webp" },
];

const slides = galleryImageSlides(points);

// Order: start (10), then mid image 1, then mid image 2. Warnings + gallery:false dropped.
assert.deepEqual(
  slides.map((s) => `${s.poiId}#${s.imageIndex}`),
  ["start#0", "mid#0", "mid#1"],
);

// Each slide carries presentation fields + its image.
assert.equal(slides[0].photo, "start.webp");
assert.equal(slides[0].thumbnail, "start.webp");
assert.equal(slides[0].name, "Start view");
assert.equal(slides[1].photo, "mid-1.webp");
assert.equal(slides[1].poiId, "mid");
assert.equal(slides[1].routeFraction, 0.5);

console.log("galleryImageSlides tests passed");

assert.equal(nearestSlideIndexByFraction(slides, 0.1), 0);
assert.equal(nearestSlideIndexByFraction(slides, 0.49), 1);
assert.equal(nearestSlideIndexByFraction(slides, 0.51), 1);
assert.equal(nearestSlideIndexByFraction(slides, -0.25), 0);
assert.equal(nearestSlideIndexByFraction(slides, 1.25), 1);
assert.equal(nearestSlideIndexByFraction([], 0.5), -1);
assert.equal(nearestSlideIndexByFraction(slides, Number.NaN), -1);
assert.equal(
  nearestSlideIndexByFraction(
    [
      { poiId: "missing" },
      { poiId: "far", routeFraction: 0.9 },
      { poiId: "near", routeFraction: 0.3 },
    ],
    0.25,
  ),
  2,
);
console.log("nearestSlideIndexByFraction tests passed");

// poiMarkerIconName: warnings keep their SVG icon name; POI types get a
// per-type emoji image name (rendered via icon-image, never text-field).
assert.equal(poiMarkerIconName("warning"), poiIcon("warning"));
assert.equal(poiMarkerIconName("gate"), poiIcon("gate"));
assert.equal(poiMarkerIconName("cafe"), "poi-emoji-cafe");
assert.equal(poiMarkerIconName("river"), "poi-emoji-river");
assert.notEqual(poiMarkerIconName("river"), poiMarkerIconName("tree"));
console.log("poiMarkerIconName tests passed");

console.log("POI types tests passed");
