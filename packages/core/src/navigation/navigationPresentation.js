// Pure presentation helper for the navigation overlay (turn-by-turn Phase 8).
// Maps a navigation session state into display strings/icons so the native
// NavPanel stays a dumb renderer and the formatting is node-testable.
//
// Copy is Hebrew/RTL to match the rest of the native planner chrome.

import { CONNECTOR_NEAR_RADIUS_M } from "./connectorTargeting.js";

const STATUS_TEXT = {
  "requesting-permission": "מבקש הרשאת מיקום…",
  approaching: "בדרך למסלול",
  paused: "מושהה",
  ended: "הניווט הסתיים",
  error: "שגיאת ניווט",
  idle: "",
};

const HAZARD_FALLBACK = { text: "שים לב", icon: "alert-circle-outline" };

// Turn text mirrors the voice phrase ("פנה שמאלה אל X ומיד ימינה"): the voice
// planner suppresses the follow-up turn's own utterance after a compound
// announcement, so the card is the rider's only reminder of the second leg.
function directionWord(direction) {
  return direction === "right" ? "ימינה" : "שמאלה";
}

function roundaboutPhrase(direction) {
  return {
    straight: "בכיכר, המשיכו ישר",
    right: "בכיכר, פנו ימינה",
    left: "בכיכר, פנו שמאלה",
    "u-turn": "בכיכר, חזרו לאחור",
  }[direction] || null;
}

function maneuverDescriptor(cue) {
  if (cue?.type === "turn" || cue?.type === "bend") {
    return { type: cue.type, direction: cue.direction };
  }
  if (cue?.type === "roundabout") {
    return { type: "roundabout", direction: cue.direction };
  }
  if (cue?.type === "crossing") return { type: "crossing" };
  return null;
}

function nextManeuverDescriptor(cue) {
  const maneuver = cue?.thenManeuver || (cue?.thenDirection
    ? { type: "turn", direction: cue.thenDirection }
    : null);
  return maneuver && (maneuver.type === "turn" || maneuver.type === "roundabout")
    ? { type: maneuver.type, direction: maneuver.direction }
    : null;
}

function primaryManeuverText(cue) {
  if (cue?.type === "turn") return `פנה ${directionWord(cue.direction)}`;
  if (cue?.type === "roundabout") {
    const phrase = roundaboutPhrase(cue.direction) || "המשך במסלול";
    return cue.junctionName ? `ב${cue.junctionName}, ${phrase}` : phrase;
  }
  if (cue?.type === "crossing") return "חצו לצד השני של הכביש";
  return cueDisplay(cue).text;
}

function nextManeuverText(cue) {
  const maneuver = nextManeuverDescriptor(cue);
  if (maneuver?.type === "turn") {
    const ontoName = cue?.thenManeuver?.ontoGuidance?.name || cue?.thenManeuver?.ontoSegmentName;
    const onto = ontoName
      ? ` אל ${ontoName}`
      : "";
    return `ואז פנו ${directionWord(maneuver.direction)}${onto}`;
  }
  if (maneuver?.type === "roundabout") {
    const phrase = roundaboutPhrase(maneuver.direction);
    return phrase ? `ואז ${phrase.replace(/^בכיכר,\s*/, "בכיכר ")}` : "";
  }
  return "";
}

function thenManeuverPhrase(cue) {
  const maneuver = cue.thenManeuver || (cue.thenDirection
    ? { type: "turn", direction: cue.thenDirection }
    : null);
  if (maneuver?.type === "turn") {
    const ontoName = maneuver.ontoGuidance?.name || maneuver.ontoSegmentName;
    const onto = ontoName ? ` אל ${ontoName}` : "";
    return cue.type === "roundabout" || cue.type === "crossing"
      ? `, ואז פנו ${directionWord(maneuver.direction)}${onto}`
      : ` ומיד ${directionWord(maneuver.direction)}${onto}`;
  }
  if (maneuver?.type === "roundabout") {
    const phrase = roundaboutPhrase(maneuver.direction);
    return phrase ? `, ואז ${phrase.replace(/^בכיכר,\s*/, "בכיכר ")}` : "";
  }
  return "";
}

function turnPrimaryText(cue) {
  const base = `פנה ${directionWord(cue.direction)}`;
  return `${base}${thenManeuverPhrase(cue)}`;
}

