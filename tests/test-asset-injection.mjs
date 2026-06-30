import assert from "node:assert/strict";
import {
  getInjectedJsonAsset,
  getJsonAsset,
} from "../packages/core/src/platform/assets.js";

// No injected assets -> undefined (callers then fetch as before).
delete globalThis.__CW_ASSETS__;
assert.equal(getInjectedJsonAsset("public-data/route-catalog.json"), undefined);

// With injected assets, the matching key is returned without any network fetch.
globalThis.__CW_ASSETS__ = {
  "public-data/route-catalog.json": { entries: [{ slug: "a" }] },
  "public-data/route-videos/index.json": { routes: { a: "a.json" } },
};
assert.deepEqual(getInjectedJsonAsset("public-data/route-catalog.json"), {
  entries: [{ slug: "a" }],
});
const cat = await getJsonAsset("public-data/route-catalog.json");
assert.deepEqual(cat, { entries: [{ slug: "a" }] });

// A key that isn't injected falls through (undefined here; would fetch in app).
assert.equal(getInjectedJsonAsset("public-data/not-injected.json"), undefined);

delete globalThis.__CW_ASSETS__;
console.log("test-asset-injection: ok");
