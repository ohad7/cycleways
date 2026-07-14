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

console.log("CW Overlay V2 migration ok");
