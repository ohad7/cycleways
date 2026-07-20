import assert from "node:assert/strict";
import {
  applyManualBidirectionalReview,
  buildDirectionReviewEvidenceRows,
  buildDirectionReviewIssueRows,
  directionReviewSegmentResolved,
  filterDirectionReviewEvidenceRows,
  filterDirectionReviewRows,
  manualBidirectionalResolutionCandidate,
} from "../editor/lib/direction-review-issues.mjs";

function slot({ published = null, reasons = [] } = {}) {
  return {
    published,
    draft: published
      ? null
      : {
          disposition: "needs_review",
          validation: { status: reasons.length > 0 ? "invalid" : "valid", reasons },
        },
  };
}

const accepted = { disposition: "accepted" };
const overlay = {
  segments: {
    "1": {
      segmentId: 1,
      segmentName: "Accepted road",
      migration: { classification: "symmetric_candidate" },
      alignments: { aToB: slot({ published: accepted }), bToA: slot({ published: accepted }) },
    },
    "2": {
      segmentId: 2,
      segmentName: "Dirt path",
      migration: { classification: "direction_evidence_needed" },
      alignments: {
        aToB: slot({ reasons: [{ code: "non_allowed_traversal", edgeId: "manual-a", state: "unknown", reason: "manual-unreviewed" }] }),
        bToA: slot({ reasons: [{ code: "non_allowed_traversal", edgeId: "manual-a", state: "unknown", reason: "manual-unreviewed" }] }),
      },
    },
    "3": {
      segmentId: 3,
      segmentName: "Second dirt path",
      migration: { classification: "direction_evidence_needed" },
      alignments: {
        aToB: slot({ reasons: [{ code: "non_allowed_traversal", edgeId: "manual-a", state: "unknown", reason: "manual-unreviewed" }] }),
        bToA: slot({ reasons: [{ code: "non_allowed_traversal", edgeId: "manual-b", state: "unknown", reason: "manual-unreviewed" }] }),
      },
    },
    "4": {
      segmentId: 4,
      segmentName: "One way",
      migration: { classification: "single_direction_candidate" },
      alignments: {
        aToB: slot(),
        bToA: slot({ reasons: [{ code: "non_allowed_traversal", edgeId: "osm-one-way", state: "prohibited", reason: "osm-oneway" }] }),
      },
    },
    "5": {
      segmentId: 5,
      segmentName: "Roundabout repaired",
      migration: { classification: "roundabout_reverse_candidate" },
      alignments: { aToB: slot(), bToA: slot() },
    },
  },
};

const rows = buildDirectionReviewIssueRows(overlay);
assert.equal(rows.length, 5);
assert.equal(rows.filter((row) => !row.resolved).length, 4);
assert.equal(directionReviewSegmentResolved(overlay.segments["1"]), true);
assert.deepEqual(
  filterDirectionReviewRows(rows, { filter: "direction_evidence_needed" }).map((row) => row.segmentId),
  [2, 3],
);
assert.deepEqual(
  filterDirectionReviewRows(rows, { filter: "issues", query: "one way" }).map((row) => row.segmentId),
  [4],
);
assert.deepEqual(
  filterDirectionReviewRows(rows, { filter: "accepted" }).map((row) => row.segmentId),
  [1],
);
assert.deepEqual(
  filterDirectionReviewRows(rows, { filter: "roundabout_reverse_candidate" }).map((row) => row.segmentId),
  [5],
);

const evidence = buildDirectionReviewEvidenceRows(overlay);
assert.deepEqual(evidence.map((row) => row.edgeId), ["manual-a", "manual-b"]);
assert.equal(evidence[0].segmentCount, 2);
assert.equal(evidence[0].dependencies.length, 3, "both directions remain visible for one segment");
assert.deepEqual(
  filterDirectionReviewEvidenceRows(evidence, "second dirt").map((row) => row.edgeId),
  ["manual-a", "manual-b"],
);
assert.deepEqual(manualBidirectionalResolutionCandidate(overlay.segments["2"]), {
  eligible: true,
  edgeIds: ["manual-a"],
  otherReasons: [],
});
assert.equal(manualBidirectionalResolutionCandidate(overlay.segments["4"]).eligible, false);

const manualEdges = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        manualEdgeId: "manual-a",
        bicycleTraversal: { forward: "unknown", reverse: "unknown", reviewed: false },
      },
      geometry: { type: "LineString", coordinates: [[35, 33], [35.1, 33.1]] },
    },
    {
      type: "Feature",
      properties: {
        manualEdgeId: "manual-b",
        bicycleTraversal: { forward: "allowed", reverse: "allowed", reviewed: true },
      },
      geometry: { type: "LineString", coordinates: [[35.1, 33.1], [35.2, 33.2]] },
    },
  ],
};
const applied = applyManualBidirectionalReview(manualEdges, {
  edgeIds: ["manual-a", "manual-b"],
  reviewer: "Reviewer",
  reviewedAt: "2026-07-17",
  rationale: "Reviewed against the selected segment",
  evidence: "Direction Review #2",
  updatedAt: "2026-07-17T00:00:00.000Z",
});
assert.deepEqual(applied.updatedEdgeIds, ["manual-a"]);
assert.deepEqual(applied.alreadyAllowedEdgeIds, ["manual-b"]);
assert.deepEqual(applied.manualBaseEdges.features[0].properties.bicycleTraversal, {
  forward: "allowed",
  reverse: "allowed",
  reviewed: true,
  reviewer: "Reviewer",
  reviewedAt: "2026-07-17",
  rationale: "Reviewed against the selected segment",
  evidence: "Direction Review #2",
});
assert.throws(
  () => applyManualBidirectionalReview(manualEdges, {
    edgeIds: ["missing"], reviewer: "R", reviewedAt: "2026-07-17",
    rationale: "R", updatedAt: "2026-07-17T00:00:00.000Z",
  }),
  /Missing manual base edges/,
);
const conflictingManualEdges = structuredClone(manualEdges);
conflictingManualEdges.features[0].properties.bicycleTraversal = {
  forward: "allowed", reverse: "prohibited", reviewed: true,
};
assert.throws(
  () => applyManualBidirectionalReview(conflictingManualEdges, {
    edgeIds: ["manual-a"], reviewer: "R", reviewedAt: "2026-07-17",
    rationale: "R", updatedAt: "2026-07-17T00:00:00.000Z",
  }),
  /allowed\/prohibited evidence/,
);

console.log("Direction Review issue queue ok");
