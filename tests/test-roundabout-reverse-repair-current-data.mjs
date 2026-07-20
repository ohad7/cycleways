import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildMigrationProposal } from "../scripts/migrate-cw-base-overlay-v2.mjs";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const [overlayV1, authoringOverlayV1, publicIndexV1, mapSource, graph, policyAudit] =
  await Promise.all([
    readJson("../data/routing-compat/cw-base-overlay-v1.json"),
    readJson("../data/cw-base-overlay.json"),
    readJson("../data/routing-compat/cw-base-index-v1.json"),
    readJson("../data/map-source.geojson"),
    readJson("../build/osm/osm-base-graph-elevated.json"),
    readJson("../build/bicycle-traversal-policy-audit.json"),
  ]);

const { overlay } = buildMigrationProposal({
  overlayV1,
  authoringOverlayV1,
  publicIndexV1,
  mapSource,
  graph,
  policyAudit,
  graphDigest: "current-data-roundabout-repair-test",
});
const segment = overlay.segments["276"];
assert.equal(segment.migration.classification, "roundabout_reverse_candidate");
assert.equal(segment.alignments.aToB.draft.validation.status, "valid");
assert.equal(segment.alignments.aToB.draft.realization.edgeRefs.length, 17);

const reverse = segment.alignments.bToA.draft;
assert.equal(reverse.candidate.kind, "roundabout-repaired-reverse");
assert.equal(reverse.validation.status, "valid");
assert.equal(reverse.realization.edgeRefs.length, 16);
assert.deepEqual(reverse.candidate.repairs, [{
  entryNodeId: "nd08b5972028b7807",
  exitNodeId: "n569a568a691d4206",
  blockedEdgeRefs: [
    { edgeId: "e352638078_2", direction: "reverse" },
    { edgeId: "e352638078_1", direction: "reverse" },
    { edgeId: "e352638078_5", direction: "reverse" },
  ],
  replacementEdgeRefs: [
    { edgeId: "e352638078_3", direction: "forward" },
    { edgeId: "e352638078_4", direction: "forward" },
  ],
}]);

console.log("#276 roundabout reverse repair current-data regression ok");
