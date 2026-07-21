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
 *   - currentMappings: Map<edgeIdString, { segmentId, segmentName }> built
 *     from the current overlay (only accepted_edge_set / accepted_auto_match
 *     mappings should be included by the caller).
 *   - continuityGaps: pre-computed gaps from editor.js' edgeRefContinuityGaps.
 */
export function validateEdgePickMapping({ segmentId, edgeRefs, currentMappings, continuityGaps }) {
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
    const owner = currentMappings.get(String(ref.edgeId));
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

// V1 compatibility names. Both represent a current mapping; neither is a
// curator-facing acceptance step in the consolidated Network workflow.
export const V1_CURRENT_MAPPING_STATUSES = new Set([
  "accepted_edge_set",
  "accepted_auto_match",
]);

export function isCurrentV1Mapping(mapping) {
  return Boolean(mapping && V1_CURRENT_MAPPING_STATUSES.has(mapping.status));
}

/**
 * Find a current overlay mapping (other than excludeSegmentId) that already
 * references this edgeId. Returns { segmentId, segmentName } or null.
 *
 * Mappings with a non-current status (e.g. needs_edit) are not
 * considered committed owners and do not produce a conflict.
 */
function edgeEndpoints(edge, direction) {
  const coords = edge?.coordinates;
  if (!coords?.length) return null;
  const oriented = direction === "reverse" ? [...coords].reverse() : coords;
  return { start: oriented[0], end: oriented[oriented.length - 1] };
}

function endpointDistanceSq(a, b) {
  if (!a || !b) return Infinity;
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

/**
 * Append a new EdgeRef to an existing chain, choosing orientation(s) to
 * minimize the gap between the chain's last endpoint and the new edge's
 * first endpoint.
 *
 * - chainRefs.length === 0: new edge becomes forward.
 * - chainRefs.length === 1: all 4 orientation combos of (chain[0], newEdge)
 *   are tried; the pair with smallest gap wins, possibly flipping chain[0].
 *   This handles the common case where the first edge's orientation was a
 *   guess and the second click reveals which end matters.
 * - chainRefs.length >= 2: existing orientations are locked (so earlier
 *   neighbours stay valid); the new edge is oriented to minimize the gap
 *   from the chain's last oriented endpoint.
 *
 * Returns a fresh array of EdgeRefs with sequenceIndex re-assigned 0..N.
 * Missing geometry in edgeLookup degrades gracefully to direction: "forward".
 */
export function orientAppendedEdgeRef(chainRefs, newEdge, edgeLookup) {
  const refs = (chainRefs || []).slice();
  const finalize = (arr) => arr.map((ref, i) => ({ ...ref, sequenceIndex: i }));

  if (refs.length === 0) {
    return finalize([{ ...newEdge, direction: "forward" }]);
  }

  const newGeom = edgeLookup.get(String(newEdge.edgeId));
  if (!newGeom?.coordinates?.length) {
    return finalize([...refs, { ...newEdge, direction: "forward" }]);
  }

  if (refs.length === 1) {
    const firstGeom = edgeLookup.get(String(refs[0].edgeId));
    if (!firstGeom?.coordinates?.length) {
      return finalize([...refs, { ...newEdge, direction: "forward" }]);
    }
    let best = null;
    for (const firstDir of ["forward", "reverse"]) {
      const firstEnds = edgeEndpoints(firstGeom, firstDir);
      for (const newDir of ["forward", "reverse"]) {
        const newEnds = edgeEndpoints(newGeom, newDir);
        const gap = endpointDistanceSq(firstEnds.end, newEnds.start);
        if (best === null || gap < best.gap) {
          best = { firstDir, newDir, gap };
        }
      }
    }
    return finalize([
      { ...refs[0], direction: best.firstDir },
      { ...newEdge, direction: best.newDir },
    ]);
  }

  const lastRef = refs[refs.length - 1];
  const lastGeom = edgeLookup.get(String(lastRef.edgeId));
  if (!lastGeom?.coordinates?.length) {
    return finalize([...refs, { ...newEdge, direction: "forward" }]);
  }
  const lastEnd = edgeEndpoints(lastGeom, lastRef.direction).end;
  let bestDir = "forward";
  let bestGap = Infinity;
  for (const newDir of ["forward", "reverse"]) {
    const newEnds = edgeEndpoints(newGeom, newDir);
    const gap = endpointDistanceSq(lastEnd, newEnds.start);
    if (gap < bestGap) {
      bestGap = gap;
      bestDir = newDir;
    }
  }
  return finalize([...refs, { ...newEdge, direction: bestDir }]);
}

export function conflictingSegmentForEdge(edgeId, excludeSegmentId, overlaySegments) {
  const target = String(edgeId);
  for (const mapping of Object.values(overlaySegments || {})) {
    if (!isCurrentV1Mapping(mapping)) continue;
    if (Number(mapping.segmentId) === Number(excludeSegmentId)) continue;
    if (!Array.isArray(mapping.edgeRefs)) continue;
    if (mapping.edgeRefs.some((ref) => String(ref.edgeId) === target)) {
      return { segmentId: mapping.segmentId, segmentName: mapping.segmentName };
    }
  }
  return null;
}

export function directedIntervalKey(ref) {
  return [
    String(ref?.edgeId || ""),
    ref?.direction === "reverse" ? "reverse" : "forward",
    Number(ref?.fromFraction ?? 0),
    Number(ref?.toFraction ?? 1),
  ].join("|");
}

export function isFullBaseEdgeRef(ref) {
  const fromFraction = Number(ref?.fromFraction ?? 0);
  const toFraction = Number(ref?.toFraction ?? 1);
  return (
    Number.isFinite(fromFraction) &&
    Number.isFinite(toFraction) &&
    Math.abs(Math.min(fromFraction, toFraction)) <= 1e-9 &&
    Math.abs(Math.max(fromFraction, toFraction) - 1) <= 1e-9
  );
}

export function isCwAccessPrecedenceEligible(state, reason) {
  return (
    (state === "prohibited" && reason === "explicit-access-prohibited") ||
    (state === "conditional" && reason === "explicit-access-conditional")
  );
}

/** Validate one V2 alignment without reading or mutating the opposite slot. */
export function validateDirectionReviewAlignment({
  segmentId,
  alignmentKey,
  edgeRefs,
  edgeLookup,
  directedOwners = new Map(),
  continuityGaps = [],
  endpointValidation = { ok: true },
  evidenceCurrent = true,
}) {
  const reasons = [];
  const traversalStates = {};
  const policyPrecedence = [];
  if (!Array.isArray(edgeRefs) || edgeRefs.length === 0) reasons.push({ code: "alignment_empty" });
  if (!evidenceCurrent) reasons.push({ code: "stale_evidence" });
  if (!endpointValidation?.ok) {
    reasons.push({ code: "endpoint_zone_failure", ...(endpointValidation || {}) });
  }
  for (const gap of continuityGaps || []) reasons.push({ code: "continuity_gap", ...gap });
  for (const [index, ref] of (edgeRefs || []).entries()) {
    const edge = edgeLookup?.get(String(ref.edgeId));
    if (!edge) {
      reasons.push({ code: "missing_edge", edgeId: String(ref.edgeId) });
      traversalStates[`${index}:${String(ref.edgeId)}`] = "unknown";
      continue;
    }
    const direction = ref.direction === "reverse" ? "reverse" : "forward";
    const traversal = edge.bicycleTraversal?.[direction] || "unknown";
    const traversalReason =
      edge.bicycleTraversal?.[`${direction}Reason`] || "missing_policy_evidence";
    traversalStates[`${index}:${String(ref.edgeId)}`] = traversal;
    if (
      isCwAccessPrecedenceEligible(traversal, traversalReason) &&
      isFullBaseEdgeRef(ref)
    ) {
      policyPrecedence.push({
        edgeId: String(ref.edgeId),
        direction,
        baseState: traversal,
        baseReason: traversalReason,
        effectiveState: "allowed",
        reason: "accepted-cw-alignment",
      });
    } else if (traversal !== "allowed") {
      reasons.push({
        code: "non_allowed_traversal",
        edgeId: String(ref.edgeId),
        direction,
        state: traversal,
        reason:
          isCwAccessPrecedenceEligible(traversal, traversalReason) && !isFullBaseEdgeRef(ref)
            ? "cw-precedence-requires-full-edge"
            : traversalReason,
      });
    }
    const owner = directedOwners.get(directedIntervalKey(ref));
    if (
      owner &&
      (Number(owner.segmentId) !== Number(segmentId) || owner.alignmentKey !== alignmentKey)
    ) {
      reasons.push({ code: "directed_ownership_conflict", edgeId: String(ref.edgeId), owner });
    }
  }
  return {
    ok: reasons.length === 0,
    status: reasons.length === 0 ? "valid" : "invalid",
    reasons,
    traversalStates,
    policyPrecedence,
    ...(endpointValidation?.terminals ? { terminals: endpointValidation.terminals } : {}),
    ...(endpointValidation?.distances ? { endpointDistancesMeters: endpointValidation.distances } : {}),
  };
}
