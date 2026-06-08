import assert from "node:assert/strict";
import { routeSliceForRange } from "../src/components/frontPanel/routeSlice.js";

// Generic points + parallel cumulative-meters array (format-agnostic).
const pts = [
  { lat: 33, lng: 35.0 },
  { lat: 33, lng: 35.1 },
  { lat: 33, lng: 35.2 },
  { lat: 33, lng: 35.3 },
];
const cumMeters = [0, 1000, 2000, 3000];

// Range entirely inside → boundary points included.
const slice = routeSliceForRange(pts, cumMeters, 500, 2500);
assert.equal(slice.length, 2);
assert.deepEqual(slice[0], pts[1]); // first point at/after 500m is index 1 (1000m)
assert.deepEqual(slice[1], pts[2]); // last point at/before 2500m is index 2 (2000m)

// Invalid / empty range → empty slice.
assert.deepEqual(routeSliceForRange(pts, cumMeters, 2000, 1000), []);
assert.deepEqual(routeSliceForRange([], [], 0, 1000), []);

console.log("route-slice ok");
