import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createShardedRouteSession } from "@cycleways/core/routing/shardedRouteSession.js";

const require = createRequire(import.meta.url);
const RouteManager = require("../packages/core/route-manager.js");

const nodes = [
  { id: "west", coord: [35, 33] },
  { id: "border", coord: [35.001, 33] },
  { id: "east", coord: [35.002, 33] },
];
const westEdge = {
  id: "west-edge",
  from: "west",
  to: "border",
  distanceMeters: 93,
  coordinates: [[35, 33], [35.001, 33]],
  routeClass: "local_road",
  cwSegmentIds: [],
};
const eastEdge = {
  id: "east-edge",
  from: "border",
  to: "east",
  distanceMeters: 93,
  coordinates: [[35.001, 33], [35.002, 33]],
  routeClass: "local_road",
  cwSegmentIds: [],
};
const manifest = {
  scheme: { shardSizeDegrees: 0.001 },
  shards: [
    { id: "west", bounds: [35, 33, 35.001, 33.001] },
    { id: "east", bounds: [35.001, 33, 35.002, 33.001] },
  ],
};
const shards = {
  west: { id: "west", nodes: nodes.slice(0, 2), edges: [westEdge] },
  east: { id: "east", nodes: nodes.slice(1), edges: [eastEdge] },
};

const session = await createShardedRouteSession(
  RouteManager,
  { type: "FeatureCollection", features: [] },
  {},
  manifest,
  async (entry) => shards[entry.id],
  { paddingShards: 0 },
);
await session.restorePoints([
  { lat: 33.00001, lng: 35.0001 },
  { lat: 33.00001, lng: 35.0009 },
]);
assert.deepEqual(session.diagnostics().loadedShards, ["west"]);
const before = structuredClone(session.manager.getRouteInfo());
const connector = await session.computeConnector(
  { lat: 33.00001, lng: 35.0009 },
  { lat: 33.00001, lng: 35.0019 },
);
assert.equal(connector.failure, null);
assert.ok(connector.geometry.length >= 2);
assert.deepEqual(session.diagnostics().loadedShards, ["east", "west"]);
assert.deepEqual(
  session.manager.getRouteInfo(),
  before,
  "loading connector coverage preserves active planner route",
);

const offGrid = await session.computeConnector(
  { lat: 34, lng: 36 },
  { lat: 34.001, lng: 36.001 },
);
assert.ok(offGrid.failure);
assert.deepEqual(session.manager.getRouteInfo(), before);

const junctions = await session.junctionsNearRoute([
  { lat: 33.00001, lng: 35.0001 },
  { lat: 33.00001, lng: 35.0019 },
]);
assert.ok(Array.isArray(junctions), "complete coverage produces junction data");
assert.equal(junctions.length, 0, "fixture has no degree-3 junction");

const partialCoverageSession = await createShardedRouteSession(
  RouteManager,
  { type: "FeatureCollection", features: [] },
  {},
  manifest,
  async (entry) => {
    if (entry.id === "west") return shards.west;
    throw new Error("simulated shard failure");
  },
  { paddingShards: 0 },
);
await partialCoverageSession.restorePoints([
  { lat: 33.00001, lng: 35.0001 },
  { lat: 33.00001, lng: 35.0009 },
]);
assert.ok(
  partialCoverageSession.indexedNetwork(),
  "precondition: a partial network is already indexed",
);
assert.equal(
  await partialCoverageSession.junctionsNearRoute([
    { lat: 33.00001, lng: 35.0001 },
    { lat: 33.00001, lng: 35.0019 },
  ]),
  null,
  "failed coverage returns null rather than partial junction data",
);

console.log("test-compute-connector OK");
