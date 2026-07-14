import assert from "node:assert/strict";
import {
  buildRouteAttestation,
  reverseRouteAttestation,
  validateRouteAttestation,
} from "../packages/core/src/routing/routeAttestation.js";

const context = {
  baseRoutingSchemaVersion: 3,
  graphVersion: "fixture-v3",
  policyId: "il-bicycle-v1",
  policyDigest: "fixture-policy",
  routingContextDigest: "fixture-context",
};
const build = (oppositePolicyState) =>
  buildRouteAttestation({
    validationContext: context,
    traversalSlices: [
      {
        edgeShareId: 370,
        fromFraction: 0.2,
        toFraction: 0.8,
        distanceMeters: 547.3,
        policyState: "allowed",
        policyReason: "fixture-forward",
        oppositePolicyState,
        oppositePolicyReason: "fixture-reverse",
        cwMembership: [{ segmentId: 174, alignmentKey: "bToA" }],
        oppositeCwMembership: [],
        shardIds: ["g711_664"],
      },
    ],
    waypointOccurrences: [
      { id: "A", lat: 33, lng: 35, baseEdgeShareId: 370, baseEdgeFraction: 0.2 },
      { id: "B", lat: 33, lng: 35.01, baseEdgeShareId: 370, baseEdgeFraction: 0.8 },
    ],
    legBoundaries: [{ startTraversal: 0, endTraversal: 1 }],
    geometry: [
      { lat: 33, lng: 35 },
      { lat: 33, lng: 35.01 },
    ],
  });

const oneWay = build("prohibited");
assert.deepEqual(validateRouteAttestation(oneWay), { ok: true, reason: null });
assert.equal(oneWay.exactReverseAllowed, false);
assert.equal(reverseRouteAttestation(oneWay), null);

const twoWay = build("allowed");
assert.equal(twoWay.exactReverseAllowed, true);
const reversed = reverseRouteAttestation(twoWay);
assert.ok(reversed);
assert.equal(reversed.traversalSlices[0].fromFractionQ, twoWay.traversalSlices[0].toFractionQ);
assert.equal(reversed.traversalSlices[0].toFractionQ, twoWay.traversalSlices[0].fromFractionQ);
assert.equal(reversed.derivation, "exact-reverse");
assert.deepEqual(validateRouteAttestation(reversed), { ok: true, reason: null });

const tampered = structuredClone(twoWay);
tampered.traversalSlices[0].edgeShareId = 19;
assert.equal(validateRouteAttestation(tampered).reason, "route-content-fingerprint-mismatch");

console.log("route attestation ok");
