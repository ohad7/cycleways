// Static wiring checks for the guidance authoring UI. The editor is a
// monolithic browser module, so these assert the markup, element map, event
// wiring, and server contract line up without booting a browser.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const html = read("../editor/index.html");
const editor = read("../editor/editor.js");
const server = read("../editor/server.mjs");
const styles = read("../editor/styles.css");

// --- markup ---------------------------------------------------------------
for (const id of [
  "segment-guidance-details",
  "guidance-preview",
  "guidance-role",
  "guidance-way-id",
  "guidance-create-way",
  "guidance-section-label",
  "guidance-standalone-name",
  "guidance-kind",
  "guidance-issues",
  "guidance-save",
  "guidance-coverage",
  "workspace-ways",
  "ways-panel",
  // One mode at a time, one search, one progress bar.
  "ways-mode-review",
  "ways-mode-library",
  "ways-search",
  "ways-search-results",
  "ways-progress-fill",
  "ways-coverage",
  "ways-warning-filter",
  "ways-blocker-filter",
  "ways-undo",
  "ways-undo-button",
  "ways-library",
  "ways-detail",
  "ways-review",
  "ways-list",
  "way-detail-back",
  "way-detail-menu",
  "way-editor-id",
  "way-editor-name",
  "way-editor-spoken-name",
  "way-editor-audible-verified",
  "way-editor-members",
  "way-candidates",
  "way-editor-save",
  "way-editor-cancel",
  "way-editor-delete",
  "ways-queue-filters",
  "guidance-suggestion-list",
]) {
  assert.ok(html.includes(`id="${id}"`), `index.html is missing #${id}`);
}

// The panel no longer carries a second segment-assignment form or a second and
// third search field: the map assigns, and one search covers ways and segments.
for (const removed of [
  "ways-segment-search",
  "ways-segment-way",
  "ways-segment-assign",
  "ways-selected-segment",
  "guidance-suggestion-search",
  "guidance-suggestion-filter",
]) {
  assert.equal(
    html.includes(`id="${removed}"`),
    false,
    `#${removed} belongs to the superseded assignment form`,
  );
}

// The three production roles, and nothing else, are offered.
for (const role of ["named-way", "standalone", "unnamed"]) {
  assert.ok(html.includes(`value="${role}"`), `role option ${role} missing`);
}

// Segment assignment stays in Network.
const inspectorStart = html.indexOf('id="network-selection-panel"');
const inspectorEnd = html.indexOf('id="base-graph-panel"');
const guidanceAt = html.indexOf('id="segment-guidance-details"');
assert.ok(
  inspectorStart < guidanceAt && guidanceAt < inspectorEnd,
  "guidance authoring must live in the CW network segment inspector",
);
// Way-owned fields and the suggestion queue live in their own first-class
// workspace, rather than contaminating the Network sidebar.
const waysStart = html.indexOf('id="ways-panel"');
const waysEnd = html.indexOf('id="network-selection-panel"');
const suggestionsAt = html.indexOf('id="ways-review"');
const wayEditorAt = html.indexOf('id="ways-detail"');
assert.ok(
  waysStart < wayEditorAt
  && wayEditorAt < suggestionsAt
  && suggestionsAt < waysEnd,
  "the Ways workspace must own way details and the review queue",
);
assert.equal(
  html.includes('id="guidance-way-spoken-name"'),
  false,
  "Network must not edit way-owned audible fields",
);

