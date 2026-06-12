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

// Case 3: ratio guard. Click ~2.2 m from the road with the CW edge ~17.8 m
// away: inside the absolute margin, but ~8x farther than the road. A click
// this decisively close to the road should keep the road.
{
  const manager = new RouteManager();
  await manager.load(geoJsonData, segmentsData, buildNetwork({ cwLat: 33.00018 }));
  const snapped = manager.snapToNetwork({ lat: 33.00002, lng: 35.001 });
  assert.ok(snapped, "point should snap within threshold");
  assert.equal(
    snapped.baseEdgeId,
    "road",
    "a CW edge many times farther than the road should not win the snap",
  );
}

// Case 4: re-snap stability. A point exactly on the road (distance 0) must
// stay on the road even with a CW edge ~8 m away, so recalculations do not
// migrate previously snapped points onto the CW network.
{
  const manager = new RouteManager();
  await manager.load(geoJsonData, segmentsData, buildNetwork({ cwLat: 33.00007 }));
  const snapped = manager.snapToNetwork({ lat: 33.0, lng: 35.001 });
  assert.ok(snapped, "point should snap within threshold");
  assert.equal(
    snapped.baseEdgeId,
    "road",
    "a point sitting on the road should not migrate to a nearby CW edge",
  );
}

// Case 5: zoom-aware preference margin. Click ~3.3 m from the road with the
// CW edge ~10 m away: with no zoom info the CW edge wins (margin 20 m, ratio
// ok), but when the click carries metersPerPixel from a zoomed-in map the
// margin shrinks to pixel scale and the road wins.
{
  const manager = new RouteManager();
  await manager.load(geoJsonData, segmentsData, buildNetwork({ cwLat: 33.00012 }));
  const noZoom = manager.snapToNetwork({ lat: 33.00003, lng: 35.001 });
  assert.equal(
    noZoom?.baseEdgeId,
    "cw",
    "without zoom info the CW preference margin should still apply",
  );
  const zoomedIn = manager.snapToNetwork({
    lat: 33.00003,
    lng: 35.001,
    metersPerPixel: 0.3,
  });
  assert.equal(
    zoomedIn?.baseEdgeId,
    "road",
    "zoomed in, the CW margin shrinks and the closer road should win",
  );
}

// Case 6: zoom-aware snap threshold. A click ~40 m from the only edge snaps
// with the default 100 m threshold, but is rejected when the click carries a
// zoomed-in metersPerPixel (threshold becomes pixel-scaled).
{
  const manager = new RouteManager();
  await manager.load(geoJsonData, segmentsData, buildNetwork({ cwLat: 33.01 }));
  const noZoom = manager.snapToNetwork({ lat: 33.00036, lng: 35.001 });
  assert.equal(
    noZoom?.baseEdgeId,
    "road",
    "without zoom info the default 100 m threshold should snap the click",
  );
  const zoomedIn = manager.snapToNetwork({
    lat: 33.00036,
    lng: 35.001,
    metersPerPixel: 0.5,
  });
  assert.equal(
    zoomedIn,
    null,
    "zoomed in, a click ~40 m from the network should not snap",
  );
}

console.log("RouteManager CW snap preference tests passed");
