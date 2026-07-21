import { digestCwOverlayValue } from "./cw-overlay-v2.mjs";

const REPLACEABLE_AUTOMATIC_DRAFT_KINDS = new Set([
  "v1-existing",
  "exact-reverse",
  "opposite-alignment-required",
  "authoring-revision",
  "roundabout-repaired-reverse",
]);

function isReplaceableAutomaticDraft(draft) {
  if (!draft) return true;
  const candidate = draft.candidate || {};
  if (REPLACEABLE_AUTOMATIC_DRAFT_KINDS.has(candidate.kind)) return true;
  return (
    candidate.kind === "previous-draft" &&
    REPLACEABLE_AUTOMATIC_DRAFT_KINDS.has(candidate.previousCandidateKind) &&
    !candidate.previousReview
  );
}

export function shouldAdoptAuthoringRevisionSegment(proposalSegment, previousSegment) {
  if (proposalSegment?.migration?.sourceMappingOrigin !== "authoring-v1-revision") {
    return false;
  }
  if (!previousSegment) return true;

  for (const alignmentKey of ["aToB", "bToA"]) {
    const slot = previousSegment.alignments?.[alignmentKey];
    if (slot?.published) return false;
    if (!isReplaceableAutomaticDraft(slot?.draft)) return false;
  }
  return true;
}

/**
 * The migration proposal is rebuilt from the V1 compatibility overlay. Segments
 * authored directly in V2 are therefore absent from that proposal. Seed those
 * active segments back into the proposal before rebasing so a refresh validates
 * them against current evidence instead of silently deleting them.
 */
export function restoreStagedOnlyActiveSegments(proposalOverlay, stagedOverlay, source) {
  const next = structuredClone(proposalOverlay);
  const sourceById = new Map(
    (source?.features || [])
      .filter((feature) => feature?.geometry?.type === "LineString")
      .map((feature) => [Number(feature?.properties?.id), feature]),
  );
  const restoredSegmentIds = [];
  const preservedJunctionAttachmentSegmentIds = [];

  for (const [key, previous] of Object.entries(stagedOverlay?.segments || {})) {
    if (next.segments?.[key]) {
      if (previous?.junctionAttachments) {
        next.segments[key].junctionAttachments = structuredClone(previous.junctionAttachments);
        preservedJunctionAttachmentSegmentIds.push(Number(previous.segmentId));
      } else {
        delete next.segments[key].junctionAttachments;
      }
      continue;
    }
    const feature = sourceById.get(Number(previous?.segmentId));
    if (!feature) continue;
    const lifecycleStatus = String(feature.properties?.status || "active");
    if (["deprecated", "legacy", "draft"].includes(lifecycleStatus)) continue;
    const coordinates = feature.geometry.coordinates.map((coordinate) => coordinate.slice(0, 2));
    if (coordinates.length < 2) continue;

    const restored = structuredClone(previous);
    restored.segmentName = String(feature.properties?.name || previous.segmentName || key);
    restored.lifecycleStatus = lifecycleStatus;
    restored.navigable = true;
    restored.sourceGeometryDigest = digestCwOverlayValue(coordinates);
    restored.endpoints = {
      a: {
        coordinate: coordinates[0],
        zoneMeters: Number(previous.endpoints?.a?.zoneMeters || 30),
        labels: { key: "A" },
      },
      b: {
        coordinate: coordinates.at(-1),
        zoneMeters: Number(previous.endpoints?.b?.zoneMeters || 30),
        labels: { key: "B" },
      },
    };
    next.segments[key] = restored;
    restoredSegmentIds.push(Number(previous.segmentId));
  }

  return { overlay: next, restoredSegmentIds, preservedJunctionAttachmentSegmentIds };
}
