const REVIEWED_STATES = new Set(["allowed", "prohibited", "conditional"]);

export const MANUAL_EDGE_DIRECTION_ORIGINS = Object.freeze({
  AUTHORING_DEFAULT: "manual-authoring-default",
  INHERITED_OSM: "inherited-osm-policy",
});

export function newManualEdgeBidirectionalTraversal({
  reviewer = "ohad",
  reviewedAt,
} = {}) {
  if (!reviewedAt) throw new Error("New manual edge direction requires a review date");
  return {
    forward: "allowed",
    reverse: "allowed",
    reviewed: true,
    reviewer,
    reviewedAt,
    rationale: "Curator-authored manual edge; bidirectional default",
    origin: MANUAL_EDGE_DIRECTION_ORIGINS.AUTHORING_DEFAULT,
  };
}

export function copiedManualEdgeTraversal(
  sourceTraversal,
  { reviewer = "ohad", reviewedAt, sourceEdgeId = "source edge" } = {},
) {
  const forward = sourceTraversal?.forward;
  const reverse = sourceTraversal?.reverse;
  if (!REVIEWED_STATES.has(forward) || !REVIEWED_STATES.has(reverse)) {
    return { forward: "unknown", reverse: "unknown", reviewed: false };
  }
  if (!reviewedAt) throw new Error("Copied manual edge direction requires a review date");
  return {
    forward,
    reverse,
    reviewed: true,
    reviewer,
    reviewedAt,
    rationale: `Inherited ${forward}/${reverse} direction policy from ${sourceEdgeId}`,
    origin: MANUAL_EDGE_DIRECTION_ORIGINS.INHERITED_OSM,
  };
}

export function manualEdgeDirectionDefaultLabel(traversal) {
  if (traversal?.origin === MANUAL_EDGE_DIRECTION_ORIGINS.AUTHORING_DEFAULT) {
    return "Bidirectional · default for manual edges";
  }
  if (traversal?.origin === MANUAL_EDGE_DIRECTION_ORIGINS.INHERITED_OSM) {
    return "Direction inherited from the copied OSM edge";
  }
  return null;
}
