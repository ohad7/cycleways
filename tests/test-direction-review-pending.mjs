import assert from "node:assert/strict";
import {
  emptyDirectionReviewPendingApprovals,
  normalizeDirectionReviewPendingApprovals,
  queueDirectionReviewPendingApproval,
  settleDirectionReviewPendingApprovals,
} from "../editor/lib/direction-review-pending.mjs";

const queued = queueDirectionReviewPendingApproval(emptyDirectionReviewPendingApprovals(), {
  segmentId: 2,
  segmentName: "Test segment",
  sourceGeometryDigest: "source-digest",
  edgeIds: ["manual-a", "manual-a"],
  alignmentMappingDigests: { aToB: "mapping-digest" },
  reviewer: "ohad",
  reviewedAt: "2026-07-17",
  batchId: "direction-review-2026-07-17",
  queuedAt: "2026-07-17T01:00:00.000Z",
});
assert.deepEqual(queued.items["2"].edgeIds, ["manual-a"]);

const failed = settleDirectionReviewPendingApprovals(queued, {
  failures: [{ segmentId: 2, error: "one-way conflict" }],
  attemptedAt: "2026-07-17T01:05:00.000Z",
});
assert.equal(failed.items["2"].lastError, "one-way conflict");

const completed = settleDirectionReviewPendingApprovals(failed, {
  completedSegmentIds: [2],
  attemptedAt: "2026-07-17T01:10:00.000Z",
});
assert.deepEqual(completed, emptyDirectionReviewPendingApprovals());
assert.throws(
  () => normalizeDirectionReviewPendingApprovals({ schemaVersion: 1, items: { bad: {} } }),
  /invalid segmentId/,
);

console.log("Direction Review pending approvals ok");
