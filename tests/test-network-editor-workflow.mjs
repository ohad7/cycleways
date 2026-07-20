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
assert.match(editor, /scheduleAuthoringSync/);
assert.match(editor, /explicitEdgeRefsBySegment/);
assert.match(editor, /queueNetworkMetadataFeature/);
assert.match(editor, /\/api\/network-authoring\/segment-metadata/);
assert.match(
  editor,
  /function updateSelectedProperties\(\)[\s\S]{0,900}queueNetworkMetadataFeature\(feature\)/,
  "metadata edits must not rematch directional paths",
);
assert.match(editor, /Saving and checking its rideable path automatically/);
assert.match(styles, /\.legacy-authoring-control[\s\S]*display:\s*none/);
assert.match(server, /POST[^\n]*\/api\/network-authoring\/segment|url\.pathname === "\/api\/network-authoring\/segment"/);
assert.match(server, /url\.pathname === "\/api\/network-authoring\/segment-metadata"/);
assert.match(server, /automaticBidirectionalDecision/);
assert.match(server, /validatePublishedDirectionReviewOverlay\(parsed\)/);
assert.match(server, /last published path while evaluating a revised source shape/);

console.log("Consolidated Network editor workflow wiring ok");
