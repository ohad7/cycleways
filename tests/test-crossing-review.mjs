import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  crossingIssue,
  joinCrossingReviews,
} from "../editor/lib/crossingReview.mjs";

const fixture = JSON.parse(await readFile(new URL("./fixtures/crossing-review-cases.json", import.meta.url)));
const joined = joinCrossingReviews(fixture.candidates, fixture.reviews);
assert.deepEqual(joined.summary, {
  total: 3, accepted: 1, rejected: 0, pending: 1,
  staleAccepted: 0, staleRejected: 1, manual: 1,
  invalid: 0, orphaned: 1, warnings: 3,
});
assert.deepEqual(joined.runtimeCrossings.map((crossing) => crossing.id), ["crossing-accepted", "manual-crossing-1"]);
assert.deepEqual(joined.runtimeCrossings[0].mappings.map((mapping) => mapping.id), ["mapping-forward"]);
assert.equal(joined.blockingIssues.length, 0);
assert.equal(crossingIssue({ ...fixture.candidates.crossings[0], mappings: [] }, { requireFingerprint: true }), "invalid_crossing_mappings");

const staleAccepted = structuredClone(fixture.reviews);
staleAccepted.reviews["crossing-accepted"].candidateFingerprint = "sha256:old";
assert.ok(joinCrossingReviews(fixture.candidates, staleAccepted).blockingIssues.some((issue) => issue.code === "stale_accepted_reviews"));

console.log("crossing review tests passed");
