import assert from "node:assert/strict";
import {
  stitchCoordsFromEdgeRefs,
  validateEdgePickMapping,
  conflictingSegmentForEdge,
  orientAppendedEdgeRef,
  isCurrentV1Mapping,
  directedIntervalKey,
  validateDirectionReviewAlignment,
} from "../editor/lib/edge-pick.mjs";

// V1 status names are compatibility storage; both saved mapping kinds are current.
assert.equal(isCurrentV1Mapping({ status: "accepted_auto_match" }), true);
assert.equal(isCurrentV1Mapping({ status: "accepted_edge_set" }), true);
assert.equal(isCurrentV1Mapping({ status: "needs_edit" }), false);

// stitchCoordsFromEdgeRefs ---------------------------------------------------

// Two forward edges sharing an endpoint are stitched and the duplicate point is dropped.
{
  const edges = new Map([
    ["e1", { coordinates: [[0, 0], [1, 0]] }],
    ["e2", { coordinates: [[1, 0], [2, 0]] }],
  ]);
  const refs = [
    { edgeId: "e1", direction: "forward", sequenceIndex: 0 },
    { edgeId: "e2", direction: "forward", sequenceIndex: 1 },
  ];
  assert.deepEqual(stitchCoordsFromEdgeRefs(refs, edges), [
    [0, 0], [1, 0], [2, 0],
  ]);
}

// A reverse-direction edge has its coords reversed before stitching.
{
  const edges = new Map([
    ["e1", { coordinates: [[0, 0], [1, 0]] }],
    ["e2", { coordinates: [[2, 0], [1, 0]] }],
  ]);
  const refs = [
    { edgeId: "e1", direction: "forward", sequenceIndex: 0 },
    { edgeId: "e2", direction: "reverse", sequenceIndex: 1 },
  ];
  assert.deepEqual(stitchCoordsFromEdgeRefs(refs, edges), [
    [0, 0], [1, 0], [2, 0],
  ]);
}

// A single edge passes through unchanged.
{
  const edges = new Map([["e1", { coordinates: [[0, 0], [1, 1]] }]]);
  const refs = [{ edgeId: "e1", direction: "forward", sequenceIndex: 0 }];
  assert.deepEqual(stitchCoordsFromEdgeRefs(refs, edges), [[0, 0], [1, 1]]);
}

// Missing edge in the lookup yields an empty stitch (caller must validate first).
{
  const edges = new Map();
  const refs = [{ edgeId: "e1", direction: "forward", sequenceIndex: 0 }];
  assert.deepEqual(stitchCoordsFromEdgeRefs(refs, edges), []);
}

// Non-touching pair still concatenates (validation, not stitching, flags gaps).
{
  const edges = new Map([
    ["e1", { coordinates: [[0, 0], [1, 0]] }],
    ["e2", { coordinates: [[5, 5], [6, 6]] }],
  ]);
  const refs = [
    { edgeId: "e1", direction: "forward", sequenceIndex: 0 },
    { edgeId: "e2", direction: "forward", sequenceIndex: 1 },
  ];
  assert.deepEqual(stitchCoordsFromEdgeRefs(refs, edges), [
    [0, 0], [1, 0], [5, 5], [6, 6],
  ]);
}

console.log("stitchCoordsFromEdgeRefs ok");

// validateEdgePickMapping ----------------------------------------------------

// Empty edgeRefs is invalid (UI gate also blocks this, but the helper must too).
{
  const result = validateEdgePickMapping({
    segmentId: 99,
    edgeRefs: [],
    currentMappings: new Map(),
    continuityGaps: [],
  });
  assert.equal(result.ok, false);
  assert.equal(result.failureClass, "edge_pick_empty");
}

// Single edge with no continuity gaps passes.
{
  const result = validateEdgePickMapping({
    segmentId: 99,
    edgeRefs: [{ edgeId: "e1", direction: "forward", sequenceIndex: 0 }],
    currentMappings: new Map(),
    continuityGaps: [],
  });
  assert.equal(result.ok, true);
}

