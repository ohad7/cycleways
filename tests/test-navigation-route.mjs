import assert from "node:assert/strict";
import {
  navigationRouteFromCatalogEntry,
  navigationRouteFromRouteState,
} from "@cycleways/core/navigation/navigationRoute.js";
import { buildRouteAttestation } from "@cycleways/core/routing/routeAttestation.js";

const routingValidation = buildRouteAttestation({
  validationContext: {
    baseRoutingSchemaVersion: 3,
    graphVersion: "fixture-v3",
    policyId: "il-bicycle-v1",
    policyDigest: "fixture-policy",
    routingContextDigest: "fixture-context",
  },
  traversalSlices: [
    {
      edgeShareId: 1,
      fromFraction: 0,
      toFraction: 1,
      distanceMeters: 230,
      policyState: "allowed",
      policyReason: "fixture",
      oppositePolicyState: "allowed",
      oppositePolicyReason: "fixture",
    },
  ],
  waypointOccurrences: [
    { id: "start", lat: 33.1, lng: 35.6, baseEdgeShareId: 1, baseEdgeFraction: 0 },
    { id: "end", lat: 33.101, lng: 35.602, baseEdgeShareId: 1, baseEdgeFraction: 1 },
  ],
  legBoundaries: [{ startTraversal: 0, endTraversal: 1 }],
  geometry: [
    { lat: 33.1, lng: 35.6 },
    { lat: 33.1005, lng: 35.601 },
    { lat: 33.101, lng: 35.602 },
  ],
});

const routeState = {
  points: [
    { id: "start", lat: 33.1, lng: 35.6 },
    { id: "end", lat: 33.101, lng: 35.602 },
  ],
  selectedSegments: ["Segment A", "Segment B"],
  geometry: [
    { lat: 33.1, lng: 35.6, elevation: 80 },
    { lat: 33.1005, lng: 35.601, elevation: 82 },
    { lat: 33.101, lng: 35.602, elevation: 84 },
  ],
  distance: 230,
  elevationGain: 6,
  elevationLoss: 1,
  activeDataPoints: [
    {
      id: "poi-1",
      type: "caution",
      segmentName: "Segment A",
      routeProgressMeters: 40,
    },
  ],
  routeFailure: null,
  routingValidation,
};

const built = navigationRouteFromRouteState(
  routeState,
  { param: "built-route-token", format: "hybrid_route_v6" },
  {
    name: "Morning ride",
    segmentsData: {
      "Segment A": { id: 12 },
      "Segment B": { id: 34 },
    },
  },
);

assert.equal(built.id, "built:built-route-token");
assert.equal(built.source, "built");
assert.equal(built.canNavigate, true);
assert.equal(built.unavailableReason, null);
assert.equal(built.routeParam, "built-route-token");
assert.equal(built.routeFormat, "hybrid_route_v6");
assert.equal(built.name, "Morning ride");
assert.equal(built.distanceMeters, 230);
assert.equal(built.distanceKm, 0.2);
assert.equal(built.elevationGainM, 6);
assert.equal(built.elevationLossM, 1);
assert.deepEqual(built.selectedSegments, [
  { name: "Segment A", id: 12 },
  { name: "Segment B", id: 34 },
]);
assert.deepEqual(built.selectedSegmentNames, ["Segment A", "Segment B"]);
assert.equal(built.geometry.length, 3);
assert.equal(built.geometry[0].distanceFromStartMeters, 0);
assert.ok(built.geometry[1].distanceFromStartMeters > 0);
assert.ok(
  built.geometry[2].distanceFromStartMeters >
    built.geometry[1].distanceFromStartMeters,
);
assert.equal(built.activeDataPoints.length, 1);
assert.equal(built.maneuverGeneratorVersion, "navigation-cues-v2");

