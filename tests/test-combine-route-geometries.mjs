import assert from "node:assert/strict";
import { combineRouteGeometries } from "../src/map/routeFitPadding.js";

// Flattens multiple geometries in order.
{
  const routes = [
    { geometry: [{ lng: 0, lat: 0 }, { lng: 1, lat: 1 }] },
    { geometry: [{ lng: 2, lat: 2 }, { lng: 3, lat: 3 }] },
  ];
  const combined = combineRouteGeometries(routes);
  assert.equal(combined.length, 4, "all points kept");
  assert.deepEqual(combined[0], { lng: 0, lat: 0 }, "order preserved (first)");
  assert.deepEqual(combined[3], { lng: 3, lat: 3 }, "order preserved (last)");
}

// Skips routes with fewer than 2 points or missing geometry.
{
  const routes = [
    { geometry: [{ lng: 0, lat: 0 }] },
    { geometry: null },
    { geometry: [{ lng: 5, lat: 5 }, { lng: 6, lat: 6 }] },
  ];
  const combined = combineRouteGeometries(routes);
  assert.equal(combined.length, 2, "only the valid route contributes");
  assert.deepEqual(combined[0], { lng: 5, lat: 5 });
}

// Empty / non-array input -> [].
assert.deepEqual(combineRouteGeometries([]), [], "empty input");
assert.deepEqual(combineRouteGeometries(null), [], "null input");

console.log("test-combine-route-geometries.mjs passed");
