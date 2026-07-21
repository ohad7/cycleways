import assert from "node:assert/strict";
import {
  AUTHORING_REQUEST_ABORTED,
  BASE_EVIDENCE_SUPERSEDED,
  SOURCE_REVISION_SUPERSEDED,
  authoringObjectRevision,
  authoringSourceIsCurrent,
  bumpAuthoringObjectRevision,
  isAuthoringAbort,
  isCurrentAuthoringObjectRevision,
  isRetryableAuthoringConflict,
  mergeBaseGraphFeaturePatch,
  summarizeAuthoringTimings,
} from "../editor/lib/network-authoring-coordinator.mjs";

const revisions = new Map();
assert.equal(bumpAuthoringObjectRevision(revisions, 319), 1);
const firstRevision = authoringObjectRevision(revisions, 319);
assert.equal(bumpAuthoringObjectRevision(revisions, 319), 2);
assert.equal(isCurrentAuthoringObjectRevision(revisions, 319, firstRevision), false);
assert.equal(isCurrentAuthoringObjectRevision(revisions, 319, 2), true);

assert.equal(
  isRetryableAuthoringConflict(
    { code: SOURCE_REVISION_SUPERSEDED },
    { locallySuperseded: true },
  ),
  true,
);
assert.equal(
  isRetryableAuthoringConflict(
    { code: SOURCE_REVISION_SUPERSEDED },
    { locallySuperseded: false },
  ),
  false,
);
assert.equal(isRetryableAuthoringConflict({ code: BASE_EVIDENCE_SUPERSEDED }), true);
assert.equal(isAuthoringAbort({ name: "AbortError" }), true);
assert.equal(isAuthoringAbort({ code: AUTHORING_REQUEST_ABORTED }), true);
assert.equal(isAuthoringAbort(new Error("ordinary failure")), false);

assert.equal(
  authoringSourceIsCurrent({
    currentRevision: 4,
    snapshotRevision: 4,
    currentSerializedSource: "latest",
    snapshotSerializedSource: "latest",
  }),
  true,
);
assert.equal(
  authoringSourceIsCurrent({
    currentRevision: 5,
    snapshotRevision: 4,
    currentSerializedSource: "latest",
    snapshotSerializedSource: "latest",
  }),
  false,
);

assert.deepEqual(
  summarizeAuthoringTimings([
    { stage: "save source", durationMs: 12.2 },
    { stage: "match segment", durationMs: 842.8 },
    { stage: "validate mapping", durationMs: 47.1 },
  ]),
  { totalMs: 902, slowestStage: "match segment", slowestDurationMs: 843 },
);

const graph = {
  type: "FeatureCollection",
  metadata: { generatedAt: "old", retained: true },
  features: [
    { id: "osm-1", properties: { edgeId: "osm-1", source: "osm" } },
    { id: "manual-old", properties: { edgeId: "manual-old", source: "manual" } },
  ],
};
const patched = mergeBaseGraphFeaturePatch(graph, {
  replaceSources: ["manual"],
  metadata: { generatedAt: "new", graphStaleBecauseManualBaseEdgesChanged: false },
  features: [
    { id: "manual-new", properties: { edgeId: "manual-new", source: "manual" } },
  ],
});
assert.deepEqual(patched.features.map((feature) => feature.id), ["osm-1", "manual-new"]);
assert.equal(patched.metadata.generatedAt, "new");
assert.equal(patched.metadata.retained, true);
assert.equal(patched.metadata.graphStaleBecauseManualBaseEdgesChanged, false);
const osmPatched = mergeBaseGraphFeaturePatch(patched, {
  replaceSources: [],
  features: [
    { id: "osm-1", properties: { edgeId: "osm-1", source: "osm", reviewed: true } },
  ],
});
assert.equal(osmPatched.features.filter((feature) => feature.id === "osm-1").length, 1);
assert.equal(osmPatched.features.find((feature) => feature.id === "osm-1").properties.reviewed, true);

console.log("Network authoring coordinator rules ok");
