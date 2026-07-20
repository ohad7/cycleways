import assert from "node:assert/strict";
import {
  copiedManualEdgeTraversal,
  manualEdgeDirectionDefaultLabel,
  newManualEdgeBidirectionalTraversal,
} from "../editor/lib/manual-edge-direction-defaults.mjs";

const authored = newManualEdgeBidirectionalTraversal({ reviewedAt: "2026-07-20" });
assert.deepEqual(authored, {
  forward: "allowed",
  reverse: "allowed",
  reviewed: true,
  reviewer: "ohad",
  reviewedAt: "2026-07-20",
  rationale: "Curator-authored manual edge; bidirectional default",
  origin: "manual-authoring-default",
});
assert.equal(manualEdgeDirectionDefaultLabel(authored), "Bidirectional · default for manual edges");

const copiedOneWay = copiedManualEdgeTraversal(
  { forward: "allowed", reverse: "prohibited" },
  { reviewedAt: "2026-07-20", sourceEdgeId: "e1" },
);
assert.equal(copiedOneWay.forward, "allowed");
assert.equal(copiedOneWay.reverse, "prohibited");
assert.equal(copiedOneWay.reviewed, true);
assert.equal(copiedOneWay.origin, "inherited-osm-policy");
assert.match(copiedOneWay.rationale, /e1/);
assert.equal(
  manualEdgeDirectionDefaultLabel(copiedOneWay),
  "Direction inherited from the copied OSM edge",
);

assert.deepEqual(
  copiedManualEdgeTraversal(
    { forward: "unknown", reverse: "unknown" },
    { reviewedAt: "2026-07-20", sourceEdgeId: "e2" },
  ),
  { forward: "unknown", reverse: "unknown", reviewed: false },
);

console.log("manual edge direction default tests passed");
