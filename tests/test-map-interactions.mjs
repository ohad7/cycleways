import assert from "node:assert/strict";
import {
  buildNetworkSegments,
  getClosestPointOnLineSegment,
  pixelDistance,
  createClickStamp,
  isDuplicateRouteClick,
} from "../src/map/mapInteractions.js";

// buildNetworkSegments keeps only named segments with >= 2 finite coords.
{
  const segs = buildNetworkSegments([
    { properties: { name: "A" }, geometry: { coordinates: [[0, 0], [1, 1]] } },
    { properties: { name: "B" }, geometry: { coordinates: [[0, 0]] } }, // too short
    { properties: {}, geometry: { coordinates: [[0, 0], [1, 1]] } }, // unnamed
  ]);
  assert.equal(segs.length, 1, "only the valid named multi-point segment survives");
  assert.equal(segs[0].segmentName, "A");
  assert.equal(segs[0].coordinates.length, 2);
}

// getClosestPointOnLineSegment projects onto, and clamps to, the segment.
{
  const mid = getClosestPointOnLineSegment({ lng: 0.5, lat: 1 }, { lng: 0, lat: 0 }, { lng: 1, lat: 0 });
  assert.equal(mid.lng, 0.5, "perpendicular foot lands at the midpoint x");
  assert.equal(mid.lat, 0, "perpendicular foot lands on the line");
  const before = getClosestPointOnLineSegment({ lng: -5, lat: 0 }, { lng: 0, lat: 0 }, { lng: 1, lat: 0 });
  assert.deepEqual(before, { lat: 0, lng: 0 }, "clamps to the start when param < 0");
  const after = getClosestPointOnLineSegment({ lng: 5, lat: 0 }, { lng: 0, lat: 0 }, { lng: 1, lat: 0 });
  assert.deepEqual(after, { lat: 0, lng: 1 }, "clamps to the end when param > 1");
}

// pixelDistance is Euclidean.
assert.equal(pixelDistance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);

// createClickStamp reads point + lngLat + a time; isDuplicateRouteClick
// treats near-identical, recent clicks as duplicates.
{
  const evt = { point: { x: 10, y: 20 }, lngLat: { lng: 1, lat: 2 } };
  const stamp = createClickStamp(evt, () => 1000);
  assert.equal(stamp.x, 10);
  assert.equal(stamp.lng, 1);
  assert.equal(stamp.time, 1000);
  // same coords, 50ms later -> duplicate
  assert.equal(isDuplicateRouteClick(stamp, evt, () => 1050), true);
  // same coords, 400ms later -> not a duplicate (stale)
  assert.equal(isDuplicateRouteClick(stamp, evt, () => 1400), false);
}

console.log("test-map-interactions OK");
