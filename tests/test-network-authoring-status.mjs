import assert from "node:assert/strict";
import {
  buildNetworkIssueRows,
  networkSegmentNeedsDirections,
  networkSegmentStatus,
} from "../editor/lib/network-authoring-status.mjs";

function accepted(realization) {
  return { disposition: "accepted", realization };
}

const symmetric = {
  segmentId: 62,
  segmentName: "Simple",
  alignments: {
    aToB: {
      published: accepted({ type: "explicit", edgeRefs: [{ edgeId: "a" }, { edgeId: "b" }, { edgeId: "c" }] }),
      draft: null,
    },
    bToA: {
      published: accepted({ type: "reverseOf", alignmentKey: "aToB" }),
      draft: null,
    },
  },
};
assert.deepEqual(networkSegmentStatus(symmetric), {
  key: "current",
  label: "Current",
  summary: "Bidirectional · 3 base edges",
  issue: null,
  directional: false,
  edgeCount: 3,
});
assert.equal(networkSegmentNeedsDirections(symmetric), false);

const gap = structuredClone(symmetric);
gap.segmentId = 63;
gap.segmentName = "Gap";
gap.alignments.aToB.published = null;
gap.alignments.bToA.published = null;
gap.alignments.aToB.draft = {
  validation: {
    status: "invalid",
    reasons: [{ code: "continuity_gap", fromEdgeId: "a", toEdgeId: "c", distanceMeters: 15 }],
  },
};
gap.alignments.bToA.draft = { validation: { status: "invalid", reasons: [] } };
const gapStatus = networkSegmentStatus(gap);
assert.equal(gapStatus.key, "blocked");
assert.equal(gapStatus.summary, "Disconnected base-edge sequence");
assert.match(gapStatus.detail, /a → c \(15 m\)/);

const choice = structuredClone(gap);
choice.segmentId = 174;
choice.alignments.aToB.draft = { validation: { status: "valid", reasons: [], policyPrecedence: [] } };
choice.alignments.bToA.draft = { validation: { status: "valid", reasons: [], policyPrecedence: [] } };
assert.equal(networkSegmentStatus(choice).key, "needs-decision");
assert.deepEqual(
  buildNetworkIssueRows({ segments: { "62": symmetric, "63": gap, "174": choice } }).map((row) => row.segmentId),
  [63, 174],
);

console.log("Network authoring status model ok");

