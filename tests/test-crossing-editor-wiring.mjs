import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, client, server, build] = await Promise.all([
  readFile(new URL("../editor/index.html", import.meta.url), "utf8"),
  readFile(new URL("../editor/editor.js", import.meta.url), "utf8"),
  readFile(new URL("../editor/server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../processing/build_map.py", import.meta.url), "utf8"),
]);

assert.match(html, /id="crossings-show-cw"[^>]*checked/);
assert.match(html, /id="crossings-show-base"[^>]*checked/);
assert.match(html, /id="crossings-show-junctions" type="checkbox">/);
assert.match(html, /id="crossings-show-one-way" type="checkbox">/);
assert.doesNotMatch(html, /id="crossings-summary"/);
assert.doesNotMatch(html, /id="crossings-coverage"/);
assert.doesNotMatch(html, /id="crossings-filter"/);
assert.match(html, /id="crossings-new"/);
assert.match(html, /id="crossings-road-name"/);
assert.match(html, /fractional base edges/);
assert.match(client, /crossing-sites-layer/);
assert.match(client, /function crossingFilteredSites/);
assert.match(client, /function curatedCrossingSitesGeoJson/);
assert.match(client, /`curated:\$\{crossing\.id\}`/);
assert.match(client, /showCwNetwork: true/);
assert.match(client, /showBaseNetwork: true/);
assert.match(client, /showJunctions: false/);
assert.match(client, /showOneWayDirections: false/);
assert.match(client, /showCrossingBaseNetwork/);
assert.match(client, /showCrossingCwNetwork/);
assert.match(client, /state\.workspaceMode === "crossings" && state\.crossings\.showBaseNetwork/);
assert.match(client, /function crossingSelectedItem/);
assert.match(client, /function renameSelectedCrossing/);
assert.match(client, /function deleteSelectedCrossing/);
assert.match(client, /data-save-crossing-name/);
assert.match(client, /data-delete-crossing/);
assert.match(client, /Bidirectional crossing/);
assert.match(client, /crossing-actions-casing-layer/);
assert.match(client, /crossing-all-actions-layer/);
assert.match(client, /crossing-all-arrows-layer/);
assert.match(client, /const curatedFilter = curatedIds\.length/);
assert.match(client, /#f97316/);
assert.match(client, /#facc15/);
assert.doesNotMatch(client, /Accept selected mappings/);
assert.doesNotMatch(client, /Mapping overrides \(advanced JSON array\)/);
assert.doesNotMatch(client, /Junction context:<\/strong>/);
assert.match(client, /selectedMovementIds/);
assert.match(client, /Number\(bbox\[0\]\) === Number\(bbox\[2\]\)/);
assert.match(client, /setStatus\(`Selected \$\{site\.label \|\| "crossing"\}\.\`\)/);
assert.match(client, /junctionGeojson/);
assert.match(client, /Confirm crossing guidance/);
assert.match(client, /state\.crossings\.junctionDraft/);
assert.match(client, /function startCrossingGuidelineDraw/);
assert.match(client, /function matchCrossingGuideline/);
assert.match(client, /const namedCrossing =/);
assert.match(client, /els\.crossingsRoadName\.disabled = state\.crossings\.matchingGuideline/);
assert.match(client, /Enter or change the name, then save/);
assert.match(client, /type: "crossingGuideline"/);
assert.match(client, /\/api\/crossings\/match-guideline/);
assert.match(server, /buildCrossingReviewSites/);
assert.match(server, /buildJunctionCrossingProposal/);
assert.match(server, /url\.pathname === "\/api\/crossings\/from-junction"/);
assert.match(server, /Publish the junction in the CW network before adding crossing guidance/);
assert.match(server, /buildCrossingFromGuideline/);
assert.match(server, /url\.pathname === "\/api\/crossings\/match-guideline"/);
assert.match(server, /url\.pathname === "\/api\/crossings\/manual\/name"/);
assert.match(server, /url\.pathname === "\/api\/crossings\/manual\/delete"/);
assert.match(build, /stale_crossing_junction/);
assert.match(build, /missing_crossing_junction_movement/);

console.log("crossing editor junction workflow wiring ok");
