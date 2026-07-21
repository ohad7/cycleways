import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deriveNetworkJunctionCandidates } from "../editor/lib/networkJunctions.mjs";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const [graph, roundabouts, roundaboutReviews, overlay, curatedJunctions] = await Promise.all([
  readJson("../build/osm/osm-base-graph.json"), readJson("../build/osm/roundabout-candidates.json"),
  readJson("../data/roundabout-review.json"), readJson("../data/cw-base-overlay.v2.staged.json"),
  readJson("../data/network-junctions.json"),
]);
const candidates = deriveNetworkJunctionCandidates({ graph, roundaboutCandidates: roundabouts, roundaboutReviews, overlay, curatedJunctions });
const rager = candidates.junctions.find((junction) => junction.roundaboutId === "osm-ways:842376170");
assert.deepEqual(rager.segmentIds, [204, 210, 211]);
assert.deepEqual(
  rager.armAttachments.map(({ segmentId, endpoint }) => ({ segmentId, endpoint })),
  [{ segmentId: 204, endpoint: "b" }, { segmentId: 210, endpoint: "b" }, { segmentId: 211, endpoint: "a" }],
);
assert.equal(rager.attachments.filter((attachment) => attachment.source === "arm-attachment").length, 6);
assert.equal(rager.attachmentIssues.length, 0);
assert.equal(rager.summary.legalMovements, 6);
assert.equal(rager.summary.unavailableMovements, 0);
assert.equal(rager.publication.status, "detected");
for (const [segmentId, endpoint] of [[204, "b"], [210, "b"], [211, "a"]]) {
  assert.equal(
    overlay.segments[String(segmentId)].junctionAttachments?.[endpoint]?.junctionId,
    "junction-osm-ways:842376170",
  );
}
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

const fieldReverseRefs = overlay.segments["358"].alignments.bToA.published.realization.edgeRefs;
const fieldJunctionRun = fieldReverseRefs.slice(8, 13).map(({ edgeId, direction }) => `${edgeId}:${direction}`);
assert.deepEqual(fieldJunctionRun, [
  "e841155413_1:forward", "e841155426_5:forward", "e841155426_6:forward", "e841155426_7:forward", "e841155417_1:forward",
]);
console.log("current-data Rager and #358 junction regressions ok");
