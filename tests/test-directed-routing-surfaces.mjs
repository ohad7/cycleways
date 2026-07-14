import assert from "node:assert/strict";
import RouteManager from "../packages/core/route-manager.js";
import { createShardedRouteSession } from "../packages/core/src/routing/shardedRouteSession.js";

const policy = {
  policyId: "il-bicycle-v1",
  policyDigest: "directed-routing-surface-fixture",
  strictTraversalPolicy: true,
};

function traversal(forward = "allowed", reverse = "allowed") {
  return {
    policyId: policy.policyId,
    policyDigest: policy.policyDigest,
    forward,
    reverse,
    forwardReason: "fixture",
    reverseReason: "fixture",
  };
}

const nodes = [
  { id: "west", coord: [35, 33] },
  { id: "east", coord: [35.002, 33] },
  { id: "north-east", coord: [35.002, 33.001] },
  { id: "north-west", coord: [35, 33.001] },
];
const edges = [
  {
    id: "direct-one-way",
    shareId: 1,
    from: "west",
    to: "east",
    distanceMeters: 186,
    coordinates: [[35, 33], [35.002, 33]],
    source: "osm",
    routeClass: "road",
    cwSegmentIds: [],
    bicycleTraversal: traversal("allowed", "prohibited"),
  },
  {
    id: "detour-east",
    shareId: 2,
    from: "east",
    to: "north-east",
    distanceMeters: 111,
    coordinates: [[35.002, 33], [35.002, 33.001]],
    source: "osm",
    routeClass: "road",
    cwSegmentIds: [],
    bicycleTraversal: traversal(),
  },
  {
    id: "detour-north",
    shareId: 3,
    from: "north-east",
    to: "north-west",
    distanceMeters: 186,
    coordinates: [[35.002, 33.001], [35, 33.001]],
    source: "osm",
    routeClass: "road",
    cwSegmentIds: [],
    bicycleTraversal: traversal(),
  },
  {
    id: "detour-west",
    shareId: 4,
    from: "north-west",
    to: "west",
    distanceMeters: 111,
    coordinates: [[35, 33.001], [35, 33]],
    source: "osm",
    routeClass: "road",
    cwSegmentIds: [],
    bicycleTraversal: traversal(),
  },
];
const network = {
  schemaVersion: 3,
  graphVersion: "directed-routing-surface-fixture",
  routingContract: policy,
  nodes,
  edges,
};
const east = { lat: 33, lng: 35.002 };
const west = { lat: 33, lng: 35 };

function assertUsesPermittedDetour(preview, surface) {
  assert.equal(preview.failure, null, `${surface} should find a permitted route`);
  assert.deepEqual(
    preview.edgeIds,
    ["detour-east", "detour-north", "detour-west"],
    `${surface} must not reverse the direct one-way edge`,
  );
}

const manager = new RouteManager();
await manager.load({ type: "FeatureCollection", features: [] }, {}, network);
assertUsesPermittedDetour(manager.previewBaseRoute([east, west]), "ordinary off-CW routing");
assertUsesPermittedDetour(
  manager.previewBaseRoute([east, west], { costProfile: "connector" }),
  "connector routing",
);

const manifest = {
  schemaVersion: 2,
  graphVersion: network.graphVersion,
  routingContract: policy,
  scheme: { shardSizeDegrees: 0.01 },
  shards: [{ id: "fixture", bounds: [34.99, 32.99, 35.01, 33.01] }],
};
const session = await createShardedRouteSession(
  RouteManager,
  { type: "FeatureCollection", features: [] },
  {},
  manifest,
  async () => ({
    id: "fixture",
    sourceRoutingSchemaVersion: 3,
    nodes,
    edges,
  }),
  { paddingShards: 0 },
);
assertUsesPermittedDetour(
  await session.computeConnector(east, west),
  "approach/rejoin connector session",
);

console.log("directed routing surfaces ok");
