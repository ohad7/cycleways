import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, client, server] = await Promise.all([
  readFile(new URL("../editor/index.html", import.meta.url), "utf8"),
  readFile(new URL("../editor/editor.js", import.meta.url), "utf8"),
  readFile(new URL("../editor/server.mjs", import.meta.url), "utf8"),
]);

assert.match(html, /id="workspace-roundabouts"[^>]*>Junctions</);
assert.match(html, /value="relevant">Relevant junctions</);
assert.match(html, /value="movement-issues">Movement issues</);
assert.match(html, /id="select-junction-edges"/);
assert.match(html, /id="create-junction-from-edges"/);
assert.match(client, /fetch\("\/api\/network-junctions"\)/);
assert.match(client, /junction-movements-layer/);
assert.match(client, /junction-arrows-layer/);
assert.match(client, /junction-arm-attachments-layer/);
assert.match(client, /networkRole: "junction"/);
assert.match(client, /Arrival and departure ports are automatic/);
assert.match(client, /Publish as CW junction/);
assert.match(client, /createJunctionFromSelectedEdges/);
assert.match(client, /renderJunctionAuthoringControls/);
assert.match(client, /junctionAuthoring\.toggledThisClick/);
assert.match(client, /junction-internal-edge-list/);
assert.match(client, /\["==", \["get", "movementId"\], "__none__"\]/);
assert.equal(
  (client.match(/state\.workspaceMode === "base" && state\.junctionAuthoring\.selecting/g) || []).length >= 2,
  true,
  "both OSM and manual hit layers must give junction selection first priority",
);
assert.doesNotMatch(
  client,
  /function toggleJunctionEdgeSelection\(feature\)[\s\S]{0,1600}updateMapSources\(\)/,
  "selecting one junction edge must not refresh every map source",
);
assert.match(client, /data-junction-port/);
assert.match(client, /selectJunctionFromMapFeature/);
assert.match(client, /Junction selected\. Choose a movement/);
assert.match(client, /junction\.segmentIds\.map/);
assert.match(client, /Orange ports enter; green ports exit/);
assert.match(server, /url\.pathname === "\/api\/network-junctions"/);
assert.match(server, /normalizeNetworkJunctionRegistry/);
assert.match(server, /url\.pathname === "\/api\/network-junctions\/review"/);
assert.match(client, /data-movement-review="unavailable"/);
assert.match(server, /network junction refresh/);
assert.match(server, /reconcileNetworkAuthoringJunctionAttachments/);
console.log("network junction editor wiring ok");
