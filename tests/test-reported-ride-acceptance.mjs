import assert from "node:assert/strict";
import {
  reportedRideFingerprintDisposition,
  reportedRideTraversalPathFingerprint,
} from "../scripts/lib/reportedRideAcceptance.mjs";

const slices = [{
  edgeShareId: 19,
  fromFractionQ: 0,
  toFractionQ: 1_000_000,
  distanceMetersQ: 100_000,
  policyState: "allowed",
  policyReason: "osm-default",
  cwMembership: [{ segmentId: 174, alignmentKey: "aToB", mappingDigest: "volatile" }],
}];
const pathFingerprint = reportedRideTraversalPathFingerprint(slices);
assert.equal(
  pathFingerprint,
  reportedRideTraversalPathFingerprint([{ ...slices[0], distanceMetersQ: 104_000 }]),
);
assert.notEqual(
  pathFingerprint,
  reportedRideTraversalPathFingerprint([{ ...slices[0], toFractionQ: -1 }]),
);
assert.equal(
  reportedRideFingerprintDisposition({
    acceptedFingerprint: "old-content",
    actualFingerprint: "new-content",
    acceptedTraversalPathFingerprint: pathFingerprint,
    actualTraversalPathFingerprint: pathFingerprint,
    acceptedDistanceMeters: 1000,
    actualDistanceMeters: 1004,
    distanceToleranceMeters: 10,
  }),
  "safe-geometry-update-same-traversal",
);
assert.equal(
  reportedRideFingerprintDisposition({
    acceptedFingerprint: "old-content",
    actualFingerprint: "new-content",
    acceptedTraversalPathFingerprint: pathFingerprint,
    actualTraversalPathFingerprint: "different-path",
    acceptedDistanceMeters: 1000,
    actualDistanceMeters: 1004,
  }),
  "changed",
);
assert.equal(
  reportedRideFingerprintDisposition({
    acceptedFingerprint: "old-content",
    actualFingerprint: "new-content",
    acceptedTraversalPathFingerprint: pathFingerprint,
    actualTraversalPathFingerprint: pathFingerprint,
    acceptedDistanceMeters: 1000,
    actualDistanceMeters: 1020,
    distanceToleranceMeters: 10,
  }),
  "changed",
);

console.log("reported ride acceptance tests passed");
