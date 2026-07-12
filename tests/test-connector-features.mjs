import assert from "node:assert/strict";
import {
  computeConnectorFeatures,
  CONNECTOR_CLASS_RANK,
  CONNECTOR_FEATURE_VERSION,
} from "@cycleways/core/routing/connectorFeatures.js";

const origin = { lat: 33.0, lng: 35.0 };
const routeStart = { lat: 33.0, lng: 35.01 };

const preview = {
  failure: null,
  distanceMeters: 1000,
  geometry: [origin, routeStart],
  edgeCosts: [
    {
      edgeId: "a",
      routeClass: "cycle",
      cyclewaysSegmentIds: [7],
      distanceMeters: 400,
    },
    {
      edgeId: "b",
      routeClass: "road",
      cyclewaysSegmentIds: [],
      distanceMeters: 600,
    },
  ],
};

const f = computeConnectorFeatures(preview, { origin, routeStart });
assert.equal(f.featureVersion, CONNECTOR_FEATURE_VERSION);
assert.equal(f.snapOk, true);
assert.equal(f.failure, null);
assert.equal(f.routedMeters, 1000);
assert.ok(f.straightLineMeters > 800 && f.straightLineMeters < 1000, "straight-line is roughly 930m");
assert.ok(Math.abs(f.detourRatio - preview.distanceMeters / f.straightLineMeters) < 1e-9);
assert.ok(Math.abs(f.cwNetworkFraction - 0.4) < 1e-9, "400/1000 on cw network");
assert.equal(f.worstRouteClass, "road");
assert.equal(f.edgeCount, 2);

const roadTypeFallback = computeConnectorFeatures(
  {
    failure: null,
    distanceMeters: 100,
    geometry: [origin, routeStart],
    edgeCosts: [
      {
        edgeId: "c",
        routeClass: "other",
        roadType: "road",
        cyclewaysSegmentIds: [],
        distanceMeters: 100,
      },
    ],
  },
  { origin, routeStart },
);
assert.equal(roadTypeFallback.worstRouteClass, "road");

const failed = computeConnectorFeatures(
  { failure: "snap-failed" },
  { origin, routeStart },
);
assert.equal(failed.featureVersion, CONNECTOR_FEATURE_VERSION);
assert.equal(failed.snapOk, false);
assert.equal(failed.failure, "snap-failed");
assert.equal(failed.routedMeters, 0);
assert.equal(failed.detourRatio, Infinity);
assert.equal(failed.cwNetworkFraction, 0);
assert.equal(failed.worstRouteClass, null);
assert.equal(failed.edgeCount, 0);
assert.ok(failed.straightLineMeters > 0);

assert.equal(CONNECTOR_CLASS_RANK.cw_network, 0);
assert.equal(CONNECTOR_CLASS_RANK.other, 6);

console.log("connector-features OK");
