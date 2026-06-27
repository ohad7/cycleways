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
    case "turn":
      return cue.direction === "right"
        ? { text: "פנה ימינה", icon: "arrow-forward-outline" }
        : { text: "פנה שמאלה", icon: "arrow-back-outline" };
    case "arrive":
      return { text: "הגעת ליעד", icon: "flag-outline" };
    case "start":
      return { text: "תחילת המסלול", icon: "navigate-outline" };
    default:
      return HAZARD_FALLBACK;
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
  };
}
