// tests/test-navigation-replay.mjs
import assert from "node:assert/strict";
import { navigationRouteFromRouteState } from "@cycleways/core/navigation/navigationRoute.js";
import { replaySession } from "@cycleways/core/navigation/replayRunner.js";

function straightRoute() {
  return navigationRouteFromRouteState(
    {
      points: [
        { id: "a", lat: 33.1, lng: 35.6 },
        { id: "b", lat: 33.1, lng: 35.61 },
      ],
      selectedSegments: [],
      geometry: [
        { lat: 33.1, lng: 35.6 },
        { lat: 33.1, lng: 35.605 },
        { lat: 33.1, lng: 35.61 },
      ],
      distance: 931.5,
    },
    { param: "straight" },
  );
}

// Runner drives the real session over a fix array and records one state per fix.
{
  const fixes = [
    { lat: 33.1, lng: 35.6, accuracy: 5, speed: 3, timestamp: 1000 },
    { lat: 33.1, lng: 35.605, accuracy: 5, speed: 3, timestamp: 4000 },
    { lat: 33.1, lng: 35.61, accuracy: 5, speed: 3, timestamp: 7000 },
  ];
  const { timeline, last } = replaySession(straightRoute(), fixes);
  assert.equal(timeline.length, 3, "one recorded state per fix");
  assert.ok(last.progress, "last state carries progress");
  assert.ok(
    last.progress.progressMeters > timeline[0].progress.progressMeters,
    "progress advances across the timeline",
  );
}

console.log("test-navigation-replay OK");