function turnText(cue) {
  const ontoName = cue.ontoGuidance?.name || cue.ontoSegmentName;
  const onto = ontoName ? ` אל ${ontoName}` : "";
  const then = thenManeuverPhrase(cue);
  if (!ontoName && cue.stayOnGuidance?.name) {
    return `פנה ${directionWord(cue.direction)} כדי להישאר על ${cue.stayOnGuidance.name}${then}`;
  }
  return `פנה ${directionWord(cue.direction)}${onto}${then}`;
}

function cueDisplay(cue) {
  if (!cue) return { text: "המשך במסלול", icon: "navigate-outline" };
  switch (cue.type) {
    case "turn":
      return {
        text: turnText(cue),
        icon: cue.direction === "right" ? "arrow-forward-outline" : "arrow-back-outline",
      };
    case "bend":
      // Sharp curve of the road itself (no junction) — heads-up, not a turn.
      return cue.direction === "right"
        ? { text: "עיקול ימינה", icon: "arrow-forward-outline" }
        : { text: "עיקול שמאלה", icon: "arrow-back-outline" };
    case "roundabout": {
      const text = roundaboutPhrase(cue.direction);
      const namedText = text && cue.junctionName ? `ב${cue.junctionName}, ${text}` : text;
      return namedText
        ? { text: `${namedText}${thenManeuverPhrase(cue)}`, icon: "reload-outline" }
        : { text: "המשך במסלול", icon: "navigate-outline" };
    }
    case "crossing":
      return { text: "חצו לצד השני של הכביש", icon: "crossing" };
    case "enter-segment":
      return { text: cue.segmentName ? `כניסה אל ${cue.segmentName}` : "המשך במסלול", icon: "navigate-outline" };
    case "arrive":
      return { text: "הגעת ליעד", icon: "flag-outline" };
    case "start":
      return { text: "תחילת המסלול", icon: "navigate-outline" };
    default:
      return HAZARD_FALLBACK;
  }
}

function routeClassLabel(routeClass) {
  switch (routeClass) {
    case "track": return "בדרך עפר";
    case "path": return "בשביל";
    case "footway": return "במדרכה";
    default: return "במקטע מקשר";
  }
}

// Bare noun for the on-map chip ("דרך עפר"); routeClassLabel keeps the
// prefixed form ("בדרך עפר") used in sentence context.
export function roadClassChipLabel(routeClass) {
  switch (routeClass) {
    case "cycleway": return "שביל אופניים";
    case "track": return "דרך עפר";
    case "path_track": return "דרך עפר";
    case "path": return "שביל";
    case "footway": return "מדרכה";
    case "local_road":
    case "road":
    case "residential": return "כביש";
    default: return null;
  }
}

function buildContextText(progress) {
  if (!progress?.hasAcquiredRoute) return "";
  const here = progress.currentGuidanceName
    ? progress.currentGuidanceName
    : progress.currentOnNetwork && progress.currentSegmentName
      ? progress.currentSegmentName
    : routeClassLabel(progress.currentRouteClass);
  const nextName = progress.nextGuidanceName || progress.nextSegmentName;
  const nextDistance = progress.nextGuidanceName
    ? progress.distanceToNextGuidanceMeters
    : progress.distanceToNextSegmentMeters;
  const next = nextName
    ? ` · הבא: ${nextName} בעוד ${formatDistanceMeters(nextDistance)}`
    : "";
  return here ? `${here}${next}` : "";
}

function buildCurrentRoadText(progress) {
  if (!progress?.hasAcquiredRoute) return "";
  if (progress.currentGuidanceName) return progress.currentGuidanceName;
  if (progress.currentSegmentName) return progress.currentSegmentName;
  return roadClassChipLabel(progress.currentRouteClass) || routeClassLabel(progress.currentRouteClass);
}

function relativeArrowDeg(progress) {
  if (!Number.isFinite(progress?.guidanceBearingDeg)) return null;
  // Prefer the general direction of travel; the per-fix course jitters.
  const course = Number.isFinite(progress?.smoothedCourseDeg)
    ? progress.smoothedCourseDeg
    : progress?.courseDeg;
  if (!Number.isFinite(course)) return null;
  return ((progress.guidanceBearingDeg - course) % 360 + 360) % 360;
}

