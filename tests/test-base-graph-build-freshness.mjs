import assert from "node:assert/strict";
import {
  baseGraphFreshnessReason,
  compareBaseGraphBuildInputs,
} from "../editor/lib/base-graph-build-freshness.mjs";

const snapshot = (manualDigest = "sha256:manual-a") => ({
  schemaVersion: 1,
  files: {
    rawOsmWays: { exists: true, digest: "sha256:raw" },
    osmIntersections: { exists: true, digest: "sha256:intersections" },
    manualBaseEdges: { exists: true, digest: manualDigest },
    bicycleTraversalOverrides: { exists: false, digest: null },
  },
});

assert.deepEqual(compareBaseGraphBuildInputs(snapshot(), snapshot()), {
  comparable: true,
  fresh: true,
  mismatches: [],
});

const changed = compareBaseGraphBuildInputs(snapshot(), snapshot("sha256:manual-b"));
assert.equal(changed.comparable, true);
assert.equal(changed.fresh, false);
assert.deepEqual(changed.mismatches.map((item) => item.key), ["manualBaseEdges"]);
assert.equal(changed.mismatches[0].reason, "content-changed");
assert.match(baseGraphFreshnessReason(changed), /manual base edges/);

const legacy = compareBaseGraphBuildInputs(null, snapshot());
assert.equal(legacy.comparable, false);
assert.equal(legacy.fresh, false);
assert.equal(legacy.mismatches.length, 4);

const appeared = compareBaseGraphBuildInputs(
  snapshot(),
  {
    ...snapshot(),
    files: {
      ...snapshot().files,
      bicycleTraversalOverrides: { exists: true, digest: "sha256:overrides" },
    },
  },
);
assert.equal(appeared.mismatches[0].reason, "existence-changed");

console.log("Base graph build freshness tests passed");
