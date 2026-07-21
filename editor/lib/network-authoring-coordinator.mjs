export const SOURCE_REVISION_SUPERSEDED = "SOURCE_REVISION_SUPERSEDED";
export const BASE_EVIDENCE_SUPERSEDED = "BASE_EVIDENCE_SUPERSEDED";
export const AUTHORING_REQUEST_ABORTED = "AUTHORING_REQUEST_ABORTED";

export function bumpAuthoringObjectRevision(revisions, objectId) {
  const key = String(objectId);
  const revision = Number(revisions.get(key) || 0) + 1;
  revisions.set(key, revision);
  return revision;
}

export function authoringObjectRevision(revisions, objectId) {
  return Number(revisions.get(String(objectId)) || 0);
}

export function isCurrentAuthoringObjectRevision(revisions, objectId, revision) {
  return authoringObjectRevision(revisions, objectId) === Number(revision);
}

export function isRetryableAuthoringConflict(error, { locallySuperseded = false } = {}) {
  if (error?.code === BASE_EVIDENCE_SUPERSEDED) return true;
  return error?.code === SOURCE_REVISION_SUPERSEDED && locallySuperseded;
}

export function isAuthoringAbort(error) {
  return error?.name === "AbortError" || error?.code === AUTHORING_REQUEST_ABORTED;
}

export function authoringSourceIsCurrent({
  currentRevision,
  snapshotRevision,
  currentSerializedSource,
  snapshotSerializedSource,
}) {
  return Number(currentRevision) === Number(snapshotRevision)
    && currentSerializedSource === snapshotSerializedSource;
}

export function mergeBaseGraphFeaturePatch(graphEdges, patch) {
  if (!graphEdges || !patch || !Array.isArray(patch.features)) return graphEdges;
  const replaceSources = new Set(
    (Array.isArray(patch.replaceSources) ? patch.replaceSources : [])
      .map(String),
  );
  const replacementIds = new Set(
    patch.features
      .map((feature) => String(feature?.properties?.edgeId || feature?.properties?.id || feature?.id || ""))
      .filter(Boolean),
  );
  const retained = (graphEdges.features || []).filter((feature) => {
    const properties = feature?.properties || {};
    const edgeId = String(properties.edgeId || properties.id || feature?.id || "");
    if (replacementIds.has(edgeId)) return false;
    return !replaceSources.has(String(properties.source || "osm"));
  });
  return {
    ...graphEdges,
    metadata: {
      ...(graphEdges.metadata || {}),
      ...(patch.metadata || {}),
    },
    features: [...retained, ...patch.features],
  };
}

export function summarizeAuthoringTimings(timings) {
  const rows = Array.isArray(timings) ? timings : [];
  const totalMs = rows.reduce((total, row) => total + Math.max(0, Number(row?.durationMs) || 0), 0);
  const slowest = rows.reduce(
    (current, row) =>
      !current || Number(row?.durationMs || 0) > Number(current?.durationMs || 0) ? row : current,
    null,
  );
  return {
    totalMs: Math.round(totalMs),
    slowestStage: slowest?.stage || null,
    slowestDurationMs: Math.round(Number(slowest?.durationMs) || 0),
  };
}
