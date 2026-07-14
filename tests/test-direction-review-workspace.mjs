import assert from "node:assert/strict";
import {
  activationReadiness,
  cancelWorkspaceEntry,
  normalizeDirectionReviewWorkspace,
  reserveWorkspaceSegment,
} from "../editor/lib/direction-review-workspace.mjs";

const empty = { schemaVersion: 1, nextReservedSegmentId: 400, entries: {} };
const feature = {
  type: "Feature",
  properties: { name: "New divided corridor" },
  geometry: { type: "LineString", coordinates: [[35, 33], [35.01, 33]] },
};
const reserved = reserveWorkspaceSegment(empty, feature);
assert.equal(reserved.segmentId, 400);
assert.equal(reserved.workspace.entries["400"].logicalFeatureDraft.properties.status, "draft");
assert.equal(reserved.workspace.nextReservedSegmentId, 401);
assert.deepEqual(activationReadiness(reserved.workspace.entries["400"]), {
  ready: false,
  reasons: ["aToB:review_required", "bToA:review_required", "at_least_one_accepted_alignment_required"],
});

reserved.workspace.entries["400"].alignmentDrafts.aToB.reviewedDisposition = "accepted";
reserved.workspace.entries["400"].alignmentDrafts.aToB.validation.status = "valid";
reserved.workspace.entries["400"].alignmentDrafts.bToA.reviewedDisposition = "unavailable";
assert.deepEqual(activationReadiness(reserved.workspace.entries["400"]), { ready: true, reasons: [] });
assert.deepEqual(cancelWorkspaceEntry(reserved.workspace, 400).entries, {});

assert.throws(
  () => normalizeDirectionReviewWorkspace({ ...empty, nextReservedSegmentId: 0 }),
  /nextReservedSegmentId/,
);

console.log("Direction Review workspace ok");
