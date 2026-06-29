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

// Connector mode uses the maneuver pipeline with a distinct context line.
{
  const p = getNavigationPresentation({
    status: "on-connector",
    activeCue: {
      cue: { type: "turn", direction: "right" },
      phase: "preview",
      distanceToCueMeters: 80,
    },
    progress: { remainingMeters: 300, hasAcquiredRoute: true },
  });
  assert.equal(p.onConnector, true);
  assert.equal(p.showCue, true);
  assert.equal(p.showContext, true);
  assert.match(p.connectorContextText, /חיבור/);
  assert.equal(p.contextText, p.connectorContextText);
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
