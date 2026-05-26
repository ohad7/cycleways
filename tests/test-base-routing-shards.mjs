import assert from "node:assert/strict";
import {
  baseRoutingShardEntriesForPoints,
  mergeBaseRoutingShards,
} from "../src/routing/baseRoutingShards.js";
import { buildShareInfo } from "../src/routing/routeActions.js";
import { createShardedRouteSession } from "../src/routing/shardedRouteSession.js";
import { decodeRoutePayload } from "../utils/route-encoding.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const RouteManager = require("../route-manager.js");

const geoJsonData = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { id: 10, name: "CW west" },
      geometry: {
        type: "LineString",
        coordinates: [[35, 33], [35.001, 33]],
      },
    },
  ],
};
const segmentsData = {
  "CW west": { id: 10, status: "active" },
};
const nodes = [
  { id: "west", coord: [35, 33] },
  { id: "border", coord: [35.001, 33] },
  { id: "east", coord: [35.002, 33] },
];
const edges = [
  {
    id: "cw-west",
    shareId: 101,
    from: "west",
    to: "border",
    distanceMeters: 93,
    coordinates: [[35, 33], [35.001, 33]],
    routeClass: "path_track",
    cwSegmentIds: [10],
  },
  {
    id: "east-connector",
    shareId: 102,
    from: "border",
    to: "east",
    distanceMeters: 93,
    coordinates: [[35.001, 33], [35.002, 33]],
    routeClass: "local_road",
    cwSegmentIds: [],
  },
];
const fullNetwork = {
  schemaVersion: 2,
  nodes,
  edges,
};
const manifest = {
  scheme: { shardSizeDegrees: 0.001 },
  shards: [
    {
      id: "g700_660",
      bounds: [35, 33, 35.001, 33.001],
    },
    {
      id: "g701_660",
      bounds: [35.001, 33, 35.002, 33.001],
    },
  ],
};
const shardAssets = {
  "g700_660": {
    id: "g700_660",
    sourceRoutingSchemaVersion: 2,
    nodes: nodes.slice(0, 2),
    edges: edges.slice(0, 1),
  },
  "g701_660": {
    id: "g701_660",
    sourceRoutingSchemaVersion: 2,
    nodes: nodes.slice(1),
    edges: edges.slice(1),
  },
};
const cwBaseIndex = {
  schemaVersion: 1,
  segments: {
    10: [[101, 0]],
  },
};
const points = [
  { lat: 33.00001, lng: 35.0001 },
  { lat: 33.00001, lng: 35.0019 },
];

const entries = baseRoutingShardEntriesForPoints(manifest, points, {
  paddingDegrees: 0,
});
assert.deepEqual(
  entries.map((entry) => entry.id),
  ["g700_660", "g701_660"],
);

const shardNetwork = mergeBaseRoutingShards(
  entries.map((entry) => shardAssets[entry.id]),
);
assert.equal(shardNetwork.nodes.length, 3);
assert.equal(shardNetwork.edges.length, 2);
assert.deepEqual(shardNetwork.summary.loadedShards, ["g700_660", "g701_660"]);
assert.deepEqual(
  shardNetwork.edges.map((edge) => [edge.id, edge.shareId, edge.shardIds]),
  [
    ["cw-west", 101, ["g700_660"]],
    ["east-connector", 102, ["g701_660"]],
  ],
);

const fullTraversalIds = await routeTraversalIds(fullNetwork);
const shardTraversalIds = await routeTraversalIds(shardNetwork);
assert.deepEqual(shardTraversalIds, fullTraversalIds);
assert.deepEqual(shardTraversalIds, ["cw-west", "east-connector"]);

