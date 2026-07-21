import assert from "node:assert/strict";
import {
  baseOverlayContinuityIssue,
  recalculationResultMessage,
} from "../editor/lib/base-overlay-continuity.mjs";

const disconnected = {
  coverageRatio: 1,
  confidence: "high",
  gapCount: 0,
  continuityGapCount: 1,
  continuityGaps: [
    {
      fromEdgeId: "e248208200_1",
      toEdgeId: "manual-edge-mrtjsvs1",
      distanceMeters: 15,
    },
  ],
};

const issue = baseOverlayContinuityIssue(disconnected);
assert.equal(issue.count, 1);
assert.equal(issue.summary, "1 continuity gap");
assert.equal(issue.detail, "e248208200_1 → manual-edge-mrtjsvs1 (15 m)");

const result = recalculationResultMessage("#63", disconnected, (value) => `${value * 100}%`);
assert.equal(result.level, "error");
assert.match(result.message, /0 coverage gaps · 1 continuity gap/);
assert.match(result.message, /Cannot apply this mapping/);
assert.match(result.message, /e248208200_1 → manual-edge-mrtjsvs1 \(15 m\)/);

const connected = recalculationResultMessage(
  "#63",
  { coverageRatio: 1, confidence: "high", gapCount: 0, continuityGapCount: 0 },
  (value) => `${value * 100}%`,
);
assert.equal(connected.level, "info");
assert.equal(connected.continuity, null);
assert.match(connected.message, /0 coverage gaps\.$/);

const reviewedIssue = baseOverlayContinuityIssue(
  { continuityGapCount: 1, continuityGaps: [{ fromEdgeId: "stale", toEdgeId: "stale" }] },
  [{ fromEdgeId: "reviewed-a", toEdgeId: "reviewed-b", distanceMeters: 4.6 }],
);
assert.equal(reviewedIssue.detail, "reviewed-a → reviewed-b (5 m)");

console.log("base overlay continuity UX tests passed");
