import assert from "node:assert/strict";
import { optionalManifestJsonAssets } from "../apps/mobile/scripts/sync-offline-assets.mjs";

assert.deepEqual(optionalManifestJsonAssets({}), []);
assert.deepEqual(
  optionalManifestJsonAssets({ roundabouts: "roundabouts.json" }),
  [{ logicalPath: "public-data/roundabouts.json" }],
);

console.log("mobile roundabout asset tests passed");
