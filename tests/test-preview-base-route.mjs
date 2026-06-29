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

// Task 1: connector cost profile — minimum gate (fixture has only local_road edges,
// no parallel road/path_track pair to assert preference ordering).
const conn = manager.previewBaseRoute(
  [{ lat: 33.00001, lng: 35.0002 }, { lat: 33.00001, lng: 35.0018 }],
  { costProfile: "connector" },
);
assert.equal(conn.failure, null);
assert.ok(conn.geometry.length >= 2);
assert.equal(manager._connectorCostProfile, false); // transient flag cleared

console.log("test-preview-base-route OK");
