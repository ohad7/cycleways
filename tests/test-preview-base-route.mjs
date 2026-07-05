import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const RouteManager = require("../packages/core/route-manager.js");

const network = {
  schemaVersion: 2,
  nodes: [
    { id: "a", coord: [35, 33] },
    { id: "b", coord: [35.001, 33] },
    { id: "c", coord: [35.002, 33] },
  ],
  edges: [
    {
      id: "west",
      from: "a",
      to: "b",
      distanceMeters: 93,
      coordinates: [[35, 33], [35.001, 33]],
      routeClass: "local_road",
      cwSegmentIds: [],
    },
    {
      id: "east",
      from: "b",
      to: "c",
      distanceMeters: 93,
      coordinates: [[35.001, 33], [35.002, 33]],
      routeClass: "local_road",
      cwSegmentIds: [],
    },
  ],
};

const manager = new RouteManager();
await manager.load({ type: "FeatureCollection", features: [] }, {}, network);
manager.recalculateRoute([
  { lat: 33, lng: 35.0001 },
  { lat: 33, lng: 35.0009 },
]);
const before = structuredClone(manager.getRouteInfo());
const preview = manager.previewBaseRoute([
  { lat: 33.00001, lng: 35.0002 },
  { lat: 33.00001, lng: 35.0018 },
]);
assert.equal(preview.failure, null);
assert.ok(preview.geometry.length >= 3);
assert.ok(preview.distanceMeters > 100);
assert.equal(preview.snappedEndpoints.length, 2);
assert.deepEqual(manager.getRouteInfo(), before, "preview does not mutate active route");

const offGraph = manager.previewBaseRoute([
  { lat: 34, lng: 36 },
  { lat: 34.001, lng: 36.001 },
]);
assert.ok(offGraph.failure);

// Connector cost profile must actually change the chosen route. Build a diamond
// where a->c can go via a short path_track (cheap for cycling) OR a slightly
// longer two-hop road detour through d (cheap for the connector profile). The
// endpoints snap onto dead-end stubs at a and c, forcing the graph search to
// pick between the two interior routes.
const prefNetwork = {
  schemaVersion: 2,
  nodes: [
    { id: "w", coord: [34.998, 33] },
    { id: "a", coord: [35.0, 33] },
    { id: "c", coord: [35.002, 33] },
    { id: "e", coord: [35.004, 33] },
    { id: "d", coord: [35.001, 33.0007] },
  ],
  edges: [
    { id: "stub_w", from: "w", to: "a", distanceMeters: 186,
      coordinates: [[34.998, 33], [35.0, 33]], routeClass: "road", cwSegmentIds: [] },
    { id: "path_direct", from: "a", to: "c", distanceMeters: 186,
      coordinates: [[35.0, 33], [35.002, 33]], routeClass: "path_track", cwSegmentIds: [] },
    { id: "road_ad", from: "a", to: "d", distanceMeters: 121,
      coordinates: [[35.0, 33], [35.001, 33.0007]], routeClass: "road", cwSegmentIds: [] },
    { id: "road_dc", from: "d", to: "c", distanceMeters: 121,
      coordinates: [[35.001, 33.0007], [35.002, 33]], routeClass: "road", cwSegmentIds: [] },
    { id: "stub_e", from: "c", to: "e", distanceMeters: 186,
      coordinates: [[35.002, 33], [35.004, 33]], routeClass: "road", cwSegmentIds: [] },
  ],
};
const prefManager = new RouteManager();
await prefManager.load({ type: "FeatureCollection", features: [] }, {}, prefNetwork);

const from = { lat: 33, lng: 34.999 };
const to = { lat: 33, lng: 35.003 };
const maxLat = (geometry) => Math.max(...geometry.map((p) => p.lat));

const defaultRoute = prefManager.previewBaseRoute([from, to]);
assert.equal(defaultRoute.failure, null);
// Default (cycling) profile prefers the straight path_track; it never bows north
// through d (lat 33.0007).
assert.ok(maxLat(defaultRoute.geometry) < 33.0003, "default route stays on the direct path");

const connectorRoute = prefManager.previewBaseRoute([from, to], { costProfile: "connector" });
assert.equal(connectorRoute.failure, null);
// Connector profile prefers the road detour through d, so the geometry passes
// near lat 33.0007.
assert.ok(maxLat(connectorRoute.geometry) > 33.0005, "connector route takes the road detour");
assert.equal(prefManager._connectorCostProfile, false); // transient flag cleared

// Connector routes must not use private/restricted roads, even when they are
// shorter than a public detour.
const accessNetwork = {
  schemaVersion: 2,
  nodes: [
    { id: "a", coord: [35.0, 33] },
    { id: "b", coord: [35.001, 33] },
    { id: "c", coord: [35.002, 33] },
    { id: "d", coord: [35.001, 33.0007] },
  ],
  edges: [
    { id: "restricted_ab", from: "a", to: "b", distanceMeters: 93,
      coordinates: [[35.0, 33], [35.001, 33]], routeClass: "road", accessStatus: "restricted", cwSegmentIds: [] },
    { id: "restricted_bc", from: "b", to: "c", distanceMeters: 93,
      coordinates: [[35.001, 33], [35.002, 33]], routeClass: "road", accessStatus: "restricted", cwSegmentIds: [] },
    { id: "public_ad", from: "a", to: "d", distanceMeters: 121,
      coordinates: [[35.0, 33], [35.001, 33.0007]], routeClass: "road", accessStatus: "unspecified", cwSegmentIds: [] },
    { id: "public_dc", from: "d", to: "c", distanceMeters: 121,
      coordinates: [[35.001, 33.0007], [35.002, 33]], routeClass: "road", accessStatus: "unspecified", cwSegmentIds: [] },
  ],
};
const accessManager = new RouteManager();
await accessManager.load({ type: "FeatureCollection", features: [] }, {}, accessNetwork);
const accessConnectorRoute = accessManager.previewBaseRoute(
  [{ lat: 33, lng: 35.0001 }, { lat: 33, lng: 35.0019 }],
  { costProfile: "connector" },
);
assert.equal(accessConnectorRoute.failure, null);
assert.ok(
  maxLat(accessConnectorRoute.geometry) > 33.0005,
  "connector route avoids restricted road and takes the public detour",
);

// A connector with only non-car-road edges should fail instead of showing an
// unsafe blue suggestion.
const pathOnlyManager = new RouteManager();
await pathOnlyManager.load(
  { type: "FeatureCollection", features: [] },
  {},
  {
    schemaVersion: 2,
    nodes: [
      { id: "a", coord: [35.0, 33] },
      { id: "b", coord: [35.001, 33] },
    ],
    edges: [
      { id: "path", from: "a", to: "b", distanceMeters: 93,
        coordinates: [[35.0, 33], [35.001, 33]], routeClass: "path_track", accessStatus: "unspecified", cwSegmentIds: [] },
    ],
  },
);
const pathDefaultRoute = pathOnlyManager.previewBaseRoute([
  { lat: 33, lng: 35.0001 },
  { lat: 33, lng: 35.0009 },
]);
assert.equal(pathDefaultRoute.failure, null);
const pathConnectorRoute = pathOnlyManager.previewBaseRoute(
  [{ lat: 33, lng: 35.0001 }, { lat: 33, lng: 35.0009 }],
  { costProfile: "connector" },
);
assert.ok(pathConnectorRoute.failure, "connector route rejects non-road-only graph");

console.log("test-preview-base-route OK");
