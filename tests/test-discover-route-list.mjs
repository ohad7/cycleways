import assert from "node:assert/strict";
import {
  filterRoutesByDiscoveryIntent,
  hasActiveDiscoverFilters,
  selectDiscoveryHero,
  selectDiscoverRoutes,
  routesWithoutDiscoveryHero,
} from "../src/components/frontPanel/discoverRouteList.js";

const entries = [
  { slug: "a", difficulty: "easy", featured: true, distanceKm: 6, summary: "מסלול משפחתי" },
  { slug: "b", difficulty: "moderate", featured: false, distanceKm: 18, summary: "רכיבה ליד הירדן" },
  { slug: "c", difficulty: "easy", featured: true, distanceKm: 14, summary: "מסלול ארוך" },
];

// Empty filter object → no active filters.
assert.equal(hasActiveDiscoverFilters({}), false);
assert.equal(
  hasActiveDiscoverFilters({ difficulty: new Set(), startLocation: new Set() }),
  false,
);
assert.equal(hasActiveDiscoverFilters({ difficulty: new Set(["easy"]) }), true);

// No active filters → all mode = every entry in catalog order.
const all = selectDiscoverRoutes(entries, {});
assert.equal(all.mode, "all");
assert.deepEqual(all.routes.map((r) => r.slug), ["a", "b", "c"]);

// Active filter → results mode = catalogFilter output.
const res = selectDiscoverRoutes(entries, { difficulty: new Set(["moderate"]) });
assert.equal(res.mode, "results");
assert.deepEqual(res.routes.map((r) => r.slug), ["b"]);

// Hero selection prefers featured/recommended routes and is deterministic for
// a session seed.
assert.equal(selectDiscoveryHero(entries, { seed: 0 })?.slug, "a");
assert.equal(selectDiscoveryHero(entries, { seed: 0.75 })?.slug, "c");
assert.equal(selectDiscoveryHero(entries, { seed: 0.75 })?.slug, "c");

// With no featured routes, fall back to the visible catalog.
const plain = entries.map((entry) => ({ ...entry, featured: false }));
assert.equal(selectDiscoveryHero(plain, { seed: 0.5 })?.slug, "b");
assert.equal(
  selectDiscoveryHero(entries, { seed: 0.4, preferEditorial: false })?.slug,
  "b",
);

// The selected hero is removed from the secondary list.
assert.deepEqual(
  routesWithoutDiscoveryHero(entries, entries[0]).map((r) => r.slug),
  ["b", "c"],
);

// Empty and single-route catalogs are safe.
assert.equal(selectDiscoveryHero([], { seed: 0.2 }), null);
assert.deepEqual(routesWithoutDiscoveryHero([entries[0]], entries[0]), []);

assert.deepEqual(
  filterRoutesByDiscoveryIntent(entries, new Set(["easy"])).map((r) => r.slug),
  ["a", "c"],
);
assert.deepEqual(
  filterRoutesByDiscoveryIntent(entries, new Set(["family"])).map((r) => r.slug),
  ["a"],
);
assert.deepEqual(
  filterRoutesByDiscoveryIntent(entries, new Set(["water"])).map((r) => r.slug),
  ["b"],
);
assert.deepEqual(
  filterRoutesByDiscoveryIntent(entries, new Set(["easy", "family"])).map((r) => r.slug),
  ["a"],
);

console.log("discover-route-list ok");
