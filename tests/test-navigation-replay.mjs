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

// --- synthetic generator ---
import { generateTrack } from "@cycleways/core/navigation/trackGenerator.js";
{
  const route = straightRoute();
  const fixes = generateTrack(route, { speedMps: 5, intervalMs: 1000, seed: 7 });
  assert.ok(fixes.length >= 2, "generator emits multiple fixes");
  assert.equal(fixes[0].timestamp, 0, "default start timestamp is 0");
  assert.equal(fixes[1].timestamp - fixes[0].timestamp, 1000, "interval honored");
  // Approach lead-in: fixes before the route start.
  const withApproach = generateTrack(route, {
    speedMps: 5,
    approachFrom: { lat: 33.1, lng: 35.594 }, // ~560 m west of start
  });
  const first = withApproach[0];
  const distToStart = Math.hypot((first.lat - 33.1), (first.lng - 35.6));
  assert.ok(distToStart > 0.001, "approach fixes start away from the route");
}

// --- realistic fixture milestones (EXPECTED TO FAIL until acquisition lands) ---
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
{
  const path = fileURLToPath(new URL("./fixtures/nav-ride-realistic.json", import.meta.url));
  const fx = JSON.parse(readFileSync(path, "utf8"));
  const route = navigationRouteFromRouteState(fx.route, { param: "fixture" });
  const { timeline, last } = replaySession(route, fx.fixes);

  // Before acquisition the session must NOT report on-route progress.
  for (let i = 0; i < fx.milestones.approachFixCount; i++) {
    assert.equal(
      timeline[i].progress.hasAcquiredRoute,
      false,
      `fix ${i} (approach) must not be acquired`,
    );
    assert.equal(
      timeline[i].progress.progressMeters,
      fx.milestones.minProgressBeforeAcquireM,
      `fix ${i} (approach) must not advance progress`,
    );
    assert.equal(timeline[i].status, "approaching", `fix ${i} status is approaching`);
  }
  assert.equal(
    timeline[fx.milestones.acquiredByFixIndex].progress.hasAcquiredRoute,
    true,
    "route acquired once the rider reaches it",
  );
  assert.ok(
    last.progress.progressMeters >= fx.milestones.finalProgressAtLeastM,
    "progress completes despite jitter, pause, and the GPS jump",
  );
}

console.log("test-navigation-replay OK");
