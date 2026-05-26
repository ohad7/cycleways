import assert from "node:assert/strict";
import {
  stitchCoordsFromEdgeRefs,
  validateEdgePickMapping,
  conflictingSegmentForEdge,
} from "../editor/lib/edge-pick.mjs";

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
    acceptedMappings: new Map(),
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
    acceptedMappings: new Map(),
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
    acceptedMappings: new Map(),
    continuityGaps: [{ sequenceIndex: 0, fromEdgeId: "e1", toEdgeId: "e2", distanceMeters: 42 }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.failureClass, "edge_pick_gap");
  assert.equal(result.gaps.length, 1);
}

// Edge owned by another accepted segment produces edge_pick_conflict.
{
  const accepted = new Map([
    ["e1", { segmentId: 7, segmentName: "Foo" }],
  ]);
  const result = validateEdgePickMapping({
    segmentId: 99,
    edgeRefs: [{ edgeId: "e1", direction: "forward", sequenceIndex: 0 }],
    acceptedMappings: accepted,
    continuityGaps: [],
  });
  assert.equal(result.ok, false);
  assert.equal(result.failureClass, "edge_pick_conflict");
  assert.equal(result.conflicts[0].segmentId, 7);
}

// Edge owned only by the *current* segment does not conflict (self-edits).
{
  const accepted = new Map([
    ["e1", { segmentId: 99, segmentName: "Self" }],
  ]);
  const result = validateEdgePickMapping({
    segmentId: 99,
    edgeRefs: [{ edgeId: "e1", direction: "forward", sequenceIndex: 0 }],
    acceptedMappings: accepted,
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
