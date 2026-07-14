const ALIGNMENT_KEYS = ["aToB", "bToA"];

function coordinate(value, label) {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    !Number.isFinite(Number(value[0])) ||
    !Number.isFinite(Number(value[1]))
  ) {
    throw new Error(`${label} must be a [lng, lat] coordinate`);
  }
}

export function normalizeDirectionReviewWorkspace(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Direction Review workspace must be an object");
  }
  if (value.schemaVersion !== 1) {
    throw new Error("Direction Review workspace requires schemaVersion 1");
  }
  if (!Number.isInteger(value.nextReservedSegmentId) || value.nextReservedSegmentId <= 0) {
    throw new Error("Direction Review workspace has invalid nextReservedSegmentId");
  }
  const entries = value.entries;
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    throw new Error("Direction Review workspace entries must be an object");
  }
  const ids = new Set();
  for (const [key, entry] of Object.entries(entries)) {
    if (!entry || !Number.isInteger(entry.segmentId) || String(entry.segmentId) !== key) {
      throw new Error(`Direction Review workspace entry ${key} has a mismatched segmentId`);
    }
    if (ids.has(entry.segmentId)) throw new Error(`duplicate reserved segment ID ${entry.segmentId}`);
    ids.add(entry.segmentId);
    if (!["new", "existing-replacement"].includes(entry.kind)) {
      throw new Error(`workspace entry ${key} has invalid kind`);
    }
    if (entry.status !== "draft") {
      throw new Error(`workspace entry ${key} must remain draft until atomic activation`);
    }
    const feature = entry.logicalFeatureDraft;
    if (!feature || feature.type !== "Feature" || feature.geometry?.type !== "LineString") {
      throw new Error(`workspace entry ${key} is missing a logical LineString draft`);
    }
    if (!Array.isArray(feature.geometry.coordinates) || feature.geometry.coordinates.length < 2) {
      throw new Error(`workspace entry ${key} logical geometry is incomplete`);
    }
    feature.geometry.coordinates.forEach((value, index) =>
      coordinate(value, `workspace entry ${key} coordinate ${index}`),
    );
    if (Number(feature.properties?.id) !== entry.segmentId) {
      throw new Error(`workspace entry ${key} logical feature ID does not match`);
    }
    for (const alignmentKey of ALIGNMENT_KEYS) {
      const draft = entry.alignmentDrafts?.[alignmentKey];
      if (!draft || draft.disposition !== "needs_review") {
        throw new Error(`workspace entry ${key} ${alignmentKey} must have a review draft`);
      }
    }
  }
  return structuredClone(value);
}

export function reserveWorkspaceSegment(workspace, logicalFeatureDraft, { kind = "new" } = {}) {
  const next = normalizeDirectionReviewWorkspace(workspace);
  const segmentId = Number(logicalFeatureDraft?.properties?.id || next.nextReservedSegmentId);
  if (!Number.isInteger(segmentId) || segmentId <= 0 || next.entries[String(segmentId)]) {
    throw new Error(`cannot reserve segment ID ${segmentId}`);
  }
  const feature = structuredClone(logicalFeatureDraft);
  feature.properties = { ...(feature.properties || {}), id: segmentId, status: "draft" };
  next.entries[String(segmentId)] = {
    segmentId,
    kind,
    status: "draft",
    logicalFeatureDraft: feature,
    alignmentDrafts: {
      aToB: { disposition: "needs_review", realization: null, validation: { status: "pending" } },
      bToA: { disposition: "needs_review", realization: null, validation: { status: "pending" } },
    },
  };
  next.nextReservedSegmentId = Math.max(next.nextReservedSegmentId, segmentId + 1);
  return { workspace: normalizeDirectionReviewWorkspace(next), segmentId };
}

export function activationReadiness(entry) {
  const reasons = [];
  for (const alignmentKey of ALIGNMENT_KEYS) {
    const draft = entry?.alignmentDrafts?.[alignmentKey];
    if (!draft || !["accepted", "unavailable"].includes(draft.reviewedDisposition)) {
      reasons.push(`${alignmentKey}:review_required`);
    }
    if (draft?.reviewedDisposition === "accepted" && draft.validation?.status !== "valid") {
      reasons.push(`${alignmentKey}:validation_required`);
    }
  }
  if (!ALIGNMENT_KEYS.some((key) => entry?.alignmentDrafts?.[key]?.reviewedDisposition === "accepted")) {
    reasons.push("at_least_one_accepted_alignment_required");
  }
  return { ready: reasons.length === 0, reasons };
}

export function cancelWorkspaceEntry(workspace, segmentId) {
  const next = normalizeDirectionReviewWorkspace(workspace);
  if (!next.entries[String(segmentId)]) return next;
  delete next.entries[String(segmentId)];
  return normalizeDirectionReviewWorkspace(next);
}
