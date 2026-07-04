// Pure navigation-session controller. Native code supplies location fixes and
// performs best-effort connector route requests; the session keeps the main
// route's acquisition logic and offers the connector only as a non-narrated
// approach suggestion. Acquiring the main route is the only handoff into
// `navigating` — there is no seeded jump.

import { getDistance } from "../utils/distance.js";
import {
  approachTargetChoices,
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
  PAUSE: "PAUSE",
  RESUME: "RESUME",
  RECENTER: "RECENTER",
  USER_PANNED: "USER_PANNED",
  STOP: "STOP",
  ERROR: "ERROR",
};

const ACTIVE = new Set(["navigating", "off-route", "approaching"]);
const REQUEST_MIN_MOVE_M = 200;
const REJOIN_REQUEST_MIN_MOVE_M = 50;

function emptyApproach() {
  return {
    target: null,
    choices: null,
    suggestionGeometry: null,
    suggestionStatus: "idle",
    suggestionDistanceMeters: null,
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
  let connectorRequestAttempt = 0;
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
    connectorResult: null,
    error: null,
    justAcquired: false,
    rideStartTimestamp: null,
  };

  function set(patch) {
    state = { ...state, ...patch };
    return state;
  }

  // Single best-effort request gate: fire the first request freely, then only
  // again once the rider has moved a meaningful distance since the last one.
  function shouldRequest(fix, minMoveMeters = REQUEST_MIN_MOVE_M) {
    if (lastRequestPos === null) return true;
    return getDistance(lastRequestPos, fix) >= minMoveMeters;
  }

  function suggestionRequest(fix, target) {
    requestSeq += 1;
    connectorRequestAttempt += 1;
    lastRequestPos = fixPoint(fix);
    return {
      requestId: requestSeq,
      from: fixPoint(fix),
      to: target.point,
      targetMode: target.mode || null,
      targetProgressMeters: Number.isFinite(Number(target.mainProgressMeters))
        ? Number(target.mainProgressMeters)
        : null,
      attempt: connectorRequestAttempt,
      isRetry: connectorRequestAttempt > 1,
    };
  }

  function canRequestSuggestion(
    fix,
    {
      allowReadyRefresh = false,
      minMoveMeters = REQUEST_MIN_MOVE_M,
    } = {},
  ) {
    const status = state.approach.suggestionStatus;
    if (status === "requesting") return false;
    if (status === "ready" && !allowReadyRefresh) return false;
    return shouldRequest(fix, minMoveMeters);
  }

  function failedSuggestionPatch() {
    const keepGeometry =
      Array.isArray(state.approach.suggestionGeometry) &&
      state.approach.suggestionGeometry.length >= 2;
    return {
      ...state.approach,
      suggestionStatus: "failed",
      suggestionGeometry: keepGeometry ? state.approach.suggestionGeometry : null,
      suggestionDistanceMeters: keepGeometry
        ? state.approach.suggestionDistanceMeters
        : null,
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
        connectorRequestAttempt = 0;
        return set({
          status: "navigating",
          backgroundLocation: action.background === true,
          foregroundOnly: action.background !== true,
          approach: emptyApproach(),
          routeRequest: null,
          connectorResult: null,
          error: null,
          justAcquired: false,
          rideStartTimestamp: null,
        });

      case NAV_ACTIONS.LOCATION: {
        if (!ACTIVE.has(state.status)) return state;
        const latestFix = { ...action.fix };
        state = { ...state, latestFix };
        if (state.rideStartTimestamp === null) {
          state = { ...state, rideStartTimestamp: action.fix.timestamp };
        }
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
            canRequestSuggestion(action.fix)
          ) {
            return set({
              status: "approaching",
              progress: mainProgress,
              activeCue: null,
              offRoute: false,
              cueEvent: null,
              justAcquired: false,
              approach: {
                ...approach,
                suggestionStatus: "requesting",
                // Keep the prior suggestion visible until the new one is ready.
              },
              routeRequest: suggestionRequest(action.fix, target),
              connectorResult: null,
            });
          }
          return set({
            status: "approaching",
            progress: mainProgress,
            activeCue: null,
            offRoute: false,
            cueEvent: null,
            justAcquired: false,
            approach,
          });
        }

        const offRoute = mainProgress.offRoute;

        // Acquired but off-route: offer a best-effort rejoin suggestion without
        // narration; the status stays `off-route` (never `navigating`).
        if (offRoute) {
          const firstOffRoute = !wasOffRoute;
          wasOffRoute = true;
          const rejoin = selectConnectorTarget(navigationRoute, action.fix, {
            mode: "rejoin",
            lastConfirmedProgressMeters,
          });
          const nextTarget = rejoin ? { ...rejoin, mode: "rejoin" } : null;
          if (
            nextTarget &&
            canRequestSuggestion(action.fix, {
              allowReadyRefresh: true,
              minMoveMeters: REJOIN_REQUEST_MIN_MOVE_M,
            })
          ) {
            return set({
              status: "off-route",
              progress: mainProgress,
              activeCue: null,
              offRoute: true,
              cueEvent: firstOffRoute ? { kind: "off-route" } : null,
              justAcquired: false,
              approach: {
                ...state.approach,
                target: nextTarget,
                distanceToRouteMeters: getDistance(action.fix, nextTarget.point),
                suggestionStatus: "requesting",
                // Keep the prior suggestion visible until the new one is ready.
              },
              routeRequest: suggestionRequest(action.fix, nextTarget),
              connectorResult: null,
            });
          }
          const target =
            state.approach.suggestionStatus === "requesting"
              ? state.approach.target || nextTarget
              : nextTarget || state.approach.target;
          const distanceToRouteMeters = target
            ? getDistance(action.fix, target.point)
            : state.approach.distanceToRouteMeters;
          return set({
            status: "off-route",
            progress: mainProgress,
            activeCue: null,
            offRoute: true,
            cueEvent: firstOffRoute ? { kind: "off-route" } : null,
            justAcquired: false,
            approach: { ...state.approach, target, distanceToRouteMeters },
          });
        }

        // Acquired and on-route: the only handoff into `navigating`. Clear the
        // approach slot and behave exactly as Phase A.
        lastConfirmedProgressMeters = mainProgress.progressMeters;
        const acquiredApproach =
          state.approach.target || state.approach.suggestionStatus !== "idle";
        const enteredEffectiveRoute = Boolean(
          acquiredApproach ||
            (navigationRoute?.requiresStartAcquisition === true &&
              state.progress?.hasAcquiredRoute !== true),
        );
        if (acquiredApproach) lastRequestPos = null;
        if (acquiredApproach) connectorRequestAttempt = 0;
        const activeCue = selectActiveCue(mainCues, mainProgress.progressMeters);
        const cueEvent = enteredEffectiveRoute
          ? { kind: "acquired" }
          : cueFor(activeCue);
        wasOffRoute = false;
        return set({
          status: "navigating",
          progress: mainProgress,
          activeCue,
          offRoute: false,
          cueEvent,
          justAcquired: enteredEffectiveRoute,
          approach: acquiredApproach ? emptyApproach() : state.approach,
          routeRequest: null,
          connectorResult: null,
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
            approach: failedSuggestionPatch(),
            routeRequest: null,
            connectorResult: {
              requestId: action.requestId,
              result: "failed",
              reason: "invalid-geometry",
              attempt: state.routeRequest?.attempt ?? null,
              isRetry: state.routeRequest?.isRetry === true,
              targetMode: state.routeRequest?.targetMode ?? null,
              durationMs: Number.isFinite(Number(action.durationMs))
                ? Number(action.durationMs)
                : null,
            },
          });
        }
        const distanceMeters = Number(action.distanceMeters);
        return set({
          approach: {
            ...state.approach,
            suggestionStatus: "ready",
            suggestionGeometry: geometry,
            suggestionDistanceMeters:
              Number.isFinite(distanceMeters) && distanceMeters > 0
                ? distanceMeters
                : null,
          },
          routeRequest: null,
          connectorResult: {
            requestId: action.requestId,
            result: "ready",
            reason: null,
            attempt: state.routeRequest?.attempt ?? null,
            isRetry: state.routeRequest?.isRetry === true,
            targetMode: state.routeRequest?.targetMode ?? null,
            durationMs: Number.isFinite(Number(action.durationMs))
              ? Number(action.durationMs)
              : null,
            distanceMeters:
              Number.isFinite(distanceMeters) && distanceMeters > 0
                ? distanceMeters
                : null,
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
          approach: failedSuggestionPatch(),
          routeRequest: null,
          connectorResult: {
            requestId: action.requestId,
            result: "failed",
            reason: action.reason || "unknown",
            attempt: state.routeRequest?.attempt ?? null,
            isRetry: state.routeRequest?.isRetry === true,
            targetMode: state.routeRequest?.targetMode ?? null,
            durationMs: Number.isFinite(Number(action.durationMs))
              ? Number(action.durationMs)
              : null,
          },
        });

      case NAV_ACTIONS.PERMISSION_DENIED:
        return set({
          status: "error",
          error: "location-permission-denied",
          justAcquired: false,
        });

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
        connectorRequestAttempt = 0;
        return set({
          status: "ended",
          approach: emptyApproach(),
          routeRequest: null,
          connectorResult: null,
          justAcquired: false,
        });

      case NAV_ACTIONS.ERROR:
        requestSeq += 1;
        lastRequestPos = null;
        connectorRequestAttempt = 0;
        return set({
          status: "error",
          approach: emptyApproach(),
          routeRequest: null,
          connectorResult: null,
          error: action.message || "navigation-error",
          justAcquired: false,
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
