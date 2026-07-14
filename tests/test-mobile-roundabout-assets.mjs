import assert from "node:assert/strict";
import {
  manifestReferencedJsonAssets,
  optionalManifestJsonAssets,
} from "../apps/mobile/scripts/sync-offline-assets.mjs";

assert.deepEqual(optionalManifestJsonAssets({}), []);
assert.deepEqual(
  optionalManifestJsonAssets({ roundabouts: "roundabouts.json", crossings: "crossings.json" }),
  [
    { logicalPath: "public-data/roundabouts.json" },
    { logicalPath: "public-data/crossings.json" },
  ],
);

assert.deepEqual(
  manifestReferencedJsonAssets({
    bikeRoads: "bike_roads.geojson",
    segments: "segments.json",
    cwBaseIndex: "cw-base-index.json",
    baseRoutingShards: "routing/manifest.json",
    routeCatalog: "route-catalog.abc123.json",
    cwAlignmentGeometry: "cw-alignments.json",
    crossings: "crossings.json",
    legacyRoutingCompatibility: {
      cwBaseIndex: "routing-compat/cw-v1.json",
      metadata: "routing-compat/cw-v1.metadata.json",
    },
  }),
  [
    {
      logicalPath: "public-data/bike_roads.geojson",
      targetPath: "public-data/bike_roads.geojson.json",
    },
    { logicalPath: "public-data/crossings.json" },
    { logicalPath: "public-data/cw-alignments.json" },
    { logicalPath: "public-data/cw-base-index.json" },
    { logicalPath: "public-data/route-catalog.abc123.json" },
    { logicalPath: "public-data/routing-compat/cw-v1.json" },
    { logicalPath: "public-data/routing-compat/cw-v1.metadata.json" },
    { logicalPath: "public-data/routing/manifest.json" },
    { logicalPath: "public-data/segments.json" },
  ],
);

console.log("mobile roundabout asset tests passed");
