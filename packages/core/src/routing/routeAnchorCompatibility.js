import { canonicalSha256 } from "../utils/canonicalHash.js";

function normalizedSpan(span) {
  if (span?.type === "cw") {
    return {
      type: "cw",
      segmentId: Number(span.segmentId),
      reversed: span.reversed === true,
    };
  }
  if (span?.type === "cwChain") {
    return {
      type: "cwChain",
      runs: (span.runs || []).map((run) => ({
        segmentId: Number(run.segmentId),
        reversed: run.reversed === true,
        startIndex: Number(run.startIndex),
        edgeCount: Number(run.edgeCount),
      })),
    };
  }
  const edgeShareIds = (span?.edgeShareIds || span?.edges || []).map(Number);
  return {
    type: "base",
    edgeShareIds,
    directions: edgeShareIds.map((_, index) =>
      span?.directions?.[index] === "reverse" || span?.directions?.[index] === 1
        ? "reverse"
        : "forward",
    ),
  };
}

export function historicalRouteIntentKey(payload) {
  const routePoints = (payload?.routePoints || []).map((point) => ({
    edgeShareId: Number(point?.baseEdgeShareId ?? point?.edgeShareId),
    edgeFractionQ: Math.round(
      Math.max(0, Math.min(1, Number(point?.baseEdgeFraction ?? point?.edgeFraction) || 0)) *
        1_000_000,
    ),
  }));
  if (routePoints.length < 2) return null;
  return `sha256-${canonicalSha256({
    routePoints,
    spans: (payload?.spans || []).map(normalizedSpan),
  })}`;
}
