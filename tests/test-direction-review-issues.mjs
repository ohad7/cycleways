import assert from "node:assert/strict";
import {
  buildDirectionReviewEvidenceRows,
  buildDirectionReviewIssueRows,
  directionReviewSegmentResolved,
  filterDirectionReviewEvidenceRows,
  filterDirectionReviewRows,
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
  },
};

const rows = buildDirectionReviewIssueRows(overlay);
assert.equal(rows.length, 4);
assert.equal(rows.filter((row) => !row.resolved).length, 3);
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

const evidence = buildDirectionReviewEvidenceRows(overlay);
assert.deepEqual(evidence.map((row) => row.edgeId), ["manual-a", "manual-b"]);
assert.equal(evidence[0].segmentCount, 2);
assert.equal(evidence[0].dependencies.length, 3, "both directions remain visible for one segment");
assert.deepEqual(
  filterDirectionReviewEvidenceRows(evidence, "second dirt").map((row) => row.edgeId),
  ["manual-a", "manual-b"],
);

console.log("Direction Review issue queue ok");
