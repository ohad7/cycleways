import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [server, editor, migration, packageJson] = await Promise.all([
  readFile(new URL("../editor/server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../editor/editor.js", import.meta.url), "utf8"),
  readFile(new URL("../scripts/migrate-cw-base-overlay-v2.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
]);

const refreshEvidence = functionSource(
  server,
  "async function refreshDirectionReviewEvidence",
  "async function readDirectionReviewPendingApprovals",
);
assert.match(refreshEvidence, /ensureCurrentBaseTopologyArtifacts/);
assert.match(refreshEvidence, /build\/osm\/osm-base-graph\.json/);
assert.doesNotMatch(refreshEvidence, /osm-base-graph-elevated/);
assert.doesNotMatch(refreshEvidence, /ensureCurrentBaseRoutingArtifacts/);

const topologyPreparation = functionSource(
  server,
  "async function ensureCurrentBaseTopologyArtifacts",
  "async function ensureCurrentBaseRoutingArtifacts",
);
assert.match(topologyPreparation, /inspectBaseGraphFreshness/);
assert.match(topologyPreparation, /"osm:topology"/);
assert.match(topologyPreparation, /base inputs changed while topology was rebuilding/);
assert.match(topologyPreparation, /BASE_EVIDENCE_SUPERSEDED/);
assert.doesNotMatch(topologyPreparation, /osm:graph/);
assert.doesNotMatch(topologyPreparation, /elevation/);

const releasePreparation = functionSource(
  server,
  "async function ensureCurrentBaseRoutingArtifacts",
  "async function handleBuild",
);
assert.match(releasePreparation, /ensureCurrentBaseTopologyArtifacts/);
assert.match(releasePreparation, /build_osm_base_graph_elevation\.py/);

const graphContext = functionSource(
  server,
  "async function readDirectionReviewGraphContext",
  "function reverseAlignmentRefs",
);
assert.match(graphContext, /osmBaseGraphPath/);
assert.doesNotMatch(graphContext, /osmElevatedBaseGraphPath/);

assert.equal(
  packageJson.scripts["osm:topology"],
  "python3 processing/build_osm_base_graph.py",
);
assert.match(packageJson.scripts["osm:graph"], /osm:topology/);
assert.match(packageJson.scripts["osm:graph"], /match_cycleways_to_osm_graph/);
assert.match(migration, /argument\("--graph", "build\/osm\/osm-base-graph\.json"\)/);
assert.match(editor, /error\?\.code === "BASE_EVIDENCE_SUPERSEDED"/);

console.log("Direction Review topology-only refresh wiring passed");

function functionSource(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing ${start}`);
  assert.notEqual(endIndex, -1, `Missing boundary ${end}`);
  return source.slice(startIndex, endIndex);
}
