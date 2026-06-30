import assert from "node:assert/strict";
import { filterCatalogBySearch } from "../packages/core/src/data/catalogSearch.js";

const entries = [
  { slug: "a", name: "סובב בית הלל", passesNear: ["beit-hillel"] },
  { slug: "b", name: "מסלול הבניאס", passesNear: ["banias"] },
  { slug: "c", name: "רכיבה בעמק", passesNear: ["beit-hillel", "shdeh"] },
];
const placeById = new Map([
  ["beit-hillel", { id: "beit-hillel", name: "בית הלל" }],
  ["banias", { id: "banias", name: "בניאס" }],
  ["shdeh", { id: "shdeh", name: "שדה נחמיה" }],
]);

// Empty query returns everything unchanged.
assert.equal(filterCatalogBySearch(entries, "", placeById).length, 3);
assert.equal(filterCatalogBySearch(entries, "   ", placeById).length, 3);

// Match by route name.
let r = filterCatalogBySearch(entries, "בניאס", placeById);
assert.deepEqual(r.map((e) => e.slug), ["b"]);

// Match by nearby-place name (matches the route even though its name lacks it).
r = filterCatalogBySearch(entries, "בית הלל", placeById);
assert.deepEqual(r.map((e) => e.slug).sort(), ["a", "c"]);

// Case-insensitive over latin too.
const latin = [{ slug: "x", name: "Hula Loop", passesNear: [] }];
assert.equal(filterCatalogBySearch(latin, "hula", new Map()).length, 1);

console.log("test-catalog-search: ok");
