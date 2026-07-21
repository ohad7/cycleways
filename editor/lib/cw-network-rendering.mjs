import { isCurrentV1Mapping } from "./edge-pick.mjs";

const ALIGNMENT_KEYS = ["aToB", "bToA"];

function orderedRefs(refs) {
  return [...(refs || [])]
    .sort((left, right) => Number(left.sequenceIndex ?? 0) - Number(right.sequenceIndex ?? 0))
    .map((ref, sequenceIndex) => ({ ...ref, sequenceIndex }));
}

function materializeAcceptedAlignment(segment, alignmentKey) {
  const record = segment?.alignments?.[alignmentKey]?.published;
  if (record?.disposition !== "accepted") return [];
  if (record.realization?.type === "explicit") {
    return orderedRefs(record.realization.edgeRefs);
  }
  if (record.realization?.type !== "reverseOf") return [];
  const target = segment?.alignments?.[record.realization.alignmentKey]?.published;
  if (target?.disposition !== "accepted" || target.realization?.type !== "explicit") return [];
  return orderedRefs(target.realization.edgeRefs)
    .reverse()
    .map((ref, sequenceIndex) => ({
      ...ref,
      direction: ref.direction === "reverse" ? "forward" : "reverse",
      sequenceIndex,
    }));
}

function addUniqueEdgeRef(byEdgeId, ref, alignmentKey) {
  const edgeId = String(ref?.edgeId || "");
  if (!edgeId) return;
  const existing = byEdgeId.get(edgeId);
  if (existing) {
    if (!existing.alignmentKeys.includes(alignmentKey)) {
      existing.alignmentKeys.push(alignmentKey);
    }
    return;
  }
  byEdgeId.set(edgeId, {
    ...ref,
    edgeId,
    alignmentKeys: [alignmentKey],
  });
}

/**
 * Resolve the base-edge geometry that represents a logical CW segment.
 * Overlay V2 is authoritative because its two accepted alignments may use
 * different physical carriageways. V1 is only a fallback for records that
 * have not entered the directional model yet.
 */
export function cwNetworkRenderEdgeRefs({ directionSegment, compatibilityMapping }) {
  if (directionSegment) {
    if (directionSegment.navigable === false) {
      return { source: "v2", edgeRefs: [] };
    }
    const byEdgeId = new Map();
    for (const alignmentKey of ALIGNMENT_KEYS) {
      for (const ref of materializeAcceptedAlignment(directionSegment, alignmentKey) || []) {
        addUniqueEdgeRef(byEdgeId, ref, alignmentKey);
      }
    }
    return { source: "v2", edgeRefs: [...byEdgeId.values()] };
  }

  if (!isCurrentV1Mapping(compatibilityMapping)) {
    return { source: "none", edgeRefs: [] };
  }
  const byEdgeId = new Map();
  for (const ref of compatibilityMapping.edgeRefs || []) {
    addUniqueEdgeRef(byEdgeId, ref, "compatibility");
  }
  return { source: "v1", edgeRefs: [...byEdgeId.values()] };
}
