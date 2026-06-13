import assert from "node:assert/strict";
import {
  endpointLabel,
  routeEndpointSlides,
  routeEndpointStories,
} from "@cycleways/core/data/routePoiStoryData.js";
import {
  routeCatalogImageCandidatesFromSnapshot,
  validateCatalogDraft,
} from "../editor/server.mjs";

const geometry = [
  { lat: 33.1, lng: 35.6 },
  { lat: 33.2, lng: 35.7 },
  { lat: 33.3, lng: 35.8 },
];
const routeState = { geometry, distance: 6500 };

// No start point -> feature off.
assert.deepEqual(routeEndpointStories({}, routeState), []);
assert.deepEqual(routeEndpointSlides({}, routeState), []);

// Start only (cyclic): one story at fraction 0, location from geometry[0].
const metaStart = {
  start: {
    name: "חניון ההתחלה",
    description: "חניה נוחה",
    images: [{ photo: "s.webp", thumbnail: "s-thumb.webp" }],
  },
};
const startOnly = routeEndpointStories(metaStart, routeState);
assert.equal(startOnly.length, 1);
assert.equal(startOnly[0].kind, "start");
assert.equal(startOnly[0].routeFraction, 0);
assert.equal(startOnly[0].routeProgressMeters, 0);
assert.deepEqual(startOnly[0].location, [33.1, 35.6]);
assert.equal(startOnly[0].images.length, 1);

// Start + end: end at fraction 1, progress = distance, location from last point.
const metaBoth = {
  start: { name: "S", images: [{ photo: "s.webp" }] },
  end: { name: "E", description: "סיום", images: [{ photo: "e.webp" }] },
};
const both = routeEndpointStories(metaBoth, routeState);
assert.equal(both.length, 2);
assert.equal(both[0].kind, "start");
assert.equal(both[1].kind, "end");
assert.equal(both[1].routeFraction, 1);
assert.equal(both[1].routeProgressMeters, 6500);
assert.deepEqual(both[1].location, [33.3, 35.8]);

// Missing image or missing name -> skipped.
assert.deepEqual(routeEndpointStories({ start: { name: "x", images: [] } }, routeState), []);
assert.deepEqual(
  routeEndpointStories({ start: { images: [{ photo: "a.webp" }] } }, routeState),
  [],
);

// Slides flatten with top-level photo + fraction, start before end.
const slides = routeEndpointSlides(metaBoth, routeState);
assert.equal(slides.length, 2);
assert.equal(slides[0].kind, "start");
assert.equal(slides[0].routeFraction, 0);
assert.equal(slides[0].photo, "s.webp");
assert.equal(slides[1].kind, "end");
assert.equal(slides[1].routeFraction, 1);

// Labels.
assert.equal(endpointLabel("start"), "🚩 התחלה");
assert.equal(endpointLabel("end"), "🏁 סיום");
assert.equal(endpointLabel(null), null);

// Catalog validation: valid start/end accepted.
const baseEntry = { slug: "demo", name: "Demo", summary: "s", route: "abc" };
validateCatalogDraft({
  entries: [
    {
      ...baseEntry,
      description: "Longer description",
      heroImage: { photo: "hero.webp", thumbnail: "hero-thumb.webp", alt: "Hero" },
      routeMapImage: {
        photo: "map.webp",
        thumbnail: "map-thumb.webp",
        alt: "Route map",
        source: { type: "mapbox-screenshot" },
      },
      start: { name: "S", description: "", images: [{ photo: "s.webp", thumbnail: "t.webp" }] },
      end: { name: "E", images: [{ photo: "e.webp" }] },
    },
  ],
});

// Start present but no image -> rejected.
assert.throws(
  () => validateCatalogDraft({ entries: [{ ...baseEntry, start: { name: "S", images: [] } }] }),
  /start point must have at least one image/,
);

// Start present but no name -> rejected.
assert.throws(
  () =>
    validateCatalogDraft({
      entries: [{ ...baseEntry, start: { images: [{ photo: "s.webp" }] } }],
    }),
  /start point is missing a name/,
);

// Malformed route-level image -> rejected.
assert.throws(
  () =>
    validateCatalogDraft({
      entries: [{ ...baseEntry, heroImage: { thumbnail: "hero-thumb.webp" } }],
    }),
  /heroImage is missing a photo/,
);

assert.throws(
  () =>
    validateCatalogDraft({
      entries: [{ ...baseEntry, routeMapImage: { thumbnail: "map-thumb.webp" } }],
    }),
  /routeMapImage is missing a photo/,
);

const segmentImageCandidates = routeCatalogImageCandidatesFromSnapshot(
  {
    selectedSegments: ["B", "A"],
    activeDataPoints: [
      { id: "a-1", routeProgressMeters: 30 },
      { id: "b-1", routeProgressMeters: 10 },
    ],
  },
  {
    A: {
      data: [
        {
          id: "a-1",
          name: "Alpha",
          images: [{ photo: "a.webp", thumbnail: "a-thumb.webp" }],
        },
        {
          id: "a-2",
          name: "Fallback",
          images: [{ photo: "fallback.webp" }],
        },
      ],
    },
    B: {
      data: [
        {
          id: "b-1",
          name: "Beta",
          images: [
            { photo: "b.webp", thumbnail: "b-thumb.webp" },
            { photo: "a.webp", thumbnail: "a-thumb.webp" },
          ],
        },
      ],
    },
  },
);
assert.deepEqual(
  segmentImageCandidates.map((candidate) => candidate.photo),
  ["b.webp", "a.webp", "fallback.webp"],
);
assert.equal(segmentImageCandidates[0].label, "Beta");
assert.equal(segmentImageCandidates[2].thumbnail, "fallback.webp");

console.log("route-endpoints tests passed");
