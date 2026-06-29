// tests/test-navigation-replay.mjs
import assert from "node:assert/strict";
import { navigationRouteFromRouteState } from "@cycleways/core/navigation/navigationRoute.js";
import { replaySession } from "@cycleways/core/navigation/replayRunner.js";
import { NAV_ACTIONS } from "@cycleways/core/navigation/navigationSession.js";

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

  const withExcursion = generateTrack(route, {
    speedMps: 5,
    intervalMs: 1000,
    offRouteExcursion: {
      startMeters: 250,
      lengthMeters: 300,
      offsetMeters: 120,
    },
  });
  const maxLateralMeters = Math.max(
    ...withExcursion.map((fix) => Math.abs(fix.lat - 33.1) * 111320),
  );
  assert.ok(maxLateralMeters > 110, "excursion moves the replay well away from the route");
  assert.ok(
    Math.abs(withExcursion.at(-1).lat - 33.1) * 111320 < 1,
    "excursion returns to the main route",
  );
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

// --- synthetic multi-segment milestones (acquisition + segment context + completion) ---
// Deterministic end-to-end coverage of the segment-context pipeline through the
// real session. SYNTHETIC stand-in; a real on-device recording is a follow-up.
{
  const path = fileURLToPath(
    new URL("./fixtures/nav-ride-synthetic-multiseg.json", import.meta.url),
  );
  const fx = JSON.parse(readFileSync(path, "utf8"));
  const route = navigationRouteFromRouteState(fx.routeState, { param: "synth-multiseg" });
  const fixes = generateTrack(route, {
    speedMps: 5,
    intervalMs: 1000,
    jitterM: 5,
    seed: 42,
    approachFrom: { lat: 33.1, lng: 35.5989 }, // ~100 m before the route start
  });
  const { timeline, last } = replaySession(route, fixes);

  // Early approach fixes are not yet acquired.
  for (let i = 0; i < 5; i++) {
    assert.equal(timeline[i].status, "approaching", `synth fix ${i} approaching`);
    assert.equal(timeline[i].progress.hasAcquiredRoute, false, `synth fix ${i} not acquired`);
  }
  // The route is acquired later in the ride.
  assert.ok(
    timeline.some((s) => s.progress.hasAcquiredRoute === true),
    "synth: route acquired once the rider reaches it",
  );
  // Progress is ~monotonic once acquired (jitter tolerance).
  let prev = 0;
  for (const s of timeline) {
    if (!s.progress.hasAcquiredRoute) continue;
    assert.ok(
      s.progress.progressMeters >= prev - 12,
      "synth: progress stays ~monotonic under jitter",
    );
    prev = Math.max(prev, s.progress.progressMeters);
  }
  // The named-segment context advances from the first span to the second.
  const acquired = timeline.filter((s) => s.progress.hasAcquiredRoute);
  assert.ok(
    acquired.some((s) => s.progress.currentSegmentName === "שביל הראשון"),
    "synth: rides the first named segment",
  );
  assert.ok(
    acquired.some((s) => s.progress.currentSegmentName === "שביל השני"),
    "synth: context advances to the second named segment",
  );
  // The ride completes.
  assert.ok(last.progress.fraction > 0.9, "synth: ride completes");
}

// --- connector replay records requesting, active, and handoff transitions ---
{
  const route = straightRoute();
  const fixes = [
    { lat: 33.105, lng: 35.6, accuracy: 5, speed: 4, timestamp: 1000 },
    { lat: 33.1025, lng: 35.6, accuracy: 5, speed: 4, timestamp: 4000 },
    { lat: 33.1, lng: 35.6, accuracy: 5, speed: 4, timestamp: 7000 },
    { lat: 33.1, lng: 35.604, accuracy: 5, speed: 4, timestamp: 10000 },
  ];
  const { timeline, last } = replaySession(route, fixes, {
    connectorRouter: (request) => ({ geometry: [request.from, request.to] }),
  });
  assert.ok(
    timeline.some((entry) => entry.connector.status === "requesting"),
    "timeline records the request transition",
  );
  assert.ok(
    timeline.some((entry) => entry.status === "on-connector"),
    "timeline records the active connector",
  );
  assert.equal(last.status, "navigating");
  assert.ok(last.progress.progressMeters > 300);
}

// --- controlled mode permits deterministic stale-result ordering ---------
{
  const firstFix = {
    lat: 33.105,
    lng: 35.6,
    accuracy: 5,
    speed: 4,
    timestamp: 1000,
  };
  const replay = replaySession(straightRoute(), [firstFix], {
    controlledConnector: true,
  });
  const first = replay.routeRequests[0];
  replay.session.dispatch({
    type: NAV_ACTIONS.CONNECTOR_FAILED,
    requestId: first.requestId,
    reason: "transient",
  });
  replay.session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { ...firstFix, timestamp: 5000 },
  });
  const second = replay.session.getState().routeRequest;
  assert.ok(second.requestId > first.requestId);
  replay.session.dispatch({
    type: NAV_ACTIONS.CONNECTOR_READY,
    requestId: first.requestId,
    geometry: [first.from, first.to],
    distanceMeters: 500,
  });
  assert.equal(replay.session.getState().connector.requestId, second.requestId);
  assert.equal(replay.session.getState().connector.status, "requesting");
}

console.log("test-navigation-replay OK");
