import assert from "node:assert/strict";
import {
  loadRouteCatalogWithAssetLoader,
} from "../packages/core/src/data/catalog.js";

const catalog = await loadRouteCatalogWithAssetLoader(async (path) => {
  assert.equal(path, "public-data/route-catalog.json");
  return {
    version: 1,
    entries: [
      {
        slug: "sovev-beit-hillel",
        name: "סובב בית הלל",
        route: "encoded-route",
      },
    ],
  };
});

assert.equal(catalog.version, 1);
assert.equal(catalog.entries.length, 1);
assert.equal(catalog.entries[0].slug, "sovev-beit-hillel");
assert.equal(catalog.entries[0].route, "encoded-route");

console.log("route catalog loading tests passed");
