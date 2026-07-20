const BLOCKING_VALIDATION_CODES = new Set([
  "alignment_empty",
  "continuity_gap",
  "endpoint_zone_failure",
  "missing_edge",
  "stale_evidence",
]);

export function reverseDirectedEdgeRefs(refs) {
  return [...(refs || [])]
    .sort((left, right) => Number(left.sequenceIndex ?? 0) - Number(right.sequenceIndex ?? 0))
    .reverse()
    .map((ref, sequenceIndex) => ({
      ...ref,
      edgeId: String(ref.edgeId || ""),
      direction: ref.direction === "reverse" ? "forward" : "reverse",
      sequenceIndex,
      fromFraction: Number(ref.fromFraction ?? 0),
      toFraction: Number(ref.toFraction ?? 1),
    }));
}

export function automaticMatchQualityEligible(match) {
  return Boolean(
    match?.failureClass === "accepted" &&
      match?.reviewStatus === "auto_accept_candidate" &&
      match?.confidence === "high" &&
      Number(match?.coverageRatio) >= 0.999 &&
      Number(match?.gapCount) === 0 &&
      Number(match?.overmatchedEdgeCount || 0) === 0 &&
      match?.reviewStatus !== "inspect_edge_sequence",
  );
}

function validationReasons(validation) {
  return Array.isArray(validation?.reasons) ? validation.reasons : [];
}

function firstReason(validation) {
  return validationReasons(validation)[0] || null;
}

function validationBlocked(validation) {
  return validationReasons(validation).some((reason) =>
    BLOCKING_VALIDATION_CODES.has(String(reason?.code || "")),
  );
}

function precedenceCount(validation) {
  return Array.isArray(validation?.policyPrecedence)
    ? validation.policyPrecedence.length
    : 0;
}

/**
 * Decide whether a proposed pair is safe to apply without another curator
 * action. Validation is produced by the same endpoint/continuity/policy/
 * ownership validator used by Direction Review.
 */
export function automaticBidirectionalDecision({
  intent = "automatic-match",
  match = null,
  forwardValidation,
  reverseValidation,
  intentionalAsymmetry = false,
  competingPathCount = 0,
  roundaboutRepair = null,
} = {}) {
  if (intent === "automatic-match" && !automaticMatchQualityEligible(match)) {
    return {
      outcome: "blocked",
      code: "match_quality",
      message: "The automatic match does not meet the full-coverage confidence gate.",
    };
  }
  if (intentionalAsymmetry) {
    return {
      outcome: "needs-decision",
      code: "intentional_asymmetry",
      message: "This segment already has intentionally different directional paths.",
    };
  }
  if (Number(competingPathCount) > 1) {
    return {
      outcome: "needs-decision",
      code: "ambiguous_parallel_path",
      message: "More than one materially different valid path is available.",
    };
  }
  if (precedenceCount(forwardValidation) + precedenceCount(reverseValidation) > 0) {
    return {
      outcome: "needs-decision",
      code: "access_precedence",
      message: "This mapping needs an explicit CycleWays access-precedence decision.",
    };
  }
  if (!forwardValidation?.ok || !reverseValidation?.ok) {
    const failing = !forwardValidation?.ok ? forwardValidation : reverseValidation;
    const reason = firstReason(failing);
    return {
      outcome: validationBlocked(failing) ? "blocked" : "needs-decision",
      code: String(reason?.code || "direction_validation"),
      message: String(reason?.reason || reason?.code || "A direction does not pass validation."),
      reason,
    };
  }
  return {
    outcome: "apply",
    code: roundaboutRepair ? "unique_roundabout_reverse" : "exact_safe_reverse",
    message: roundaboutRepair
      ? "Applied the path and its uniquely repaired legal roundabout reverse."
      : "Applied the path and its mechanically validated exact reverse.",
  };
}

export function automaticAcceptanceBasis({ intent, roundaboutRepair } = {}) {
  if (roundaboutRepair) return "automatic-roundabout-reverse";
  if (intent === "migration-safe") return "automatic-bidirectional-evidence";
  return intent === "explicit-selection"
    ? "explicit-authoring-safe-reverse"
    : "automatic-bidirectional-match";
}
