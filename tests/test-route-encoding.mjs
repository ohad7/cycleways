import assert from "node:assert/strict";
import {
  COMPACT_ROUTE_VERSION,
  decodeRoute,
  decodeRoutePayload,
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

console.log("Route encoding tests passed");
