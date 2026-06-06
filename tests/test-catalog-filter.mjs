import assert from "node:assert/strict";
import { catalogFilter } from "../src/components/catalogFilter.js";

const catalog = [
  { slug: "a", distanceKm: 5,  elevationGainM: 50,  regionId: "hula-valley", passesNear: ["beit-hillel"], startPlaceIds: ["beit-hillel"], routeShape: { type: "circular" }, difficulty: "easy",     style: "family", surfaceType: "paved", qualityScore: 4.5 },
  { slug: "b", distanceKm: 15, elevationGainM: 200, regionId: "hula-valley", passesNear: ["dafna"],       startPlaceIds: ["dafna"],       routeShape: { type: "circular" }, difficulty: "moderate", style: "scenic", surfaceType: "mixed", qualityScore: 4.2 },
  { slug: "c", distanceKm: 30, elevationGainM: 700, regionId: "north-golan", passesNear: ["banias"],      startPlaceIds: ["dafna"],       routeShape: { type: "one_way" }, difficulty: "hard",     style: "sporty", surfaceType: "dirt", qualityScore: 3.8 },
  { slug: "d", distanceKm: 8,  elevationGainM: 30,  regionId: "hula-valley", passesNear: ["beit-hillel"], routeShape: { type: "circular" }, difficulty: "easy",     style: "scenic", surfaceType: "paved", qualityScore: 3.5 },
];

// No filters → all entries sorted by qualityScore desc.
const all = catalogFilter(catalog, {});
assert.deepEqual(all.map((r) => r.slug), ["a", "b", "c", "d"]);

// place filter is single-valued.
const beitHillel = catalogFilter(catalog, { place: "beit-hillel" });
assert.deepEqual(beitHillel.map((r) => r.slug), ["a", "d"]);

// Single difficulty in the set
const easyOnly = catalogFilter(catalog, { difficulty: new Set(["easy"]) });
assert.deepEqual(easyOnly.map((r) => r.slug), ["a", "d"]);

// Multi-value difficulty: union within axis
const easyOrModerate = catalogFilter(catalog, {
  difficulty: new Set(["easy", "moderate"]),
});
assert.deepEqual(easyOrModerate.map((r) => r.slug), ["a", "b", "d"]);

// Combined axes: AND across, OR within
const easyScenic = catalogFilter(catalog, {
  difficulty: new Set(["easy"]),
  style: new Set(["scenic"]),
});
assert.deepEqual(easyScenic.map((r) => r.slug), ["d"]);

// Distance bucket filter
const shortRides = catalogFilter(catalog, { distance: new Set(["short"]) });
assert.deepEqual(shortRides.map((r) => r.slug), ["a", "d"]);

// Surface filter
const pavedRides = catalogFilter(catalog, { surface: new Set(["paved"]) });
assert.deepEqual(pavedRides.map((r) => r.slug), ["a", "d"]);

// Region filter
const golan = catalogFilter(catalog, { region: new Set(["north-golan"]) });
assert.deepEqual(golan.map((r) => r.slug), ["c"]);

// Start location: circular routes can start from any pass-through place, while
// one-way routes only match explicit startPlaceIds.
const startsAtBeitHillel = catalogFilter(catalog, {
  startLocation: new Set(["beit-hillel"]),
});
assert.deepEqual(startsAtBeitHillel.map((r) => r.slug), ["a", "d"]);

const startsAtDafna = catalogFilter(catalog, {
  startLocation: new Set(["dafna"]),
});
assert.deepEqual(startsAtDafna.map((r) => r.slug), ["b", "c"]);

// Goes-through location stays based on the route path, not the one-way start.
const throughBanias = catalogFilter(catalog, {
  throughLocation: new Set(["banias"]),
});
assert.deepEqual(throughBanias.map((r) => r.slug), ["c"]);

// Empty filter sets behave the same as missing
assert.equal(catalogFilter(catalog, { difficulty: new Set() }).length, 4);

// Place filter with no matches
const none = catalogFilter(catalog, { place: "nonexistent" });
assert.deepEqual(none, []);

console.log("catalogFilter tests passed");
