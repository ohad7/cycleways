import { createHash } from "node:crypto";

function stableMembership(values) {
  return (values || [])
    .map((membership) => ({
      segmentId: Number(membership?.segmentId),
      alignmentKey: membership?.alignmentKey ? String(membership.alignmentKey) : null,
    }))
    .sort(
      (left, right) =>
        left.segmentId - right.segmentId ||
        String(left.alignmentKey).localeCompare(String(right.alignmentKey)),
    );
}

export function reportedRideTraversalPathFingerprint(slices) {
  const path = (slices || []).map((slice) => ({
    edgeShareId: Number(slice?.edgeShareId),
    direction:
      Number(slice?.toFractionQ) < Number(slice?.fromFractionQ)
        ? "reverse"
        : "forward",
    policyState: String(slice?.policyState || "unknown"),
    policyReason: String(slice?.policyReason || ""),
    cwMembership: stableMembership(slice?.cwMembership),
  }));
  return `sha256-${createHash("sha256").update(JSON.stringify(path)).digest("hex")}`;
}

export function reportedRideFingerprintDisposition({
  acceptedFingerprint,
  actualFingerprint,
  acceptedTraversalPathFingerprint,
  actualTraversalPathFingerprint,
  acceptedDistanceMeters,
  actualDistanceMeters,
  distanceToleranceMeters = 10,
} = {}) {
  if (!acceptedFingerprint) return "unaccepted";
  if (acceptedFingerprint === actualFingerprint) return "accepted";
  const distanceDeltaMeters =
    Number(actualDistanceMeters) - Number(acceptedDistanceMeters);
  if (
    acceptedTraversalPathFingerprint &&
    acceptedTraversalPathFingerprint === actualTraversalPathFingerprint &&
    Number.isFinite(distanceDeltaMeters) &&
    Math.abs(distanceDeltaMeters) <= Number(distanceToleranceMeters)
  ) {
    return "safe-geometry-update-same-traversal";
  }
  return "changed";
}
