// Pure navigation-session controller. Native code supplies location fixes and
// performs best-effort connector route requests; the session keeps the main
// route's acquisition logic and offers the connector only as a non-narrated
// approach suggestion. Acquiring the main route is the only handoff into
// `navigating` — there is no seeded jump.

import { getDistance } from "../utils/distance.js";
import {
  approachTargetChoices,
  projectOntoRoute,
  selectConnectorTarget,
} from "./connectorTargeting.js";
import { buildRouteCues, selectActiveCue } from "./navigationCues.js";
import { buildNavigationGeometry } from "./navigationRoute.js";
import { createRouteProgressTracker } from "./routeProgress.js";

export const NAV_ACTIONS = {
  START: "START",
  PERMISSION_GRANTED: "PERMISSION_GRANTED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  LOCATION: "LOCATION",
  CONNECTOR_READY: "CONNECTOR_READY",
  CONNECTOR_FAILED: "CONNECTOR_FAILED",
  SET_APPROACH_TARGET: "SET_APPROACH_TARGET",
  SET_APPROACH_CUSTOM_TARGET: "SET_APPROACH_CUSTOM_TARGET",
  PAUSE: "PAUSE",
  RESUME: "RESUME",
  RECENTER: "RECENTER",
  USER_PANNED: "USER_PANNED",
  STOP: "STOP",
  ERROR: "ERROR",
};

const ACTIVE = new Set(["navigating", "off-route", "approaching"]);
const REQUEST_MIN_MOVE_M = 200;

function emptyApproach() {
  return {
    target: null,
    choices: null,
    suggestionGeometry: null,
    suggestionStatus: "idle",
    distanceToRouteMeters: null,
  };
}

function fixPoint(fix) {
  return { lat: Number(fix.lat), lng: Number(fix.lng) };
}

