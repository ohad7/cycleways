import assert from "node:assert/strict";
import {
  DEFAULT_CONNECTOR_STRATEGY,
  evaluateConnectorEdge,
} from "@cycleways/core/routing/connectorCostModel.js";

const S = DEFAULT_CONNECTOR_STRATEGY;

// road → allowed, ×1.0
assert.deepEqual(
  evaluateConnectorEdge({ routeClass: "road" }, S),
  { allowed: true, multiplier: 1 },
);

// local_road → allowed, ×1.1
assert.deepEqual(
  evaluateConnectorEdge({ routeClass: "local_road" }, S),
  { allowed: true, multiplier: 1.1 },
);

// roadType "road" (non-road routeClass) → treated as road, ×1.0
assert.deepEqual(
  evaluateConnectorEdge({ routeClass: "other", roadType: "road" }, S),
  { allowed: true, multiplier: 1 },
);

// cycle → excluded under default
assert.deepEqual(
  evaluateConnectorEdge({ routeClass: "cycle" }, S),
  { allowed: false, multiplier: Infinity },
);

// path_track → excluded under default
assert.equal(evaluateConnectorEdge({ routeClass: "path_track" }, S).allowed, false);

// restricted access excludes an otherwise-allowed road
assert.deepEqual(
  evaluateConnectorEdge({ routeClass: "road", accessStatus: "restricted" }, S),
  { allowed: false, multiplier: Infinity },
);

// conditional access excludes
assert.equal(
  evaluateConnectorEdge({ routeClass: "local_road", accessStatus: "conditional" }, S).allowed,
  false,
);

// unspecified access does not penalize
assert.equal(
  evaluateConnectorEdge({ routeClass: "road", accessStatus: "unspecified" }, S).multiplier,
  1,
);

// null / missing edge → excluded
assert.deepEqual(
  evaluateConnectorEdge(null, S),
  { allowed: false, multiplier: Infinity },
);

// A softened strategy (cycle finite) flips the verdict and combines with access.
const softened = {
  ...S,
  classMultipliers: { ...S.classMultipliers, cycle: 1.5 },
  accessPolicy: { ...S.accessPolicy, conditional: 2 },
};
assert.deepEqual(
  evaluateConnectorEdge({ routeClass: "cycle" }, softened),
  { allowed: true, multiplier: 1.5 },
);
// class ×1.5 and access ×2 combine
assert.equal(
  evaluateConnectorEdge({ routeClass: "cycle", accessStatus: "conditional" }, softened).multiplier,
  3,
);

console.log("connector-cost-model OK");
