const ACCEPTED_STATUSES = new Set(["accepted_auto_match", "accepted_edge_set"]);

function orderedEdgeRefs(edgeRefs) {
  return [...(edgeRefs || [])].sort(
    (left, right) => Number(left.sequenceIndex ?? 0) - Number(right.sequenceIndex ?? 0),
  );
}

function replacementRef(originalRef, replacement, direction, sequenceIndex, preserveFractions) {
  const ref = {
    edgeId: String(replacement.edgeId),
    source: replacement.source || "manual",
    direction,
    sequenceIndex,
    fromFraction: preserveFractions ? originalRef.fromFraction : 0,
    toFraction: preserveFractions ? originalRef.toFraction : 1,
  };
  if (replacement.manualEdgeId) ref.manualEdgeId = String(replacement.manualEdgeId);
  if (Number.isFinite(Number(replacement.osmWayId))) ref.osmWayId = Number(replacement.osmWayId);
  return ref;
}

/**
 * Rewrite overlay mappings after one routable base edge is replaced.
 *
 * A one-for-one replacement is safe even for fractional refs. A one-to-many
 * replacement is safe only for whole-edge refs with a known orientation; an
 * accepted mapping that cannot be migrated safely is downgraded to needs_edit.
 */
export function migrateOverlayEdgeReplacement(
  overlay,
  replacedEdgeId,
  replacements,
  { updatedAt = new Date().toISOString() } = {},
) {
  const target = String(replacedEdgeId || "");
  const nextReplacements = (replacements || []).filter((replacement) => replacement?.edgeId);
  if (!target || nextReplacements.length === 0) {
    return { overlay, migratedSegmentIds: [], invalidatedSegmentIds: [] };
  }

  const segments = { ...(overlay?.segments || {}) };
  const migratedSegmentIds = [];
  const invalidatedSegmentIds = [];

  for (const [key, mapping] of Object.entries(segments)) {
    if (!mapping || !Array.isArray(mapping.edgeRefs)) continue;
    const refs = orderedEdgeRefs(mapping.edgeRefs);
    const affectedRefs = refs.filter((ref) => String(ref?.edgeId) === target);
    if (affectedRefs.length === 0) continue;

    const unsafeSplit = nextReplacements.length > 1 && affectedRefs.some((ref) => (
      ref.fromFraction !== 0 ||
      ref.toFraction !== 1 ||
      !["forward", "reverse"].includes(ref.direction)
    ));
    if (unsafeSplit) {
      if (ACCEPTED_STATUSES.has(mapping.status)) {
        segments[key] = {
          ...mapping,
          status: "needs_edit",
          failureClass: "base_edge_replaced",
          failureMessage: `Base edge ${target} was split and this mapping could not be migrated safely.`,
          updatedAt,
        };
        invalidatedSegmentIds.push(mapping.segmentId);
      }
      continue;
    }

    const expanded = [];
    for (const ref of refs) {
      if (String(ref?.edgeId) !== target) {
        expanded.push({ ...ref });
        continue;
      }
      const direction = ref.direction || "unknown";
      const orientedReplacements = direction === "reverse"
        ? [...nextReplacements].reverse()
        : nextReplacements;
      for (const replacement of orientedReplacements) {
        expanded.push(replacementRef(
          ref,
          replacement,
          direction,
          expanded.length,
          nextReplacements.length === 1,
        ));
      }
    }
    const edgeRefs = expanded.map((ref, sequenceIndex) => ({ ...ref, sequenceIndex }));
    segments[key] = {
      ...mapping,
      edgeRefs,
      updatedAt,
    };
    migratedSegmentIds.push(mapping.segmentId);
  }

  if (migratedSegmentIds.length === 0 && invalidatedSegmentIds.length === 0) {
    return { overlay, migratedSegmentIds, invalidatedSegmentIds };
  }
  return {
    overlay: {
      ...overlay,
      updatedAt,
      segments,
    },
    migratedSegmentIds,
    invalidatedSegmentIds,
  };
}
