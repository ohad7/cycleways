import assert from "node:assert/strict";
import {
  BASE_EVIDENCE_SUPERSEDED,
  SOURCE_REVISION_SUPERSEDED,
  authoringObjectRevision,
  bumpAuthoringObjectRevision,
  isCurrentAuthoringObjectRevision,
  isRetryableAuthoringConflict,
  summarizeAuthoringTimings,
} from "../editor/lib/network-authoring-coordinator.mjs";

const revisions = new Map();
assert.equal(bumpAuthoringObjectRevision(revisions, 319), 1);
const firstRevision = authoringObjectRevision(revisions, 319);
assert.equal(bumpAuthoringObjectRevision(revisions, 319), 2);
assert.equal(isCurrentAuthoringObjectRevision(revisions, 319, firstRevision), false);
assert.equal(isCurrentAuthoringObjectRevision(revisions, 319, 2), true);

assert.equal(
  isRetryableAuthoringConflict(
    { code: SOURCE_REVISION_SUPERSEDED },
    { locallySuperseded: true },
  ),
  true,
);
assert.equal(
  isRetryableAuthoringConflict(
    { code: SOURCE_REVISION_SUPERSEDED },
    { locallySuperseded: false },
  ),
  false,
);
assert.equal(isRetryableAuthoringConflict({ code: BASE_EVIDENCE_SUPERSEDED }), true);

assert.deepEqual(
  summarizeAuthoringTimings([
    { stage: "save source", durationMs: 12.2 },
    { stage: "match segment", durationMs: 842.8 },
    { stage: "validate mapping", durationMs: 47.1 },
  ]),
  { totalMs: 902, slowestStage: "match segment", slowestDurationMs: 843 },
);

console.log("Network authoring coordinator rules ok");
