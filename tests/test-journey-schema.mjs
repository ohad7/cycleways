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
  journeySchemaVersion: 2,
  entryMode: "ride-intro",
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
  bookmarks: [
    {
      id: "intro",
      phase: "pre-start",
      startAction: "hold",
      targetTimestamp: 0,
      preRollMs: 0,
      holdMs: 0,
      expectedStage: "intro-start-facing",
    },
    {
      id: "b1",
      phase: "post-start",
      startAction: "require-confirm",
      targetTimestamp: 3000,
      preRollMs: 2000,
      holdMs: 1000,
      expectedStage: "ride",
    },
  ],
};
assert.equal(validateResolvedJourney(journey), journey);
assert.deepEqual(bookmarkPlaybackWindow(fixes, journey.bookmarks[0]), {
  warmupEndIndex: -1,
  startIndex: 0,
  endIndex: 4,
});
assert.deepEqual(bookmarkPlaybackWindow(fixes, journey.bookmarks[1]), {
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
assert.throws(
  () => validateResolvedJourney({
    ...journey,
    entryMode: "session",
  }),
  /entryMode must be/,
);
assert.throws(
  () => validateResolvedJourney({
    ...journey,
    bookmarks: journey.bookmarks.map((bookmark) => ({
      ...bookmark,
      phase: "post-start",
      startAction: "require-confirm",
    })),
  }),
  /requires exactly one pre-start/,
);
assert.throws(
  () => validateResolvedJourney({
    ...journey,
    bookmarks: [
      { ...journey.bookmarks[0], targetTimestamp: 1000 },
      journey.bookmarks[1],
    ],
  }),
  /must target the first fix/,
);

console.log("journey schema tests passed");
