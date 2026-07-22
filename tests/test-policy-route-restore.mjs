import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createShardedRouteSession } from "../packages/core/src/routing/shardedRouteSession.js";
import { historicalRouteIntentKey } from "../packages/core/src/routing/routeAnchorCompatibility.js";

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

async function createSession(
  legacyRoutingCompatibility,
  routeAnchorCompatibility = null,
  currentCwBaseIndex = { schemaVersion: 2, segments: {} },
) {
  return createShardedRouteSession(
    RouteManager,
    { type: "FeatureCollection", features: [] },
    {},
    manifest,
    async () => shard,
    {
      paddingShards: 0,
      cwBaseIndex: currentCwBaseIndex,
      legacyRoutingCompatibility,
      routeAnchorCompatibility,
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

// Legacy identity can be valid even after one of its anchor edges has been
// retired. In that case current share resolution fails and restoration must
// continue through the separately verified historical anchor archive.
const retiredLegacyCompatibility = structuredClone(compatibility);
retiredLegacyCompatibility.cwBaseIndex.segments[174] = [[8, 0]];
const retiredLegacyArchive = {
  schemaVersion: 1,
  graphVersions: {
    [graphHash]: {
      registryDigest: "b".repeat(64),
      archivedEdges: {
        8: {
          edgeId: "retired-legacy-edge",
          coordinates: [[35, 33], [35.01, 33]],
        },
      },
      routeIntents: {},
    },
  },
};
const retiredLegacy = await createSession(
  retiredLegacyCompatibility,
  retiredLegacyArchive,
);
const retiredLegacyRestored = await retiredLegacy.restoreHybridRoutePayload(payload);
assert.ok(retiredLegacyRestored, "proved legacy identity falls back to archived anchors");
assert.equal(retiredLegacyRestored.requiresReview, true);
assert.equal(retiredLegacyRestored.restoreDisposition, "replanned-current-policy");
assert.equal(
  retiredLegacyRestored.routingValidation.traversalSlices[0].policyState,
  "allowed",
);

const archivedGraphHash = "a1b2c3d4";
const archivedPayload = {
  ...payload,
  graphVersion: `h${archivedGraphHash}`,
  graphVersionHash: Number.parseInt(archivedGraphHash, 16),
  routePoints: [
    { id: "A", baseEdgeShareId: 8, baseEdgeFraction: 0.1 },
    { id: "B", baseEdgeShareId: 8, baseEdgeFraction: 0.9 },
  ],
};
const routeAnchorCompatibility = {
  schemaVersion: 1,
  graphVersions: {
    [archivedGraphHash]: {
      registryDigest: "a".repeat(64),
      archivedEdges: {
        8: {
          edgeId: "retired-one-way",
          coordinates: [[35, 33], [35.01, 33]],
        },
      },
      routeIntents: {
        [historicalRouteIntentKey(archivedPayload)]: {
          routeSlugs: ["fixture"],
          points: [[35.001, 33], [35.009, 33]],
          detours: [{
            afterPointIndex: 0,
            segmentIds: [335],
            points: [[35.005, 33]],
          }],
        },
      },
    },
  },
};
const archived = await createSession(
  null,
  routeAnchorCompatibility,
  { schemaVersion: 2, segments: { 335: {} } },
);
const archivedRestore = await archived.restoreHybridRoutePayload(archivedPayload);
assert.ok(archivedRestore, "a known historical V6 graph recovers retired edge anchors");
assert.equal(archivedRestore.requiresReview, true);
assert.equal(archivedRestore.restoreDisposition, "replanned-current-policy-route-intent");
assert.equal(archivedRestore.routingValidation.traversalSlices[0].policyState, "allowed");
assert.equal(archivedRestore.points.length, 3, "a missing current CW visit activates its archived detour");

const retiredSegmentRestore = await createSession(null, routeAnchorCompatibility);
const retiredSnapshot = await retiredSegmentRestore.restoreHybridRoutePayload(archivedPayload);
assert.equal(retiredSnapshot.points.length, 2, "a retired CW segment does not force obsolete shaping");
assert.equal(retiredSnapshot.restoreDisposition, "replanned-current-policy");

const unknownArchive = structuredClone(routeAnchorCompatibility);
delete unknownArchive.graphVersions[archivedGraphHash];
const unknown = await createSession(null, unknownArchive);
assert.equal(
  await unknown.restoreHybridRoutePayload(archivedPayload),
  null,
  "an unregistered graph hash cannot use historical anchor geometry",
);

console.log("policy route restore ok");
