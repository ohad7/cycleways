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
assert.equal(rager.publication.status, "published");
assert.equal(rager.name, "צומת רג׳ר");
assert.equal(rager.publication.canPublish, true);
for (const [segmentId, endpoint] of [[204, "b"], [210, "b"], [211, "a"]]) {
  assert.equal(
    overlay.segments[String(segmentId)].junctionAttachments?.[endpoint]?.junctionId,
    "junction-osm-ways:842376170",
  );
}
const fieldEntrance = candidates.junctions.find(
  (junction) => junction.roundaboutId === "osm-ways:841155428",
);
assert.deepEqual(fieldEntrance.segmentIds, [358, 359]);
assert.deepEqual(
  fieldEntrance.armAttachments.map(({ segmentId, endpoint }) => ({ segmentId, endpoint })),
  [{ segmentId: 358, endpoint: "a" }, { segmentId: 359, endpoint: "b" }],
);
assert.equal(fieldEntrance.publication.status, "published");
assert.equal(fieldEntrance.publication.canPublish, true);
for (const [segmentId, endpoint] of [[358, "a"], [359, "b"]]) {
  assert.equal(
    overlay.segments[String(segmentId)].junctionAttachments?.[endpoint]?.junctionId,
    "junction-osm-ways:841155428",
  );
}
assert.deepEqual(
  candidates.junctions.find((junction) => junction.roundaboutId === "osm-ways:228885122").segmentIds,
  [144, 263, 361, 368],
);
assert.deepEqual(
  candidates.junctions.find((junction) => junction.roundaboutId === "osm-ways:1024609346").segmentIds,
  [74, 96, 330, 337, 339, 364],
);
assert.deepEqual(
  candidates.junctions.find((junction) => junction.roundaboutId === "osm-ways:1230594681").segmentIds,
  [330, 333, 334],
);

const horshatTal = candidates.junctions.find((junction) => junction.id === "junction-custom-mrujg8lc");
assert.equal(horshatTal.name, "צומת חורשת טל");
assert.equal(horshatTal.publication.status, "published");
assert.equal(horshatTal.publication.canPublish, true);
assert.deepEqual(horshatTal.internalEdgeIds, [
  "manual-74-mrufpgtj",
  "manual-74-mrufztbk",
  "manual-74-mrug3gou",
]);
assert.deepEqual(
  horshatTal.armAttachments.map(({ segmentId, endpoint }) => ({ segmentId, endpoint })),
  [
    { segmentId: 330, endpoint: "b" },
    { segmentId: 337, endpoint: "b" },
    { segmentId: 339, endpoint: "b" },
    { segmentId: 364, endpoint: "b" },
  ],
);
assert.equal(horshatTal.summary.legalMovements, 4);
assert.equal(horshatTal.summary.unavailableMovements, 0);
for (const [segmentId, endpoint] of [[330, "b"], [337, "b"], [339, "b"], [364, "b"]]) {
  assert.equal(
    overlay.segments[String(segmentId)].junctionAttachments?.[endpoint]?.junctionId,
    "junction-custom-mrujg8lc",
  );
}
assert.equal(overlay.segments["363"]?.junctionAttachments, undefined);

console.log("current-data Rager, Sde Eliezer, and Horshat Tal junction regressions ok");
