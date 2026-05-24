import assert from "node:assert/strict";
import { catalogFilter } from "../src/components/catalogFilter.js";

const catalog = [
  { slug: "a", distanceKm: 5,  elevationGainM: 50,  regionId: "hula-valley", passesNear: ["beit-hillel"], difficulty: "easy",     style: "family",      qualityScore: 4.5 },
  { slug: "b", distanceKm: 15, elevationGainM: 200, regionId: "hula-valley", passesNear: ["dafna"],       difficulty: "moderate", style: "scenic",      qualityScore: 4.2 },
  { slug: "c", distanceKm: 30, elevationGainM: 700, regionId: "north-golan", passesNear: ["banias"],      difficulty: "hard",     style: "sporty",      qualityScore: 3.8 },
  { slug: "d", distanceKm: 8,  elevationGainM: 30,  regionId: "hula-valley", passesNear: ["beit-hillel"], difficulty: "easy",     style: "scenic",      qualityScore: 3.5 },
];

// All "any" returns full catalog sorted by qualityScore.
const all = catalogFilter(catalog, { place: "any", region: "any", distance: "any", difficulty: "any", style: "any" });
assert.equal(all.length, 4);
assert.equal(all[0].slug, "a");

// Hard filter on place
const onlyBeitHillel = catalogFilter(catalog, { place: "beit-hillel", region: "any", distance: "any", difficulty: "any", style: "any" });
assert.deepEqual(onlyBeitHillel.map(r => r.slug), ["a", "d"]);

// Hard filter on region (place=any)
const golan = catalogFilter(catalog, { place: "any", region: "north-golan", distance: "any", difficulty: "any", style: "any" });
assert.deepEqual(golan.map(r => r.slug), ["c"]);

// Soft scoring: distance="medium" prefers b (15 km, exact match) over a (5 km, adjacent)
const medium = catalogFilter(catalog, { place: "any", region: "any", distance: "medium", difficulty: "any", style: "any" });
assert.equal(medium[0].slug, "b");

// Soft scoring: style="family" prefers a (exact) over b (no match)
const family = catalogFilter(catalog, { place: "any", region: "any", distance: "any", difficulty: "any", style: "family" });
assert.equal(family[0].slug, "a");

// No match returns empty
const empty = catalogFilter(catalog, { place: "nonexistent", region: "any", distance: "any", difficulty: "any", style: "any" });
assert.deepEqual(empty, []);

// Returns at most 5
const fiveCat = Array.from({ length: 10 }, (_, i) => ({
  slug: `r${i}`, distanceKm: 10, elevationGainM: 100, regionId: "x", passesNear: [],
  difficulty: "easy", style: "scenic", qualityScore: 5 - i * 0.1,
}));
const five = catalogFilter(fiveCat, { place: "any", region: "any", distance: "any", difficulty: "any", style: "any" });
assert.equal(five.length, 5);
assert.equal(five[0].slug, "r0");

console.log("catalogFilter tests passed");
