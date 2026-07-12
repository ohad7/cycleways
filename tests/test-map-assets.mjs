import assert from "node:assert/strict";
import { loadMapAssets, summarizeMapAssets } from "@cycleways/core/data/mapAssets.js";

const manifest = {
  version: "shard-test",
  bikeRoads: "bike-roads.json",
  segments: "segments.json",
  cwBaseIndex: "cw-base-index.json",
  baseRoutingShards: "base-routing-shards.test/manifest.json",
  roundabouts: "roundabouts.json",
};
const assetsByPath = new Map([
  ["public-data/map-manifest.json", manifest],
  ["public-data/bike-roads.json", { type: "FeatureCollection", features: [] }],
  ["public-data/segments.json", { Segment: { id: 1 } }],
  ["public-data/cw-base-index.json", { segments: { 1: [[100, 0]] } }],
  ["public-data/roundabouts.json", { roundabouts: [{ id: "r1" }] }],
  [
    "public-data/base-routing-shards.test/manifest.json",
    { shards: [{ id: "g1_1", path: "shards/g1_1.json" }] },
  ],
]);
const requestedPaths = [];
const originalFetch = global.fetch;
global.fetch = async (url) => {
  const pathWithQuery = String(url).replace(/^(\.\/|\/)/, "");
  const path = pathWithQuery.replace(/\?.*$/, "");
  requestedPaths.push(pathWithQuery);
  const value = assetsByPath.get(path);
  return {
    ok: value !== undefined,
    status: value === undefined ? 404 : 200,
    statusText: value === undefined ? "Not found" : "OK",
    async json() {
      return value;
    },
  };
};

try {
  const shardedAssets = await loadMapAssets({ includeRoundabouts: true });
  assert.equal(shardedAssets.baseRoutingMode, "shards");
  assert.equal(shardedAssets.baseRoutingNetworkData, null);
  assert.equal(Object.keys(shardedAssets.cwBaseIndexData.segments).length, 1);
  assert.equal(shardedAssets.baseRoutingShardManifestData.shards.length, 1);
  assert.equal(
    shardedAssets.baseRoutingShardManifestPath,
    "public-data/base-routing-shards.test/manifest.json",
  );
  assert.ok(
    requestedPaths.includes("public-data/base-routing-shards.test/manifest.json?v=shard-test"),
  );
  assert.ok(requestedPaths.includes("public-data/cw-base-index.json?v=shard-test"));
  assert.ok(requestedPaths.includes("public-data/roundabouts.json?v=shard-test"));
  assert.equal(shardedAssets.roundaboutsData.roundabouts.length, 1);
  assert.ok(!requestedPaths.includes("public-data/base-routing-network.json"));
  assert.equal(summarizeMapAssets(shardedAssets).baseRoutingShards, 1);
  assert.equal(summarizeMapAssets(shardedAssets).cwBaseIndexSegments, 1);
  assert.equal(summarizeMapAssets(shardedAssets).roundabouts, 1);

  requestedPaths.length = 0;
  const legacyAssets = await loadMapAssets({ baseRoutingMode: "legacy", includeRoundabouts: true });
  assert.equal(legacyAssets.baseRoutingMode, "legacy");
  assert.equal(legacyAssets.baseRoutingNetworkData, null);
  assert.equal(legacyAssets.baseRoutingShardManifestData, null);
  assert.ok(!requestedPaths.includes("public-data/base-routing-network.json"));
  assert.ok(
    !requestedPaths.includes("public-data/base-routing-shards.test/manifest.json?v=shard-test"),
  );

  const abortError = new Error("signal is aborted without reason");
  abortError.name = "AbortError";
  global.fetch = async () => {
    throw abortError;
  };
  await assert.rejects(
    loadMapAssets({ signal: new AbortController().signal }),
    (error) => error === abortError,
  );
} finally {
  global.fetch = originalFetch;
}

console.log("Map asset loading tests passed");