const loadedShardIds = [];
const shardStatuses = [];
let shardedManagerLoads = 0;
class IncrementalShardRouteManager extends RouteManager {
  async load(...args) {
    shardedManagerLoads++;
    return super.load(...args);
  }
}
const shardedSession = await createShardedRouteSession(
  IncrementalShardRouteManager,
  geoJsonData,
  segmentsData,
  manifest,
  async (entry) => {
    loadedShardIds.push(entry.id);
    return shardAssets[entry.id];
  },
  {
    paddingShards: 0,
    cwBaseIndex,
    onStatus: (status) => shardStatuses.push(status),
  },
);
let shardedSnapshot = await shardedSession.addPoint(points[0]);
assert.equal(shardedSnapshot.points.length, 1);
assert.deepEqual(loadedShardIds, ["g700_660"]);
shardedSnapshot = await shardedSession.addPoint(points[1]);
assert.equal(shardedSnapshot.points.length, 2);
assert.deepEqual(shardedSnapshot.selectedSegments, ["CW west"]);
assert.deepEqual(loadedShardIds, ["g700_660", "g701_660"]);
const routeShareInfo = buildShareInfo(
  shardedSnapshot,
  segmentsData,
  shardedSession.manager,
  new URL("https://example.test/"),
  cwBaseIndex,
);
assert.equal(routeShareInfo.format, "hybrid_route_v6");
assert.equal(routeShareInfo.status, "ok");
const routeSharePayload = decodeRoutePayload(
  new URL(routeShareInfo.url).searchParams.get("route"),
);
assert.equal(routeSharePayload.type, "hybrid_route_v6");
assert.deepEqual(routeSharePayload.shards.map((shard) => shard.id), [
  "g700_660",
  "g701_660",
]);
assert.equal(routeSharePayload.routePoints[0].lng, undefined);
assert.deepEqual(routeSharePayload.spans[0].edgeShareIds, [101, 102]);
assert.equal(shardedManagerLoads, 1);
const replaySession = await createShardedRouteSession(
  IncrementalShardRouteManager,
  geoJsonData,
  segmentsData,
  manifest,
  async (entry) => shardAssets[entry.id],
  { paddingShards: 0, cwBaseIndex },
);
const replaySnapshot = await replaySession.restoreRouteParam(
  new URL(routeShareInfo.url).searchParams.get("route"),
);
assert.equal(replaySnapshot.routeFailure, null);
assert.deepEqual(
  replaySession.manager
    .getBaseRouteDiagnostics()
    .traversals.map((traversal) => traversal.edgeId),
  ["cw-west", "east-connector"],
);
assert.deepEqual(shardedSession.diagnostics(), {
  loadedShards: ["g700_660", "g701_660"],
  loadedCompactBytes: 0,
  loadedNodes: 3,
  loadedEdges: 2,
});
assert.deepEqual(
  shardStatuses
    .filter((status) => status.phase !== "ready")
    .map((status) => [status.phase, status.batchShardIds]),
  [
    ["loading", ["g700_660"]],
    ["loaded", ["g700_660"]],
    ["loading", ["g701_660"]],
    ["loaded", ["g701_660"]],
  ],
);

const prefetchLoadedShardIds = [];
const prefetchSession = await createShardedRouteSession(
  IncrementalShardRouteManager,
  geoJsonData,
  segmentsData,
  manifest,
  async (entry) => {
    prefetchLoadedShardIds.push(entry.id);
    return shardAssets[entry.id];
  },
  {
    paddingShards: 0,
    prefetchPaddingShards: 0,
  },
);
assert.equal(
  await prefetchSession.prefetchBounds({
    west: 35,
    south: 33,
    east: 35.0005,
    north: 33.0005,
  }),
  true,
);
assert.deepEqual(prefetchLoadedShardIds, ["g700_660"]);
shardedSnapshot = await prefetchSession.addPoint(points[0]);
assert.equal(shardedSnapshot.points.length, 1);
assert.deepEqual(
  prefetchLoadedShardIds,
  ["g700_660"],
  "clicking inside a prefetched shard must not refetch it",
);

let releaseConcurrentLoad;
const concurrentLoadCalls = [];
const concurrentSession = await createShardedRouteSession(
  IncrementalShardRouteManager,
  geoJsonData,
  segmentsData,
  manifest,
  async (entry) => {
    concurrentLoadCalls.push(entry.id);
    if (entry.id === "g700_660") {
      await new Promise((resolve) => {
        releaseConcurrentLoad = resolve;
      });
    }
    return shardAssets[entry.id];
  },
  {
    paddingShards: 0,
    prefetchPaddingShards: 0,
  },
);
const concurrentPrefetch = concurrentSession.prefetchBounds({
  west: 35,
  south: 33,
  east: 35.0005,
  north: 33.0005,
});
const concurrentAddPoint = concurrentSession.addPoint(points[0]);
await Promise.resolve();
releaseConcurrentLoad();
await Promise.all([concurrentPrefetch, concurrentAddPoint]);
assert.deepEqual(
  concurrentLoadCalls,
  ["g700_660"],
  "concurrent prefetch and route clicks must share in-flight shard loads",
);

async function routeTraversalIds(network) {
  const manager = new RouteManager();
  await manager.load(geoJsonData, segmentsData, network);
  const snappedPoints = points.map((point) => manager.snapToNetwork(point));
  assert.ok(snappedPoints.every(Boolean));
  manager.recalculateRoute(snappedPoints);
  assert.equal(manager.getRouteInfo().failure, null);
  return manager
    .getBaseRouteDiagnostics()
    .traversals.map((traversal) => traversal.edgeId);
}

console.log("Base routing shard tests passed");
