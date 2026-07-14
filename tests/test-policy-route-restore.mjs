import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createShardedRouteSession } from "../packages/core/src/routing/shardedRouteSession.js";

const require = createRequire(import.meta.url);
const RouteManager = require("../packages/core/route-manager.js");
const registryDigest = "fixture-registry-digest";
const indexDigest = "fixture-index-digest";
const graphHash = "f03acd80";
const policy = {
  baseRoutingSchemaVersion: 3,
  policyId: "il-bicycle-v1",
  policyDigest: "fixture-policy",
  routingContextDigest: "fixture-current-v3",
  strictTraversalPolicy: true,
  legacyCompatibilityRegistryDigest: registryDigest,
  legacyCompatibilityGraphVersionHashes: { [graphHash]: registryDigest },
  legacyCwBaseIndexSha256: indexDigest,
};
const manifest = {
  sourceRoutingSchemaVersion: 3,
  graphVersion: "fixture-current-v3",
  policyId: policy.policyId,
  policyDigest: policy.policyDigest,
  routingContract: policy,
  scheme: { shardSizeDegrees: 1 },
  shards: [{ id: "only", bounds: [34, 32, 36, 34] }],
};
const shard = {
  id: "only",
  sourceRoutingSchemaVersion: 3,
  nodes: [
    { id: "west", coord: [35, 33] },
    { id: "east", coord: [35.01, 33] },
  ],
  edges: [{
    id: "one-way",
    shareId: 7,
    from: "west",
    to: "east",
    distanceMeters: 930,
    coordinates: [[35, 33], [35.01, 33]],
    source: "osm",
    routeClass: "local_road",
    bicycleTraversal: {
      policyId: policy.policyId,
      policyDigest: policy.policyDigest,
      forward: "allowed",
      reverse: "prohibited",
      forwardReason: "fixture-forward",
      reverseReason: "fixture-oneway",
    },
    cwAlignments: { forward: [], reverse: [] },
  }],
};
const compatibility = {
  manifest: {
    registryDigest,
    cwBaseIndexSha256: indexDigest,
    graphVersionHashes: { [graphHash]: registryDigest },
  },
  metadata: {
    sourceSha256: indexDigest,
    baseEdgeShareRegistryDigest: registryDigest,
    legacyGraphVersionHash: graphHash,
  },
  cwBaseIndex: {
    schemaVersion: 1,
    segments: { 174: [[7, 0]] },
  },
};
const payload = {
  type: "hybrid_route_v6",
  graphVersion: `h${graphHash}`,
  graphVersionHash: Number.parseInt(graphHash, 16),
  routePoints: [
    { id: "A", baseEdgeShareId: 7, baseEdgeFraction: 0.1 },
    { id: "B", baseEdgeShareId: 7, baseEdgeFraction: 0.9 },
  ],
  shards: [{ id: "only" }],
  spans: [{ type: "cw", segmentId: 174, reversed: true }],
};

async function createSession(legacyRoutingCompatibility) {
  return createShardedRouteSession(
    RouteManager,
    { type: "FeatureCollection", features: [] },
    {},
    manifest,
    async () => shard,
    {
      paddingShards: 0,
      cwBaseIndex: { schemaVersion: 2, segments: {} },
      legacyRoutingCompatibility,
    },
  );
}

const compatible = await createSession(compatibility);
const restored = await compatible.restoreHybridRoutePayload(payload);
assert.ok(restored, "proved legacy anchors are recoverable");
assert.equal(restored.requiresReview, true);
assert.equal(restored.restoreDisposition, "replanned-current-policy");
assert.equal(restored.routingValidation.traversalSlices[0].policyState, "allowed");
assert.equal(
  restored.routingValidation.traversalSlices[0].fromFractionQ <
    restored.routingValidation.traversalSlices[0].toFractionQ,
  true,
  "forbidden requested reverse is replaced by a current-policy forward route",
);

const missing = await createSession(null);
assert.equal(
  await missing.restoreHybridRoutePayload(payload),
  null,
  "V6 anchors cannot be trusted without the bundled immutable identity proof",
);

const tampered = structuredClone(compatibility);
tampered.manifest.registryDigest = "tampered";
const rejected = await createSession(tampered);
assert.equal(await rejected.restoreHybridRoutePayload(payload), null);

console.log("policy route restore ok");
