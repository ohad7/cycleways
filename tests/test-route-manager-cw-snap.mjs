// Verifies the CW-edge snap preference in _snapToBaseRoutingNetwork: a route
// point near both a road and a parallel CycleWays edge should prefer the CW edge
// when it is within the preference margin, but fall back to the closest edge
// when the CW edge is clearly farther. See plans/cw-edge-snap-preference/.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const RouteManager = require("../packages/core/route-manager.js");

const segmentsData = { "CW Path": { id: 10, status: "active" } };
const geoJsonData = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { id: 10, name: "CW Path" },
      geometry: {
        type: "LineString",
        coordinates: [
          [35, 33.00005],
          [35.002, 33.00005],
        ],
      },
    },
  ],
};

// Two near-parallel horizontal edges:
//   road  at lat 33.00000  (cwSegmentIds: [])
//   CW    at lat 33.00005  (~5.5 m north, cwSegmentIds: [10])
// A click just north of the road is geometrically closer to the road, but the
// CW edge is well within the 20 m preference margin.
function buildNetwork({ cwLat }) {
  return {
    schemaVersion: 1,
    nodes: [
      { id: "road-a", coord: [35, 33.0] },
      { id: "road-b", coord: [35.002, 33.0] },
      { id: "cw-a", coord: [35, cwLat] },
      { id: "cw-b", coord: [35.002, cwLat] },
    ],
    edges: [
      {
        id: "road",
        shareId: 1,
        from: "road-a",
        to: "road-b",
        distanceMeters: 186,
        coordinates: [
          [35, 33.0],
          [35.002, 33.0],
        ],
        routeClass: "road",
        cwSegmentIds: [],
      },
      {
        id: "cw",
        shareId: 2,
        from: "cw-a",
        to: "cw-b",
        distanceMeters: 186,
        coordinates: [
          [35, cwLat],
          [35.002, cwLat],
        ],
        routeClass: "path_track",
        cwSegmentIds: [10],
      },
    ],
  };
}

// Case 1: CW edge ~5.5 m away, road ~1.1 m away -> within margin -> prefer CW.
{
  const manager = new RouteManager();
  await manager.load(geoJsonData, segmentsData, buildNetwork({ cwLat: 33.00005 }));
  const snapped = manager.snapToNetwork({ lat: 33.00001, lng: 35.001 });
  assert.ok(snapped, "point should snap within threshold");
  assert.equal(
    snapped.baseEdgeId,
    "cw",
    "a nearby CW edge within the margin should win over the closer road",
  );
}

// Case 2: CW edge ~44 m away, road ~2.2 m away -> beyond margin -> keep road.
{
  const manager = new RouteManager();
  await manager.load(geoJsonData, segmentsData, buildNetwork({ cwLat: 33.0004 }));
  const snapped = manager.snapToNetwork({ lat: 33.00002, lng: 35.001 });
  assert.ok(snapped, "point should snap within threshold");
  assert.equal(
    snapped.baseEdgeId,
    "road",
    "a distant CW edge beyond the margin should not override the closest road",
  );
}

console.log("RouteManager CW snap preference tests passed");
