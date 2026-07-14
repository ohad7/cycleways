import assert from "node:assert/strict";
import {
  acceptAlignmentDraft,
  alignmentMappingDigest,
  applyReviewedMigrationBatch,
  applyReviewedSymmetricMigrationBatch,
  clearAlignmentDraft,
  deriveReverseAlignmentDraft,
  materializeAcceptedAlignment,
  parseCwOverlayV2,
  publishAlignmentUnavailable,
  replaceOverlayV2AlignmentEdge,
  serializeCwOverlayV2,
  setAlignmentDraft,
} from "../editor/lib/cw-overlay-v2.mjs";

const explicit = (edgeId = "edge-a", direction = "forward") => ({
  type: "explicit",
  edgeRefs: [{ edgeId, direction, sequenceIndex: 0, fromFraction: 0, toFraction: 1 }],
});

function baseOverlay() {
  const segment = {
    segmentId: 7,
    segmentName: "Test",
    lifecycleStatus: "active",
    navigable: true,
    sourceGeometryDigest: "source-digest",
    endpoints: {
      a: { coordinate: [35, 33], zoneMeters: 20 },
      b: { coordinate: [35.01, 33], zoneMeters: 20 },
    },
    alignments: {
      aToB: { published: null, draft: null },
      bToA: { published: null, draft: null },
    },
  };
  const realization = explicit();
  const mappingDigest = alignmentMappingDigest(7, "aToB", realization);
  segment.alignments.aToB.published = {
    disposition: "accepted",
    realization,
    mappingDigest,
    review: {
      reviewer: "curator",
      reviewedAt: "2026-07-14",
      graphDigest: "graph-digest",
      policyDigest: "policy-digest",
      sourceGeometryDigest: "source-digest",
      mappingDigest,
    },
  };
  segment.alignments.bToA.draft = {
    disposition: "needs_review",
    realization: {
      type: "reverseOf",
      alignmentKey: "aToB",
      referencedMappingDigest: mappingDigest,
    },
    candidate: { kind: "exact-reverse" },
    validation: { status: "valid" },
  };
  return {
    schemaVersion: 2,
    policyId: "il-bicycle-v1",
    policyDigest: "policy-digest",
    graphDigest: "graph-digest",
    segments: { "7": segment },
  };
}

{
  const overlay = baseOverlay();
  assert.deepEqual(parseCwOverlayV2(overlay), overlay);
  assert.equal(serializeCwOverlayV2(overlay), serializeCwOverlayV2(JSON.parse(JSON.stringify(overlay))));
  assert.deepEqual(materializeAcceptedAlignment(overlay.segments["7"], "aToB").map((ref) => ref.edgeId), ["edge-a"]);
}

{
  const overlay = baseOverlay();
  const digest = overlay.segments["7"].alignments.aToB.published.mappingDigest;
  overlay.segments["7"].alignments.bToA.published = {
    disposition: "accepted",
    realization: { type: "reverseOf", alignmentKey: "aToB", referencedMappingDigest: digest },
  };
  overlay.segments["7"].alignments.bToA.published.mappingDigest = alignmentMappingDigest(
    7,
    "bToA",
    overlay.segments["7"].alignments.bToA.published.realization,
  );
  overlay.segments["7"].alignments.bToA.published.review = {
    reviewer: "curator",
    reviewedAt: "2026-07-14",
    graphDigest: "graph-digest",
    policyDigest: "policy-digest",
    sourceGeometryDigest: "source-digest",
    mappingDigest: overlay.segments["7"].alignments.bToA.published.mappingDigest,
  };
  assert.deepEqual(materializeAcceptedAlignment(overlay.segments["7"], "bToA"), [
    { edgeId: "edge-a", direction: "reverse", sequenceIndex: 0, fromFraction: 0, toFraction: 1 },
  ]);
  overlay.segments["7"].alignments.bToA.published.realization.referencedMappingDigest = "stale";
  overlay.segments["7"].alignments.bToA.published.mappingDigest = alignmentMappingDigest(
    7,
    "bToA",
    overlay.segments["7"].alignments.bToA.published.realization,
  );
  overlay.segments["7"].alignments.bToA.published.review.mappingDigest =
    overlay.segments["7"].alignments.bToA.published.mappingDigest;
  assert.throws(() => parseCwOverlayV2(overlay), /stale/);
}

{
  const overlay = baseOverlay();
  overlay.segments["7"].alignments.aToB.published.realization = {
    type: "reverseOf",
    alignmentKey: "aToB",
    referencedMappingDigest: "x",
  };
  assert.throws(() => parseCwOverlayV2(overlay), /mappingDigest|itself/);
}

{
  const overlay = baseOverlay();
  overlay.segments["7"].alignments.aToB.published = {
    disposition: "unavailable",
    unavailableReasonCode: "no_canonical_alignment",
    review: { reviewer: "curator", reviewedAt: "2026-07-14", rationale: "none" },
  };
  overlay.segments["7"].alignments.bToA.published = {
    disposition: "unavailable",
    unavailableReasonCode: "editorially_not_offered",
    review: { reviewer: "curator", reviewedAt: "2026-07-14", rationale: "none" },
  };
  overlay.segments["7"].alignments.bToA.draft = null;
  assert.throws(() => parseCwOverlayV2(overlay), /both directions unavailable/);
}

