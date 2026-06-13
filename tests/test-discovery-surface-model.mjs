import assert from "node:assert/strict";
import {
  buildDiscoveryFilterOptions,
  buildDiscoveryRoutes,
  buildRouteCardViewModels,
  createPlaceById,
  featuredDiscoveryRoutes,
  hasActiveDiscoverFilters,
  selectDiscoverRoutes,
} from "../packages/core/src/discovery/discoverySurfaceModel.js";

const places = [
  { id: "beit-hillel", name: "בית הלל", lat: 33.208, lng: 35.607 },
  { id: "dafna", name: "דפנה", lat: 33.23, lng: 35.638 },
];
const placeById = createPlaceById(places);
const entries = [
  {
    slug: "a",
    name: "A",
    route: "route-a",
    difficulty: "easy",
    distanceKm: 8,
    elevationGainM: 100,
    featured: true,
    passesNear: ["beit-hillel"],
    routeShape: "circular",
    routeMapImage: {
      photo: "public-data/route-map-images/a.webp",
      thumbnail: "public-data/route-map-images/a-thumb.webp",
    },
  },
  {
    slug: "b",
    name: "B",
    route: "route-b",
    difficulty: "moderate",
    distanceKm: 22,
    elevationGainM: 200,
    featured: false,
    startPlaceIds: ["dafna"],
    passesNear: ["dafna"],
  },
];

assert.equal(hasActiveDiscoverFilters({}), false);
assert.equal(hasActiveDiscoverFilters({ difficulty: new Set(["easy"]) }), true);

assert.deepEqual(
  selectDiscoverRoutes(entries, {}).routes.map((entry) => entry.slug),
  ["a", "b"],
);
assert.deepEqual(
  selectDiscoverRoutes(entries, { difficulty: new Set(["moderate"]) }).routes.map(
    (entry) => entry.slug,
  ),
  ["b"],
);

const options = buildDiscoveryFilterOptions(entries, placeById);
assert.deepEqual(
  options.throughPlaceOptions.map((option) => option.value),
  ["beit-hillel", "dafna"],
);
assert.deepEqual(
  options.startPlaceOptions.map((option) => option.value),
  ["beit-hillel", "dafna"],
);

assert.deepEqual(
  featuredDiscoveryRoutes(entries).map((entry) => entry.slug),
  ["a"],
);

const nearMe = buildDiscoveryRoutes({
  entries,
  filters: {},
  locationFix: { lat: 33.231, lng: 35.639 },
  nearMeSort: true,
  placeById,
});
assert.deepEqual(nearMe.routes.map((entry) => entry.slug), ["b", "a"]);

const [card] = buildRouteCardViewModels(entries, { placeById });
assert.equal(card.name, "A");
assert.equal(card.image.thumbnail, "public-data/route-map-images/a-thumb.webp");
assert.ok(card.stats.includes("8.0 ק״מ"));
assert.ok(card.stats.includes("100 מ׳ טיפוס"));
assert.deepEqual(card.placeNames, ["בית הלל"]);

console.log("discovery surface model tests passed");
