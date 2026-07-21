import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deriveNetworkJunctionCandidates } from "../editor/lib/networkJunctions.mjs";
import { repairNetworkJunctionReverse } from "../scripts/migrate-cw-base-overlay-v2.mjs";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const [graph, roundabouts, roundaboutReviews, overlay, policyAudit] = await Promise.all([
  readJson("../build/osm/osm-base-graph.json"), readJson("../build/osm/roundabout-candidates.json"),
  readJson("../data/roundabout-review.json"), readJson("../data/cw-base-overlay.v2.staged.json"),
  readJson("../build/bicycle-traversal-policy-audit.json"),
]);
const candidates = deriveNetworkJunctionCandidates({ graph, roundaboutCandidates: roundabouts, roundaboutReviews, overlay });
const rager = candidates.junctions.find((junction) => junction.roundaboutId === "osm-ways:842376170");
assert.deepEqual(rager.segmentIds, [204, 210, 211]);
assert.equal(rager.summary.legalMovements, 6);
assert.equal(rager.summary.unavailableMovements, 0);
const field = candidates.junctions.find((junction) => junction.roundaboutId === "osm-ways:841155426");
assert.deepEqual(field.segmentIds, [358]);
assert.ok(field.throughAlignments.some((alignment) => alignment.segmentId === 358));
assert.deepEqual(
  candidates.junctions.find((junction) => junction.roundaboutId === "osm-ways:228885122").segmentIds,
  [143, 144, 263, 361],
);
assert.deepEqual(
  candidates.junctions.find((junction) => junction.roundaboutId === "osm-ways:1024609346").segmentIds,
  [74, 96, 328, 329, 330, 337, 339],
);
assert.deepEqual(
  candidates.junctions.find((junction) => junction.roundaboutId === "osm-ways:1230594681").segmentIds,
  [330, 333, 334],
);

const policyLookup = new Map();
for (const queue of ["restricted", "conditional", "unknown"]) {
  for (const item of policyAudit?.queues?.[queue] || []) policyLookup.set(`${item.edgeId}|${item.direction}`, { state: item.state, reason: item.reason });
}
const graphById = new Map(graph.edges.map((edge) => [edge.id, edge]));
for (const [segmentId, alignmentKey, expectedJunctionId] of [
  [210, "aToB", "junction-osm-842376170"],
  [204, "bToA", "junction-osm-842376170"],
  [211, "bToA", "junction-osm-842376170"],
]) {
  const draft = overlay.segments[String(segmentId)].alignments[alignmentKey].draft;
  const refs = draft.realization?.edgeRefs || (
    [...overlay.segments[String(segmentId)].alignments[alignmentKey === "aToB" ? "bToA" : "aToB"].draft.realization.edgeRefs]
      .reverse()
      .map((ref, sequenceIndex) => ({ ...ref, direction: ref.direction === "forward" ? "reverse" : "forward", sequenceIndex }))
  );
  const repaired = repairNetworkJunctionReverse(refs, draft.validation, graphById, policyLookup);
  assert.equal(repaired?.validation?.status, "valid", `segment #${segmentId} ${alignmentKey}`);
  assert.equal(repaired.repairs[0].junctionId, expectedJunctionId);
}
const reverseDraft = overlay.segments["358"].alignments.bToA.draft;
const reverseRefs = [...overlay.segments["358"].alignments.aToB.draft.realization.edgeRefs].reverse().map((ref, sequenceIndex) => ({
  ...ref, direction: ref.direction === "forward" ? "reverse" : "forward", sequenceIndex,
}));
const repair = repairNetworkJunctionReverse(reverseRefs, reverseDraft.validation, graphById, policyLookup);
assert.equal(repair.validation.status, "valid");
assert.equal(repair.repairs[0].junctionId, "junction-osm-841155426");
assert.deepEqual(repair.repairs[0].replacementEdgeRefs.map(({ edgeId, direction }) => `${edgeId}:${direction}`), [
  "e841155413_1:forward", "e841155426_5:forward", "e841155426_6:forward", "e841155426_7:forward", "e841155417_1:forward",
]);
console.log("current-data Rager and #358 junction regressions ok");