// Geographic bearing (deg, 0 = north) from one lat/lng to another. The native
// layer subtracts the live compass heading to get a phone-relative arrow.
export function bearingDeg(from, to) {
  if (!from || !to) return null;
  const lat1 = Number(from.lat);
  const lng1 = Number(from.lng);
  const lat2 = Number(to.lat);
  const lng2 = Number(to.lng);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function destinationLabelFor(mode) {
  switch (mode) {
    case "rejoin":
      return "חזרה למסלול";
    default:
      return "תחילת המסלול";
  }
}

function handoffProminenceForTier(tier) {
  if (tier === "guide") return "hidden";
  if (tier === "too-far") return "primary";
  return "secondary";
}

function approachSupportTextForTier(tier, status) {
  if (status !== "approaching") return "";
  switch (tier) {
    case "guide":
      return "האפליקציה מנווטת אותך לתחילת המסלול";
    case "too-far":
      return "תחילת המסלול רחוקה מדי להכוונת גישה באפליקציה";
    default:
      return "הניווט במסלול יתחיל כשתגיע";
  }
}

// Round to a friendly precision: nearest 10 m below 1 km, else 0.1 km.
export function formatDistanceMeters(meters) {
  const m = Number(meters);
  if (!Number.isFinite(m) || m < 0) return "";
  if (m < 1000) return `${Math.round(m / 10) * 10} מ׳`;
  return `${(m / 1000).toFixed(1)} ק״מ`;
}

export function getNavigationPresentation(state = {}) {
  const status = state.status || "idle";
  const navigating = status === "navigating" || status === "off-route";
  const offRoute = state.offRoute === true || status === "off-route";
  const progress = state.progress || null;

  const approach = state.approach || null;
  const showApproach = status === "approaching" || offRoute;
  const approachOwnershipTier = approach?.ownershipTier || "unknown";
  const distanceToRoute = Number(approach?.distanceToRouteMeters);
  const suggestionDistance = Number(approach?.suggestionDistanceMeters);
  const hasSuggestionGeometry =
    Array.isArray(approach?.suggestionGeometry) &&
    approach.suggestionGeometry.length >= 2;
  const approachDisplayDistance =
    hasSuggestionGeometry && Number.isFinite(suggestionDistance) && suggestionDistance > 0
      ? suggestionDistance
      : distanceToRoute;
  const tier =
    Number.isFinite(distanceToRoute) && distanceToRoute <= CONNECTOR_NEAR_RADIUS_M
      ? "near"
      : "far";
  const approachBearingDeg =
    showApproach && state.latestFix && approach?.target?.point
      ? bearingDeg(state.latestFix, approach.target.point)
      : null;
  const approachActive = approach?.approachActiveCue || null;
  const approachCue = cueDisplay(approachActive?.cue || null);
  const showApproachCue =
    (status === "approaching" || offRoute) &&
    approachOwnershipTier === "guide" &&
    Boolean(approachActive);
  const showApproachLeg =
    showApproach &&
    approachOwnershipTier === "guide" &&
    hasSuggestionGeometry;
  const showDirectApproachLine = showApproach && !showApproachLeg;

  const active = state.activeCue || null;
  const cue = cueDisplay(active?.cue || null);
  const cueDistanceText = active
    ? formatDistanceMeters(active.distanceToCueMeters)
    : "";
  const arrivalPreviewText =
    active?.cue?.type === "arrive" && active.phase === "preview"
      ? `בעוד ${cueDistanceText.replace(/ מ׳$/, " מטרים")} תגיע ליעד`
      : "";
  const arrived =
    !offRoute &&
    progress?.hasAcquiredRoute === true &&
    Number.isFinite(progress?.remainingMeters) &&
    progress.remainingMeters <= 15;
  const cardMode = offRoute
    ? "off-route"
    : arrived
      ? "arrived"
      : status === "approaching"
        ? "approach"
        : navigating && active && active.cue?.type !== "start"
          ? "cue"
          : "status";

  const segmentChipText = (() => {
    const name = progress?.currentGuidanceName || progress?.currentSegmentName || null;
    const label = roadClassChipLabel(progress?.currentRouteClass);
    if (name && label && !name.startsWith(label)) return `${name} · ${label}`;
    return name || label || null;
  })();
  const chip = offRoute
    ? { kind: "rejoin", text: "בדרך חזרה למסלול" }
    : (cardMode === "cue" || cardMode === "arrived") && segmentChipText
        ? { kind: "segment", text: segmentChipText }
        : null;

  const speedMps = progress?.smoothedSpeedMps;
  const speedText =
    Number.isFinite(speedMps) && speedMps >= 1
      ? `${(speedMps * 3.6).toFixed(1)} קמ״ש`
      : "";

  const cuePrimaryText = (() => {
    const c = active?.cue || null;
    if (!c) return cue.text;
    if (arrivalPreviewText) return arrivalPreviewText;
    if (c.type === "turn" || c.type === "roundabout" || c.type === "crossing") return primaryManeuverText(c);
    if (c.type === "enter-segment") return "המשך במסלול";
    return cue.text;
  })();
  const cueNextText = nextManeuverText(active?.cue || null);
  const cueManeuver = maneuverDescriptor(active?.cue || null);
  const cueNextManeuver = nextManeuverDescriptor(active?.cue || null);
  const cueSecondaryText = (() => {
    const c = active?.cue || null;
    if (!c) return "";
    const ontoName = c.ontoGuidance?.name || c.ontoSegmentName;
    if ((c.type === "turn" || c.type === "roundabout") && ontoName) {
      const continuation = Number.isFinite(Number(c.continueOnWayMeters))
        ? ` · המשיכו ${formatDistanceMeters(c.continueOnWayMeters)}`
        : "";
      return `אל ${ontoName}${continuation}`;
    }
    if (c.stayOnGuidance?.name) return `כדי להישאר על ${c.stayOnGuidance.name}`;
    if (c.type === "crossing" && c.ontoGuidance?.name) return `המשיכו על ${c.ontoGuidance.name}`;
    if (c.type === "crossing" && c.crossedRoadName) return c.crossedRoadName;
    if (c.type === "enter-segment" && c.segmentName) return `אל ${c.segmentName}`;
    if (
      (progress?.nextGuidanceName || progress?.nextSegmentName) &&
      Number.isFinite(progress?.distanceToNextGuidanceMeters ?? progress?.distanceToNextSegmentMeters) &&
      (progress?.distanceToNextGuidanceMeters ?? progress?.distanceToNextSegmentMeters) <= 300
    ) {
      return `אל ${progress.nextGuidanceName || progress.nextSegmentName}`;
    }
    return "";
  })();

  // O5: off-route card shows the live distance back to the route.
  // Prefer remaining-along-leg (from a guided rejoin connector), fall back to straight-line.
  const rawLegRemaining = approach?.approachProgress?.remainingMeters;
  const rawStraightLine = approach?.distanceToRouteMeters;
  const legRemaining = rawLegRemaining == null ? NaN : Number(rawLegRemaining);
  const straightLine = rawStraightLine == null ? NaN : Number(rawStraightLine);
  const hasGuidedLeg =
    Array.isArray(approach?.approachLegGeometry) &&
    approach.approachLegGeometry.length >= 2;
  const backMeters =
    hasGuidedLeg && Number.isFinite(legRemaining) ? legRemaining : straightLine;
  const offRouteDistanceText =
    Number.isFinite(backMeters) && backMeters >= 0
      ? formatDistanceMeters(backMeters)
      : "";
  const hasReadyRejoin =
    approach?.suggestionStatus === "ready" && hasSuggestionGeometry;
  const offRouteTextWithDistance =
    `${hasReadyRejoin ? "בדרך חזרה למסלול" : "יצאתם מהמסלול"}` +
    (offRouteDistanceText ? ` · ${offRouteDistanceText}` : "");
  const offRouteInstructionText = showApproachCue
    ? (() => {
      const c = approachActive?.cue || null;
      if (c?.type === "turn") return turnPrimaryText(c);
      if (c?.type === "crossing") {
        return [primaryManeuverText(c), nextManeuverText(c)].filter(Boolean).join(" ");
      }
        if (c?.type === "enter-segment") return "המשיכו לפי הקו המסומן";
        return approachCue.text;
      })()
    : approach?.suggestionStatus === "requesting"
      ? "מכינים דרך חזרה למסלול…"
      : hasReadyRejoin
        ? "המשיכו לפי הקו המסומן"
        : "התקדמו לכיוון המסלול";

  let arrivalSummary = null;
  if (cardMode === "arrived") {
    const elapsedMs =
      Number.isFinite(state.latestFix?.timestamp) &&
      Number.isFinite(state.rideStartTimestamp)
        ? state.latestFix.timestamp - state.rideStartTimestamp
        : null;
    const minutes = elapsedMs !== null ? Math.round(elapsedMs / 60000) : null;
    const elapsedText =
      minutes === null
        ? ""
        : minutes >= 60
          ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`
          : `${minutes} דק׳`;
    const avgMps =
      elapsedMs > 0 && Number.isFinite(progress?.progressMeters)
        ? progress.progressMeters / (elapsedMs / 1000)
        : null;
    arrivalSummary = {
      distanceText: formatDistanceMeters(progress?.progressMeters),
      elapsedText,
      avgSpeedText: Number.isFinite(avgMps) ? `${(avgMps * 3.6).toFixed(1)} קמ״ש` : "",
    };
  }

  // "Remaining route distance" is meaningful only once on the route; before
  // that (approaching / off-route) we show the distance-to-route instead.
  const remainingMeters = progress?.remainingMeters;
  const remainingText =
    navigating &&
    !offRoute &&
    Number.isFinite(Number(remainingMeters)) &&
    Number(remainingMeters) >= 0
      ? `נותרו ${formatDistanceMeters(remainingMeters)}`
      : "";

  return {
    mode: status,
    cardMode,
    chip,
    speedText,
    cuePrimaryText,
    cueNextText,
    cueSecondaryText,
    cueManeuver,
    cueNextManeuver,
    arrivalSummary,
    justAcquired: state.justAcquired === true,
    acquisitionText: state.justAcquired === true
      ? "הגעת למסלול · הניווט התחיל"
      : "",
    statusText: STATUS_TEXT[status] ?? "",
    showCue: navigating && !offRoute,
    cueText: arrivalPreviewText || cue.text,
    cueIcon: cue.icon,
    cueDistanceText,
    remainingText,
    offRoute,
    offRouteText: offRouteTextWithDistance,
    offRouteDistanceText,
    offRouteInstructionText,
    showContext:
      navigating && !offRoute && Boolean(progress?.hasAcquiredRoute),
    currentRoadText: buildCurrentRoadText(progress),
    contextText: buildContextText(progress),
    showApproach,
    tier,
    approachOwnershipTier,
    handoffProminence:
      approach?.handoffProminence || handoffProminenceForTier(approachOwnershipTier),
    handoffSuggested:
      approach?.handoffSuggested !== undefined
        ? approach.handoffSuggested === true
        : approachOwnershipTier !== "guide",
    showApproachCue,
    showApproachLeg,
    showDirectApproachLine,
    approachBearingDeg,
    approachCueText: approachCue.text,
    approachCueIcon: approachCue.icon,
    approachCueDistanceText: approachActive
      ? formatDistanceMeters(approachActive.distanceToCueMeters)
      : "",
    approachCuePrimaryText: (() => {
      const c = approachActive?.cue || null;
      if (!c) return approachCue.text;
      if (c.type === "turn") return turnPrimaryText(c);
      if (c.type === "enter-segment") return "המשך במסלול";
      return approachCue.text;
    })(),
    approachCueSecondaryText: (() => {
      const c = approachActive?.cue || null;
      if (!c) return "";
      const ontoName = c.ontoGuidance?.name || c.ontoSegmentName;
      if (c.type === "turn" && ontoName) return `אל ${ontoName}`;
      if (c.type === "crossing" && c.crossedRoadName) return c.crossedRoadName;
      if (c.type === "enter-segment" && c.segmentName) return `אל ${c.segmentName}`;
      return "";
    })(),
    // Banner: "<destination> · <distance>" (e.g. "תחילת המסלול · 600 מ׳").
    destinationLabel: destinationLabelFor(approach?.target?.mode),
    approachDistanceShort: Number.isFinite(approachDisplayDistance)
      ? formatDistanceMeters(approachDisplayDistance)
      : "",
    approachDistanceSource:
      hasSuggestionGeometry && Number.isFinite(suggestionDistance) && suggestionDistance > 0
        ? "connector"
        : "beeline",
    disclaimerText: "ניווט מחוץ לרשת CycleWays",
    approachHeading: status === "approaching" ? "בדרך למסלול" : "חזרה למסלול",
    approachSupportText: approachSupportTextForTier(approachOwnershipTier, status),
    externalNavTarget: approach?.target?.point ?? null,
    showGuidance: status === "approaching" || offRoute,
    guidanceText: Number.isFinite(progress?.guidanceDistanceMeters)
      ? `${status === "approaching" ? "לכיוון תחילת המסלול" : "חזרה למסלול"} · ${formatDistanceMeters(progress.guidanceDistanceMeters)}`
      : "",
    guidanceArrowDeg: relativeArrowDeg(progress),
    // Rejoin guidance owns the card while off-route. Main-route orientation
    // is not actionable until the rider has physically reacquired the route.
    wrongWay: !offRoute && progress?.wrongWay === true,
    wrongWayText: "המסלול בכיוון ההפוך - הסתובבו",
    currentOnNetwork: progress?.currentOnNetwork ?? false,
  };
}