// --- element map and render/event wiring ---------------------------------
for (const key of [
  "guidanceRole:",
  "guidanceWayId:",
  "guidanceKind:",
  "guidanceIssues:",
  "guidanceSave:",
  "guidanceCoverage:",
  "workspaceWays:",
  "waysPanel:",
  "waysList:",
  "waysModeReview:",
  "waysModeLibrary:",
  "waysSearchResults:",
  "waysUndoButton:",
  "wayCandidates:",
  "wayEditorSpokenName:",
  "wayEditorDelete:",
]) {
  assert.ok(editor.includes(key), `editor element map is missing ${key}`);
}
assert.ok(editor.includes("renderGuidanceSection();"), "guidance is not rendered");
assert.ok(editor.includes("await loadGuidanceRegistry();"), "registry is not loaded at startup");
assert.ok(editor.includes("await loadGuidanceSuggestions();"), "suggestions are not loaded at startup");
assert.match(
  editor,
  /function setAlert\(message\) \{\s*showAlert\("Action failed", message\);\s*setStatus\(message, "error"\);\s*\}/,
  "Ways validation errors must use a defined editor alert helper",
);
assert.ok(
  editor.includes("saveSelectedSegmentGuidance().catch(showError)"),
  "save button is not wired",
);
assert.ok(editor.includes("createGuidanceWay().catch(showError)"), "create-way is not wired");
assert.match(
  editor,
  /const nextSource = applySegmentGuidance\(state\.source, segmentId, \{\s*role: "named-way",\s*wayId: trimmedId,/,
  "creating a way must atomically assign its first Network segment",
);
assert.ok(editor.includes('setWorkspaceMode("ways")'), "Ways workspace is not wired");
assert.ok(editor.includes("renderWaysManager();"), "way registry is not rendered");
assert.ok(
  editor.includes("saveSelectedGuidanceWay().catch(showError)"),
  "way-owned fields cannot be saved",
);
for (const operation of [
  "beginCreateGuidanceWay",
  "attachSegmentToGuidanceWay",
  "unassignSelectedSegmentGuidance",
  "removeSegmentFromGuidanceWay",
  "deleteSelectedGuidanceWay",
  "saveMemberSectionLabel",
  "undoLastGuidanceChange",
]) {
  assert.ok(editor.includes(`function ${operation}`) || editor.includes(`async function ${operation}`),
    `Ways CRUD operation ${operation} is missing`);
}
assert.match(
  editor,
  /const nextRegistry = applyWay\(state\.guidance\.registry, wayId, null\);/,
  "deleting a way must delete its registry record",
);
assert.match(
  editor,
  /nextSource = applySegmentGuidance\(\s*nextSource,\s*Number\(feature\.properties\?\.id\),\s*null,/,
  "deleting a way must clear all of its member assignments atomically",
);
assert.ok(
  editor.includes("זהו המקטע האחרון"),
  "member removal must prevent invalid empty ways",
);
assert.ok(
  editor.includes("spokenName !== (existing?.spokenName || null)"),
  "audible-name changes must require explicit device verification",
);
assert.ok(
  editor.includes("renderGuidanceSection({ preserveFormRole: true })"),
  "changing an unclassified segment role must reveal its fields instead of resetting the role",
);
assert.match(
  editor,
  /if \(!preserveFormRole\) \{\s*els\.guidanceRole\.value = guidance\?\.role \|\| "";/,
  "the segment renderer must preserve a curator's unsaved role selection",
);

// Writes go through the combined transaction, never a bare source POST: a way
// and its members live in two canonical files and must land together.
assert.ok(
  editor.includes('fetch("/api/navigation-ways", {'),
  "guidance writes must use the combined endpoint",
);
assert.ok(
  editor.includes("expectedDigests: state.guidance.digests"),
  "guidance writes must carry expected content digests",
);
assert.ok(
  editor.includes("if (response.status === 409)"),
  "a superseded response must reload rather than overwrite",
);

// A guessed audible form never becomes canonical when a way is created.
assert.ok(
  /spokenName: null/.test(editor),
  "created ways must start with a null spokenName",
);

// The map is the assignment surface: one source, four role layers, and a click
// path that attaches a candidate rather than opening a form.
for (const layerId of [
  "ways-highlight-casing",
  "ways-taken-layer",
  "ways-candidate-layer",
  "ways-member-layer",
  "ways-preview-layer",
]) {
  assert.ok(editor.includes(`id: "${layerId}"`), `map layer ${layerId} is missing`);
}
assert.ok(
  editor.includes('map.addSource("ways-context"'),
  "the ways context source is missing",
);
assert.ok(
  editor.includes('if (state.workspaceMode === "ways") handleWaysMapSegmentClick(feature);'),
  "a segment click in Ways must run the assignment gesture",
);
assert.ok(
  editor.includes("attachSegmentToGuidanceWay(segmentId, selected.wayId)"),
  "clicking a candidate must attach it to the selected way",
);
assert.ok(
  editor.includes("const conflict = assignmentFacilityConflict("),
  "attaching must refuse a facility-class conflict before the write",
);
assert.ok(
  editor.includes("setGuidanceUndo(before,"),
  "membership writes must be undoable",
);
assert.ok(
  editor.includes("document.addEventListener(\"keydown\", handleWaysKeydown)"),
  "queue triage must be keyboard-first",
);
// Derivation lives in the pure module, so the panel stays a projection of
// tested logic rather than growing its own copy.
assert.match(
  editor,
  /import \{[^}]*buildWorkQueue,[^}]*\} from "\.\/lib\/ways-workspace\.mjs";/s,
  "the editor must consume the tested workspace module",
);

// --- server contract ------------------------------------------------------
assert.ok(
  server.includes('url.pathname === "/api/navigation-ways"'),
  "server is missing the navigation-ways endpoint",
);
assert.ok(
  server.includes('url.pathname === "/api/navigation-ways/review"'),
  "server is missing the dry-run review endpoint",
);
assert.ok(
  server.includes("navigationWaysPath"),
  "server does not know the registry path",
);
assert.ok(
  server.includes("if (introducedBlocking.length > 0)"),
  "server must refuse blockers introduced by a guidance edit",
);
assert.ok(
  server.includes("introducedGuidanceBlockers(currentReview, review)"),
  "pre-existing unrelated blockers must not freeze incremental curation",
);
assert.ok(
  editor.includes("payload.introducedBlocking?.[0]"),
  "the editor must report the blocker introduced by the attempted edit",
);
assert.ok(
  server.includes('return { ok: false, status: 409, error: "superseded"'),
  "server must reject a superseded write",
);
// Rollback on partial failure: a half-applied transaction would leave a way
// referencing members that were never assigned.
assert.ok(
  server.includes("await rename(sourceRollbackTmp, sourcePath)"),
  "server must roll the source back when the registry write fails",
);
assert.ok(
  server.includes("withGuidanceWriteLock"),
  "digest check and replacement must be serialized",
);
assert.ok(
  server.includes('url.pathname === "/api/navigation-way-suggestions"'),
  "server is missing the scored suggestion endpoint",
);

// --- styles ---------------------------------------------------------------
for (const selector of [
  ".guidance-preview",
  ".guidance-issue-error",
  ".guidance-coverage",
  ".guidance-suggestion-card",
  ".ways-panel",
  ".ways-header",
  ".ways-mode",
  ".ways-bar",
  ".way-card",
  ".way-health",
  ".way-member-row",
  ".way-gap-row",
  ".way-candidate-row",
  ".ways-queue-filters",
]) {
  assert.ok(styles.includes(selector), `styles are missing ${selector}`);
}

// `display: grid/flex` on a component would otherwise beat the user agent's
// [hidden] rule and leave hidden rows on screen.
assert.match(
  styles,
  /\.ways-panel \[hidden\] \{\s*display: none;/,
  "the panel must state hidden precedence for its own components",
);

console.log("test-navigation-way-editor-wiring: OK");
