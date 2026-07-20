export const DIRECTION_REVIEW_CLASSIFICATIONS = Object.freeze([
  "direction_evidence_needed",
  "invalid_existing",
  "roundabout_reverse_candidate",
  "single_direction_candidate",
  "unresolved",
]);

export const DIRECTION_REVIEW_CLASSIFICATION_LABELS = Object.freeze({
  direction_evidence_needed: "Direction evidence needed",
  invalid_existing: "Invalid existing mapping",
  roundabout_reverse_candidate: "Roundabout reverse ready",
  single_direction_candidate: "Single-direction candidate",
  unresolved: "Unresolved",
  accepted: "Accepted",
});

function decided(slot) {
  return slot?.published?.disposition === "accepted" ||
    slot?.published?.disposition === "unavailable";
}

export function directionReviewSegmentResolved(segment) {
  return ["aToB", "bToA"].every((alignmentKey) => decided(segment?.alignments?.[alignmentKey]));
}

function blockingReasons(segment) {
  return ["aToB", "bToA"].flatMap((alignmentKey) =>
    (segment?.alignments?.[alignmentKey]?.draft?.validation?.reasons || []).map((reason) => ({
      ...reason,
      alignmentKey,
    })),
  );
}

export function manualBidirectionalResolutionCandidate(segment) {
  const reasons = blockingReasons(segment);
  const manualReasons = reasons.filter(
    (reason) =>
      reason?.code === "non_allowed_traversal" &&
      reason?.state === "unknown" &&
      reason?.reason === "manual-unreviewed" &&
      reason?.edgeId,
  );
  const otherReasons = reasons.filter((reason) => !manualReasons.includes(reason));
  const edgeIds = [...new Set(manualReasons.map((reason) => String(reason.edgeId)))];
  return {
    eligible:
      !directionReviewSegmentResolved(segment) &&
      segment?.migration?.classification === "direction_evidence_needed" &&
      edgeIds.length > 0 &&
      otherReasons.length === 0,
    edgeIds,
    otherReasons,
  };
}

function manualEdgeId(feature) {
  return String(
    feature?.properties?.manualEdgeId ||
    feature?.properties?.id ||
    feature?.id ||
    "",
  );
}

export function applyManualBidirectionalReview(
  manualBaseEdges,
  { edgeIds, reviewer, reviewedAt, rationale, evidence = "", updatedAt },
) {
  if (manualBaseEdges?.type !== "FeatureCollection" || !Array.isArray(manualBaseEdges.features)) {
    throw new Error("Manual base edges must be a FeatureCollection");
  }
  for (const [field, value] of Object.entries({ reviewer, reviewedAt, rationale, updatedAt })) {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`Bidirectional manual-edge review requires ${field}`);
    }
  }
  const targets = new Set((edgeIds || []).map(String));
  if (targets.size === 0) throw new Error("No manual edges were selected for review");
  const found = new Set();
  const updatedEdgeIds = [];
  const alreadyAllowedEdgeIds = [];
  const features = manualBaseEdges.features.map((feature) => {
    const edgeId = manualEdgeId(feature);
    if (!targets.has(edgeId)) return feature;
    found.add(edgeId);
    const traversal = feature?.properties?.bicycleTraversal || {};
    const alreadyAllowed =
      traversal.reviewed === true &&
      traversal.forward === "allowed" &&
      traversal.reverse === "allowed";
    if (alreadyAllowed) {
      alreadyAllowedEdgeIds.push(edgeId);
      return feature;
    }
    const unknown =
      (traversal.forward || "unknown") === "unknown" &&
      (traversal.reverse || "unknown") === "unknown";
    if (!unknown) {
      throw new Error(
        `${edgeId} now has ${traversal.forward || "unknown"}/${traversal.reverse || "unknown"} evidence`,
      );
    }
    updatedEdgeIds.push(edgeId);
    return {
      ...feature,
      properties: {
        ...(feature.properties || {}),
        updatedAt: updatedAt.trim(),
        bicycleTraversal: {
          forward: "allowed",
          reverse: "allowed",
          reviewed: true,
          reviewer: reviewer.trim(),
          reviewedAt: reviewedAt.trim(),
          rationale: rationale.trim(),
          ...(typeof evidence === "string" && evidence.trim()
            ? { evidence: evidence.trim() }
            : {}),
        },
      },
    };
  });
  const missingEdgeIds = [...targets].filter((edgeId) => !found.has(edgeId));
  if (missingEdgeIds.length > 0) {
    throw new Error(`Missing manual base edges: ${missingEdgeIds.join(", ")}`);
  }
  return {
    manualBaseEdges: { ...manualBaseEdges, features },
    updatedEdgeIds,
    alreadyAllowedEdgeIds,
  };
}

