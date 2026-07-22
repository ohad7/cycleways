import assert from "node:assert/strict";
import { projectCwOverlayV2Compatibility } from "../editor/lib/cw-overlay-v2.mjs";

const ref = (edgeId, direction, sequenceIndex) => ({
  edgeId,
  direction,
  sequenceIndex,
  fromFraction: 0,
  toFraction: 1,
});

const overlay = {
  schemaVersion: 2,
  updatedAt: "2026-07-22T00:00:00.000Z",
  segments: {
    159: {
      segmentId: 159,
      segmentName: "Road 90",
      lifecycleStatus: "active",
      navigable: true,
      alignments: {
        aToB: {
          published: {
            disposition: "accepted",
            realization: {
              type: "explicit",
              edgeRefs: [ref("edge-a", "forward", 0), ref("edge-b", "reverse", 1)],
            },
          },
        },
        bToA: {
          published: {
            disposition: "accepted",
            realization: {
              type: "explicit",
              edgeRefs: [ref("edge-c", "forward", 0)],
            },
          },
        },
      },
    },
    999: {
      segmentId: 999,
      segmentName: "Deprecated",
      lifecycleStatus: "deprecated",
      navigable: false,
      alignments: {},
    },
  },
};

const compatibility = projectCwOverlayV2Compatibility(overlay);

assert.equal(compatibility.schemaVersion, 1);
assert.equal(compatibility.sourceSchemaVersion, 2);
assert.equal(compatibility.compatibilityOnly, true);
assert.deepEqual(Object.keys(compatibility.segments), ["159"]);
assert.equal(compatibility.segments["159"].status, "accepted_auto_match");
assert.equal(compatibility.segments["159"].source, "v2_compatibility_projection");
assert.deepEqual(
  compatibility.segments["159"].edgeRefs.map(({ edgeId, direction, sequenceIndex }) => ({
    edgeId,
    direction,
    sequenceIndex,
  })),
  [
    { edgeId: "edge-a", direction: "forward", sequenceIndex: 0 },
    { edgeId: "edge-b", direction: "reverse", sequenceIndex: 1 },
  ],
);

console.log("editor overlay V2 cutover tests passed");
