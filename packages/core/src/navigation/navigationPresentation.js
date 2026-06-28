// Pure presentation helper for the navigation overlay (turn-by-turn Phase 8).
// Maps a navigation session state into display strings/icons so the native
// NavPanel stays a dumb renderer and the formatting is node-testable.
//
// Copy is Hebrew/RTL to match the rest of the native planner chrome.

const STATUS_TEXT = {
  "requesting-permission": "מבקש הרשאת מיקום…",
  paused: "מושהה",
  ended: "הניווט הסתיים",
  error: "שגיאת ניווט",
  idle: "",
};

const HAZARD_FALLBACK = { text: "שים לב", icon: "alert-circle-outline" };

function cueDisplay(cue) {
  if (!cue) return { text: "המשך במסלול", icon: "navigate-outline" };
  switch (cue.type) {
    case "turn": {
      const base = cue.direction === "right"
        ? { text: "פנה ימינה", icon: "arrow-forward-outline" }
        : { text: "פנה שמאלה", icon: "arrow-back-outline" };
      return cue.ontoSegmentName ? { ...base, text: `${base.text} אל ${cue.ontoSegmentName}` } : base;
    }
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

function buildContextText(progress) {
  if (!progress?.hasAcquiredRoute) return "";
  const here = progress.currentOnNetwork && progress.currentSegmentName
    ? progress.currentSegmentName
    : routeClassLabel(progress.currentRouteClass);
  const next = progress.nextSegmentName
    ? ` · הבא: ${progress.nextSegmentName} בעוד ${formatDistanceMeters(progress.distanceToNextSegmentMeters)}`
    : "";
  return here ? `${here}${next}` : "";
}

function relativeArrowDeg(progress) {
  if (!Number.isFinite(progress?.guidanceBearingDeg)) return null;
  const course = Number.isFinite(progress?.courseDeg) ? progress.courseDeg : 0;
  return ((progress.guidanceBearingDeg - course) % 360 + 360) % 360;
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

  const active = state.activeCue || null;
  const cue = cueDisplay(active?.cue || null);
  const cueDistanceText = active
    ? formatDistanceMeters(active.distanceToCueMeters)
    : "";

  const remainingMeters = state.progress?.remainingMeters;
  const remainingText =
    Number.isFinite(Number(remainingMeters)) && Number(remainingMeters) >= 0
      ? `נותרו ${formatDistanceMeters(remainingMeters)}`
      : "";

  return {
    mode: status,
    statusText: STATUS_TEXT[status] ?? "",
    showCue: navigating && !offRoute,
    cueText: cue.text,
    cueIcon: cue.icon,
    cueDistanceText,
    remainingText,
    offRoute,
    offRouteText: "חזרו למסלול",
    showContext: navigating && !offRoute && Boolean(state.progress?.hasAcquiredRoute),
    contextText: buildContextText(state.progress),
    showGuidance: status === "approaching" || offRoute,
    guidanceText: Number.isFinite(state.progress?.guidanceDistanceMeters)
      ? `${status === "approaching" ? "לכיוון תחילת המסלול" : "חזרה למסלול"} · ${formatDistanceMeters(state.progress.guidanceDistanceMeters)}`
      : "",
    guidanceArrowDeg: relativeArrowDeg(state.progress),
    wrongWay: state.progress?.wrongWay === true,
    wrongWayText: "אתה נוסע בכיוון הלא נכון — סובב",
    currentOnNetwork: state.progress?.currentOnNetwork ?? false,
  };
}
