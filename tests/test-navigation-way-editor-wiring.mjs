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
  "ways-search",
  "ways-list",
  "ways-segment-search",
  "ways-segment-results",
  "ways-selected-segment",
  "ways-segment-way",
  "ways-segment-assign",
  "ways-segment-unassign",
  "way-editor",
  "way-editor-id",
  "way-editor-name",
  "way-editor-spoken-name",
  "way-editor-audible-verified",
  "way-editor-members",
  "way-editor-save",
  "way-editor-cancel",
  "way-editor-delete",
  "guidance-review-panel",
  "guidance-suggestion-list",
]) {
  assert.ok(html.includes(`id="${id}"`), `index.html is missing #${id}`);
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
const suggestionsAt = html.indexOf('id="guidance-review-panel"');
const wayEditorAt = html.indexOf('id="way-editor"');
assert.ok(
  waysStart < wayEditorAt
  && wayEditorAt < suggestionsAt
  && suggestionsAt < waysEnd,
  "the Ways workspace must own way details and suggestions",
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
  "waysSegmentSearch:",
  "waysSegmentAssign:",
  "waysSegmentUnassign:",
  "wayEditorSpokenName:",
  "wayEditorDelete:",
]) {
  assert.ok(editor.includes(key), `editor element map is missing ${key}`);
}
assert.ok(editor.includes("renderGuidanceSection();"), "guidance is not rendered");
assert.ok(editor.includes("await loadGuidanceRegistry();"), "registry is not loaded at startup");
assert.ok(editor.includes("await loadGuidanceSuggestions();"), "suggestions are not loaded at startup");
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
  "assignSelectedSegmentToGuidanceWay",
  "unassignSelectedSegmentGuidance",
  "removeSegmentFromGuidanceWay",
  "deleteSelectedGuidanceWay",
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
  server.includes("if (review.blocking.length > 0)"),
  "server must refuse blocking guidance issues",
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
  ".way-list-item",
  ".way-editor",
  ".way-segment-assignment",
  ".way-segment-result",
]) {
  assert.ok(styles.includes(selector), `styles are missing ${selector}`);
}

console.log("test-navigation-way-editor-wiring: OK");
