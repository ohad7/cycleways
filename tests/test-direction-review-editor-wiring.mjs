import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  restoreStagedOnlyActiveSegments,
  shouldAdoptAuthoringRevisionSegment,
} from "../editor/lib/direction-review-refresh.mjs";

const [html, editor, server] = await Promise.all([
  readFile(new URL("../editor/index.html", import.meta.url), "utf8"),
  readFile(new URL("../editor/editor.js", import.meta.url), "utf8"),
  readFile(new URL("../editor/server.mjs", import.meta.url), "utf8"),
]);

for (const id of [
  "direction-review-a-to-b",
  "direction-review-b-to-a",
  "direction-review-edges",
  "direction-review-generate",
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
  "generateSelectedDirectionReview",
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
assert.match(html, /value="mapping_confidence_review">Mapping coverage review/);
assert.match(
  editor,
  /if \(finishing\) \{[\s\S]{0,500}explicitEdgeRefsBySegment\.set[\s\S]{0,500}scheduleAuthoringSync/,
  "finishing explicit mapping inspection must submit the selected edge sequence",
);
assert.match(editor, /Finish editing to use this exact path/);
assert.match(editor, /localDateInputValue/);
assert.match(editor, /showOverlay && !editingPhysicalEdges/);
assert.match(editor, /editingPhysicalEdges = state\.editingOverlayEdges \|\| state\.directionReview\.editing/);
assert.match(editor, /!state\.directionReview\.editing &&[\s\S]{0,100}cwOverlayNetworkFeaturesAtPoint/);
assert.match(editor, /Boolean\(directionReviewSegment\(\)\)/);
assert.match(
  editor,
  /setSourceData\(["']direction-review-alignments["'], directionReviewAlignmentCollection\)/,
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

const stagedOnly = {
  segmentId: 359,
  segmentName: "Old name",
  lifecycleStatus: "active",
  navigable: true,
  sourceGeometryDigest: "old-digest",
  endpoints: {
    a: { coordinate: [1, 2], zoneMeters: 25, labels: { key: "A" } },
    b: { coordinate: [3, 4], zoneMeters: 35, labels: { key: "B" } },
  },
  alignments: {
    aToB: { published: { disposition: "accepted" }, draft: null },
    bToA: { published: { disposition: "accepted" }, draft: null },
  },
};
const existingProposalSegment = {
  ...structuredClone(stagedOnly),
  segmentId: 358,
};
const existingStagedSegment = {
  ...structuredClone(stagedOnly),
  segmentId: 358,
  junctionAttachments: {
    b: {
      junctionId: "junction-test",
      armId: "arm-b",
      externalNodeId: "arm-b",
      source: "automatic-terminal-node",
    },
  },
};
const restored = restoreStagedOnlyActiveSegments(
  { segments: { "358": existingProposalSegment } },
  { segments: { "358": existingStagedSegment, "359": stagedOnly, "360": { ...stagedOnly, segmentId: 360 } } },
  {
    features: [
      {
        properties: { id: 358, name: "Existing", status: "active" },
        geometry: { type: "LineString", coordinates: [[1, 2], [3, 4]] },
      },
      {
        properties: { id: 359, name: "Current name", status: "active" },
        geometry: { type: "LineString", coordinates: [[10, 20, 1], [30, 40, 2]] },
      },
      {
        properties: { id: 360, status: "deprecated" },
        geometry: { type: "LineString", coordinates: [[1, 2], [3, 4]] },
      },
    ],
  },
);
assert.deepEqual(restored.restoredSegmentIds, [359]);
assert.equal(restored.overlay.segments["359"].segmentName, "Current name");
assert.deepEqual(restored.overlay.segments["359"].endpoints.a.coordinate, [10, 20]);
assert.deepEqual(restored.overlay.segments["359"].endpoints.b.coordinate, [30, 40]);
assert.equal(restored.overlay.segments["359"].alignments.aToB.published.disposition, "accepted");
assert.equal(restored.overlay.segments["360"], undefined);
assert.deepEqual(restored.preservedJunctionAttachmentSegmentIds, [358]);
assert.equal(
  restored.overlay.segments["358"].junctionAttachments.b.junctionId,
  "junction-test",
);

console.log("Direction Review editor wiring ok");
