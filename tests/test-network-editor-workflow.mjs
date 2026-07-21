import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, editor, styles, server] = await Promise.all([
  readFile(new URL("../editor/index.html", import.meta.url), "utf8"),
  readFile(new URL("../editor/editor.js", import.meta.url), "utf8"),
  readFile(new URL("../editor/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../editor/server.mjs", import.meta.url), "utf8"),
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
assert.match(editor, /persistNetworkViewPreferences/);
assert.match(editor, /buildNetworkIssueRows/);
assert.match(editor, /isCurrentV1Mapping/);
assert.match(
  editor,
  /function cwOverlayNetworkCollection\(\)[\s\S]{0,1800}!isCurrentV1Mapping\(mapping\)/,
  "CW network rendering must include both automatic and explicitly chosen current V1 mappings",
);
assert.match(editor, /scheduleAuthoringSync/);
assert.match(editor, /explicitEdgeRefsBySegment/);
assert.match(editor, /queueNetworkMetadataFeature/);
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
assert.match(server, /"manual-editor"/);
assert.match(server, /validatePublishedDirectionReviewOverlay\(parsed\)/);
assert.match(server, /last published path while evaluating a revised source shape/);
assert.match(server, /AUTHORING_REQUEST_ABORTED/);
assert.match(server, /child\.kill\("SIGTERM"\)/);

console.log("Consolidated Network editor workflow wiring ok");
