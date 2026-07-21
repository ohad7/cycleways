import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { cwNetworkRenderEdgeRefs } from "../editor/lib/cw-network-rendering.mjs";

const [html, editor, styles, server, compatibilityOverlay, directionOverlay] = await Promise.all([
  readFile(new URL("../editor/index.html", import.meta.url), "utf8"),
  readFile(new URL("../editor/editor.js", import.meta.url), "utf8"),
  readFile(new URL("../editor/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../editor/server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../data/cw-base-overlay.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../data/cw-base-overlay.v2.staged.json", import.meta.url), "utf8").then(JSON.parse),
]);

for (const id of [
  "workspace-network",
  "network-focus-controls",
  "network-focus-cw",
  "network-focus-base",
  "network-show-context",
  "network-segment-routing",
  "direction-review-section",
  "release-state-summary",
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `Network workflow is missing #${id}`);
}

assert.doesNotMatch(editor, /els\.workspaceSegments/);
assert.doesNotMatch(editor, /els\.workspaceBase/);
assert.doesNotMatch(editor, /els\.workspaceOverlay/);
assert.match(editor, /showOverlay && !editingPhysicalEdges/);
assert.match(editor, /state\.workspaceMode === "base" \|\| editingPhysicalEdges/);
assert.match(
  editor,
  /map\.on\("click", "cw-overlay-network-hit-layer",[\s\S]{0,1800}selectSegmentById\(segmentId, false\)/,
  "selecting a CW edge directly on the map must preserve the viewport",
);
assert.match(editor, /persistNetworkViewPreferences/);
assert.match(editor, /buildNetworkIssueRows/);
assert.match(editor, /activeSegments: state\.source \? activeSegmentDescriptors\(\) : null/);
assert.match(editor, /overlaySource: "source-unresolved"/);
assert.match(editor, /cw-overlay-network-unresolved-layer/);
assert.match(editor, /const showCwNetwork = showOverlay \|\| showRoundabouts/);
assert.match(editor, /directionReviewValidationCanAccept/);
assert.match(editor, /Revalidate & use this path/);
assert.match(editor, /No directional path record yet/);
assert.match(editor, /Generate proposed paths/);
assert.match(editor, /queueChangedFeature\(feature\)/);
assert.match(editor, /isCurrentV1Mapping/);
assert.match(
  editor,
  /function cwOverlayNetworkCollection\(\)[\s\S]{0,2200}cwNetworkRenderEdgeRefs\(/,
  "CW network rendering must resolve visible geometry from the directional source of truth",
);
assert.match(
  editor,
  /function cwOverlayNetworkCollection\(\)[\s\S]{0,2200}state\.directionReview\.overlay/,
  "CW network rendering must react to Overlay V2 updates",
);

const road99Rendering = cwNetworkRenderEdgeRefs({
  directionSegment: directionOverlay.segments["174"],
  compatibilityMapping: compatibilityOverlay.segments["174"],
});
assert.equal(road99Rendering.source, "v2");
assert.ok(
  road99Rendering.edgeRefs.some((ref) => ref.edgeId === "e626743324_8"),
  "#174 must render its accepted A→B carriageway even while V1 says needs_edit",
);
assert.ok(
  road99Rendering.edgeRefs.some((ref) => ref.edgeId === "manual-edge-mrnlxmj5"),
  "#174 must render its distinct accepted B→A carriageway",
);

const segment159Rendering = cwNetworkRenderEdgeRefs({
  directionSegment: directionOverlay.segments["159"],
  compatibilityMapping: compatibilityOverlay.segments["159"],
});
assert.equal(segment159Rendering.source, "v2");
assert.ok(segment159Rendering.edgeRefs.length > 0, "V2-only segment #159 must remain visible");

const sharedEdgeRendering = cwNetworkRenderEdgeRefs({
  directionSegment: {
    navigable: true,
    alignments: {
      aToB: {
        published: {
          disposition: "accepted",
          realization: {
            type: "explicit",
            edgeRefs: [{ edgeId: "shared", direction: "forward", sequenceIndex: 0 }],
          },
        },
      },
      bToA: {
        published: {
          disposition: "accepted",
          realization: { type: "reverseOf", alignmentKey: "aToB" },
        },
      },
    },
  },
  compatibilityMapping: null,
});
assert.deepEqual(sharedEdgeRendering.edgeRefs.map((ref) => ref.edgeId), ["shared"]);
assert.deepEqual(sharedEdgeRendering.edgeRefs[0].alignmentKeys, ["aToB", "bToA"]);

const v2ReviewingRendering = cwNetworkRenderEdgeRefs({
  directionSegment: { navigable: true, alignments: {} },
  compatibilityMapping: {
    status: "accepted_edge_set",
    edgeRefs: [{ edgeId: "stale-v1", direction: "forward", sequenceIndex: 0 }],
  },
});
assert.equal(v2ReviewingRendering.source, "v2");
assert.deepEqual(v2ReviewingRendering.edgeRefs, [], "V1 must not override an existing V2 review state");
assert.match(editor, /scheduleAuthoringSync/);
assert.match(editor, /explicitEdgeRefsBySegment/);
assert.match(editor, /queueNetworkMetadataFeature/);
assert.match(editor, /function queueStaleNetworkLifecycleMetadata/);
assert.match(editor, /const staleLifecycleIds = queueStaleNetworkLifecycleMetadata\(\)/);
assert.match(
  editor,
  /if \(!isActiveLineFeature\(job\.feature\)\) \{[\s\S]{0,900}applyNetworkAuthoringMetadata/,
  "queued geometry work must release an inactive segment instead of rematching it",
);
assert.match(editor, /segmentRevisions/);
assert.match(editor, /isCurrentAuthoringObjectRevision/);
assert.match(editor, /rebuilding base evidence/);
assert.doesNotMatch(html, /base-network-mode-explore|base-network-mode-edit/);
assert.match(editor, /\/api\/network-authoring\/segment-metadata/);
assert.match(
  editor,
  /function updateSelectedProperties\(\)[\s\S]{0,900}queueNetworkMetadataFeature\(feature\)/,
  "metadata edits must not rematch directional paths",
);
assert.match(editor, /Saving and checking its rideable path automatically/);
assert.match(editor, /Saving geometry/);
assert.match(editor, /route path queued/);
assert.match(editor, /obsolete update cancelled/);
assert.match(editor, /queueManualBaseEdgePersistence/);
assert.match(editor, /manualSaveRerun/);
assert.match(editor, /presentation: incremental \? "incremental" : "full"/);
assert.match(editor, /mergeBaseGraphFeaturePatch/);
assert.doesNotMatch(
  editor,
  /if \(state\.draggingManualBaseVertex\)[\s\S]{0,500}renderAll\(\)/,
  "manual base-edge drag completion must not run the full editor renderer",
);
const deleteVertexBody = editor.match(
  /function deleteSelectedVertex\(\) \{([\s\S]*?)\n\}\n\nasync function deleteSelectedManualBaseVertex/,
)?.[1] || "";
assert.match(deleteVertexBody, /markDirty\(true, \{ render: false \}\)/);
assert.match(deleteVertexBody, /updateSelectedSegmentEditSources\(\)/);
assert.doesNotMatch(
  deleteVertexBody,
  /renderAll\(\)/,
  "deleting a CW vertex must not rebuild the full editor UI on the main thread",
);
assert.match(server, /readBaseGraphEditorPatch/);
assert.match(server, /graphPatch: result\.graphPatch/);
assert.doesNotMatch(
  editor,
  /state\.authoring\.activeSegmentIds = new Set\([\s\S]{0,500}renderAll\(\)/,
  "background reconciliation must not run the full editor renderer",
);
assert.match(styles, /\.legacy-authoring-control[\s\S]*display:\s*none/);
assert.match(html, /<option value="accepted">Current<\/option>/);
assert.match(server, /POST[^\n]*\/api\/network-authoring\/segment|url\.pathname === "\/api\/network-authoring\/segment"/);
assert.match(server, /url\.pathname === "\/api\/network-authoring\/segment-metadata"/);
assert.match(server, /automaticBidirectionalDecision/);
assert.match(server, /function segmentOwnsDirectedIntervals/);
assert.match(server, /if \(!segmentOwnsDirectedIntervals\(segment\)\) continue/);
assert.match(server, /automaticallyAppliedSegmentIds/);
assert.match(server, /delete compatibilitySegments\[String\(segmentId\)\]/);
assert.match(server, /revalidateDirectionReviewDrafts\(nextOverlay, affectedSegmentIds\)/);
assert.match(
  server,
  /\["deprecated", "legacy", "draft"\]\.includes\(sourceStatus\)[\s\S]{0,240}applyNetworkAuthoringSegmentMetadata/,
  "the segment endpoint must defensively redirect stale inactive routing requests",
);
assert.match(server, /"manual-editor"/);
assert.match(server, /validatePublishedDirectionReviewOverlay\(parsed\)/);
assert.match(server, /last published path while evaluating a revised source shape/);
assert.match(server, /AUTHORING_REQUEST_ABORTED/);
assert.match(server, /child\.kill\("SIGTERM"\)/);

console.log("Consolidated Network editor workflow wiring ok");
