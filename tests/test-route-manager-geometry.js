const assert = require("node:assert/strict");
const fs = require("node:fs");
const RouteManager = require("../route-manager.js");
const { mockGeoJsonData, mockSegmentsData } = require("./test-route-manager.js");

function approxEqual(actual, expected, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

async function run() {
  const manager = new RouteManager();
  await manager.load(mockGeoJsonData, mockSegmentsData);

  manager.addPoint({ lat: 33.0, lng: 35.005 });
  let routeInfo = manager.getRouteInfo();
  assert.equal(routeInfo.segments.length, 0);
  assert.equal(routeInfo.orderedCoordinates.length, 0);

  manager.addPoint({ lat: 33.0, lng: 35.015 });
  routeInfo = manager.getRouteInfo();
  assert.deepEqual(routeInfo.segments, ["Test Segment 1"]);
  assert.ok(routeInfo.orderedCoordinates.length >= 2);
  approxEqual(routeInfo.orderedCoordinates[0].lng, 35.005);
  approxEqual(routeInfo.orderedCoordinates[0].lat, 33.0);
  approxEqual(
    routeInfo.orderedCoordinates[routeInfo.orderedCoordinates.length - 1].lng,
    35.015,
  );
  approxEqual(
    routeInfo.orderedCoordinates[routeInfo.orderedCoordinates.length - 1].lat,
    33.0,
  );
  assert.ok(
    routeInfo.distance < manager.segmentMetrics.get("Test Segment 1").distance,
    "same-segment route geometry should be clipped to the two waypoints",
  );

  manager.clearRoute();
  manager.addPoint({ lat: 33.0, lng: 35.005 });
  manager.addPoint({ lat: 33.0, lng: 35.035 });
  routeInfo = manager.getRouteInfo();
  assert.deepEqual(routeInfo.segments, ["Test Segment 1", "Test Segment 2"]);
  approxEqual(routeInfo.orderedCoordinates[0].lng, 35.005);
  approxEqual(
    routeInfo.orderedCoordinates[routeInfo.orderedCoordinates.length - 1].lng,
    35.035,
  );
  assert.ok(
    routeInfo.distance <
      manager.segmentMetrics.get("Test Segment 1").distance +
        manager.segmentMetrics.get("Test Segment 2").distance,
    "multi-segment route geometry should not include full first/last segments",
  );

  const realManager = new RouteManager();
  await realManager.load(
    JSON.parse(fs.readFileSync("./tests/bike_roads_test.geojson", "utf8")),
    JSON.parse(fs.readFileSync("./tests/segments-test.json", "utf8")),
  );

  realManager.addPoint({ lng: 35.579326, lat: 33.1108295 });
  realManager.addPoint({ lng: 35.58359183561644, lat: 33.128109082191784 });
  realManager.addPoint({ lng: 35.59128891304348, lat: 33.11013617391304 });
  routeInfo = realManager.getRouteInfo();
  assert.deepEqual(routeInfo.segments, [
    "כביש גישה אגמון החולה",
    "דרך המנפטה",
    "אגמון החולה מבואה",
  ]);
  for (let i = 0; i < routeInfo.orderedCoordinates.length - 1; i++) {
    assert.ok(
      realManager._getDistance(
        routeInfo.orderedCoordinates[i],
        routeInfo.orderedCoordinates[i + 1],
      ) <= 100,
      "valid waypoint backtracking route should not contain geometry gaps",
    );
  }

  const previousRouteInfo = realManager.getRouteInfo();
  const preview = realManager.previewRouteInfo([
    { lng: 35.579326, lat: 33.1108295 },
    { lng: 35.59128891304348, lat: 33.11013617391304 },
  ]);
  assert.ok(preview.orderedCoordinates.length >= 2);
  assert.deepEqual(
    realManager.getRouteInfo().segments,
    previousRouteInfo.segments,
    "previewRouteInfo should not mutate the current route",
  );

  console.log("RouteManager clipped geometry tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
