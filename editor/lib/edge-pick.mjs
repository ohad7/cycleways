// Pure helpers for edge-picked CW segment creation.
// No imports from editor.js; all dependencies are passed as arguments.

/**
 * Stitch a LineString coordinate array from an ordered EdgeRef list.
 * - edgeRefs: { edgeId, direction, sequenceIndex }[] (already normalized).
 * - edgeLookup: Map<edgeIdString, { coordinates: [lng, lat][] }>
 *
 * Edges with direction === "reverse" have their coordinates reversed before
 * concatenation. Shared endpoints between consecutive edges are deduplicated
 * (the duplicated start of the next edge is dropped).
 *
 * Missing edges contribute nothing; the caller is responsible for validating
 * the lookup is complete.
 */
export function stitchCoordsFromEdgeRefs(edgeRefs, edgeLookup) {
  const result = [];
  for (const ref of edgeRefs || []) {
    const edge = edgeLookup.get(String(ref.edgeId));
    if (!edge?.coordinates?.length) continue;
    const coords = ref.direction === "reverse"
      ? [...edge.coordinates].reverse()
      : edge.coordinates;
    if (result.length === 0) {
      result.push(...coords.map((c) => c.slice()));
      continue;
    }
    const tail = result[result.length - 1];
    const head = coords[0];
    const dedup = tail[0] === head[0] && tail[1] === head[1];
    for (let i = dedup ? 1 : 0; i < coords.length; i++) {
      result.push(coords[i].slice());
    }
  }
  return result;
}

/**
 * Validate an edge-picked overlay mapping. Returns:
 *   { ok: true } on success, or
 *   { ok: false, failureClass, message, gaps?, conflicts? } on failure.
 *
 * Inputs:
 *   - segmentId: number of the segment being validated (used to exclude itself
 *     from the conflict check).
 *   - edgeRefs: ordered EdgeRef list.
 *   - acceptedMappings: Map<edgeIdString, { segmentId, segmentName }> built
 *     from the current overlay (only accepted_edge_set / accepted_auto_match
 *     mappings should be included by the caller).
 *   - continuityGaps: pre-computed gaps from editor.js' edgeRefContinuityGaps.
 */
export function validateEdgePickMapping({ segmentId, edgeRefs, acceptedMappings, continuityGaps }) {
  if (!edgeRefs || edgeRefs.length === 0) {
    return {
      ok: false,
      failureClass: "edge_pick_empty",
      message: "Pick at least one base edge before saving.",
    };
  }

  const gaps = (continuityGaps || []).slice();
  if (gaps.length > 0) {
    return {
      ok: false,
      failureClass: "edge_pick_gap",
      message: `Gap between edge ${gaps[0].sequenceIndex} and ${gaps[0].sequenceIndex + 1} (${Math.round(gaps[0].distanceMeters)}m).`,
      gaps,
    };
  }

  const conflicts = [];
  for (const ref of edgeRefs) {
    const owner = acceptedMappings.get(String(ref.edgeId));
    if (owner && Number(owner.segmentId) !== Number(segmentId)) {
      conflicts.push({ edgeId: String(ref.edgeId), segmentId: owner.segmentId, segmentName: owner.segmentName });
    }
  }
  if (conflicts.length > 0) {
    return {
      ok: false,
      failureClass: "edge_pick_conflict",
      message: `Edge ${conflicts[0].edgeId} is already owned by segment ${conflicts[0].segmentName || conflicts[0].segmentId}.`,
      conflicts,
    };
  }

  return { ok: true };
}

const ACCEPTED_STATUSES = new Set(["accepted_edge_set", "accepted_auto_match"]);

/**
 * Find an accepted overlay mapping (other than excludeSegmentId) that already
 * references this edgeId. Returns { segmentId, segmentName } or null.
 *
 * Mappings with status outside ACCEPTED_STATUSES (e.g. needs_edit) are not
 * considered committed owners and do not produce a conflict.
 */
export function conflictingSegmentForEdge(edgeId, excludeSegmentId, overlaySegments) {
  const target = String(edgeId);
  for (const mapping of Object.values(overlaySegments || {})) {
    if (!mapping || !ACCEPTED_STATUSES.has(mapping.status)) continue;
    if (Number(mapping.segmentId) === Number(excludeSegmentId)) continue;
    if (!Array.isArray(mapping.edgeRefs)) continue;
    if (mapping.edgeRefs.some((ref) => String(ref.edgeId) === target)) {
      return { segmentId: mapping.segmentId, segmentName: mapping.segmentName };
    }
  }
  return null;
}
