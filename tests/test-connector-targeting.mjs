import assert from "node:assert/strict";
import { navigationRouteFromRouteState } from "@cycleways/core/navigation/navigationRoute.js";
import {
  APPROACH_NEAREST_MARGIN_M,
  REJOIN_FORWARD_WINDOW_M,
  connectorWithinCap,
  projectOntoRoute,
  selectConnectorTarget,
} from "@cycleways/core/navigation/connectorTargeting.js";

const route = navigationRouteFromRouteState({
  points: [{ lat: 33.1, lng: 35.6 }, { lat: 33.1, lng: 35.62 }],
  geometry: [
    { lat: 33.1, lng: 35.6 },
    { lat: 33.1, lng: 35.61 },
    { lat: 33.1, lng: 35.62 },
  ],
  distance: 1863,
}, { param: "targeting" });

const projected = projectOntoRoute(route.geometry, { lat: 33.101, lng: 35.605 });
assert.ok(projected.progressMeters > 400 && projected.progressMeters < 550);
assert.ok(Math.abs(projected.point.lng - 35.605) < 0.0001);

const beforeStart = selectConnectorTarget(
  route,
  { lat: 33.1, lng: 35.594 },
  { mode: "approach" },
);
assert.equal(beforeStart.mainProgressMeters, 0);

const nearEnd = selectConnectorTarget(
  route,
  { lat: 33.1, lng: 35.6195 },
  { mode: "approach" },
);
assert.ok(nearEnd.mainProgressMeters > APPROACH_NEAREST_MARGIN_M);

const rejoin = selectConnectorTarget(
  route,
  { lat: 33.105, lng: 35.615 },
  { mode: "rejoin", lastConfirmedProgressMeters: 600 },
);
assert.ok(rejoin.mainProgressMeters >= 600);
assert.ok(rejoin.mainProgressMeters <= 600 + REJOIN_FORWARD_WINDOW_M);

assert.equal(connectorWithinCap(500), true);
assert.equal(connectorWithinCap(8001), false);
assert.equal(connectorWithinCap(0), false);

console.log("test-connector-targeting OK");
