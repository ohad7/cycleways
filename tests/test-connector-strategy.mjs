import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { DEFAULT_CONNECTOR_STRATEGY } from "@cycleways/core/routing/connectorCostModel.js";

const require = createRequire(import.meta.url);
const RouteManager = require("../packages/core/route-manager.js");

const network = {
  schemaVersion: 2,
  nodes: [
    { id: "a", coord: [35.0, 33.0] },
    { id: "b", coord: [35.001, 33.001] },
    { id: "c", coord: [35.002, 33.0] },
  ],
  edges: [
    // Direct A->C: a cycleway (excluded by default), geometrically shortest.
    {
      id: "direct",
      from: "a",
      to: "c",
      distanceMeters: 186,
      coordinates: [[35.0, 33.0], [35.002, 33.0]],
      routeClass: "cycle",
      cwSegmentIds: [],
    },
    // Detour A->B->C over local_road.
    {
      id: "ab",
      from: "a",
      to: "b",
      distanceMeters: 150,
      coordinates: [[35.0, 33.0], [35.001, 33.001]],
      routeClass: "local_road",
      cwSegmentIds: [],
    },
    {
      id: "bc",
      from: "b",
      to: "c",
      distanceMeters: 150,
      coordinates: [[35.001, 33.001], [35.002, 33.0]],
      routeClass: "local_road",
      cwSegmentIds: [],
    },
  ],
};

const manager = new RouteManager();
await manager.load({ type: "FeatureCollection", features: [] }, {}, network);

const from = { lat: 33.0, lng: 35.00005 };
const to = { lat: 33.0, lng: 35.00195 };

// Default connector: cycle edge excluded → must route the local_road detour
// (via node b), so the path passes near b's latitude 33.001.
const base = manager.previewBaseRoute([from, to], { costProfile: "connector" });
assert.equal(base.failure, null, "default connector should find the detour");
const usesDetour = base.geometry.some((p) => Math.abs(p.lat - 33.001) < 1e-4);
assert.ok(usesDetour, "default connector should detour via the local_road node b");

// Softened strategy: allow cycle cheaply → take the direct hop (stays on lat 33.0).
const softened = {
  ...DEFAULT_CONNECTOR_STRATEGY,
  classMultipliers: { ...DEFAULT_CONNECTOR_STRATEGY.classMultipliers, cycle: 1 },
};
const soft = manager.previewBaseRoute([from, to], {
  costProfile: "connector",
  connectorStrategy: softened,
});
assert.equal(soft.failure, null, "softened connector should find the direct hop");
const usesDirect = soft.geometry.every((p) => Math.abs(p.lat - 33.0) < 1e-4);
assert.ok(usesDirect, "softened connector should take the direct cycle hop");

// Injecting a strategy must not mutate the manager afterwards: a subsequent
// default connector still detours.
const baseAgain = manager.previewBaseRoute([from, to], { costProfile: "connector" });
assert.ok(
  baseAgain.geometry.some((p) => Math.abs(p.lat - 33.001) < 1e-4),
  "strategy must not leak into later default runs",
);

const cwNetwork = {
  schemaVersion: 2,
  nodes: [
    { id: "a", coord: [35.0, 33.0] },
    { id: "b", coord: [35.001, 33.001] },
    { id: "c", coord: [35.002, 33.0] },
  ],
  edges: [
    {
      id: "cw-direct",
      from: "a",
      to: "c",
      distanceMeters: 186,
      coordinates: [[35.0, 33.0], [35.002, 33.0]],
      routeClass: "cycle",
      accessStatus: "restricted",
      cwSegmentIds: [10],
    },
    {
      id: "cw-detour-ab",
      from: "a",
      to: "b",
      distanceMeters: 150,
      coordinates: [[35.0, 33.0], [35.001, 33.001]],
      routeClass: "local_road",
      cwSegmentIds: [],
    },
    {
      id: "cw-detour-bc",
      from: "b",
      to: "c",
      distanceMeters: 150,
      coordinates: [[35.001, 33.001], [35.002, 33.0]],
      routeClass: "local_road",
      cwSegmentIds: [],
    },
  ],
};
const cwManager = new RouteManager();
await cwManager.load({ type: "FeatureCollection", features: [] }, {}, cwNetwork);
const cwDefault = cwManager.previewBaseRoute([from, to], { costProfile: "connector" });
assert.equal(cwDefault.failure, null, "default connector should route on CW-owned edges");
assert.ok(cwDefault.edgeIds.includes("cw-direct"), "CW-owned cycle edge is connector-eligible by default");
assert.ok(
  cwDefault.edgeCosts.some((entry) => entry.edgeId === "cw-direct" && entry.costMultiplier === 0.8),
  "CW-owned edge uses the cw_network multiplier",
);

const endpointNetwork = {
  schemaVersion: 2,
  nodes: [
    { id: "a", coord: [35.0, 33.0] },
    { id: "b", coord: [35.001, 33.0] },
    { id: "c", coord: [35.004, 33.0] },
  ],
  edges: [
    {
      id: "road-to-junction",
      from: "a",
      to: "b",
      distanceMeters: 111,
      coordinates: [[35.0, 33.0], [35.001, 33.0]],
      routeClass: "local_road",
      cwSegmentIds: [],
    },
    {
      id: "excluded-endpoint-cycle",
      from: "b",
      to: "c",
      distanceMeters: 333,
      coordinates: [[35.001, 33.0], [35.004, 33.0]],
      routeClass: "cycle",
      cwSegmentIds: [],
    },
  ],
};
const endpointManager = new RouteManager();
await endpointManager.load({ type: "FeatureCollection", features: [] }, {}, endpointNetwork);
const endpointOrigin = { lat: 33.0, lng: 35.0 };
const cycleMidpointTarget = { lat: 33.0, lng: 35.0025 };

const allowedOnlyEndpoint = endpointManager.previewBaseRoute(
  [endpointOrigin, cycleMidpointTarget],
  { costProfile: "connector", connectorStrategy: DEFAULT_CONNECTOR_STRATEGY },
);
assert.equal(
  allowedOnlyEndpoint.failure,
  "snap-failed",
  "allowed-only snapping rejects a target that only sits on an excluded cycle edge",
);

const snapAnyEndpoint = endpointManager.previewBaseRoute(
  [endpointOrigin, cycleMidpointTarget],
  {
    costProfile: "connector",
    connectorStrategy: { ...DEFAULT_CONNECTOR_STRATEGY, snap: "any" },
  },
);
assert.equal(snapAnyEndpoint.failure, null, "snap:any can reach an excluded endpoint edge");
assert.ok(
  snapAnyEndpoint.edgeIds.includes("excluded-endpoint-cycle"),
  "snap:any includes only the endpoint stub on the excluded cycle edge",
);
assert.ok(
  snapAnyEndpoint.edgeCosts.some((edge) => edge.connectorSnapAnyEndpoint === true),
  "snap:any endpoint stub is marked in cost diagnostics",
);

console.log("connector-strategy OK");
