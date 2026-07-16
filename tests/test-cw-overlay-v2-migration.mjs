import assert from "node:assert/strict";
import { buildMigrationProposal } from "../scripts/migrate-cw-base-overlay-v2.mjs";

const graph = {
  edges: [
    {
      id: "east",
      fromNodeId: "a",
      toNodeId: "b",
      coordinates: [[35, 33], [35.01, 33]],
      tags: { highway: "residential" },
    },
    {
      id: "new-east",
      fromNodeId: "c",
      toNodeId: "d",
      coordinates: [[35, 33], [35.01, 33]],
      tags: { highway: "cycleway" },
    },
  ],
};
const mapSource = {
  features: [
    {
      type: "Feature",
      properties: { id: 7, name: "Test", status: "active" },
      geometry: { type: "LineString", coordinates: [[35, 33], [35.01, 33]] },
    },
  ],
};
const overlayV1 = {
  schemaVersion: 1,
  segments: {
    "7": {
      segmentId: 7,
      segmentName: "Test",
      status: "accepted_edge_set",
      edgeRefs: [
        { edgeId: "east", direction: "forward", sequenceIndex: 0, fromFraction: 0, toFraction: 1 },
      ],
    },
    "8": { segmentId: 8, status: "accepted_edge_set", edgeRefs: [] },
  },
};
const publicIndexV1 = { schemaVersion: 1, segments: { "7": [[1, 0]] } };
const policyAudit = {
  policy: { policyId: "il-bicycle-v1" },
  policyDigest: "policy-digest",
  queues: { restricted: [], conditional: [], unknown: [] },
};

const first = buildMigrationProposal({
  overlayV1,
  publicIndexV1,
  mapSource,
  graph,
  policyAudit,
  graphDigest: "graph-digest",
});
const second = buildMigrationProposal({
  overlayV1,
  publicIndexV1,
  mapSource,
  graph,
  policyAudit,
  graphDigest: "graph-digest",
});
assert.deepEqual(first, second);
assert.equal(first.report.activeV1Mappings, 1);
assert.equal(first.report.archivedV1Mappings, 1);
assert.equal(first.report.classifications.symmetric_candidate, 1);
assert.equal(
  first.overlay.segments["7"].alignments.aToB.draft.candidate.kind,
  "v1-existing",
);
assert.equal(
  first.overlay.segments["7"].alignments.bToA.draft.candidate.kind,
  "exact-reverse",
);

const blocked = buildMigrationProposal({
  overlayV1,
  publicIndexV1,
  mapSource,
  graph,
  policyAudit: {
    ...policyAudit,
    queues: {
      restricted: [{ edgeId: "east", direction: "reverse", state: "prohibited", reason: "osm-oneway" }],
      conditional: [],
      unknown: [],
    },
  },
  graphDigest: "graph-digest",
});
assert.equal(blocked.report.classifications.single_direction_candidate, 1);
assert.equal(
  blocked.overlay.segments["7"].alignments.bToA.draft.candidate.kind,
  "opposite-alignment-required",
);

const evidenceNeeded = buildMigrationProposal({
  overlayV1,
  publicIndexV1,
  mapSource,
  graph,
  policyAudit: {
    ...policyAudit,
    queues: {
      restricted: [],
      conditional: [],
      unknown: [{
        edgeId: "east",
        direction: "forward",
        state: "unknown",
        reason: "manual-unreviewed",
      }],
    },
  },
  graphDigest: "graph-digest",
});
assert.equal(evidenceNeeded.report.classifications.direction_evidence_needed, 1);
assert.equal(evidenceNeeded.report.classifications.invalid_existing, undefined);

const mapSourceWithNewSegment = {
  features: [
    ...mapSource.features,
    {
      type: "Feature",
      properties: { id: 9, name: "New cycleway", status: "active" },
      geometry: { type: "LineString", coordinates: [[35, 33], [35.01, 33]] },
    },
  ],
};
const withNewAuthoringSegment = buildMigrationProposal({
  overlayV1,
  authoringOverlayV1: {
    schemaVersion: 1,
    segments: {
      ...overlayV1.segments,
      "9": {
        segmentId: 9,
        segmentName: "New cycleway",
        source: "edge_pick",
        status: "accepted_edge_set",
        updatedAt: "2026-07-16T12:00:00.000Z",
        edgeRefs: [
          { edgeId: "new-east", direction: "forward", sequenceIndex: 0, fromFraction: 0, toFraction: 1 },
        ],
      },
    },
  },
  publicIndexV1,
  mapSource: mapSourceWithNewSegment,
  graph,
  policyAudit,
  graphDigest: "graph-digest",
});
assert.equal(withNewAuthoringSegment.report.activeV1Mappings, 1);
assert.equal(withNewAuthoringSegment.report.activeAuthoringSegments, 2);
assert.equal(withNewAuthoringSegment.report.newAuthoringSegments, 1);
assert.equal(withNewAuthoringSegment.report.proposedSegments, 2);
assert.equal(withNewAuthoringSegment.report.automaticallyPublishedAuthoringSegments, 1);
assert.equal(
  withNewAuthoringSegment.overlay.segments["9"].alignments.aToB.published.disposition,
  "accepted",
);
assert.equal(
  withNewAuthoringSegment.overlay.segments["9"].migration.sourceMappingOrigin,
  "authoring-v1",
);
assert.equal(
  withNewAuthoringSegment.overlay.segments["9"].alignments.bToA.published.realization.type,
  "reverseOf",
);
assert.equal(
  withNewAuthoringSegment.overlay.segments["9"].alignments.aToB.published.review.acceptanceBasis,
  "automatic-bidirectional-authoring",
);

const conflictingAuthoringSegment = buildMigrationProposal({
  overlayV1,
  authoringOverlayV1: {
    schemaVersion: 1,
    segments: {
      ...overlayV1.segments,
      "9": {
        segmentId: 9,
        segmentName: "Conflicting cycleway",
        source: "edge_pick",
        status: "accepted_edge_set",
        updatedAt: "2026-07-16T12:00:00.000Z",
        edgeRefs: [
          { edgeId: "east", direction: "forward", sequenceIndex: 0, fromFraction: 0, toFraction: 1 },
        ],
      },
    },
  },
  publicIndexV1,
  mapSource: mapSourceWithNewSegment,
  graph,
  policyAudit,
  graphDigest: "graph-digest",
});
assert.equal(conflictingAuthoringSegment.report.automaticallyPublishedAuthoringSegments, 0);
assert.equal(
  conflictingAuthoringSegment.overlay.segments["9"].alignments.aToB.draft.candidate.kind,
  "new-authoring",
);
assert.ok(
  conflictingAuthoringSegment.report.queue.some(
    (item) => item.segmentId === 9 && item.code === "automatic_authoring_ownership_conflict",
  ),
);

console.log("CW Overlay V2 migration ok");
