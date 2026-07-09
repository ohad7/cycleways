import assert from "node:assert/strict";
import {
  bookmarkPlaybackWindow,
  validateResolvedJourney,
} from "@cycleways/core/navigation/scenarios/journeySchema.js";

const fixes = [0, 1000, 2000, 3000, 4000].map((timestamp, index) => ({
  lat: 33.1,
  lng: 35.6 + index * 0.00004,
  speed: 4,
  timestamp,
}));

const journey = {
  name: "valid",
  journeySchemaVersion: 1,
  fixes,
  connectorResponses: [{
    id: "r1",
    match: {
      targetMode: "start",
      purpose: "initial",
      attempt: 1,
      from: fixes[0],
      to: fixes[4],
    },
    result: {
      geometry: [fixes[0], fixes[4]],
      distanceMeters: 15,
      edgeCosts: [],
      snappedEndpoints: [],
    },
  }],
  bookmarks: [{
    id: "b1",
    targetTimestamp: 3000,
    preRollMs: 2000,
    holdMs: 1000,
    expectedStage: "ride",
  }],
};
assert.equal(validateResolvedJourney(journey), journey);
assert.deepEqual(bookmarkPlaybackWindow(fixes, journey.bookmarks[0]), {
  warmupEndIndex: 0,
  startIndex: 1,
  endIndex: 3,
});
assert.throws(
  () => validateResolvedJourney({ ...journey, fixes: [fixes[1], fixes[0]] }),
  /timestamp is not monotonic/,
);
assert.throws(
  () => validateResolvedJourney({ ...journey, connectorResponses: [{ id: "x" }, { id: "x" }] }),
  /ids must be unique/,
);
assert.throws(
  () => validateResolvedJourney({
    ...journey,
    connectorResponses: [{
      ...journey.connectorResponses[0],
      match: { targetMode: "start" },
    }],
  }),
  /requires semantic target/,
);
assert.throws(
  () => validateResolvedJourney({
    ...journey,
    fixes: [fixes[0], { ...fixes[1], lng: 35.61, speed: 1 }],
  }),
  /moves at/,
);

console.log("journey schema tests passed");
