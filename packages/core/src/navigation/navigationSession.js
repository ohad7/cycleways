// Navigation session state machine (implementation-plan Phase 7).
//
// Pure, node-testable controller: createNavigationSession(navigationRoute) ->
// { getState, dispatch }. It owns the Phase 4 progress tracker and the Phase 5
// cue list internally, so the native `useNavigationSession` hook is a thin
// wrapper that pipes a location stream in and renders the resulting state.
//
// It never touches planner route state — the NavigationRoute is an immutable
// input — so starting/stopping navigation cannot mutate the loaded route.

import { createRouteProgressTracker } from "./routeProgress.js";
import { buildRouteCues, selectActiveCue } from "./navigationCues.js";

export const NAV_ACTIONS = {
  START: "START",
  PERMISSION_GRANTED: "PERMISSION_GRANTED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  LOCATION: "LOCATION",
  PAUSE: "PAUSE",
  RESUME: "RESUME",
  RECENTER: "RECENTER",
  USER_PANNED: "USER_PANNED",
  STOP: "STOP",
  ERROR: "ERROR",
};

const ACTIVE = new Set(["navigating", "off-route"]);

export function createNavigationSession(navigationRoute, options = {}) {
  const tracker = createRouteProgressTracker(navigationRoute, options);
  const cues = buildRouteCues(navigationRoute);

  // Cue-event dedupe memory (so the same cue/phase or a sustained off-route is
  // announced once, not every fix — the Phase 9 voice/haptic dedupe foundation).
  let lastCueKey = null;
  let wasOffRoute = false;

  let state = {
    status: "idle",
    route: navigationRoute,
    progress: null,
    activeCue: null,
    cueEvent: null,
    offRoute: false,
    cameraIntent: "follow",
    backgroundLocation: false,
    foregroundOnly: false,
    error: null,
  };

  function set(patch) {
    state = { ...state, ...patch };
    return state;
  }

  function dispatch(action) {
    // cueEvent is transient: clear any prior one unless this dispatch sets a new
    // one (only LOCATION does).
    if (state.cueEvent && action.type !== NAV_ACTIONS.LOCATION) {
      state = { ...state, cueEvent: null };
    }

    switch (action.type) {
      case NAV_ACTIONS.START:
        if (!navigationRoute?.canNavigate) {
          return set({
            status: "error",
            error: navigationRoute?.unavailableReason || "route-not-navigable",
          });
        }
        return set({ status: "requesting-permission", error: null });

      case NAV_ACTIONS.PERMISSION_GRANTED:
        tracker.reset();
        lastCueKey = null;
        wasOffRoute = false;
        return set({
          status: "navigating",
          backgroundLocation: action.background === true,
          foregroundOnly: action.background !== true,
          error: null,
        });

      case NAV_ACTIONS.LOCATION: {
        if (!ACTIVE.has(state.status)) return state;
        const progress = tracker.update(action.fix);
        const offRoute = progress.offRoute;
        const activeCue = selectActiveCue(cues, progress.progressMeters);

        let cueEvent = null;
        if (offRoute && !wasOffRoute) {
          cueEvent = { kind: "off-route" };
        } else if (!offRoute) {
          const key = activeCue
            ? `${activeCue.cue.type}:${activeCue.cue.distanceMeters}:${activeCue.phase}`
            : null;
          if (key && key !== lastCueKey) {
            cueEvent = {
              kind: "cue",
              cueType: activeCue.cue.type,
              phase: activeCue.phase,
              cue: activeCue.cue,
            };
          }
          lastCueKey = key;
        }
        wasOffRoute = offRoute;

        return set({
          status: offRoute ? "off-route" : "navigating",
          progress,
          activeCue,
          offRoute,
          cueEvent,
        });
      }

      case NAV_ACTIONS.PERMISSION_DENIED:
        return set({ status: "error", error: "location-permission-denied" });

      case NAV_ACTIONS.PAUSE:
        return ACTIVE.has(state.status) ? set({ status: "paused" }) : state;

      case NAV_ACTIONS.RESUME:
        return state.status === "paused" ? set({ status: "navigating" }) : state;

      case NAV_ACTIONS.RECENTER:
        return set({ cameraIntent: "follow" });

      case NAV_ACTIONS.USER_PANNED:
        return set({ cameraIntent: "free" });

      case NAV_ACTIONS.STOP:
        return set({ status: "ended" });

      case NAV_ACTIONS.ERROR:
        return set({ status: "error", error: action.message || "navigation-error" });

      default:
        return state;
    }
  }

  return {
    getState: () => state,
    dispatch,
  };
}
