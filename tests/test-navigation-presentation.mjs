import assert from "node:assert/strict";
import {
  getNavigationPresentation,
  roadClassChipLabel,
} from "@cycleways/core/navigation/navigationPresentation.js";

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

// Bend cue (sharp curve, no junction): עיקול, not פנה.
{
  const right = getNavigationPresentation({
    status: "navigating",
    offRoute: false,
    activeCue: {
      cue: { type: "bend", direction: "right" },
      phase: "preview",
      distanceToCueMeters: 90,
    },
    progress: { remainingMeters: 700 },
  });
  assert.equal(right.cueText, "עיקול ימינה");
  assert.equal(right.cueIcon, "arrow-forward-outline");
  const left = getNavigationPresentation({
    status: "navigating",
    offRoute: false,
    activeCue: {
      cue: { type: "bend", direction: "left" },
      phase: "final",
      distanceToCueMeters: 25,
    },
    progress: { remainingMeters: 700 },
  });
  assert.equal(left.cueText, "עיקול שמאלה");
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
  assert.equal(p.offRouteText, "יצאתם מהמסלול");
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

// Paused sessions can retain an old activeCue; status mode must win.
{
  const paused = getNavigationPresentation({
    status: "paused",
    activeCue: {
      cue: { type: "turn", direction: "left" },
      phase: "preview",
      distanceToCueMeters: 90,
    },
    progress: { hasAcquiredRoute: true, remainingMeters: 500 },
  });
  assert.equal(paused.cardMode, "status");
  assert.equal(paused.statusText, "מושהה");
}

// Approach: banner label + beeline distance, disclaimer, external target.
{
  const near = getNavigationPresentation({
    status: "approaching",
    latestFix: { lat: 31.99, lng: 35 },
    approach: {
      target: { point: { lat: 32, lng: 35 }, mode: "start" },
      distanceToRouteMeters: 600,
    },
    progress: { guidanceDistanceMeters: 600, remainingMeters: 14000 },
  });
  assert.equal(near.showApproach, true);
  assert.equal(near.tier, "near");
  assert.equal(near.destinationLabel, "תחילת המסלול");
  assert.equal(near.approachDistanceShort, "600 מ׳");
  assert.equal(near.approachDistanceSource, "beeline");
  assert.equal(near.disclaimerText, "ניווט מחוץ לרשת CycleWays");
  assert.deepEqual(near.externalNavTarget, { lat: 32, lng: 35 });
  // Target is due north of the rider → bearing ≈ 0.
  assert.ok(Number.isFinite(near.approachBearingDeg));
  assert.ok(near.approachBearingDeg < 1 || near.approachBearingDeg > 359);
  // "Remaining route distance" is suppressed while approaching.
  assert.equal(near.remainingText, "");
  // No leftover connector / old inline-button fields.
  assert.equal(near.onConnector, undefined);
  assert.equal(near.showJoinPrompt, undefined);
}

// Destination labels reflect supported target modes.
{
  const rejoin = getNavigationPresentation({
    status: "approaching",
    approach: { target: { point: { lat: 1, lng: 1 }, mode: "rejoin" }, distanceToRouteMeters: 300 },
  });
  assert.equal(rejoin.destinationLabel, "חזרה למסלול");
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
  assert.equal(far.approachDistanceSource, "beeline");
}

// Approach ownership tiers drive connector visibility and handoff prominence.
{
  const target = { point: { lat: 32, lng: 35 }, mode: "start" };
  const guide = getNavigationPresentation({
    status: "approaching",
    latestFix: { lat: 31.999, lng: 35 },
    approach: {
      target,
      distanceToRouteMeters: 120,
      ownershipTier: "guide",
      handoffProminence: "hidden",
      suggestionGeometry: [{ lat: 31.999, lng: 35 }, { lat: 32, lng: 35 }],
      suggestionDistanceMeters: 130,
      approachActiveCue: {
        cue: { type: "turn", direction: "right" },
        phase: "preview",
        distanceToCueMeters: 80,
      },
    },
  });
  assert.equal(guide.approachOwnershipTier, "guide");
  assert.equal(guide.handoffProminence, "hidden");
  assert.equal(guide.showApproachCue, true);
  assert.equal(guide.showApproachLeg, true);
  assert.equal(guide.showDirectApproachLine, false);
  assert.equal(guide.approachCuePrimaryText, "פנה ימינה");
  assert.equal(guide.approachCueDistanceText, "80 מ׳");
  assert.equal(guide.approachDistanceSource, "connector");
  assert.deepEqual(guide.externalNavTarget, target.point);

  const tooFar = getNavigationPresentation({
    status: "approaching",
    approach: {
      target,
      distanceToRouteMeters: 12000,
      ownershipTier: "too-far",
      handoffProminence: "primary",
    },
  });
  assert.equal(tooFar.handoffProminence, "primary");
  assert.equal(tooFar.showApproachLeg, false);
  assert.match(tooFar.approachSupportText, /רחוקה מדי/);
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
  assert.equal(p.currentRoadText, "שביל הירקון");
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
  assert.equal(p.currentRoadText, "דרך עפר");
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
// --- stopped approach: no movement-course arrow without a course ---
{
  const p = getNavigationPresentation({
    status: "approaching",
    progress: { hasAcquiredRoute: false, guidanceDistanceMeters: 420, guidanceBearingDeg: 90, courseDeg: null, wrongWay: false },
  });
  assert.equal(p.guidanceArrowDeg, null);
}
// --- guidance arrow prefers the smoothed course over the noisy per-fix one ---
{
  const p = getNavigationPresentation({
    status: "approaching",
    progress: {
      hasAcquiredRoute: false,
      guidanceDistanceMeters: 420,
      guidanceBearingDeg: 90,
      courseDeg: 250, // one jittery fix pointing the wrong way
      smoothedCourseDeg: 60, // actual direction of travel
      wrongWay: false,
    },
  });
  assert.equal(p.guidanceArrowDeg, 30, "arrow relative to the smoothed course");
}
// --- approaching status text when guidance distance is absent ---
{
  const p = getNavigationPresentation({
    status: "approaching",
    progress: { hasAcquiredRoute: false, wrongWay: false },
  });
  assert.equal(p.showGuidance, true);
  assert.equal(p.guidanceText, "", "no guidance text without finite distance");
  assert.match(p.statusText, /בדרך למסלול/, "approaching statusText is non-empty Hebrew fallback");
}
// --- explicit acquisition transition ---
{
  const p = getNavigationPresentation({
    status: "navigating",
    justAcquired: true,
    progress: { hasAcquiredRoute: true, remainingMeters: 5000 },
  });
  assert.equal(p.justAcquired, true);
  assert.match(p.acquisitionText, /הגעת למסלול/);
}
// --- wrong-way ---
{
  const p = getNavigationPresentation({
    status: "navigating",
    progress: { hasAcquiredRoute: true, wrongWay: true, remainingMeters: 500 },
  });
  assert.equal(p.wrongWay, true);
  assert.equal(p.wrongWayText, "המסלול בכיוון ההפוך - הסתובבו");

  const offRouteOwnsWarning = getNavigationPresentation({
    status: "off-route",
    offRoute: true,
    approach: {
      suggestionStatus: "requesting",
      distanceToRouteMeters: 120,
    },
    progress: { hasAcquiredRoute: true, wrongWay: true, remainingMeters: 500 },
  });
  assert.equal(
    offRouteOwnsWarning.wrongWay,
    false,
    "main-route wrong-way warning is suppressed during rejoin guidance",
  );
  assert.equal(offRouteOwnsWarning.cardMode, "off-route");
  assert.equal(
    offRouteOwnsWarning.offRouteInstructionText,
    "מכינים דרך חזרה למסלול…",
  );
}

// --- cardMode / chip / speedText / arrivalSummary ------------------------
{
  const riding = getNavigationPresentation({
    status: "navigating",
    offRoute: false,
    activeCue: {
      cue: { type: "turn", direction: "left", ontoSegmentName: "שביל הצפון" },
      phase: "preview",
      distanceToCueMeters: 100,
    },
    latestFix: { timestamp: 600000 },
    rideStartTimestamp: 0,
    progress: {
      hasAcquiredRoute: true,
      remainingMeters: 800,
      progressMeters: 400,
      currentSegmentName: "דרך נוף הירדן",
      currentRouteClass: "track",
      smoothedSpeedMps: 4.87,
      wrongWay: false,
    },
  });
  assert.equal(riding.cardMode, "cue");
  assert.equal(riding.cuePrimaryText, "פנה שמאלה");
  assert.equal(riding.cueSecondaryText, "אל שביל הצפון");
  assert.deepEqual(riding.chip, { kind: "segment", text: "דרך נוף הירדן · דרך עפר" });
  assert.equal(riding.speedText, "17.5 קמ״ש");
  assert.equal(riding.arrivalSummary, null);

  // Compound pair: the card must mirror the spoken "turn left, then right" —
  // the voice planner suppresses the follow-up turn's own utterance, so the
  // card is the rider's only reminder of the second leg.
  const compound = getNavigationPresentation({
    status: "navigating",
    offRoute: false,
    activeCue: {
      cue: { type: "turn", direction: "left", thenDirection: "right" },
      phase: "final",
      distanceToCueMeters: 30,
    },
    latestFix: { timestamp: 600000 },
    rideStartTimestamp: 0,
    progress: {
      hasAcquiredRoute: true,
      remainingMeters: 800,
      progressMeters: 400,
      wrongWay: false,
    },
  });
  assert.equal(compound.cuePrimaryText, "פנה שמאלה ומיד ימינה");

  const cruising = getNavigationPresentation({
    status: "navigating",
    offRoute: false,
    activeCue: null,
    progress: {
      hasAcquiredRoute: true,
      remainingMeters: 800,
      progressMeters: 400,
      currentSegmentName: "דרך נוף הירדן",
      currentRouteClass: "track",
      smoothedSpeedMps: 0.4,
      wrongWay: false,
    },
  });
  assert.equal(cruising.cardMode, "status");
  assert.equal(cruising.chip, null, "status pill shows the name; no duplicate chip");
  assert.equal(cruising.speedText, "", "standing still shows no speed");

  const offRoute = getNavigationPresentation({
    status: "off-route",
    offRoute: true,
    progress: { hasAcquiredRoute: true, remainingMeters: 8, wrongWay: false },
  });
  assert.equal(offRoute.cardMode, "off-route");
  assert.deepEqual(offRoute.chip, {
    kind: "rejoin",
    text: "בדרך חזרה למסלול",
  });

  const approaching = getNavigationPresentation({
    status: "approaching",
    approach: {
      suggestionGeometry: [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }],
      suggestionStatus: "ready",
      distanceToRouteMeters: 500,
    },
    progress: { hasAcquiredRoute: false, wrongWay: false },
  });
  assert.equal(approaching.cardMode, "approach");
  assert.equal(approaching.chip, null, "no suggestion chip while approaching");

  const arrived = getNavigationPresentation({
    status: "navigating",
    offRoute: false,
    latestFix: { timestamp: 4320000 }, // 72 min after start
    rideStartTimestamp: 0,
    progress: {
      hasAcquiredRoute: true,
      remainingMeters: 8,
      progressMeters: 14800,
      smoothedSpeedMps: 3,
      wrongWay: false,
    },
  });
  assert.equal(arrived.cardMode, "arrived");
  assert.equal(arrived.arrivalSummary.distanceText, "14.8 ק״מ");
  assert.equal(arrived.arrivalSummary.elapsedText, "1:12");
  assert.equal(arrived.arrivalSummary.avgSpeedText, "12.3 קמ״ש");
}

// --- roadClassChipLabel: bare noun form ----------------------------------
{
  assert.equal(roadClassChipLabel("cycleway"), "שביל אופניים");
  assert.equal(roadClassChipLabel("track"), "דרך עפר");
  assert.equal(roadClassChipLabel("path_track"), "דרך עפר");
  assert.equal(roadClassChipLabel("path"), "שביל");
  assert.equal(roadClassChipLabel("footway"), "מדרכה");
  assert.equal(roadClassChipLabel("local_road"), "כביש");
  assert.equal(roadClassChipLabel("road"), "כביש");
  assert.equal(roadClassChipLabel("residential"), "כביש");
  assert.equal(roadClassChipLabel("anything-else"), null);
}

// Roundabout cue card uses direction-specific copy and icon.
{
  const p = getNavigationPresentation({
    status: "navigating",
    offRoute: false,
    activeCue: {
      cue: { type: "roundabout", direction: "left" },
      phase: "preview",
      distanceToCueMeters: 80,
    },
    progress: { remainingMeters: 500 },
  });
  assert.equal(p.cueText, "בכיכר, פנו שמאלה");
  assert.equal(p.cueIcon, "reload-outline");
}

// --- O5: off-route card shows the live distance back -----------------------
{
  // Guided leg active: remaining-along-leg wins over straight-line.
  const guided = getNavigationPresentation({
    status: "off-route",
    offRoute: true,
    approach: {
      distanceToRouteMeters: 118,
      approachLegGeometry: [{ lat: 33.1, lng: 35.6 }, { lat: 33.101, lng: 35.6 }],
      approachProgress: { remainingMeters: 240 },
    },
    progress: { hasAcquiredRoute: true, offRoute: true },
  });
  assert.ok(guided.offRouteText.includes("יצאתם מהמסלול"), guided.offRouteText);
  assert.ok(/240/.test(guided.offRouteText), `leg distance, got ${guided.offRouteText}`);

  const readyWithoutCue = getNavigationPresentation({
    status: "off-route",
    offRoute: true,
    approach: {
      suggestionStatus: "ready",
      suggestionGeometry: [{ lat: 33.1, lng: 35.6 }, { lat: 33.101, lng: 35.6 }],
      distanceToRouteMeters: 118,
    },
    progress: { hasAcquiredRoute: true, offRoute: true, wrongWay: true },
  });
  assert.match(readyWithoutCue.offRouteText, /בדרך חזרה למסלול/);
  assert.equal(
    readyWithoutCue.offRouteInstructionText,
    "המשיכו לפי הקו המסומן",
  );
  assert.equal(readyWithoutCue.wrongWay, false);

  const readyWithCue = getNavigationPresentation({
    status: "off-route",
    offRoute: true,
    approach: {
      suggestionStatus: "ready",
      suggestionGeometry: [{ lat: 33.1, lng: 35.6 }, { lat: 33.101, lng: 35.6 }],
      ownershipTier: "guide",
      approachActiveCue: {
        cue: { type: "turn", direction: "left", ontoSegmentName: "שביל החורש" },
        distanceToCueMeters: 82,
      },
      distanceToRouteMeters: 118,
    },
    progress: { hasAcquiredRoute: true, offRoute: true },
  });
  assert.equal(readyWithCue.showApproachCue, true);
  assert.equal(readyWithCue.offRouteInstructionText, "פנה שמאלה");
  assert.equal(readyWithCue.approachCueSecondaryText, "אל שביל החורש");
  assert.equal(readyWithCue.approachCueDistanceText, "80 מ׳");

  // No leg yet: straight-line fallback.
  const bare = getNavigationPresentation({
    status: "off-route",
    offRoute: true,
    approach: { distanceToRouteMeters: 118 },
    progress: { hasAcquiredRoute: true, offRoute: true },
  });
  assert.ok(/1[0-2]0/.test(bare.offRouteText), `fallback distance, got ${bare.offRouteText}`);

  // Leg geometry present but approachProgress lacks a finite remainingMeters:
  // fall back to the straight-line distance.
  const legWithoutProgress = getNavigationPresentation({
    status: "off-route",
    offRoute: true,
    approach: {
      distanceToRouteMeters: 118,
      approachLegGeometry: [{ lat: 33.1, lng: 35.6 }, { lat: 33.101, lng: 35.6 }],
      approachProgress: { remainingMeters: undefined },
    },
    progress: { hasAcquiredRoute: true, offRoute: true },
  });
  assert.ok(
    /1[0-2]0/.test(legWithoutProgress.offRouteText),
    `fallback distance when leg progress missing, got ${legWithoutProgress.offRouteText}`,
  );

  // The session's empty approach shape uses null, which must not coerce to 0.
  const noKnownDistance = getNavigationPresentation({
    status: "off-route",
    offRoute: true,
    approach: {
      distanceToRouteMeters: null,
      approachProgress: { remainingMeters: null },
    },
    progress: { hasAcquiredRoute: true, offRoute: true },
  });
  assert.equal(noKnownDistance.offRouteText, "יצאתם מהמסלול");

  const legWithNullProgress = getNavigationPresentation({
    status: "off-route",
    offRoute: true,
    approach: {
      distanceToRouteMeters: 118,
      approachLegGeometry: [{ lat: 33.1, lng: 35.6 }, { lat: 33.101, lng: 35.6 }],
      approachProgress: { remainingMeters: null },
    },
    progress: { hasAcquiredRoute: true, offRoute: true },
  });
  assert.ok(
    /1[0-2]0/.test(legWithNullProgress.offRouteText),
    `fallback distance when leg progress is null, got ${legWithNullProgress.offRouteText}`,
  );
}

console.log("navigation presentation tests passed");
