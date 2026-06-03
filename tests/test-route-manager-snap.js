const assert = require("node:assert/strict");
const RouteManager = require("../packages/core/route-manager.js");
const { mockGeoJsonData, mockSegmentsData } = require("./test-route-manager.js");

async function run() {
  const manager = new RouteManager();
  await manager.load(mockGeoJsonData, mockSegmentsData);

  const nearPoint = { lat: 33.0, lng: 35.005 };
  const snapped = manager.snapToNetwork(nearPoint);
  assert.ok(snapped, "near point should snap to the network");
  assert.equal(snapped.segmentName, "Test Segment 1");

  const farPoint = { lat: 33.01, lng: 35.005 };
  assert.equal(
    manager.snapToNetwork(farPoint),
    null,
    "far point should not snap within the default threshold",
  );

  manager.addPoint(nearPoint);
  manager.addPoint(farPoint);
  assert.equal(
    manager.getRouteInfo().points.length,
    1,
    "far point should not be added to the route",
  );

  manager.recalculateRoute([nearPoint, farPoint]);
  assert.equal(
    manager.getRouteInfo().points.length,
    2,
    "recalculation should preserve unsnappable edit points",
  );
  assert.equal(
    manager.getRouteInfo().points[1].unsnapped,
    true,
    "unsnappable edit points should be marked",
  );

  console.log("RouteManager snap threshold tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