const catalog = navigationRouteFromCatalogEntry(
  {
    slug: "sovev-beit-hillel",
    name: "סובב בית הלל",
    summary: "מסלול קצר ונעים",
    route: "catalog-route-token",
    featured: true,
    difficulty: "easy",
    surfaceType: "paved",
    distanceKm: 6.5,
    elevationGainM: 12,
    elevationLossM: 12,
    routeShape: { type: "circular", endpointDistanceM: 6 },
    start: { name: "חניון כניסה בית הלל" },
    regionId: "hula-valley",
    startPlaceIds: ["beit-hillel"],
    passesNear: ["beit-hillel", "shdeh-nehemia"],
  },
  routeState,
);

assert.equal(catalog.id, "catalog:sovev-beit-hillel");
assert.equal(catalog.source, "catalog");
assert.equal(catalog.canNavigate, true);
assert.equal(catalog.routeParam, "catalog-route-token");
assert.equal(catalog.slug, "sovev-beit-hillel");
assert.equal(catalog.name, "סובב בית הלל");
assert.equal(catalog.featured, true);
assert.equal(catalog.difficulty, "easy");
assert.equal(catalog.surfaceType, "paved");
assert.deepEqual(catalog.routeShape, {
  type: "circular",
  endpointDistanceM: 6,
});
assert.equal(catalog.catalogDistanceKm, 6.5);
assert.equal(catalog.catalogElevationGainM, 12);
assert.equal(catalog.catalogElevationLossM, 12);
assert.deepEqual(catalog.startPlaceIds, ["beit-hillel"]);
assert.deepEqual(catalog.passesNear, ["beit-hillel", "shdeh-nehemia"]);

const empty = navigationRouteFromRouteState(
  {
    ...routeState,
    points: [],
    geometry: [],
    distance: 0,
  },
  { param: "" },
);
assert.equal(empty.canNavigate, false);
assert.equal(empty.unavailableReason, "empty-route");

const broken = navigationRouteFromRouteState(
  {
    ...routeState,
    geometry: [],
    routeFailure: { reason: "no-path" },
  },
  { param: "broken-token" },
);
assert.equal(broken.canNavigate, false);
assert.equal(broken.unavailableReason, "broken-route");

const missingGeometry = navigationRouteFromRouteState(
  {
    ...routeState,
    geometry: [],
    routeFailure: null,
  },
  { param: "missing-geometry-token" },
);
assert.equal(missingGeometry.canNavigate, false);
assert.equal(missingGeometry.unavailableReason, "broken-route");

const geometryOnly = navigationRouteFromRouteState(
  { ...routeState, routingValidation: null },
  { param: "geometry-only" },
);
assert.equal(geometryOnly.canNavigate, false);
assert.equal(geometryOnly.unavailableReason, "missing-route-attestation");

// --- segmentSpans reconciled to the geometry distance frame ---
{
  const route = navigationRouteFromRouteState(
    {
      points: [{ id: "a", lat: 33.1, lng: 35.6 }, { id: "b", lat: 33.1, lng: 35.61 }],
      selectedSegments: ["X"],
      geometry: [
        { lat: 33.1, lng: 35.6 },
        { lat: 33.1, lng: 35.61 },
      ],
      // graph-edge spans total 1000, geometry haversine total ~931.5
      segmentSpans: [
        { startMeters: 0, endMeters: 600, name: "X", cwSegmentId: 1, onNetwork: true, routeClass: "cycleway" },
        { startMeters: 600, endMeters: 1000, name: null, cwSegmentId: null, onNetwork: false, routeClass: "residential" },
      ],
      distance: 931.5,
    },
    { param: "spans" },
  );
  const geomTotal = route.geometry[route.geometry.length - 1].distanceFromStartMeters;
  assert.equal(route.segmentSpans.length, 2);
  assert.equal(route.segmentSpans[0].startMeters, 0);
  // last span ends exactly at the geometry total (reconciled frame)
  assert.ok(Math.abs(route.segmentSpans[1].endMeters - geomTotal) < 1e-6,
    "spans rescaled to the geometry frame");
  assert.equal(route.segmentSpans[0].name, "X", "metadata preserved");
}

console.log("navigation route view-model tests passed");
