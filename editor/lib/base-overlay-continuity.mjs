function normalizedGap(gap) {
  if (!gap || typeof gap !== "object") return null;
  return {
    fromEdgeId: String(gap.fromEdgeId || "unknown edge"),
    toEdgeId: String(gap.toEdgeId || "unknown edge"),
    distanceMeters: Number.isFinite(Number(gap.distanceMeters))
      ? Number(gap.distanceMeters)
      : null,
  };
}

export function baseOverlayContinuityIssue(match, reviewedGaps = []) {
  const preferredGaps = Array.isArray(reviewedGaps) && reviewedGaps.length > 0
    ? reviewedGaps
    : Array.isArray(match?.continuityGaps)
      ? match.continuityGaps
      : [];
  const gaps = preferredGaps.map(normalizedGap).filter(Boolean);
  const declaredCount = Number(match?.continuityGapCount || 0);
  const count = Math.max(gaps.length, Number.isFinite(declaredCount) ? declaredCount : 0);
  if (count === 0) return null;

  const shown = gaps.slice(0, 2).map((gap) => {
    const distance = gap.distanceMeters === null ? "unknown distance" : `${Math.round(gap.distanceMeters)} m`;
    return `${gap.fromEdgeId} → ${gap.toEdgeId} (${distance})`;
  });
  const hiddenCount = Math.max(0, count - shown.length);
  const detail = shown.length > 0
    ? `${shown.join("; ")}${hiddenCount > 0 ? `; +${hiddenCount} more` : ""}`
    : `${count} calculated continuity ${count === 1 ? "gap" : "gaps"}`;

  return {
    count,
    gaps,
    summary: `${count} continuity ${count === 1 ? "gap" : "gaps"}`,
    detail,
  };
}

export function recalculationResultMessage(segmentName, summary, formatCoverage) {
  const coverage = formatCoverage(summary?.coverageRatio);
  const confidence = summary?.confidence || "unknown confidence";
  const coverageGapCount = Number(summary?.gapCount || 0);
  const prefix = `Recalculated ${segmentName}: ${coverage} coverage · ${confidence} · ${coverageGapCount} coverage ${
    coverageGapCount === 1 ? "gap" : "gaps"
  }`;
  const continuity = baseOverlayContinuityIssue(summary);
  if (!continuity) return { message: `${prefix}.`, level: "info", continuity: null };
  return {
    message: `${prefix} · ${continuity.summary}. Cannot apply this mapping: ${continuity.detail}. Connect the base edges and recalculate.`,
    level: "error",
    continuity,
  };
}
