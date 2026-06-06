import assert from "node:assert/strict";
import {
  buildCumulativeDistances,
  haversineMeters,
  nearestPointOnPolyline,
  pointAtFraction,
  projectPointToRouteCandidates,
} from "../src/components/featured/routeGeometry.js";

const route = [
  { lat: 33.0, lng: 35.0 },
  { lat: 33.0, lng: 35.001 },
  { lat: 33.0, lng: 35.002 },
];
const cumulative = buildCumulativeDistances(route);

assert.equal(cumulative[0], 0);
assert.ok(cumulative[2] > 150 && cumulative[2] < 220, `expected ~186m, got ${cumulative[2]}`);

const northM = haversineMeters(
  { lat: 33.0, lng: 35.0 },
  { lat: 33.001, lng: 35.0 },
);
assert.ok(northM > 100 && northM < 120, `expected ~111m, got ${northM}`);

const snap = nearestPointOnPolyline({ lat: 33.0, lng: 35.001 }, route, cumulative);
assert.ok(Math.abs(snap.fraction - 0.5) < 1e-3, `fraction ~= 0.5, got ${snap.fraction}`);
assert.ok(snap.distanceMeters < 1, `on-route distance ~= 0, got ${snap.distanceMeters}`);

const off = nearestPointOnPolyline({ lat: 33.001, lng: 35.001 }, route, cumulative);
assert.ok(off.distanceMeters > 100 && off.distanceMeters < 120, `expected ~111m, got ${off.distanceMeters}`);

const pt = pointAtFraction(route, cumulative, 0.5);
assert.ok(Math.abs(pt.lng - 35.001) < 1e-6, `lng ~= 35.001, got ${pt.lng}`);
assert.ok(Math.abs(pt.lat - 33.0) < 1e-9, `lat ~= 33.0, got ${pt.lat}`);

const closedRoute = [
  { lat: 33.0, lng: 35.0 },
  { lat: 33.0, lng: 35.002 },
  { lat: 33.002, lng: 35.002 },
  { lat: 33.002, lng: 35.0 },
  { lat: 33.0, lng: 35.0001 },
];
const closedCumulative = buildCumulativeDistances(closedRoute);
const seamCandidates = projectPointToRouteCandidates(
  { lat: 33.0, lng: 35.00005 },
  closedRoute,
  closedCumulative,
  { maxDistanceMeters: 20 },
);
assert.ok(seamCandidates.length >= 2, "loop seam point should produce multiple nearby candidates");
assert.ok(
  seamCandidates.some((candidate) => candidate.fraction < 0.05),
  "includes a start-of-loop candidate",
);
assert.ok(
  seamCandidates.some((candidate) => candidate.fraction > 0.95),
  "includes an end-of-loop candidate",
);

console.log("routeGeometry tests passed");