export function buildDirectionReviewIssueRows(overlay) {
  return Object.values(overlay?.segments || {})
    .map((segment) => {
      const resolved = directionReviewSegmentResolved(segment);
      const classification = resolved
        ? "accepted"
        : String(segment?.migration?.classification || "unresolved");
      const reasons = blockingReasons(segment);
      return {
        segmentId: Number(segment.segmentId),
        segmentName: String(segment.segmentName || segment.segmentId),
        classification,
        resolved,
        reasons,
        blockingEdgeIds: [...new Set(reasons.map((reason) => reason.edgeId).filter(Boolean).map(String))],
        alignmentStatuses: Object.fromEntries(
          ["aToB", "bToA"].map((alignmentKey) => {
            const slot = segment.alignments?.[alignmentKey];
            return [alignmentKey, slot?.published?.disposition || slot?.draft?.validation?.status || "unreviewed"];
          }),
        ),
      };
    })
    .sort((left, right) => {
      if (left.resolved !== right.resolved) return left.resolved ? 1 : -1;
      const leftOrder = DIRECTION_REVIEW_CLASSIFICATIONS.indexOf(left.classification);
      const rightOrder = DIRECTION_REVIEW_CLASSIFICATIONS.indexOf(right.classification);
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.segmentId - right.segmentId;
    });
}

export function buildDirectionReviewEvidenceRows(overlay) {
  const edges = new Map();
  for (const row of buildDirectionReviewIssueRows(overlay).filter((item) => !item.resolved)) {
    for (const reason of row.reasons) {
      if (!reason.edgeId || reason.reason !== "manual-unreviewed") continue;
      const edgeId = String(reason.edgeId);
      const entry = edges.get(edgeId) || {
        edgeId,
        state: reason.state || "unknown",
        reason: reason.reason,
        dependencies: [],
      };
      if (!entry.dependencies.some(
        (dependency) =>
          dependency.segmentId === row.segmentId && dependency.alignmentKey === reason.alignmentKey,
      )) {
        entry.dependencies.push({
          segmentId: row.segmentId,
          segmentName: row.segmentName,
          alignmentKey: reason.alignmentKey,
          classification: row.classification,
        });
      }
      edges.set(edgeId, entry);
    }
  }
  return [...edges.values()]
    .map((entry) => ({
      ...entry,
      segmentCount: new Set(entry.dependencies.map((dependency) => dependency.segmentId)).size,
    }))
    .sort((left, right) =>
      right.segmentCount - left.segmentCount || left.edgeId.localeCompare(right.edgeId),
    );
}

export function filterDirectionReviewRows(rows, { filter = "issues", query = "" } = {}) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  return (rows || []).filter((row) => {
    if (filter === "issues" && row.resolved) return false;
    if (filter === "accepted" && !row.resolved) return false;
    if (!["all", "issues", "accepted"].includes(filter) && row.classification !== filter) return false;
    if (!normalizedQuery) return true;
    return [row.segmentId, row.segmentName, row.classification, ...(row.blockingEdgeIds || [])]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });
}

export function filterDirectionReviewEvidenceRows(rows, query = "") {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) return rows || [];
  return (rows || []).filter((row) =>
    [
      row.edgeId,
      row.reason,
      ...row.dependencies.flatMap((dependency) => [
        dependency.segmentId,
        dependency.segmentName,
      ]),
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery),
  );
}
