import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  filterRoundaboutItems,
  joinRoundaboutReviews,
  roundaboutReviewGeoJson,
} from "../editor/lib/roundaboutReview.mjs";

const fixture = JSON.parse(await readFile(new URL("./fixtures/roundabout-review-cases.json", import.meta.url)));
for (const testCase of fixture.cases) {
  const result = joinRoundaboutReviews(testCase.candidates, testCase.reviews);
  for (const key of ["total", "accepted", "rejected", "pending", "stale", "orphaned"]) {
    assert.equal(result.summary[key], testCase.expected[key], `${testCase.name}: ${key}`);
  }
  assert.deepEqual(result.blockingIssues.map((issue) => issue.code), testCase.expected.blockingCodes);
}

const joined = joinRoundaboutReviews(fixture.cases[0].candidates, fixture.cases[0].reviews);
assert.equal(filterRoundaboutItems(joined.items, "pending").length, 1);
assert.equal(filterRoundaboutItems(joined.items, "warnings").length, 0);
const geojson = roundaboutReviewGeoJson(joined);
assert.ok(geojson.lines.features.length > 0);

console.log("roundabout review conformance tests passed");
