import assert from "node:assert/strict";
import { getNavigationPresentation } from "@cycleways/core/navigation/navigationPresentation.js";

// Navigating, no active maneuver cue -> "continue on route".
{
  const p = getNavigationPresentation({
    status: "navigating",
    offRoute: false,
    activeCue: null,
    progress: { remainingMeters: 2340 },
  });
  assert.equal(p.mode, "navigating");
  assert.equal(p.cueText, "המשך במסלול");
  assert.equal(p.cueDistanceText, "");
  assert.equal(p.remainingText, "נותרו 2.3 ק״מ");
  assert.equal(p.offRoute, false);
}

// Preview of a left turn 120 m ahead.
{
  const p = getNavigationPresentation({
    status: "navigating",
    offRoute: false,
    activeCue: {
      cue: { type: "turn", direction: "left" },
      phase: "preview",
      distanceToCueMeters: 118,
    },
    progress: { remainingMeters: 800 },
  });
  assert.equal(p.cueText, "פנה שמאלה");
  assert.equal(p.cueDistanceText, "120 מ׳");
  assert.equal(p.cueIcon, "arrow-back-outline");
}

// Arrival cue.
{
  const p = getNavigationPresentation({
    status: "navigating",
    offRoute: false,
    activeCue: { cue: { type: "arrive" }, phase: "final", distanceToCueMeters: 20 },
    progress: { remainingMeters: 20 },
  });
  assert.equal(p.cueText, "הגעת ליעד");
  assert.equal(p.cueDistanceText, "20 מ׳");
}

// Off-route takes over the banner.
{
  const p = getNavigationPresentation({
    status: "off-route",
    offRoute: true,
    activeCue: null,
    progress: { remainingMeters: 1200 },
  });
  assert.equal(p.offRoute, true);
  assert.equal(p.offRouteText, "חזרו למסלול");
}

// Non-navigating statuses surface a clear line and no cue.
{
  const requesting = getNavigationPresentation({
    status: "requesting-permission",
    progress: null,
    activeCue: null,
  });
  assert.equal(requesting.mode, "requesting-permission");
  assert.ok(requesting.statusText.length > 0, "permission status text present");

const paused = getNavigationPresentation({ status: "paused", activeCue: null });
  assert.equal(paused.mode, "paused");
  assert.equal(paused.statusText, "מושהה");
}

// Approach: banner label + distance, disclaimer, external target, join-nearest.
{
  const near = getNavigationPresentation({
    status: "approaching",
    latestFix: { lat: 31.99, lng: 35 },
    approach: {
      target: { point: { lat: 32, lng: 35 }, mode: "start" },
      distanceToRouteMeters: 600,
      choices: { nearest: { point: {} }, skipMeters: 1500 },
    },
    progress: { guidanceDistanceMeters: 600, remainingMeters: 14000 },
  });
  assert.equal(near.showApproach, true);
  assert.equal(near.tier, "near");
  assert.equal(near.destinationLabel, "תחילת המסלול");
  assert.match(near.approachDistanceShort, /מ׳/);
  assert.equal(near.disclaimerText, "ניווט מחוץ לרשת CycleWays");
  assert.deepEqual(near.externalNavTarget, { lat: 32, lng: 35 });
  assert.equal(near.canJoinNearest, true);
  assert.ok(near.nearestSkipText.includes("דילוג"));
  // Target is due north of the rider → bearing ≈ 0.
  assert.ok(Number.isFinite(near.approachBearingDeg));
  assert.ok(near.approachBearingDeg < 1 || near.approachBearingDeg > 359);
  // "Remaining route distance" is suppressed while approaching.
  assert.equal(near.remainingText, "");
  // No leftover connector / old inline-button fields.
  assert.equal(near.onConnector, undefined);
  assert.equal(near.showJoinPrompt, undefined);
}

// Destination labels reflect the target mode.
{
  const custom = getNavigationPresentation({
    status: "approaching",
    approach: { target: { point: { lat: 1, lng: 1 }, mode: "custom" }, distanceToRouteMeters: 300 },
  });
  assert.equal(custom.destinationLabel, "נקודה שנבחרה");
  const nearest = getNavigationPresentation({
    status: "approaching",
    approach: { target: { point: { lat: 1, lng: 1 }, mode: "nearest" }, distanceToRouteMeters: 300 },
  });
  assert.equal(nearest.destinationLabel, "נקודה קרובה במסלול");
}

// On-route: remaining distance shows; no approach block.
{
  const onRoute = getNavigationPresentation({
    status: "navigating",
    progress: { hasAcquiredRoute: true, remainingMeters: 14000 },
  });
  assert.equal(onRoute.showApproach, false);
  assert.match(onRoute.remainingText, /נותרו/);
}

// Approach (far tier): no nearest-join option when there are no choices.
{
  const far = getNavigationPresentation({
    status: "approaching",
    approach: {
      target: { point: { lat: 32, lng: 35 }, mode: "start" },
      distanceToRouteMeters: 4000,
      choices: null,
    },
  });
  assert.equal(far.tier, "far");
  assert.equal(far.canJoinNearest, false);
}

// --- context line ---
{
  const p = getNavigationPresentation({
    status: "navigating",
    progress: {
      remainingMeters: 1000, hasAcquiredRoute: true,
      currentSegmentName: "שביל הירקון", currentOnNetwork: true, currentRouteClass: "cycleway",
      nextSegmentName: "גשר איילון", distanceToNextSegmentMeters: 400,
      wrongWay: false,
    },
  });
  assert.equal(p.showContext, true);
  assert.match(p.contextText, /שביל הירקון/);
  assert.match(p.contextText, /גשר איילון/);
}
// --- off-network context uses neutral copy, not "local roads" ---
{
  const p = getNavigationPresentation({
    status: "navigating",
    progress: { hasAcquiredRoute: true, currentSegmentName: null, currentOnNetwork: false, currentRouteClass: "track", nextSegmentName: "גשר איילון", distanceToNextSegmentMeters: 1200, wrongWay: false },
  });
  assert.equal(p.currentOnNetwork ?? false, false);
  assert.ok(p.contextText.length > 0, "off-network still shows context");
  assert.match(p.contextText, /בדרך עפר/);
  assert.doesNotMatch(p.contextText, /local roads/);
}
// --- approach guidance ---
{
  const p = getNavigationPresentation({
    status: "approaching",
    progress: { hasAcquiredRoute: false, guidanceDistanceMeters: 420, guidanceBearingDeg: 90, courseDeg: 0, wrongWay: false },
  });
  assert.equal(p.showGuidance, true);
  assert.equal(p.guidanceArrowDeg, 90, "arrow relative to course");
  assert.match(p.guidanceText, /420|0\.4/);
}
// --- approaching status text when guidance distance is absent ---
{
  const p = getNavigationPresentation({
    status: "approaching",
    progress: { hasAcquiredRoute: false, wrongWay: false },
  });
  assert.equal(p.showGuidance, true);
  assert.equal(p.guidanceText, "", "no guidance text without finite distance");
  assert.match(p.statusText, /מתקרב/, "approaching statusText is non-empty Hebrew fallback");
}
// --- wrong-way ---
{
  const p = getNavigationPresentation({
    status: "navigating",
    progress: { hasAcquiredRoute: true, wrongWay: true, remainingMeters: 500 },
  });
  assert.equal(p.wrongWay, true);
  assert.match(p.wrongWayText, /כיוון הלא נכון/);
}

console.log("navigation presentation tests passed");
