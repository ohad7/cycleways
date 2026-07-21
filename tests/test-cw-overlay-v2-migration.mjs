import assert from "node:assert/strict";
import { buildMigrationProposal } from "../scripts/migrate-cw-base-overlay-v2.mjs";
import { isActiveCwOverlaySegment } from "../editor/lib/cw-overlay-v2.mjs";

assert.equal(isActiveCwOverlaySegment({ lifecycleStatus: "active" }), true);
assert.equal(isActiveCwOverlaySegment({}), true);
assert.equal(isActiveCwOverlaySegment({ lifecycleStatus: "deprecated" }), false);
assert.equal(isActiveCwOverlaySegment({ lifecycleStatus: "draft" }), false);
assert.equal(isActiveCwOverlaySegment({ lifecycleStatus: "legacy" }), false);

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

const revisedAuthoringOverlay = structuredClone(overlayV1);
revisedAuthoringOverlay.segments["7"] = {
  ...revisedAuthoringOverlay.segments["7"],
  source: "changed_queue_auto_match",
  updatedAt: "2026-07-20T12:00:00.000Z",
  edgeRefs: [
    { edgeId: "new-east", direction: "forward", sequenceIndex: 0, fromFraction: 0, toFraction: 1 },
  ],
};
const withLegacyAuthoringRevision = buildMigrationProposal({
  overlayV1,
  authoringOverlayV1: revisedAuthoringOverlay,
  publicIndexV1,
  mapSource,
  graph,
  policyAudit,
  graphDigest: "graph-digest",
});
assert.equal(withLegacyAuthoringRevision.report.authoringRevisedSegments, 1);
assert.equal(
  withLegacyAuthoringRevision.overlay.segments["7"].migration.sourceMappingOrigin,
  "authoring-v1-revision",
);
assert.equal(
  withLegacyAuthoringRevision.overlay.segments["7"].alignments.aToB.draft.candidate.kind,
  "authoring-revision",
);
assert.equal(
  withLegacyAuthoringRevision.overlay.segments["7"].alignments.aToB.draft.realization.edgeRefs[0].edgeId,
  "new-east",
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

const roundaboutGraph = {
  edges: [
    { id: "approach", fromNodeId: "a", toNodeId: "r0", coordinates: [[35, 33], [35.001, 33]], tags: { highway: "residential" } },
    { id: "r1", fromNodeId: "r0", toNodeId: "r1", coordinates: [[35.001, 33], [35.001, 33.001]], tags: { highway: "tertiary", junction: "roundabout", osmId: 1001 } },
    { id: "r2", fromNodeId: "r1", toNodeId: "r2", coordinates: [[35.001, 33.001], [35.002, 33.001]], tags: { highway: "tertiary", junction: "roundabout", osmId: 1001 } },
    { id: "r3", fromNodeId: "r2", toNodeId: "r3", coordinates: [[35.002, 33.001], [35.002, 33]], tags: { highway: "tertiary", junction: "roundabout", osmId: 1001 } },
    { id: "r4", fromNodeId: "r3", toNodeId: "r0", coordinates: [[35.002, 33], [35.001, 33]], tags: { highway: "tertiary", junction: "roundabout", osmId: 1001 } },
    { id: "exit", fromNodeId: "r2", toNodeId: "b", coordinates: [[35.002, 33.001], [35.003, 33.001]], tags: { highway: "residential" } },
  ],
};
const roundaboutOverlay = {
  schemaVersion: 1,
  segments: {
    "10": {
      segmentId: 10,
      segmentName: "Roundabout route",
      status: "accepted_edge_set",
      edgeRefs: ["approach", "r1", "r2", "exit"].map((edgeId, sequenceIndex) => ({
        edgeId,
        direction: "forward",
        sequenceIndex,
        fromFraction: 0,
        toFraction: 1,
      })),
    },
  },
};
const roundaboutPolicy = {
  ...policyAudit,
  queues: {
    restricted: ["r1", "r2", "r3", "r4"].map((edgeId) => ({
      edgeId,
      direction: "reverse",
      state: "prohibited",
      reason: "osm-roundabout-implied-oneway",
    })),
    conditional: [],
    unknown: [],
  },
};
const roundaboutRepair = buildMigrationProposal({
  overlayV1: roundaboutOverlay,
  publicIndexV1: { schemaVersion: 1, segments: { "10": [[10, 0]] } },
  mapSource: {
    features: [{
      type: "Feature",
      properties: { id: 10, name: "Roundabout route", status: "active" },
      geometry: { type: "LineString", coordinates: [[35, 33], [35.003, 33.001]] },
    }],
  },
  graph: roundaboutGraph,
  policyAudit: roundaboutPolicy,
  graphDigest: "roundabout-graph",
});
const repairedReverse = roundaboutRepair.overlay.segments["10"].alignments.bToA.draft;
assert.equal(roundaboutRepair.report.classifications.roundabout_reverse_candidate, 1);
assert.equal(repairedReverse.candidate.kind, "roundabout-repaired-reverse");
assert.equal(repairedReverse.validation.status, "valid");
assert.deepEqual(
  repairedReverse.realization.edgeRefs.map(({ edgeId, direction }) => [edgeId, direction]),
  [["exit", "reverse"], ["r3", "forward"], ["r4", "forward"], ["approach", "reverse"]],
);
assert.deepEqual(
  repairedReverse.candidate.repairs[0].blockedEdgeRefs.map(({ edgeId }) => edgeId),
  ["r2", "r1"],
);
assert.deepEqual(
  repairedReverse.candidate.repairs[0].replacementEdgeRefs.map(({ edgeId }) => edgeId),
  ["r3", "r4"],
);

const cwPrecedence = buildMigrationProposal({
  overlayV1,
  publicIndexV1,
  mapSource,
  graph,
  policyAudit: {
    ...policyAudit,
    queues: {
      restricted: [{ edgeId: "east", direction: "reverse", state: "prohibited", reason: "explicit-access-prohibited" }],
      conditional: [],
      unknown: [],
    },
  },
  graphDigest: "graph-digest",
});
assert.equal(cwPrecedence.report.classifications.symmetric_candidate, 1);
assert.equal(
  cwPrecedence.overlay.segments["7"].alignments.bToA.draft.candidate.kind,
  "exact-reverse",
);
assert.equal(
  cwPrecedence.overlay.segments["7"].alignments.bToA.draft.validation.policyPrecedence[0].reason,
  "accepted-cw-alignment",
);

const partialOverlay = structuredClone(overlayV1);
partialOverlay.segments["7"].edgeRefs[0].fromFraction = 0.2;
partialOverlay.segments["7"].edgeRefs[0].toFraction = 0.8;
const partialRestricted = buildMigrationProposal({
  overlayV1: partialOverlay,
  publicIndexV1,
  mapSource,
  graph,
  policyAudit: {
    ...policyAudit,
    queues: {
      restricted: [{ edgeId: "east", direction: "forward", state: "prohibited", reason: "explicit-access-prohibited" }],
      conditional: [],
      unknown: [],
    },
  },
  graphDigest: "graph-digest",
});
assert.equal(partialRestricted.report.classifications.unresolved, 1);
assert.equal(
  partialRestricted.overlay.segments["7"].alignments.aToB.draft.validation.reasons[0].reason,
  "cw-precedence-requires-full-edge",
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
