import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { shouldAdoptAuthoringRevisionSegment } from "../editor/lib/direction-review-refresh.mjs";

const [html, editor, server] = await Promise.all([
  readFile(new URL("../editor/index.html", import.meta.url), "utf8"),
  readFile(new URL("../editor/editor.js", import.meta.url), "utf8"),
  readFile(new URL("../editor/server.mjs", import.meta.url), "utf8"),
]);

for (const id of [
  "direction-review-a-to-b",
  "direction-review-b-to-a",
  "direction-review-edges",
  "direction-review-edit",
  "direction-review-revalidate",
  "direction-review-use-reverse",
  "direction-review-accept",
  "manual-edge-direction-review",
  "manual-edge-forward",
  "manual-edge-reverse",
  "save-manual-edge-direction",
  "base-edge-direction-help",
  "base-edge-direction-evidence",
  "clear-osm-direction-override",
  "toggle-base-one-way-directions",
  "base-one-way-direction-legend",
  "base-one-way-direction-summary",
  "base-edge-search",
  "find-base-edge",
  "base-network-preset",
  "base-network-theme",
  "base-network-show-cycleways",
  "base-network-map-summary",
  "base-network-results",
  "direction-review-apply-symmetric-batch",
  "direction-review-queue-filter",
  "direction-review-queue-search",
  "direction-review-queue-list",
  "direction-review-queue-segments",
  "direction-review-queue-evidence",
  "direction-review-queue-previous",
  "direction-review-queue-next",
  "direction-review-approve-manual-bidirectional",
  "direction-review-finalize-manual-queue",
  "direction-review-approve-manual-help",
  "direction-review-auto-fix-guide",
  "refresh-direction-review",
  "edit-base-overlay-edges",
  "base-overlay-edge-edit-help",
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `editor is missing #${id}`);
}

for (const token of [
  "direction-review-alignments-layer",
  "direction-review-arrows-layer",
  "direction-review-sequence-layer",
  "direction-review-endpoint-labels",
  "manual-base-edge-endpoints-layer",
  "manual-base-edge-endpoint-labels",
  "selected-base-graph-edge-direction-arrows",
  "base-graph-one-way-directions-layer",
  "base-graph-one-way-direction-arrows",
  "buildBaseEdgeDirectionLayer",
  "findBaseEdgeById",
  "saveSelectedManualEdgeDirectionPolicy",
  "clearSelectedOsmDirectionOverride",
  "applySymmetricDirectionMigrationBatch",
  "refreshDirectionReviewEvidence",
  "toggleBaseOverlayEdgeEditing",
  "renderBaseNetworkExplorerPanel",
  "applyBaseNetworkMapPresentation",
  "setBaseNetworkPreset",
  "directionReviewProposalExplanation",
  "newManualEdgeBidirectionalTraversal",
  "copiedManualEdgeTraversal",
  "manualEdgeDirectionDefaultLabel",
]) {
  assert.match(editor, new RegExp(token), `editor wiring is missing ${token}`);
}

assert.match(server, /\/api\/cw-base-overlay-v2\/alignment-action/);
assert.match(server, /\/api\/cw-base-overlay-v2\/refresh-evidence/);
assert.match(server, /\/api\/cw-base-overlay-v2\/apply-symmetric-batch/);
assert.match(server, /\/api\/bicycle-traversal-overrides/);
assert.match(server, /validatePublishedDirectionReviewOverlay/);
assert.match(server, /rebaseDirectionReviewState/);
assert.match(server, /rebasedSourceChanges/);
assert.match(server, /sourceGeometryChanged/);
assert.match(server, /evidenceBackfilled/);
assert.match(server, /directionReviewEvidenceDigest/);
assert.match(server, /proposalMatches/);
assert.match(editor, /buildDirectionReviewIssueRows/);
assert.match(editor, /buildDirectionReviewEvidenceRows/);
assert.match(editor, /openDirectionReviewBaseEdge/);
assert.match(editor, /collectIssueSegmentIds/);
assert.match(editor, /approveSelectedManualEdgesBidirectional/);
assert.match(editor, /finalizeQueuedManualDirectionReviews/);
assert.match(server, /manual-bidirectional-finalize/);
assert.match(editor, /reviewer \|\|= "ohad"/);
assert.match(editor, /localDateInputValue/);
assert.match(editor, /showOverlay && !editingPhysicalEdges/);
assert.match(editor, /editingPhysicalEdges = state\.editingOverlayEdges \|\| state\.directionReview\.editing/);
assert.match(editor, /!state\.directionReview\.editing &&[\s\S]{0,100}cwOverlayNetworkFeaturesAtPoint/);
assert.match(editor, /Boolean\(directionReviewSegment\(\)\)/);
assert.match(
  editor,
  /direction-review-alignments["']\)\?\.setData\(directionReviewAlignmentCollection\(\)\)/,
  "base-overlay edge hover must refresh the visible Direction Review layer",
);
assert.match(editor, /editingPhysicalEdges \? 0\.2/);
assert.match(editor, /clearBaseOverlayMappingForSegment\(originalId\)/);
assert.doesNotMatch(
  server,
  /previous\.sourceGeometryDigest\s*!==\s*segment\.sourceGeometryDigest[\s\S]{0,160}continue;/,
  "source-geometry changes must revalidate explicit mappings instead of dropping them",
);
assert.match(server, /must review both bicycleTraversal directions together/);
assert.match(editor, /Roundabout reverse repair/);
assert.match(editor, /roundabout auto-repair/);

const authoringRevisionProposal = {
  migration: { sourceMappingOrigin: "authoring-v1-revision" },
};
const automaticPrevious = {
  alignments: {
    aToB: { published: null, draft: { candidate: { kind: "v1-existing" } } },
    bToA: { published: null, draft: { candidate: { kind: "exact-reverse" } } },
  },
};
assert.equal(
  shouldAdoptAuthoringRevisionSegment(authoringRevisionProposal, automaticPrevious),
  true,
);
const rebasedAutomaticPrevious = structuredClone(automaticPrevious);
rebasedAutomaticPrevious.alignments.aToB.draft.candidate = {
  kind: "previous-draft",
  previousCandidateKind: "v1-existing",
};
assert.equal(
  shouldAdoptAuthoringRevisionSegment(authoringRevisionProposal, rebasedAutomaticPrevious),
  true,
);
const manualPrevious = structuredClone(automaticPrevious);
manualPrevious.alignments.aToB.draft.candidate.kind = "manual-editor";
assert.equal(
  shouldAdoptAuthoringRevisionSegment(authoringRevisionProposal, manualPrevious),
  false,
);
const publishedPrevious = structuredClone(automaticPrevious);
publishedPrevious.alignments.aToB.published = { disposition: "accepted" };
assert.equal(
  shouldAdoptAuthoringRevisionSegment(authoringRevisionProposal, publishedPrevious),
  false,
);
assert.equal(
  shouldAdoptAuthoringRevisionSegment(
    { migration: { sourceMappingOrigin: "frozen-v1" } },
    automaticPrevious,
  ),
  false,
);

console.log("Direction Review editor wiring ok");
