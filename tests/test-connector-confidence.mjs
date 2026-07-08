import assert from "node:assert/strict";
import {
  classifyConnector,
  DEFAULT_CONNECTOR_THRESHOLDS,
} from "@cycleways/core/routing/connectorConfidence.js";

const T = DEFAULT_CONNECTOR_THRESHOLDS;

assert.deepEqual(T, {
  guideRadiusMeters: 3000,
  tooFarRadiusMeters: 10000,
  maxDetourRatio: 2.5,
  maxRoutedMeters: 8000,
  worstClassAllowed: "local_road",
});

const good = {
  snapOk: true,
  failure: null,
  straightLineMeters: 1200,
  routedMeters: 1500,
  detourRatio: 1.25,
  cwNetworkFraction: 0.6,
  worstRouteClass: "road",
  edgeCount: 5,
};

assert.equal(classifyConnector(good, T).tier, "guide");
assert.equal(classifyConnector(good, T).handoffSuggested, false);
assert.deepEqual(classifyConnector(good, T).reasons, []);

assert.equal(
  classifyConnector({ snapOk: false, straightLineMeters: 500 }, T).tier,
  "too-far",
);

assert.equal(
  classifyConnector({ ...good, straightLineMeters: T.tooFarRadiusMeters + 1 }, T).tier,
  "too-far",
);

const midFar = { ...good, straightLineMeters: T.guideRadiusMeters + 1 };
assert.equal(classifyConnector(midFar, T).tier, "show-leg");
assert.ok(classifyConnector(midFar, T).reasons.includes("beyond-guide-radius"));

assert.equal(
  classifyConnector({ ...good, detourRatio: T.maxDetourRatio + 0.1 }, T).tier,
  "show-leg",
);
assert.equal(
  classifyConnector({ ...good, routedMeters: T.maxRoutedMeters + 1 }, T).tier,
  "show-leg",
);
assert.equal(
  classifyConnector({ ...good, worstRouteClass: "path_track" }, T).tier,
  "show-leg",
);

assert.equal(classifyConnector(midFar, T).handoffSuggested, true);

console.log("connector-confidence OK");
