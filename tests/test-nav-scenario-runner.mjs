// tests/test-nav-scenario-runner.mjs
import assert from "node:assert/strict";
import { navigationRouteFromRouteState } from "@cycleways/core/navigation/navigationRoute.js";
import { generateTrack } from "@cycleways/core/navigation/trackGenerator.js";
import {
  buildUserTimeline,
  connectorRouterForMode,
  runScenario,
} from "@cycleways/core/navigation/scenarioRunner.js";

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
    { param: "runner-straight" },
  );
}

// Happy ride: timeline carries per-fix presentation and ends at the arrive cue.
{
  const route = straightRoute();
  const fixes = generateTrack(route, { speedMps: 5, intervalMs: 1000, seed: 7 });
  const { timeline, last } = runScenario({
    navigationRoute: route,
    fixes,
    connector: "straight-line",
  });
  assert.ok(timeline.length >= fixes.length, "one entry per fix at minimum");
  assert.equal(timeline[0].status, "navigating", "starts on-route");
  assert.equal(typeof timeline[0].presentation.cueText, "string");
  assert.ok(
    timeline[0].presentation.cueText.length > 0,
    "presentation strings are populated",
  );
  assert.equal(last.activeCueType, "arrive", "ride ends at the arrive cue");
  assert.ok(
    last.presentation.cueText.includes("הגעת ליעד"),
    "arrival banner text present",
  );
  assert.ok(
    timeline.some((e) => e.haptic !== null),
    "at least one haptic event planned",
  );
  assert.ok(
    timeline.some((e) => e.voiceText !== null),
    "at least one voice event planned",
  );
  assert.ok(
    Number(last.progressMeters) > 800,
    `progress completes, got ${last.progressMeters}`,
  );
  assert.ok(
    timeline.every((e) => typeof e.wrongWay === "boolean"),
    "every entry exposes the wrong-way flag",
  );
  assert.ok(
    timeline.every((e) => typeof e.cameraStage === "string"),
    "every entry carries the camera stage",
  );
  assert.ok(
    timeline.every((e) => typeof e.cardMode === "string"),
    "every entry carries the card mode",
  );
  assert.equal(timeline[timeline.length - 1].cameraStage, "arrived");
  assert.ok(
    timeline.some((e) => /הגעת ליעד/.test(e.voiceText || "")),
    "arrival voice text is present",
  );
  assert.ok(
    timeline.some((e) => Number.isFinite(e.cameraHeadingDeg)),
    "the governed camera heading is carried on the timeline",
  );
  const rotations = timeline.filter(
    (e, i) =>
      i > 0 &&
      Number.isFinite(e.cameraHeadingDeg) &&
      Number.isFinite(timeline[i - 1].cameraHeadingDeg) &&
      e.cameraHeadingDeg !== timeline[i - 1].cameraHeadingDeg,
  );
  assert.ok(
    rotations.length <= 1,
    `straight route: camera re-orients at most once, got ${rotations.length}`,
  );
}

// Approach ride, per connector mode: straight-line -> suggestion ready;
// fail -> connector failure surfaces; none -> request left pending.
{
  const route = straightRoute();
  const fixes = generateTrack(route, {
    speedMps: 5,
    intervalMs: 1000,
    seed: 7,
    approachFrom: { lat: 33.1, lng: 35.5955 }, // ~420 m west of the start
  });

  const ready = runScenario({ navigationRoute: route, fixes, connector: "straight-line" });
  assert.equal(ready.timeline[0].status, "approaching");
  assert.ok(
    ready.timeline.some((e) => e.suggestionStatus === "ready"),
    "straight-line connector produces a ready suggestion",
  );
  assert.ok(
    ready.timeline.some((e) => e.justAcquired === true),
    "route acquisition event surfaces in the timeline",
  );

  const failed = runScenario({ navigationRoute: route, fixes, connector: "fail" });
  assert.ok(
    failed.timeline.some((e) => e.connectorResult === "failed"),
    "fail connector surfaces a failed connector result",
  );

  const none = runScenario({ navigationRoute: route, fixes, connector: "none" });
  assert.ok(none.routeRequests.length >= 1, "request was issued");
  assert.ok(
    !none.timeline.some((e) => e.suggestionStatus === "ready"),
    "no suggestion resolves in mode none",
  );
}

// connectorRouterForMode contract.
{
  const req = { from: { lat: 1, lng: 2 }, to: { lat: 3, lng: 4 } };
  assert.deepEqual(connectorRouterForMode("straight-line")(req).geometry, [req.from, req.to]);
  assert.equal(connectorRouterForMode("fail")(req).failure, "scenario-forced-failure");
  assert.equal(connectorRouterForMode("none"), null);
}

// buildUserTimeline is pure over a replay timeline (smoke: empty input).
assert.deepEqual(buildUserTimeline([]), []);

console.log("nav scenario runner tests passed");
