export const BICYCLE_TRAVERSAL_STATES = Object.freeze([
  "allowed",
  "prohibited",
  "conditional",
  "unknown",
]);

function directionFor(fromDistance, toDistance) {
  return Number(toDistance) < Number(fromDistance) ? "reverse" : "forward";
}

export function bicycleTraversalVerdict(edge, fromDistance, toDistance, policy = {}) {
  const distanceMeters = Math.abs(Number(toDistance) - Number(fromDistance));
  const direction = directionFor(fromDistance, toDistance);
  if (!Number.isFinite(distanceMeters)) {
    return {
      allowed: false,
      state: "unknown",
      direction,
      reason: "invalid-traversal-distance",
      policyId: policy.policyId || null,
      policyDigest: policy.policyDigest || null,
    };
  }
  if (distanceMeters <= 0.01) {
    return {
      allowed: true,
      state: "allowed",
      direction,
      reason: "zero-length-endpoint",
      policyId: policy.policyId || edge?.bicycleTraversal?.policyId || null,
      policyDigest: policy.policyDigest || edge?.bicycleTraversal?.policyDigest || null,
    };
  }

  const traversal = edge?.bicycleTraversal;
  if (!traversal) {
    return {
      allowed: policy.strict !== true,
      state: policy.strict === true ? "unknown" : "allowed",
      direction,
      reason: policy.strict === true ? "missing-traversal-policy" : "legacy-policy-fallback",
      policyId: policy.policyId || null,
      policyDigest: policy.policyDigest || null,
    };
  }
  if (
    (policy.policyId && traversal.policyId && policy.policyId !== traversal.policyId) ||
    (policy.policyDigest && traversal.policyDigest && policy.policyDigest !== traversal.policyDigest)
  ) {
    return {
      allowed: false,
      state: "unknown",
      direction,
      reason: "routing-policy-mismatch",
      policyId: policy.policyId || null,
      policyDigest: policy.policyDigest || null,
    };
  }
  const state = BICYCLE_TRAVERSAL_STATES.includes(traversal[direction])
    ? traversal[direction]
    : "unknown";
  return {
    allowed: state === "allowed",
    state,
    direction,
    reason:
      traversal[`${direction}Reason`] ||
      (state === "unknown" ? "missing-traversal-state" : "normalized-policy"),
    policyId: traversal.policyId || policy.policyId || null,
    policyDigest: traversal.policyDigest || policy.policyDigest || null,
  };
}

export function validateTraversalSlices(traversals, policy = {}) {
  const violations = [];
  for (const [index, traversal] of (traversals || []).entries()) {
    const verdict = bicycleTraversalVerdict(
      traversal.edge,
      traversal.fromDistance,
      traversal.toDistance,
      policy,
    );
    if (!verdict.allowed) {
      violations.push({
        index,
        edgeId: traversal.edge?.id || null,
        edgeShareId: traversal.edge?.shareId || null,
        fromDistance: traversal.fromDistance,
        toDistance: traversal.toDistance,
        ...verdict,
      });
    }
  }
  return { ok: violations.length === 0, violations };
}
