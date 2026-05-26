import assert from "node:assert/strict";
import {
  BASE_ROUTE_VERSION,
  COMPACT_ROUTE_VERSION,
  decodeRoute,
  decodeRoutePayload,
  encodeBaseRoute,
  encodeCompactRoute,
  encodeRoute,
  ROUTE_COORDINATE_PRECISION,
} from "../utils/route-encoding.js";

const routePoints = [
  { lng: 35.6066554, lat: 33.1896874 },
  { lng: 35.617497, lat: 33.183536 },
  { lng: 35.626, lat: 33.194 },
];
const segmentIds = [65, 15, 2];

const encoded = encodeCompactRoute(routePoints, segmentIds);
const payload = decodeRoutePayload(encoded);

assert.equal(payload.version, COMPACT_ROUTE_VERSION);
assert.equal(payload.type, "compact_route");
assert.deepEqual(payload.segmentIds, segmentIds);
assert.equal(payload.routePoints.length, routePoints.length);

for (let i = 0; i < routePoints.length; i++) {
  assert.ok(
    Math.abs(payload.routePoints[i].lng - routePoints[i].lng) <=
      1 / ROUTE_COORDINATE_PRECISION,
  );
  assert.ok(
    Math.abs(payload.routePoints[i].lat - routePoints[i].lat) <=
      1 / ROUTE_COORDINATE_PRECISION,
  );
}

const decimalWaypointEncoding = routePoints
  .map((point) => `${point.lng.toFixed(6)},${point.lat.toFixed(6)}`)
  .join(";");
assert.ok(
  encoded.length < decimalWaypointEncoding.length,
  `expected compact route (${encoded.length}) to be shorter than decimal waypoints (${decimalWaypointEncoding.length})`,
);

const legacyEncoded = encodeRoute(segmentIds);
assert.deepEqual(decodeRoute(legacyEncoded), segmentIds);
assert.deepEqual(decodeRoutePayload(legacyEncoded), {
  version: 2,
  type: "legacy_segments",
  routePoints: [],
  segmentIds,
});

assert.equal(encodeCompactRoute([{ lng: 200, lat: 33 }], segmentIds), "");

const baseRouteEncoded = encodeBaseRoute({
  graphVersion: "test-graph",
  points: [
    { lng: 35.6, lat: 33.1, edgeShareId: 120, edgeFraction: 0.25 },
    { lng: 35.7, lat: 33.2, edgeShareId: 125, edgeFraction: 0.75 },
  ],
  shards: ["g710_661", "g710_662", { x: 711, y: 662 }],
  legs: [
    {
      fromPoint: 0,
      toPoint: 1,
      edgeShareIds: [120, 121, 125],
      directions: ["forward", "reverse", "forward"],
    },
  ],
});
const baseRoutePayload = decodeRoutePayload(baseRouteEncoded);
assert.equal(baseRoutePayload.version, BASE_ROUTE_VERSION);
assert.equal(baseRoutePayload.type, "base_route_v4");
assert.equal(baseRoutePayload.graphVersion, "test-graph");
assert.deepEqual(
  baseRoutePayload.shards,
  [
    { id: "g710_661", x: 710, y: 661 },
    { id: "g710_662", x: 710, y: 662 },
    { id: "g711_662", x: 711, y: 662 },
  ],
);
assert.deepEqual(baseRoutePayload.legs[0].edgeShareIds, [120, 121, 125]);
assert.deepEqual(baseRoutePayload.legs[0].directions, [
  "forward",
  "reverse",
  "forward",
]);
assert.ok(Math.abs(baseRoutePayload.routePoints[0].baseEdgeFraction - 0.25) < 0.0001);

console.log("Route encoding tests passed");
