import assert from "node:assert/strict";
import {
  classifyConnector,
  DEFAULT_CONNECTOR_THRESHOLDS,
} from "@cycleways/core/routing/connectorConfidence.js";

const T = DEFAULT_CONNECTOR_THRESHOLDS;

assert.deepEqual(T, {
  tooFarRadiusMeters: 10000,
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

const longButAccepted = { ...good, straightLineMeters: 9000 };
assert.equal(classifyConnector(longButAccepted, T).tier, "guide");
assert.equal(
  classifyConnector({ ...good, detourRatio: 10 }, T).tier,
  "guide",
);
assert.equal(
  classifyConnector({ ...good, routedMeters: 9000 }, T).tier,
  "guide",
);
assert.equal(
  classifyConnector({ ...good, worstRouteClass: "path_track" }, T).tier,
  "guide",
);

console.log("connector-confidence OK");
