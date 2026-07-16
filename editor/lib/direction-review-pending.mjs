export function emptyDirectionReviewPendingApprovals() {
  return { schemaVersion: 1, items: {} };
}

export function normalizeDirectionReviewPendingApprovals(value) {
  const input = value || emptyDirectionReviewPendingApprovals();
  if (input.schemaVersion !== 1 || !input.items || typeof input.items !== "object" || Array.isArray(input.items)) {
    throw new Error("Direction Review pending approvals require schemaVersion 1 and an items object");
  }
  const items = {};
  for (const [key, item] of Object.entries(input.items)) {
    const segmentId = Number(item?.segmentId);
    if (!Number.isInteger(segmentId) || segmentId <= 0 || String(segmentId) !== String(key)) {
      throw new Error(`Pending Direction Review item ${key} has an invalid segmentId`);
    }
    if (!Array.isArray(item.edgeIds) || item.edgeIds.length === 0) {
      throw new Error(`Pending Direction Review item ${key} requires edgeIds`);
    }
    for (const field of [
      "segmentName",
      "sourceGeometryDigest",
      "reviewer",
      "reviewedAt",
      "batchId",
      "queuedAt",
    ]) {
      if (typeof item[field] !== "string" || !item[field].trim()) {
        throw new Error(`Pending Direction Review item ${key} requires ${field}`);
      }
    }
    items[key] = {
      segmentId,
      segmentName: item.segmentName.trim(),
      sourceGeometryDigest: item.sourceGeometryDigest.trim(),
      edgeIds: [...new Set(item.edgeIds.map(String))],
      alignmentMappingDigests: Object.fromEntries(
        Object.entries(item.alignmentMappingDigests || {})
          .filter(([alignmentKey, digest]) =>
            ["aToB", "bToA"].includes(alignmentKey) && typeof digest === "string" && digest,
          ),
      ),
      reviewer: item.reviewer.trim(),
      reviewedAt: item.reviewedAt.trim(),
      batchId: item.batchId.trim(),
      queuedAt: item.queuedAt.trim(),
      ...(item.lastAttemptAt ? { lastAttemptAt: String(item.lastAttemptAt) } : {}),
      ...(item.lastError ? { lastError: String(item.lastError) } : {}),
    };
  }
  return { schemaVersion: 1, items };
}

export function queueDirectionReviewPendingApproval(queue, item) {
  const next = normalizeDirectionReviewPendingApprovals(queue);
  const segmentId = Number(item?.segmentId);
  next.items[String(segmentId)] = {
    ...item,
    segmentId,
    edgeIds: [...new Set((item.edgeIds || []).map(String))],
  };
  return normalizeDirectionReviewPendingApprovals(next);
}

export function settleDirectionReviewPendingApprovals(
  queue,
  { completedSegmentIds = [], failures = [], attemptedAt },
) {
  const next = normalizeDirectionReviewPendingApprovals(queue);
  for (const segmentId of completedSegmentIds) delete next.items[String(Number(segmentId))];
  for (const failure of failures) {
    const item = next.items[String(Number(failure.segmentId))];
    if (!item) continue;
    item.lastAttemptAt = attemptedAt;
    item.lastError = String(failure.error || "Finalization failed");
  }
  return normalizeDirectionReviewPendingApprovals(next);
}
