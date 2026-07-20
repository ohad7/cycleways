export const SOURCE_REVISION_SUPERSEDED = "SOURCE_REVISION_SUPERSEDED";
export const BASE_EVIDENCE_SUPERSEDED = "BASE_EVIDENCE_SUPERSEDED";

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
