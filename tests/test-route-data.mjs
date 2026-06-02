import assert from "node:assert/strict";
import {
  distanceToRouteGeometry,
  getDataPointLocation,
  isDataPointOnRoute,
  projectPointToRouteGeometry,
  ROUTE_DATA_POINT_TRIGGER_DISTANCE_METERS,
} from "@cycleways/core/utils/route-data.js";
import { getActiveRouteDataPoints } from "@cycleways/core/routing/routeActions.js";

const routeCoordinates = [
  { lat: 33, lng: 35 },
  { lat: 33, lng: 35.01 },
];

const onRouteDataPoint = {
  type: "gate",
  information: "Gate on route",
  location: [33, 35.005],
};

const farDataPoint = {
  type: "mud",
  information: "Mud away from route",
  location: [33.01, 35.005],
};

assert.deepEqual(getDataPointLocation(onRouteDataPoint), {
  lat: 33,
  lng: 35.005,
});
assert.equal(getDataPointLocation({ location: ["bad", 35] }), null);
assert.ok(
  distanceToRouteGeometry(
    getDataPointLocation(onRouteDataPoint),
    routeCoordinates,
  ) < 1,
);
assert.ok(
  distanceToRouteGeometry(getDataPointLocation(farDataPoint), routeCoordinates) >
    ROUTE_DATA_POINT_TRIGGER_DISTANCE_METERS,
);
assert.equal(isDataPointOnRoute(onRouteDataPoint, routeCoordinates), true);
assert.equal(isDataPointOnRoute(farDataPoint, routeCoordinates), false);
assert.equal(
  isDataPointOnRoute({ type: "warning", information: "Segment-wide warning" }, []),
  true,
);

// --- projectPointToRouteGeometry route-progress enrichment ---

// A straight west-to-east route at constant latitude, four points / three segments.
const progressRoute = [
  { lat: 33, lng: 35.0 },
  { lat: 33, lng: 35.01 },
  { lat: 33, lng: 35.02 },
  { lat: 33, lng: 35.03 },
];

// Degenerate geometries.
assert.equal(projectPointToRouteGeometry({ lat: 33, lng: 35 }, []), null);
const singlePoint = projectPointToRouteGeometry(
  { lat: 33, lng: 35.005 },
  [{ lat: 33, lng: 35 }],
);
assert.equal(singlePoint.routeProgressMeters, 0);
assert.equal(singlePoint.routeFraction, 0);
assert.ok(singlePoint.routeDistanceMeters > 0);

// Marker near the route start.
const nearStart = projectPointToRouteGeometry({ lat: 33, lng: 35.001 }, progressRoute);
assert.ok(nearStart.routeDistanceMeters < 1, "start marker sits on the route");
assert.ok(nearStart.routeFraction < 0.1, "start marker fraction is near 0");

// Marker near the route middle.
const nearMiddle = projectPointToRouteGeometry({ lat: 33, lng: 35.015 }, progressRoute);
assert.ok(nearMiddle.routeFraction > 0.4 && nearMiddle.routeFraction < 0.6);

// Marker near the route end.
const nearEnd = projectPointToRouteGeometry({ lat: 33, lng: 35.029 }, progressRoute);
assert.ok(nearEnd.routeFraction > 0.9, "end marker fraction is near 1");

// Progress increases monotonically from start to end.
assert.ok(nearStart.routeProgressMeters < nearMiddle.routeProgressMeters);
assert.ok(nearMiddle.routeProgressMeters < nearEnd.routeProgressMeters);

// All three projections share the same total route length.
assert.equal(nearStart.routeLengthMeters, nearEnd.routeLengthMeters);
assert.ok(nearStart.routeLengthMeters > 0);

console.log("Route data point projection tests passed");

// --- getActiveRouteDataPoints filtering, ordering, and dedup ---

const activeSegments = {
  loop: {
    id: 1,
    data: [
      { id: "end-poi", type: "nature", location: [33, 35.029] },
      { id: "start-poi", type: "viewpoint", location: [33, 35.001] },
      { id: "mid-poi", type: "cafe", location: [33, 35.015] },
      // Off-route: > trigger distance from the geometry, filtered out.
      { id: "far-poi", type: "river", location: [33.01, 35.015] },
      // Duplicate stable id: skipped after the first occurrence.
      { id: "start-poi", type: "viewpoint", location: [33, 35.001] },
    ],
  },
};

const active = getActiveRouteDataPoints(["loop"], progressRoute, activeSegments);

// far-poi filtered, duplicate start-poi deduped -> three points remain.
assert.equal(active.length, 3);
const activeIds = active.map((p) => p.id);
assert.ok(!activeIds.includes("far-poi"));
assert.equal(activeIds.filter((id) => id === "start-poi").length, 1);

// Each active point carries route-progress enrichment fields.
for (const point of active) {
  assert.ok(Number.isFinite(point.routeProgressMeters));
  assert.ok(Number.isFinite(point.routeFraction));
  assert.ok(point.routeDistanceMeters <= ROUTE_DATA_POINT_TRIGGER_DISTANCE_METERS);
}

// Progress fields reflect each marker's place along the route regardless of
// source order.
const byId = Object.fromEntries(active.map((p) => [p.id, p]));
assert.ok(byId["start-poi"].routeFraction < 0.1);
assert.ok(byId["mid-poi"].routeFraction > 0.4 && byId["mid-poi"].routeFraction < 0.6);
assert.ok(byId["end-poi"].routeFraction > 0.9);

console.log("Active route data point enrichment tests passed");

console.log("Route data point filtering tests passed");
