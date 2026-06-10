import assert from "node:assert/strict";
import {
  hasActiveDiscoverFilters,
  selectDiscoverRoutes,
} from "../src/components/frontPanel/discoverRouteList.js";

const entries = [
  { slug: "a", difficulty: "easy", featured: true },
  { slug: "b", difficulty: "moderate", featured: false },
  { slug: "c", difficulty: "easy", featured: true },
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

console.log("discover-route-list ok");
