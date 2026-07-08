import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { DEFAULT_CONNECTOR_STRATEGY } from "@cycleways/core/routing/connectorCostModel.js";
import { runConnectorPreview } from "../editor/lib/connectorPreview.mjs";

const require = createRequire(import.meta.url);
const RouteManager = require("../packages/core/route-manager.js");

const network = {
  schemaVersion: 2,
  nodes: [
    { id: "a", coord: [35.0, 33.0] },
    { id: "b", coord: [35.001, 33.001] },
    { id: "c", coord: [35.002, 33.0] },
  ],
  edges: [
    { id: "direct", from: "a", to: "c", distanceMeters: 186,
      coordinates: [[35.0, 33.0], [35.002, 33.0]], routeClass: "cycle", cwSegmentIds: [] },
    { id: "ab", from: "a", to: "b", distanceMeters: 150,
      coordinates: [[35.0, 33.0], [35.001, 33.001]], routeClass: "local_road", cwSegmentIds: [] },
    { id: "bc", from: "b", to: "c", distanceMeters: 150,
      coordinates: [[35.001, 33.001], [35.002, 33.0]], routeClass: "local_road", cwSegmentIds: [] },
  ],
};

const manager = new RouteManager();
await manager.load({ type: "FeatureCollection", features: [] }, {}, network);

const routeStart = { lat: 33.0, lng: 35.002 };

// Single mode, default strategy: from near a to c → detours over ab/bc (cycle excluded).
const single = runConnectorPreview(manager, {
  mode: "single",
  routeStart,
  origin: { lat: 33.0, lng: 35.0 },
  strategy: DEFAULT_CONNECTOR_STRATEGY,
});
assert.equal(single.failure, null);
assert.ok(single.edgeIds.includes("ab") || single.edgeIds.includes("bc"),
  "default single run uses the local_road detour");
assert.ok(!single.edgeIds.includes("direct"), "default single run avoids the cycle edge");

// Frequency mode, default: aggregate usage exists and every origin has a status.
const freq = runConnectorPreview(manager, {
  mode: "frequency",
  routeStart,
  strategy: DEFAULT_CONNECTOR_STRATEGY,
  radiusMeters: 200,
  gridSpacingMeters: 80,
  maxOrigins: 100,
});
assert.equal(freq.stats.total, freq.origins.length);
assert.ok(freq.stats.total > 0);
assert.ok(Object.keys(freq.edgeUsage).length > 0, "some edges are used");
for (const o of freq.origins) assert.ok(typeof o.status === "string");

// Softened strategy shifts usage onto the direct cycle edge.
const softened = {
  ...DEFAULT_CONNECTOR_STRATEGY,
  classMultipliers: { ...DEFAULT_CONNECTOR_STRATEGY.classMultipliers, cycle: 1 },
};
const freqSoft = runConnectorPreview(manager, {
  mode: "frequency", routeStart, strategy: softened,
  radiusMeters: 200, gridSpacingMeters: 80, maxOrigins: 100,
});
assert.ok((freqSoft.edgeUsage.direct || 0) > 0, "softened run uses the cycle edge");

// Invalid input → 400.
assert.throws(
  () => runConnectorPreview(manager, { mode: "frequency" }),
  (err) => err.status === 400,
);

console.log("connector-preview OK");
