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

console.log("navigation presentation tests passed");
