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