// Continuity gap reported by the caller produces edge_pick_gap.
{
  const result = validateEdgePickMapping({
    segmentId: 99,
    edgeRefs: [
      { edgeId: "e1", direction: "forward", sequenceIndex: 0 },
      { edgeId: "e2", direction: "forward", sequenceIndex: 1 },
    ],
    currentMappings: new Map(),
    continuityGaps: [{ sequenceIndex: 0, fromEdgeId: "e1", toEdgeId: "e2", distanceMeters: 42 }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.failureClass, "edge_pick_gap");
  assert.equal(result.gaps.length, 1);
}

// Edge owned by another accepted segment produces edge_pick_conflict.
{
  const current = new Map([
    ["e1", { segmentId: 7, segmentName: "Foo" }],
  ]);
  const result = validateEdgePickMapping({
    segmentId: 99,
    edgeRefs: [{ edgeId: "e1", direction: "forward", sequenceIndex: 0 }],
    currentMappings: current,
    continuityGaps: [],
  });
  assert.equal(result.ok, false);
  assert.equal(result.failureClass, "edge_pick_conflict");
  assert.equal(result.conflicts[0].segmentId, 7);
}

// Edge owned only by the *current* segment does not conflict (self-edits).
{
  const current = new Map([
    ["e1", { segmentId: 99, segmentName: "Self" }],
  ]);
  const result = validateEdgePickMapping({
    segmentId: 99,
    edgeRefs: [{ edgeId: "e1", direction: "forward", sequenceIndex: 0 }],
    currentMappings: current,
    continuityGaps: [],
  });
  assert.equal(result.ok, true);
}

console.log("validateEdgePickMapping ok");

// conflictingSegmentForEdge --------------------------------------------------

{
  const overlaySegments = {
    "10": { segmentId: 10, segmentName: "Alpha", status: "accepted_edge_set", edgeRefs: [{ edgeId: "e1" }, { edgeId: "e2" }] },
    "20": { segmentId: 20, segmentName: "Beta",  status: "needs_edit",        edgeRefs: [{ edgeId: "e3" }] },
    "30": { segmentId: 30, segmentName: "Gamma", status: "accepted_auto_match", edgeRefs: [{ edgeId: "e4" }] },
  };

  // e2 owned by Alpha (accepted_edge_set) → conflict
  assert.deepEqual(conflictingSegmentForEdge("e2", 99, overlaySegments), { segmentId: 10, segmentName: "Alpha" });

  // e3 only owned by needs_edit → not a conflict
  assert.equal(conflictingSegmentForEdge("e3", 99, overlaySegments), null);

  // e4 owned by Gamma (accepted_auto_match) → conflict
  assert.deepEqual(conflictingSegmentForEdge("e4", 99, overlaySegments), { segmentId: 30, segmentName: "Gamma" });

  // Same segment → not a conflict
  assert.equal(conflictingSegmentForEdge("e1", 10, overlaySegments), null);

  // Unknown edge → not a conflict
  assert.equal(conflictingSegmentForEdge("e99", 99, overlaySegments), null);
}

console.log("conflictingSegmentForEdge ok");

// orientAppendedEdgeRef ------------------------------------------------------

// Empty chain → new edge forward, sequenceIndex 0.
{
  const edges = new Map([["e1", { coordinates: [[0, 0], [1, 0]] }]]);
  const result = orientAppendedEdgeRef([], { edgeId: "e1" }, edges);
  assert.equal(result.length, 1);
  assert.equal(result[0].direction, "forward");
  assert.equal(result[0].sequenceIndex, 0);
}

// 1-edge chain: the user's exact reported bug.
// A.coords = (5,5) → (6,5). B.coords = (5,5) → (4,5).
// Picking A then B (both forward) leaves a gap between A.end=(6,5) and B.start=(5,5).
// But A.start=B.start, so flipping A to reverse makes A.end=(5,5) which matches B.start.
// orientAppendedEdgeRef should detect this and flip A.
{
  const edges = new Map([
    ["A", { coordinates: [[5, 5], [6, 5]] }],
    ["B", { coordinates: [[5, 5], [4, 5]] }],
  ]);
  const result = orientAppendedEdgeRef(
    [{ edgeId: "A", direction: "forward", sequenceIndex: 0 }],
    { edgeId: "B" },
    edges,
  );
  assert.equal(result.length, 2);
  assert.equal(result[0].direction, "reverse", "first edge should be flipped");
  assert.equal(result[1].direction, "forward", "second edge stays forward");
  assert.equal(result[1].sequenceIndex, 1);
}

// 1-edge chain: A.end == B.start already → no flip needed.
{
  const edges = new Map([
    ["A", { coordinates: [[0, 0], [1, 0]] }],
    ["B", { coordinates: [[1, 0], [2, 0]] }],
  ]);
  const result = orientAppendedEdgeRef(
    [{ edgeId: "A", direction: "forward", sequenceIndex: 0 }],
    { edgeId: "B" },
    edges,
  );
  assert.equal(result[0].direction, "forward");
  assert.equal(result[1].direction, "forward");
}

// 2+ edge chain: existing orientations locked; only new edge is oriented.
{
  const edges = new Map([
    ["A", { coordinates: [[0, 0], [1, 0]] }],
    ["B", { coordinates: [[1, 0], [2, 0]] }],
    ["C", { coordinates: [[3, 0], [2, 0]] }],
  ]);
  const result = orientAppendedEdgeRef(
    [
      { edgeId: "A", direction: "forward", sequenceIndex: 0 },
      { edgeId: "B", direction: "forward", sequenceIndex: 1 },
    ],
    { edgeId: "C" },
    edges,
  );
  assert.equal(result.length, 3);
  assert.equal(result[0].direction, "forward");
  assert.equal(result[1].direction, "forward");
  assert.equal(result[2].direction, "reverse", "C should be reversed to attach to B.end");
}

// Missing geometry → fall back to forward, don't crash.
{
  const edges = new Map();
  const result = orientAppendedEdgeRef(
    [{ edgeId: "A", direction: "forward", sequenceIndex: 0 }],
    { edgeId: "missing" },
    edges,
  );
  assert.equal(result.length, 2);
  assert.equal(result[1].direction, "forward");
}

console.log("orientAppendedEdgeRef ok");

// Direction Review validation ------------------------------------------------

{
  const edgeLookup = new Map([
    ["e1", { bicycleTraversal: { forward: "allowed", reverse: "prohibited", reverseReason: "osm-oneway" } }],
  ]);
  const forward = validateDirectionReviewAlignment({
    segmentId: 99,
    alignmentKey: "aToB",
    edgeRefs: [{ edgeId: "e1", direction: "forward" }],
    edgeLookup,
  });
  assert.equal(forward.ok, true);
  const reverse = validateDirectionReviewAlignment({
    segmentId: 99,
    alignmentKey: "bToA",
    edgeRefs: [{ edgeId: "e1", direction: "reverse" }],
    edgeLookup,
  });
  assert.equal(reverse.ok, false, "CW access precedence must not override one-way evidence");
  assert.equal(reverse.reasons[0].reason, "osm-oneway");

  const accessEdgeLookup = new Map([
    ["access", { bicycleTraversal: {
      reverse: "prohibited",
      reverseReason: "explicit-access-prohibited",
    } }],
  ]);
  const accessReverse = validateDirectionReviewAlignment({
    segmentId: 99,
    alignmentKey: "bToA",
    edgeRefs: [{ edgeId: "access", direction: "reverse" }],
    edgeLookup: accessEdgeLookup,
  });
  assert.equal(accessReverse.ok, true);
  assert.deepEqual(accessReverse.policyPrecedence, [{
    edgeId: "access",
    direction: "reverse",
    baseState: "prohibited",
    baseReason: "explicit-access-prohibited",
    effectiveState: "allowed",
    reason: "accepted-cw-alignment",
  }]);

  const partialReverse = validateDirectionReviewAlignment({
    segmentId: 99,
    alignmentKey: "bToA",
    edgeRefs: [{ edgeId: "access", direction: "reverse", fromFraction: 0.2, toFraction: 0.8 }],
    edgeLookup: accessEdgeLookup,
  });
  assert.equal(partialReverse.ok, false);
  assert.equal(partialReverse.reasons[0].reason, "cw-precedence-requires-full-edge");

  const unknown = validateDirectionReviewAlignment({
    segmentId: 99,
    alignmentKey: "bToA",
    edgeRefs: [{ edgeId: "unknown", direction: "reverse" }],
    edgeLookup: new Map([["unknown", { bicycleTraversal: { reverse: "unknown" } }]]),
  });
  assert.equal(unknown.ok, false, "unknown evidence remains fail-closed");
}

{
  const ref = { edgeId: "e1", direction: "forward", fromFraction: 0, toFraction: 1 };
  const owners = new Map([
    [directedIntervalKey(ref), { segmentId: 7, alignmentKey: "aToB" }],
  ]);
  const conflict = validateDirectionReviewAlignment({
    segmentId: 8,
    alignmentKey: "aToB",
    edgeRefs: [ref],
    edgeLookup: new Map([["e1", { bicycleTraversal: { forward: "allowed" } }]]),
    directedOwners: owners,
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.reasons[0].code, "directed_ownership_conflict");
  const opposite = validateDirectionReviewAlignment({
    segmentId: 8,
    alignmentKey: "bToA",
    edgeRefs: [{ ...ref, direction: "reverse" }],
    edgeLookup: new Map([["e1", { bicycleTraversal: { reverse: "allowed" } }]]),
    directedOwners: owners,
  });
  assert.equal(opposite.ok, true, "opposite directed ownership is independent");
}

console.log("validateDirectionReviewAlignment ok");
