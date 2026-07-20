const BLOCKING_CODES = new Set([
  "alignment_empty",
  "continuity_gap",
  "endpoint_zone_failure",
  "match_quality",
  "missing_edge",
  "stale_evidence",
]);

const ISSUE_LABELS = {
  alignment_empty: "No base-edge path",
  continuity_gap: "Disconnected base-edge sequence",
  endpoint_zone_failure: "Endpoint drift",
  match_quality: "Automatic match needs correction",
  missing_edge: "Referenced base edge is missing",
  stale_evidence: "Routing evidence is updating",
  non_allowed_traversal: "Base-edge direction or access needs review",
  directed_ownership_conflict: "Directed edge is already used by another segment",
  access_precedence: "CycleWays access decision needed",
  intentional_asymmetry: "Directional path decision needed",
  ambiguous_parallel_path: "Choose between valid paths",
  direction_validation: "Direction needs review",
};

function slotStatus(slot) {
  if (slot?.published?.disposition === "accepted") return "accepted";
  if (slot?.published?.disposition === "unavailable") return "unavailable";
  if (slot?.draft?.validation?.status === "valid") return "valid-draft";
  if (slot?.draft) return "invalid-draft";
  return "missing";
}

function recordForSlot(slot) {
  return slot?.published || slot?.draft || null;
}

function explicitRefs(record) {
  return record?.realization?.type === "explicit"
    ? record.realization.edgeRefs || []
    : [];
}

function draftReasons(segment) {
  return ["aToB", "bToA"].flatMap((alignmentKey) =>
    (segment?.alignments?.[alignmentKey]?.draft?.validation?.reasons || []).map((reason) => ({
      ...reason,
      alignmentKey,
    })),
  );
}

function policyPrecedence(segment) {
  return ["aToB", "bToA"].flatMap((alignmentKey) =>
    (segment?.alignments?.[alignmentKey]?.draft?.validation?.policyPrecedence || []).map((item) => ({
      ...item,
      alignmentKey,
      code: "access_precedence",
    })),
  );
}

function issueDetail(issue) {
  if (!issue) return "No valid directional alignment is available.";
  if (issue.code === "continuity_gap") {
    const distance = Number(issue.distanceMeters ?? issue.gapMeters);
    return `${issue.fromEdgeId || "edge"} → ${issue.toEdgeId || "edge"}${
      Number.isFinite(distance) ? ` (${Math.round(distance * 10) / 10} m)` : ""
    }`;
  }
  if (issue.code === "endpoint_zone_failure") {
    const distances = issue.distances || issue.endpointDistancesMeters || {};
    const start = Number(distances.start);
    const end = Number(distances.end);
    if (Number.isFinite(start) || Number.isFinite(end)) {
      return `${Number.isFinite(start) ? `${Math.round(start)} m start` : ""}${
        Number.isFinite(start) && Number.isFinite(end) ? " · " : ""
      }${Number.isFinite(end) ? `${Math.round(end)} m end` : ""}`;
    }
  }
  if (issue.edgeId) {
    return `${issue.edgeId}${issue.reason ? ` · ${issue.reason}` : ""}`;
  }
  return String(issue.reason || issue.message || issue.code || "Review required");
}

function mappingShape(segment) {
  const aRecord = recordForSlot(segment?.alignments?.aToB);
  const bRecord = recordForSlot(segment?.alignments?.bToA);
  const aRefs = explicitRefs(aRecord);
  const bRefs = explicitRefs(bRecord);
  const explicit = aRefs.length > 0 ? aRefs : bRefs;
  const reverseOf = aRecord?.realization?.type === "reverseOf" || bRecord?.realization?.type === "reverseOf";
  return {
    edgeCount: explicit.length || Math.max(aRefs.length, bRefs.length),
    symmetric: reverseOf || (aRefs.length > 0 && bRefs.length === 0) || (bRefs.length > 0 && aRefs.length === 0),
    twoExplicitPaths: aRefs.length > 0 && bRefs.length > 0,
  };
}

export function networkSegmentStatus(segment, { updating = false, transientIssue = null } = {}) {
  if (updating) {
    return {
      key: "updating",
      label: "Updating",
      summary: "Saving and checking the affected routing evidence…",
      issue: null,
      directional: false,
      edgeCount: 0,
    };
  }
  if (!segment) {
    const issue = transientIssue || { code: "alignment_empty" };
    return {
      key: "blocked",
      label: "Blocked",
      summary: ISSUE_LABELS[issue.code] || "No current routing alignment",
      detail: issueDetail(issue),
      issue,
      directional: false,
      edgeCount: 0,
    };
  }

  const aStatus = slotStatus(segment.alignments?.aToB);
  const bStatus = slotStatus(segment.alignments?.bToA);
  const shape = mappingShape(segment);
  const published = [aStatus, bStatus].filter((status) =>
    ["accepted", "unavailable"].includes(status),
  ).length;
  const accepted = [aStatus, bStatus].filter((status) => status === "accepted").length;
  const precedence = policyPrecedence(segment);
  const reasons = [...draftReasons(segment), ...precedence];
  const issue = transientIssue || reasons[0] || null;
  const hasDraft = Boolean(
    segment.alignments?.aToB?.draft || segment.alignments?.bToA?.draft,
  );

  if (published === 2 && accepted >= 1 && !transientIssue && !hasDraft) {
    const bidirectional = accepted === 2;
    return {
      key: "current",
      label: "Current",
      summary: bidirectional
        ? shape.twoExplicitPaths && !shape.symmetric
          ? `Two directional paths · ${shape.edgeCount} base edges`
          : `Bidirectional · ${shape.edgeCount} base edges`
        : `One direction available · ${shape.edgeCount} base edges`,
      issue: null,
      directional: !bidirectional || (shape.twoExplicitPaths && !shape.symmetric),
      edgeCount: shape.edgeCount,
    };
  }

  const validDrafts = [aStatus, bStatus].filter((status) => status === "valid-draft").length;
  const blocked = Boolean(issue && BLOCKING_CODES.has(String(issue.code || "")));
  return {
    key: blocked ? "blocked" : "needs-decision",
    label: blocked ? "Blocked" : "Needs a decision",
    summary: ISSUE_LABELS[issue?.code] || (validDrafts > 0 ? "Review the proposed rideable path" : "Directional mapping needs review"),
    detail: issueDetail(issue),
    issue,
    directional: true,
    edgeCount: shape.edgeCount,
  };
}

export function networkSegmentNeedsDirections(segment, options) {
  return networkSegmentStatus(segment, options).directional;
}

export function buildNetworkIssueRows(overlay, { transientBySegmentId = new Map() } = {}) {
  return Object.values(overlay?.segments || {})
    .map((segment) => {
      const status = networkSegmentStatus(segment, {
        transientIssue: transientBySegmentId.get(Number(segment.segmentId)) || null,
      });
      return {
        segmentId: Number(segment.segmentId),
        segmentName: String(segment.segmentName || segment.segmentId),
        status,
      };
    })
    .filter((row) => row.status.key !== "current")
    .sort((left, right) => left.segmentId - right.segmentId);
}
