import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const RouteManager = require("../route-manager.js");

function assertNear(actual, expected, tolerance = 0.1) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

const geoJsonData = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { id: 10, name: "CW preferred" },
      geometry: {
        type: "LineString",
        coordinates: [
          [35, 33],
          [35.001, 33],
        ],
      },
    },
  ],
};
const segmentsData = {
  "CW preferred": {
    id: 10,
    status: "active",
  },
};

const baseRoutingNetwork = {
  schemaVersion: 1,
  nodes: [
    { id: "a", coord: [35, 33] },
    { id: "b", coord: [35.001, 33] },
    { id: "c", coord: [35.002, 33] },
    { id: "d", coord: [35.001, 33.0005] },
  ],
  edges: [
    {
      id: "cw",
      from: "a",
      to: "b",
      distanceMeters: 93,
      coordinates: [
        [35, 33],
        [35.001, 33],
      ],
      routeClass: "path_track",
      cwSegmentIds: [10],
    },
    {
      id: "connector",
      from: "b",
      to: "c",
      distanceMeters: 93,
      coordinates: [
        [35.001, 33],
        [35.002, 33],
      ],
      routeClass: "local_road",
      cwSegmentIds: [],
    },
    {
      id: "road-detour-a",
      from: "a",
      to: "d",
      distanceMeters: 56,
      coordinates: [
        [35, 33],
        [35.001, 33.0005],
      ],
      routeClass: "road",
      cwSegmentIds: [],
    },
    {
      id: "road-detour-b",
      from: "d",
      to: "b",
      distanceMeters: 56,
      coordinates: [
        [35.001, 33.0005],
        [35.001, 33],
      ],
      routeClass: "road",
      cwSegmentIds: [],
    },
  ],
};

const manager = new RouteManager();
await manager.load(geoJsonData, segmentsData, baseRoutingNetwork);

const incrementalManager = new RouteManager();
await incrementalManager.load(geoJsonData, segmentsData);
assert.deepEqual(
  incrementalManager.mergeBaseRoutingNetwork({
    schemaVersion: baseRoutingNetwork.schemaVersion,
    nodes: baseRoutingNetwork.nodes.slice(0, 2),
    edges: baseRoutingNetwork.edges.slice(0, 1),
  }),
  { nodes: 2, edges: 1 },
);
assert.deepEqual(
  incrementalManager.mergeBaseRoutingNetwork({
    schemaVersion: baseRoutingNetwork.schemaVersion,
    nodes: baseRoutingNetwork.nodes.slice(0, 3),
    edges: baseRoutingNetwork.edges.slice(0, 2),
  }),
  { nodes: 1, edges: 1 },
);
incrementalManager.recalculateRoute([
  { lat: 33.00001, lng: 35.00001 },
  { lat: 33.00001, lng: 35.00199 },
]);
assert.equal(incrementalManager.getRouteInfo().failure, null);
assert.deepEqual(incrementalManager.getRouteInfo().segments, ["CW preferred"]);
assert.deepEqual(
  incrementalManager
    .getBaseRouteDiagnostics()
    .traversals.map((traversal) => traversal.edgeId),
  ["cw", "connector"],
);

const farPoint = manager.snapToNetwork({ lat: 34, lng: 36 });
assert.equal(farPoint, null, "far clicks must stay off the hidden base graph");

const startSnap = manager.snapToNetwork({ lat: 33.00001, lng: 35.00025 });
const sameEdgeEndSnap = manager.snapToNetwork({
  lat: 33.00001,
  lng: 35.00075,
});
assert.equal(startSnap.baseEdgeId, "cw");
assert.equal(sameEdgeEndSnap.baseEdgeId, "cw");
manager.recalculateRoute([startSnap, sameEdgeEndSnap]);
let routeInfo = manager.getRouteInfo();
assert.equal(routeInfo.segments[0], "CW preferred");
assert.ok(routeInfo.distance > 40 && routeInfo.distance < 60);
assert.ok(routeInfo.orderedCoordinates.length >= 2);
assert.ok(routeInfo.orderedCoordinates[0].lng > 35);
assert.ok(routeInfo.orderedCoordinates.at(-1).lng < 35.001);

