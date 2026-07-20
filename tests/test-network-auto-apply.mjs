import assert from "node:assert/strict";
import {
  automaticAcceptanceBasis,
  automaticBidirectionalDecision,
  automaticMatchQualityEligible,
  reverseDirectedEdgeRefs,
} from "../editor/lib/network-auto-apply.mjs";

const match = {
  failureClass: "accepted",
  reviewStatus: "auto_accept_candidate",
  confidence: "high",
  coverageRatio: 1,
  gapCount: 0,
  overmatchedEdgeCount: 0,
};
const valid = { ok: true, status: "valid", reasons: [], policyPrecedence: [] };

assert.equal(automaticMatchQualityEligible(match), true);
assert.equal(automaticMatchQualityEligible({ ...match, coverageRatio: 0.98 }), false);
assert.deepEqual(
  reverseDirectedEdgeRefs([
    { edgeId: "a", direction: "forward", sequenceIndex: 0, fromFraction: 0, toFraction: 1 },
    { edgeId: "b", direction: "reverse", sequenceIndex: 1, fromFraction: 0, toFraction: 1 },
  ]).map((ref) => [ref.edgeId, ref.direction, ref.sequenceIndex]),
  [["b", "forward", 0], ["a", "reverse", 1]],
);
assert.equal(
  automaticBidirectionalDecision({ match, forwardValidation: valid, reverseValidation: valid }).outcome,
  "apply",
);
assert.equal(
  automaticBidirectionalDecision({
    match,
    forwardValidation: { ...valid, policyPrecedence: [{ edgeId: "restricted" }] },
    reverseValidation: valid,
  }).code,
  "access_precedence",
);
assert.equal(
  automaticBidirectionalDecision({
    match,
    forwardValidation: valid,
    reverseValidation: { ok: false, reasons: [{ code: "continuity_gap" }] },
  }).outcome,
  "blocked",
);
assert.equal(
  automaticBidirectionalDecision({ match, forwardValidation: valid, reverseValidation: valid, intentionalAsymmetry: true }).outcome,
  "needs-decision",
);
assert.equal(automaticAcceptanceBasis({ intent: "explicit-selection" }), "explicit-authoring-safe-reverse");
assert.equal(automaticAcceptanceBasis({ intent: "migration-safe" }), "automatic-bidirectional-evidence");
assert.equal(automaticAcceptanceBasis({ roundaboutRepair: {} }), "automatic-roundabout-reverse");

console.log("Network automatic application rules ok");