{
  const overlay = baseOverlay();
  const untouched = JSON.stringify(overlay.segments["7"].alignments.bToA);
  const result = replaceOverlayV2AlignmentEdge(overlay, "edge-a", [
    { edgeId: "child-a" },
    { edgeId: "child-b" },
  ]);
  assert.deepEqual(result.affected, [{ segmentId: 7, alignmentKey: "aToB", recordKey: "published" }]);
  assert.equal(JSON.stringify(result.overlay.segments["7"].alignments.bToA), untouched);
  assert.deepEqual(
    result.overlay.segments["7"].alignments.aToB.published.realization.edgeRefs.map((ref) => ref.edgeId),
    ["child-a", "child-b"],
  );
  assert.equal(overlay.segments["7"].alignments.aToB.published.realization.edgeRefs[0].edgeId, "edge-a");
}

{
  const proposal = baseOverlay();
  proposal.segments["7"].alignments.aToB.published = null;
  proposal.segments["7"].alignments.aToB.draft = {
    disposition: "needs_review",
    realization: explicit(),
    mappingDigest: alignmentMappingDigest(7, "aToB", explicit()),
    candidate: { kind: "v1-existing" },
    validation: { status: "valid" },
  };
  proposal.segments["7"].alignments.bToA.draft = null;
  const applied = applyReviewedMigrationBatch(proposal, [7], {
    reviewer: "curator",
    reviewedAt: "2026-07-14",
    batchId: "batch-1",
  });
  assert.deepEqual(applied.applied, [{ segmentId: 7, alignmentKey: "aToB" }]);
  assert.equal(applied.overlay.segments["7"].alignments.aToB.published.disposition, "accepted");
  assert.equal(applied.overlay.segments["7"].alignments.aToB.draft, null);
}

{
  const proposal = baseOverlay();
  const segment = proposal.segments["7"];
  segment.migration = { classification: "symmetric_candidate" };
  segment.alignments.aToB.published = null;
  segment.alignments.aToB.draft = {
    disposition: "needs_review",
    realization: explicit(),
    mappingDigest: alignmentMappingDigest(7, "aToB", explicit()),
    candidate: { kind: "v1-existing", classification: "symmetric_candidate" },
    validation: { status: "valid" },
  };
  segment.alignments.bToA.draft = {
    disposition: "needs_review",
    candidate: {
      kind: "exact-reverse",
      classification: "symmetric_candidate",
      reverseOfAlignmentKey: "aToB",
      referencedMappingDigest: segment.alignments.aToB.draft.mappingDigest,
    },
    validation: { status: "valid" },
  };
  const result = applyReviewedSymmetricMigrationBatch(proposal, [7], {
    reviewer: "curator",
    reviewedAt: "2026-07-14",
    batchId: "symmetric-1",
  });
  assert.equal(result.applied.length, 1);
  assert.equal(segment.alignments.aToB.published, null, "batch does not mutate input");
  assert.equal(result.overlay.segments["7"].alignments.aToB.published.disposition, "accepted");
  assert.equal(
    result.overlay.segments["7"].alignments.bToA.published.realization.type,
    "reverseOf",
  );
  assert.deepEqual(
    materializeAcceptedAlignment(result.overlay.segments["7"], "bToA").map((ref) => [ref.edgeId, ref.direction]),
    [["edge-a", "reverse"]],
  );
}

{
  let overlay = baseOverlay();
  overlay.segments["7"].alignments.aToB.published = null;
  overlay.segments["7"].alignments.bToA.draft = null;
  overlay = setAlignmentDraft(overlay, 7, "aToB", {
    realization: explicit("edge-reviewed"),
    candidate: { kind: "manual-editor" },
    validation: { status: "valid", reasons: [], traversalStates: { "0:edge-reviewed": "allowed" } },
  });
  assert.equal(overlay.segments["7"].alignments.aToB.draft.candidate.kind, "manual-editor");
  overlay = acceptAlignmentDraft(overlay, 7, "aToB", {
    reviewer: "curator",
    reviewedAt: "2026-07-14",
    batchId: "manual-1",
  });
  assert.equal(overlay.segments["7"].alignments.aToB.published.disposition, "accepted");
  assert.equal(overlay.segments["7"].alignments.aToB.draft, null);

  overlay = deriveReverseAlignmentDraft(overlay, 7, "bToA", {
    status: "valid",
    reasons: [],
    traversalStates: { "0:edge-reviewed": "allowed" },
  });
  assert.equal(overlay.segments["7"].alignments.bToA.draft.realization.type, "reverseOf");
  overlay = acceptAlignmentDraft(overlay, 7, "bToA", {
    reviewer: "curator",
    reviewedAt: "2026-07-14",
    batchId: "manual-1",
  });
  assert.deepEqual(materializeAcceptedAlignment(overlay.segments["7"], "bToA"), [
    { edgeId: "edge-reviewed", direction: "reverse", sequenceIndex: 0, fromFraction: 0, toFraction: 1 },
  ]);
}

{
  let overlay = baseOverlay();
  overlay = clearAlignmentDraft(overlay, 7, "bToA");
  assert.equal(overlay.segments["7"].alignments.bToA.draft, null);
  overlay = publishAlignmentUnavailable(overlay, 7, "bToA", {
    unavailableReasonCode: "editorially_not_offered",
    reviewer: "curator",
    reviewedAt: "2026-07-14",
    rationale: "The opposite trip is intentionally not offered.",
    userExplanation: "Choose another corridor for the return trip.",
  });
  assert.equal(overlay.segments["7"].alignments.bToA.published.disposition, "unavailable");
  assert.equal(
    overlay.segments["7"].alignments.bToA.published.userExplanation,
    "Choose another corridor for the return trip.",
  );
}

console.log("CW Overlay V2 ok");