export function createNavigationSession(navigationRoute, options = {}) {
  const mainTracker = createRouteProgressTracker(navigationRoute, options);
  const mainCues = buildRouteCues(navigationRoute);

  let mainCueKey = null;
  let wasOffRoute = false;
  let lastConfirmedProgressMeters = 0;
  let lastRequestPos = null;
  let requestSeq = 0;
  let prePauseStatus = "navigating";

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
    latestFix: null,
    approach: emptyApproach(),
    routeRequest: null,
    error: null,
  };

  function set(patch) {
    state = { ...state, ...patch };
    return state;
  }

  // Single best-effort request gate: fire the first request freely, then only
  // again once the rider has moved a meaningful distance since the last one.
  function shouldRequest(fix) {
    if (lastRequestPos === null) return true;
    return getDistance(lastRequestPos, fix) >= REQUEST_MIN_MOVE_M;
  }

  function suggestionRequest(fix, target) {
    requestSeq += 1;
    lastRequestPos = fixPoint(fix);
    return {
      requestId: requestSeq,
      from: fixPoint(fix),
      to: target.point,
    };
  }

  // Build the approach patch for an explicit target change (start / nearest /
  // custom). Re-arms the request gate so the next LOCATION recomputes, but KEEPS
  // the current suggestion visible until the replacement is ready (no blink).
  // The stale routeRequest is harmless: CONNECTOR_READY/CONNECTOR_FAILED require
  // suggestionStatus === "requesting", which we reset to "idle" here.
  function retargetApproach(picked, mode) {
    lastRequestPos = null;
    return {
      ...state.approach,
      target: { ...picked, mode },
      suggestionStatus: "idle",
      distanceToRouteMeters: state.latestFix
        ? getDistance(state.latestFix, picked.point)
        : state.approach.distanceToRouteMeters,
    };
  }

  function cueFor(activeCue) {
    const key = activeCue
      ? `main:${activeCue.cue.type}:${activeCue.cue.distanceMeters}:${activeCue.phase}`
      : null;
    const event =
      key && key !== mainCueKey
        ? {
            kind: "cue",
            cueType: activeCue.cue.type,
            phase: activeCue.phase,
            cue: activeCue.cue,
          }
        : null;
    mainCueKey = key;
    return event;
  }

  function dispatch(action) {
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
        mainTracker.reset();
        mainCueKey = null;
        wasOffRoute = false;
        lastConfirmedProgressMeters = 0;
        lastRequestPos = null;
        return set({
          status: "navigating",
          backgroundLocation: action.background === true,
          foregroundOnly: action.background !== true,
          approach: emptyApproach(),
          routeRequest: null,
          error: null,
        });

      case NAV_ACTIONS.LOCATION: {
        if (!ACTIVE.has(state.status)) return state;
        const latestFix = { ...action.fix };
        state = { ...state, latestFix };
        const mainProgress = mainTracker.update(action.fix);

        // Not yet on the route: stay in `approaching`, keep a live straight-line
        // distance to the chosen target, and offer one best-effort suggestion.
        if (!mainProgress.hasAcquiredRoute) {
          const choices = approachTargetChoices(navigationRoute, action.fix);
          let target = state.approach.target;
          if (!target && choices) {
            target = { ...choices.start, mode: "start" };
          }
          const distanceToRouteMeters = target
            ? getDistance(action.fix, target.point)
            : null;
          const approach = {
            ...state.approach,
            choices,
            target,
            distanceToRouteMeters,
          };
          if (
            target &&
            state.approach.suggestionStatus === "idle" &&
            shouldRequest(action.fix)
          ) {
            return set({
              status: "approaching",
              progress: mainProgress,
              activeCue: null,
              offRoute: false,
              cueEvent: null,
              approach: {
                ...approach,
                suggestionStatus: "requesting",
                // Keep the prior suggestion visible until the new one is ready.
              },
              routeRequest: suggestionRequest(action.fix, target),
            });
          }
          return set({
            status: "approaching",
            progress: mainProgress,
            activeCue: null,
            offRoute: false,
            cueEvent: null,
            approach,
          });
        }

        const offRoute = mainProgress.offRoute;

        // Acquired but off-route: offer a best-effort rejoin suggestion without
        // narration; the status stays `off-route` (never `navigating`).
        if (offRoute) {
          const firstOffRoute = !wasOffRoute;
          wasOffRoute = true;
          if (
            state.approach.suggestionStatus === "idle" &&
            shouldRequest(action.fix)
          ) {
            const rejoin = selectConnectorTarget(navigationRoute, action.fix, {
              mode: "rejoin",
              lastConfirmedProgressMeters,
            });
            if (rejoin) {
              const target = { ...rejoin, mode: "rejoin" };
              return set({
                status: "off-route",
                progress: mainProgress,
                activeCue: null,
                offRoute: true,
                cueEvent: firstOffRoute ? { kind: "off-route" } : null,
                approach: {
                  ...state.approach,
                  target,
                  distanceToRouteMeters: getDistance(action.fix, target.point),
                  suggestionStatus: "requesting",
                  // Keep the prior suggestion visible until the new one is ready.
                },
                routeRequest: suggestionRequest(action.fix, target),
              });
            }
          }
          const distanceToRouteMeters = state.approach.target
            ? getDistance(action.fix, state.approach.target.point)
            : state.approach.distanceToRouteMeters;
          return set({
            status: "off-route",
            progress: mainProgress,
            activeCue: null,
            offRoute: true,
            cueEvent: firstOffRoute ? { kind: "off-route" } : null,
            approach: { ...state.approach, distanceToRouteMeters },
          });
        }

        // Acquired and on-route: the only handoff into `navigating`. Clear the
        // approach slot and behave exactly as Phase A.
        lastConfirmedProgressMeters = mainProgress.progressMeters;
        const acquiredApproach =
          state.approach.target || state.approach.suggestionStatus !== "idle";
        if (acquiredApproach) lastRequestPos = null;
        const activeCue = selectActiveCue(mainCues, mainProgress.progressMeters);
        const cueEvent = cueFor(activeCue);
        wasOffRoute = false;
        return set({
          status: "navigating",
          progress: mainProgress,
          activeCue,
          offRoute: false,
          cueEvent,
          approach: acquiredApproach ? emptyApproach() : state.approach,
          routeRequest: null,
        });
      }

      case NAV_ACTIONS.CONNECTOR_READY: {
        if (
          state.status === "paused" ||
          state.approach.suggestionStatus !== "requesting" ||
          action.requestId !== state.routeRequest?.requestId
        ) {
          return state;
        }
        const geometry = buildNavigationGeometry(action.geometry);
        if (geometry.length < 2) {
          return set({
            approach: {
              ...state.approach,
              suggestionStatus: "failed",
              suggestionGeometry: null,
            },
          });
        }
        return set({
          approach: {
            ...state.approach,
            suggestionStatus: "ready",
            suggestionGeometry: geometry,
          },
        });
      }

      case NAV_ACTIONS.CONNECTOR_FAILED:
        if (
          state.status === "paused" ||
          state.approach.suggestionStatus !== "requesting" ||
          action.requestId !== state.routeRequest?.requestId
        ) {
          return state;
        }
        return set({
          approach: {
            ...state.approach,
            suggestionStatus: "failed",
            suggestionGeometry: null,
          },
        });

      case NAV_ACTIONS.SET_APPROACH_TARGET: {
        const choices = state.approach.choices;
        if (!choices) return state;
        const picked =
          action.choice === "nearest" ? choices.nearest : choices.start;
        if (!picked) return state;
        return set({
          approach: retargetApproach(picked, action.choice === "nearest" ? "nearest" : "start"),
        });
      }

      case NAV_ACTIONS.SET_APPROACH_CUSTOM_TARGET: {
        const geometry = Array.isArray(navigationRoute?.geometry)
          ? navigationRoute.geometry
          : [];
        const projection = projectOntoRoute(geometry, action.point);
        if (!projection) return state;
        return set({
          approach: retargetApproach(
            { point: projection.point, mainProgressMeters: projection.progressMeters },
            "custom",
          ),
        });
      }

      case NAV_ACTIONS.PERMISSION_DENIED:
        return set({ status: "error", error: "location-permission-denied" });

      case NAV_ACTIONS.PAUSE:
        if (!ACTIVE.has(state.status)) return state;
        prePauseStatus = state.status;
        return set({ status: "paused" });

      case NAV_ACTIONS.RESUME:
        return state.status === "paused" ? set({ status: prePauseStatus }) : state;

      case NAV_ACTIONS.RECENTER:
        return set({ cameraIntent: "follow" });

      case NAV_ACTIONS.USER_PANNED:
        return set({ cameraIntent: "free" });

      case NAV_ACTIONS.STOP:
        requestSeq += 1;
        lastRequestPos = null;
        return set({
          status: "ended",
          approach: emptyApproach(),
          routeRequest: null,
        });

      case NAV_ACTIONS.ERROR:
        requestSeq += 1;
        lastRequestPos = null;
        return set({
          status: "error",
          approach: emptyApproach(),
          routeRequest: null,
          error: action.message || "navigation-error",
        });

      default:
        return state;
    }
  }

  return {
    getState: () => state,
    dispatch,
  };
}
