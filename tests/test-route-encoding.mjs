import assert from "node:assert/strict";
import {
  BASE_ROUTE_VERSION,
  COMPACT_ROUTE_VERSION,
  decodeRoute,
  decodeRoutePayload,
  encodeBaseRoute,
  encodeCompactRoute,
  encodeHybridRoute,
  encodeHybridRouteV6,
  encodeRoute,
  HYBRID_ROUTE_VERSION,
  HYBRID_ROUTE_V6_VERSION,
  ROUTE_COORDINATE_PRECISION,
} from "@cycleways/core/utils/route-encoding.js";

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

const hybridRouteEncoded = encodeHybridRoute({
  graphVersion: "test-graph",
  points: [
    { lng: 35.6, lat: 33.1, edgeShareId: 120, edgeFraction: 0.25 },
    { lng: 35.65, lat: 33.15, edgeShareId: 122, edgeFraction: 0.5 },
    { lng: 35.7, lat: 33.2, edgeShareId: 125, edgeFraction: 0.75 },
  ],
  shards: ["g710_661", "g710_662"],
  spans: [
    { type: "cw", segmentId: 27, reversed: false },
    {
      type: "base",
      edgeShareIds: [122, 124, 125],
      directions: ["forward", "reverse", "forward"],
    },
  ],
});
const hybridRoutePayload = decodeRoutePayload(hybridRouteEncoded);
assert.equal(hybridRoutePayload.version, HYBRID_ROUTE_VERSION);
assert.equal(hybridRoutePayload.type, "hybrid_route_v5");
assert.deepEqual(hybridRoutePayload.segmentIds, [27]);
assert.deepEqual(hybridRoutePayload.spans, [
  { type: "cw", segmentId: 27, reversed: false, fromPoint: 0, toPoint: 1 },
  {
    type: "base",
    fromPoint: 1,
    toPoint: 2,
    edgeShareIds: [122, 124, 125],
    edges: [122, 124, 125],
    directions: ["forward", "reverse", "forward"],
  },
]);

const hybridRouteV6Encoded = encodeHybridRouteV6({
  graphVersion: "2026-05-26T16:43:18.801713Z",
  points: [
    { lng: 35.6, lat: 33.1, edgeShareId: 120, edgeFraction: 0.25 },
    { lng: 35.65, lat: 33.15, edgeShareId: 122, edgeFraction: 0.5 },
    { lng: 35.7, lat: 33.2, edgeShareId: 125, edgeFraction: 0.75 },
  ],
  shards: ["g710_661", "g710_662"],
  spans: [
    { type: "cw", segmentId: 27, reversed: false },
    {
      type: "cwChain",
      runs: [
        { segmentId: 12, reversed: false, startIndex: 3, edgeCount: 2 },
        { segmentId: 14, reversed: true, startIndex: 8, edgeCount: 1 },
      ],
    },
  ],
});
const hybridRouteV6Payload = decodeRoutePayload(hybridRouteV6Encoded);
assert.equal(hybridRouteV6Payload.version, HYBRID_ROUTE_V6_VERSION);
assert.equal(hybridRouteV6Payload.type, "hybrid_route_v6");
assert.equal(hybridRouteV6Payload.routePoints[0].lng, undefined);
assert.equal(hybridRouteV6Payload.routePoints[0].baseEdgeShareId, 120);
assert.ok(Math.abs(hybridRouteV6Payload.routePoints[1].baseEdgeFraction - 0.5) < 0.0001);
assert.deepEqual(hybridRouteV6Payload.segmentIds, [27, 12, 14]);
assert.deepEqual(hybridRouteV6Payload.spans, [
  { type: "cw", segmentId: 27, reversed: false, fromPoint: 0, toPoint: 1 },
  {
    type: "cwChain",
    fromPoint: 1,
    toPoint: 2,
    runs: [
      { segmentId: 12, reversed: false, startIndex: 3, edgeCount: 2 },
      { segmentId: 14, reversed: true, startIndex: 8, edgeCount: 1 },
    ],
  },
]);
assert.ok(
  hybridRouteV6Encoded.length < hybridRouteEncoded.length,
  `expected V6 (${hybridRouteV6Encoded.length}) to be shorter than V5 (${hybridRouteEncoded.length})`,
);

console.log("Route encoding tests passed");
