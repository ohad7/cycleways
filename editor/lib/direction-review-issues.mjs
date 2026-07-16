export const DIRECTION_REVIEW_CLASSIFICATIONS = Object.freeze([
  "direction_evidence_needed",
  "invalid_existing",
  "single_direction_candidate",
  "unresolved",
]);

export const DIRECTION_REVIEW_CLASSIFICATION_LABELS = Object.freeze({
  direction_evidence_needed: "Direction evidence needed",
  invalid_existing: "Invalid existing mapping",
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