const elevatedClipManager = new RouteManager();
await elevatedClipManager.load(geoJsonData, segmentsData, {
  schemaVersion: 2,
  nodes: [
    { id: "clip-start", coord: [35, 33] },
    { id: "clip-end", coord: [35.001, 33] },
  ],
  edges: [
    {
      id: "elevated-cw",
      from: "clip-start",
      to: "clip-end",
      distanceMeters: 93,
      coordinates: [[35, 33], [35.001, 33]],
      routeClass: "path_track",
      cwSegmentIds: [10],
      elevation: { fromMeters: 100, toMeters: 120, netMeters: 20 },
    },
  ],
});
elevatedClipManager.recalculateRoute([
  { lat: 33, lng: 35.00025 },
  { lat: 33, lng: 35.00075 },
]);
routeInfo = elevatedClipManager.getRouteInfo();
assertNear(routeInfo.orderedCoordinates[0].elevation, 105);
assertNear(routeInfo.orderedCoordinates.at(-1).elevation, 115);
elevatedClipManager.recalculateRoute([
  { lat: 33, lng: 35.00075 },
  { lat: 33, lng: 35.00025 },
]);
routeInfo = elevatedClipManager.getRouteInfo();
assertNear(routeInfo.orderedCoordinates[0].elevation, 115);
assertNear(routeInfo.orderedCoordinates.at(-1).elevation, 105);

manager.recalculateRoute([
  { lat: 33, lng: 35.00001 },
  { lat: 33, lng: 35.00199 },
]);
routeInfo = manager.getRouteInfo();
assert.equal(routeInfo.failure, null);
assert.ok(routeInfo.cyclewaysDistance > 80);
assert.ok(routeInfo.nonCyclewaysDistance > 80);
assert.deepEqual(routeInfo.segments, ["CW preferred"]);
assert.equal(
  routeInfo.traversals?.length,
  undefined,
  "public route info should keep internal traversal objects private",
);

const preview = manager.previewRouteInfo([
  { lat: 33, lng: 35.00001 },
  { lat: 33, lng: 35.00199 },
]);
assert.deepEqual(preview.segments, ["CW preferred"]);
assert.ok(preview.orderedCoordinates.length >= 3);

const climbAwareManager = new RouteManager();
await climbAwareManager.load(geoJsonData, segmentsData, {
  schemaVersion: 2,
  nodes: [
    { id: "start", coord: [35, 33] },
    { id: "end", coord: [35.001, 33] },
    { id: "flat", coord: [35.0005, 33.00045] },
  ],
  edges: [
    {
      id: "short-climb",
      from: "start",
      to: "end",
      distanceMeters: 93,
      coordinates: [[35, 33], [35.001, 33]],
      routeClass: "path_track",
      cwSegmentIds: [],
      elevation: { fromMeters: 100, toMeters: 120, netMeters: 20 },
    },
    {
      id: "flat-detour-a",
      from: "start",
      to: "flat",
      distanceMeters: 70,
      coordinates: [[35, 33], [35.0005, 33.00045]],
      routeClass: "path_track",
      cwSegmentIds: [],
      elevation: { fromMeters: 100, toMeters: 101, netMeters: 1 },
    },
    {
      id: "flat-detour-b",
      from: "flat",
      to: "end",
      distanceMeters: 70,
      coordinates: [[35.0005, 33.00045], [35.001, 33]],
      routeClass: "path_track",
      cwSegmentIds: [],
      elevation: { fromMeters: 101, toMeters: 100, netMeters: -1 },
    },
  ],
});
climbAwareManager.recalculateRoute([
  { lat: 33.00001, lng: 35.00001 },
  { lat: 33.00001, lng: 35.00099 },
]);
routeInfo = climbAwareManager.getRouteInfo();
assert.ok(routeInfo.distance > 120, "uphill cost should allow a flatter detour");
assert.ok(
  routeInfo.orderedCoordinates.some((coord) => coord.lat > 33.0004),
  "the chosen route should traverse the flat detour node",
);
assert.ok(
  routeInfo.orderedCoordinates.every((coord) =>
    Number.isFinite(coord.elevation),
  ),
  "elevated base routes should carry elevation on visible route geometry",
);
assert.ok(routeInfo.elevationGain > 0.9 && routeInfo.elevationGain < 1);
assert.ok(routeInfo.elevationLoss > 0.9 && routeInfo.elevationLoss < 1);
assert.equal(routeInfo.elevationGain, routeInfo.uphillMeters);
assert.equal(routeInfo.elevationLoss, routeInfo.downhillMeters);
assert.equal(routeInfo.uphillCost, routeInfo.uphillMeters * 8);
assert.equal(routeInfo.uphillCostMetersPerMeter, 8);

const climbDiagnostics = climbAwareManager.getBaseRouteDiagnostics();
assert.deepEqual(
  climbDiagnostics.traversals.map((traversal) => traversal.edgeId),
  ["flat-detour-a", "flat-detour-b"],
);
assert.equal(climbDiagnostics.distanceCost, routeInfo.distanceCost);
assert.equal(climbDiagnostics.uphillCost, routeInfo.uphillCost);
assert.equal(
  climbDiagnostics.traversals[0].uphillCost,
  climbDiagnostics.traversals[0].uphillMeters * 8,
);
assert.equal(climbDiagnostics.traversals[1].uphillCost, 0);
assert.ok(climbDiagnostics.traversals[1].downhillMeters > 0.9);

console.log("Base routing network tests passed");
