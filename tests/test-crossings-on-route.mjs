import assert from "node:assert/strict";
import { buildRouteAttestation } from "@cycleways/core/routing/routeAttestation.js";
import { crossingsOnRoute } from "@cycleways/core/routing/crossingsOnRoute.js";

const geometry = [{ lat: 33, lng: 35 }, { lat: 33, lng: 35.001 }];
const context = {
  baseRoutingSchemaVersion: 3,
  graphVersion: "graph-1",
  policyId: "policy-1",
  policyDigest: "policy-digest-1",
  routingContextDigest: "context-1",
};
const routeSlice = (edgeShareId, fromFractionQ, toFractionQ, distanceMetersQ = 10_000) => ({
  edgeShareId, fromFractionQ, toFractionQ, distanceMetersQ,
  policyState: "allowed", policyReason: "test",
  oppositePolicyState: "allowed", oppositePolicyReason: "test",
});
const attestation = buildRouteAttestation({
  validationContext: context,
  traversalSlices: [
    routeSlice(1, 0, 1_000_000),
    routeSlice(2, 1_000_000, 0, 20_000),
    routeSlice(3, 0, 1_000_000),
    routeSlice(1, 0, 1_000_000),
    routeSlice(2, 1_000_000, 0, 20_000),
    routeSlice(3, 0, 1_000_000),
  ],
  waypointOccurrences: [], legBoundaries: [], geometry,
});
const mapping = {
  id: "mapping-forward",
  match: {
    before: [routeSlice(1, 250_000, 750_000)],
    action: [routeSlice(2, 800_000, 200_000)],
    after: [routeSlice(3, 100_000, 900_000)],
  },
  // The synthetic route repeats the same attested edge sequence on one simple
  // line, so keep the reviewed anchors within the matcher sanity radius of
  // both visits. Real repeated routes return to the same physical anchors.
  entry: { lat: 33, lng: 35.00042 },
  exit: { lat: 33, lng: 35.00058 },
};
const artifact = {
  schemaVersion: 1,
  graphVersion: "graph-1",
  traversalPolicyDigest: "policy-digest-1",
  crossings: [{
    id: "crossing-1", kind: "side-change", crossedRoad: { name: "Road 99" }, mappings: [mapping],
  }],
};

const matches = crossingsOnRoute(artifact, attestation, geometry);
assert.equal(matches.length, 2, "repeated route visits must produce separate records");
assert.equal(matches[0].crossingId, "crossing-1");
assert.equal(matches[0].crossedRoadName, "Road 99");
assert.ok(matches[0].entryMeters < matches[0].exitMeters);
assert.equal(matches[0].complete, true);

const wrongDirection = structuredClone(artifact);
wrongDirection.crossings[0].mappings[0].match.action[0] = routeSlice(2, 200_000, 800_000);
assert.deepEqual(crossingsOnRoute(wrongDirection, attestation, geometry), []);

const splitAttestation = buildRouteAttestation({
  validationContext: context,
  traversalSlices: [
    routeSlice(1, 0, 1_000_000),
    routeSlice(2, 1_000_000, 0, 20_000),
    routeSlice(3, 0, 400_000, 4_000),
    routeSlice(3, 400_000, 1_000_000, 6_000),
  ],
  waypointOccurrences: [], legBoundaries: [], geometry,
});
assert.equal(
  crossingsOnRoute(artifact, splitAttestation, geometry).length,
  1,
  "one reviewed edge slice may be covered by adjacent attestation slices",
);

const interruptedContext = buildRouteAttestation({
  validationContext: context,
  traversalSlices: [
    routeSlice(1, 0, 1_000_000),
    routeSlice(99, 0, 1_000_000),
    routeSlice(2, 1_000_000, 0, 20_000),
    routeSlice(3, 0, 1_000_000),
  ],
  waypointOccurrences: [], legBoundaries: [], geometry,
});
assert.deepEqual(
  crossingsOnRoute(artifact, interruptedContext, geometry),
  [],
  "unrelated route edges must not be skipped between mapping sections",
);

const wrongAnchors = structuredClone(artifact);
wrongAnchors.crossings[0].mappings[0].entry = { lat: 34, lng: 35 };
assert.deepEqual(crossingsOnRoute(wrongAnchors, attestation, geometry), []);

const malformed = structuredClone(artifact);
delete malformed.crossings[0].mappings[0].entry;
assert.equal(crossingsOnRoute(malformed, attestation, geometry), null);

const incomplete = buildRouteAttestation({
  validationContext: context,
  traversalSlices: [routeSlice(2, 1_000_000, 0), routeSlice(3, 0, 1_000_000)],
  waypointOccurrences: [], legBoundaries: [], geometry,
});
assert.deepEqual(crossingsOnRoute(artifact, incomplete, geometry), []);
assert.equal(crossingsOnRoute({ ...artifact, graphVersion: "other" }, attestation, geometry), null);
assert.equal(crossingsOnRoute(null, attestation, geometry), null);

console.log("crossings-on-route tests passed");
