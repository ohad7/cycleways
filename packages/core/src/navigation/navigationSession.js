// Pure navigation-session controller. Native code supplies location fixes and
// performs connector route requests; request policy and stale-result safety stay
// here so replay tests exercise the same decisions as the app.

import { getDistance } from "../utils/distance.js";
import {
  HANDOFF_ACCURACY_FACTOR,
  HANDOFF_MAX_ACCURACY_M,
  HANDOFF_RADIUS_M,
  RECOMPUTE_MIN_MOVE_M,
  RECOMPUTE_MIN_MS,
  TRANSIENT_RETRY_BASE_MS,
  connectorWithinCap,
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

const ACTIVE = new Set(["navigating", "off-route", "approaching", "on-connector"]);
const EMPTY_CONNECTOR = {
  status: "idle",
  requestId: 0,
  pendingTarget: null,
  geometry: null,
  distanceMeters: null,
  snappedEndpoints: [],
  failureReason: null,
};

function connectorState(patch = {}) {
  return { ...EMPTY_CONNECTOR, ...patch };
}

function fixPoint(fix) {
  return { lat: Number(fix.lat), lng: Number(fix.lng) };
}

export function createNavigationSession(navigationRoute, options = {}) {
  const mainTracker = createRouteProgressTracker(navigationRoute, options);
  const mainCues = buildRouteCues(navigationRoute);

  let connectorTracker = null;
  let connectorCues = null;
  let mainCueKey = null;
  let connectorCueKey = null;
  let wasOffRoute = false;
  let lastConfirmedProgressMeters = 0;
  let lastRequestAt = -Infinity;
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
    connector: connectorState(),
    routeRequest: null,
    error: null,
  };

  function set(patch) {
    state = { ...state, ...patch };
    return state;
  }

  function elapsedSinceRequest(fix) {
    const timestamp = Number(fix?.timestamp);
    return Number.isFinite(timestamp) ? timestamp - lastRequestAt : Infinity;
  }

  function movedSinceRequest(fix) {
    return lastRequestPos ? getDistance(lastRequestPos, fix) : Infinity;
  }

  function mayRequest(fix) {
    if (lastRequestPos === null) return true;
    if (state.connector.status === "failed") {
      if (state.connector.failureReason === "transient") {
        return elapsedSinceRequest(fix) >= TRANSIENT_RETRY_BASE_MS;
      }
      return movedSinceRequest(fix) >= RECOMPUTE_MIN_MOVE_M;
    }
    return (
      elapsedSinceRequest(fix) >= RECOMPUTE_MIN_MS &&
      movedSinceRequest(fix) >= RECOMPUTE_MIN_MOVE_M
    );
  }

  function requestConnector(fix, mode, target, progress, fallbackStatus) {
    requestSeq += 1;
    const requestId = requestSeq;
    lastRequestAt = Number.isFinite(Number(fix.timestamp))
      ? Number(fix.timestamp)
      : lastRequestAt;
    lastRequestPos = fixPoint(fix);
    const pendingTarget = { ...target, mode };
    return set({
      status: fallbackStatus,
      progress,
      activeCue: null,
      offRoute: fallbackStatus === "off-route",
      connector: connectorState({
        status: "requesting",
        requestId,
        pendingTarget,
      }),
      routeRequest: {
        requestId,
        from: fixPoint(fix),
        to: target.point,
        toProgressMeters: target.mainProgressMeters,
        mode,
      },
    });
  }

  function cueFor(activeCue, namespace, connector = false) {
    const key = activeCue
      ? `${namespace}:${activeCue.cue.type}:${activeCue.cue.distanceMeters}:${activeCue.phase}`
      : null;
    const previous = connector ? connectorCueKey : mainCueKey;
    const event = key && key !== previous
      ? {
          kind: "cue",
          cueType: activeCue.cue.type,
          phase: activeCue.phase,
          cue: activeCue.cue,
        }
      : null;
    if (connector) connectorCueKey = key;
    else mainCueKey = key;
    return event;
  }

  function clearConnector() {
    connectorTracker = null;
    connectorCues = null;
    connectorCueKey = null;
    return connectorState();
  }

  function handoffAtTarget(fix, target) {
    mainTracker.seed({
      progressMeters: target.mainProgressMeters,
      acquired: true,
    });
    const progress = mainTracker.update(fix);
    lastConfirmedProgressMeters = progress.progressMeters;
    mainCueKey = null;
    return set({
      status: "navigating",
      progress,
      activeCue: selectActiveCue(mainCues, progress.progressMeters),
      cueEvent: null,
      offRoute: false,
      connector: clearConnector(),
      routeRequest: null,
    });
  }

  function handoffAtMainProgress(mainProgress) {
    lastConfirmedProgressMeters = mainProgress.progressMeters;
    mainCueKey = null;
    return set({
      status: "navigating",
      progress: mainProgress,
      activeCue: selectActiveCue(mainCues, mainProgress.progressMeters),
      cueEvent: null,
      offRoute: false,
      connector: clearConnector(),
      routeRequest: null,
    });
  }

  function updateConnector(fix, mainProgress) {
    const target = state.connector.pendingTarget;
    const connectorProgress = connectorTracker.update(fix);
    const accuracy = Math.min(
      HANDOFF_MAX_ACCURACY_M,
      Math.max(0, Number(fix.accuracy) || 0),
    );
    const targetReached =
      target &&
      getDistance(fix, target.point) <=
        HANDOFF_RADIUS_M + HANDOFF_ACCURACY_FACTOR * accuracy;
    const mainRecovered =
      mainProgress.hasAcquiredRoute &&
      !mainProgress.offRoute &&
      mainProgress.crossTrackMeters <= HANDOFF_RADIUS_M + accuracy;

    if (targetReached) return handoffAtTarget(fix, target);
    if (mainRecovered) return handoffAtMainProgress(mainProgress);

    const leftConnector =
      connectorProgress.offRoute ||
      (!connectorProgress.hasAcquiredRoute && mayRequest(fix));
    if (leftConnector && mayRequest(fix)) {
      const mode = mainProgress.hasAcquiredRoute ? "rejoin" : "approach";
      const targetForRecompute = selectConnectorTarget(navigationRoute, fix, {
        mode,
        lastConfirmedProgressMeters,
      });
      if (targetForRecompute) {
        connectorTracker = null;
        connectorCues = null;
        connectorCueKey = null;
        return requestConnector(
          fix,
          mode,
          targetForRecompute,
          mainProgress,
          mode === "rejoin" ? "off-route" : "approaching",
        );
      }
    }

    const activeCue = selectActiveCue(
      connectorCues,
      connectorProgress.progressMeters,
    );
    return set({
      status: "on-connector",
      progress: connectorProgress,
      activeCue,
      cueEvent: cueFor(activeCue, `connector:${state.connector.requestId}`, true),
      offRoute: false,
      routeRequest: null,
    });
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
        connectorTracker = null;
        connectorCues = null;
        mainCueKey = null;
        connectorCueKey = null;
        wasOffRoute = false;
        lastConfirmedProgressMeters = 0;
        lastRequestAt = -Infinity;
        lastRequestPos = null;
        return set({
          status: "navigating",
          backgroundLocation: action.background === true,
          foregroundOnly: action.background !== true,
          connector: connectorState(),
          routeRequest: null,
          error: null,
        });

      case NAV_ACTIONS.LOCATION: {
        if (!ACTIVE.has(state.status)) return state;
        const latestFix = { ...action.fix };
        state = { ...state, latestFix };
        const mainProgress = mainTracker.update(action.fix);
        const mainAccuracy = Math.min(
          HANDOFF_MAX_ACCURACY_M,
          Math.max(0, Number(action.fix.accuracy) || 0),
        );
        if (
          mainProgress.hasAcquiredRoute &&
          !mainProgress.offRoute &&
          mainProgress.crossTrackMeters <= HANDOFF_RADIUS_M + mainAccuracy
        ) {
          lastConfirmedProgressMeters = mainProgress.progressMeters;
        }

        if (state.connector.status === "active" && connectorTracker) {
          return updateConnector(action.fix, mainProgress);
        }

        if (!mainProgress.hasAcquiredRoute) {
          if (
            (state.connector.status === "idle" || state.connector.status === "failed") &&
            mayRequest(action.fix)
          ) {
            const target = selectConnectorTarget(navigationRoute, action.fix, {
              mode: "approach",
            });
            if (target) {
              return requestConnector(
                action.fix,
                "approach",
                target,
                mainProgress,
                "approaching",
              );
            }
          }
          return set({
            status: "approaching",
            progress: mainProgress,
            activeCue: null,
            offRoute: false,
            cueEvent: null,
          });
        }

        const offRoute = mainProgress.offRoute;
        if (
          offRoute &&
          (state.connector.status === "idle" || state.connector.status === "failed") &&
          mayRequest(action.fix)
        ) {
          const target = selectConnectorTarget(navigationRoute, action.fix, {
            mode: "rejoin",
            lastConfirmedProgressMeters,
          });
          if (target) {
            const firstOffRoute = !wasOffRoute;
            wasOffRoute = true;
            const next = requestConnector(
              action.fix,
              "rejoin",
              target,
              mainProgress,
              "off-route",
            );
            return set({
              ...next,
              cueEvent: firstOffRoute ? { kind: "off-route" } : null,
            });
          }
        }

        if (!offRoute && state.connector.status !== "idle") {
          requestSeq += 1;
          state = {
            ...state,
            connector: clearConnector(),
            routeRequest: null,
          };
        }

        const activeCue = selectActiveCue(mainCues, mainProgress.progressMeters);
        let cueEvent = null;
        if (offRoute && !wasOffRoute) cueEvent = { kind: "off-route" };
        else if (!offRoute) cueEvent = cueFor(activeCue, "main");
        wasOffRoute = offRoute;
        return set({
          status: offRoute ? "off-route" : "navigating",
          progress: mainProgress,
          activeCue,
          offRoute,
          cueEvent,
        });
      }

      case NAV_ACTIONS.CONNECTOR_READY: {
        if (
          state.status === "paused" ||
          state.connector.status !== "requesting" ||
          action.requestId !== state.connector.requestId
        ) {
          return state;
        }
        if (!connectorWithinCap(action.distanceMeters)) {
          return set({
            connector: connectorState({
              status: "failed",
              requestId: state.connector.requestId,
              pendingTarget: state.connector.pendingTarget,
              failureReason: "over-cap",
            }),
            routeRequest: null,
          });
        }
        const geometry = buildNavigationGeometry(action.geometry);
        if (geometry.length < 2) {
          return set({
            connector: connectorState({
              status: "failed",
              requestId: state.connector.requestId,
              pendingTarget: state.connector.pendingTarget,
              failureReason: "invalid-geometry",
            }),
            routeRequest: null,
          });
        }
        connectorTracker = createRouteProgressTracker({ geometry }, options);
        connectorCues = buildRouteCues({ geometry });
        connectorCueKey = null;
        const connectorProgress = state.latestFix
          ? connectorTracker.update(state.latestFix)
          : null;
        return set({
          status: "on-connector",
          offRoute: false,
          progress: connectorProgress,
          activeCue: connectorProgress
            ? selectActiveCue(connectorCues, connectorProgress.progressMeters)
            : null,
          cueEvent: null,
          connector: connectorState({
            status: "active",
            requestId: state.connector.requestId,
            pendingTarget: state.connector.pendingTarget,
            geometry,
            distanceMeters: action.distanceMeters,
            snappedEndpoints: Array.isArray(action.snappedEndpoints)
              ? action.snappedEndpoints
              : [],
          }),
          routeRequest: null,
        });
      }

      case NAV_ACTIONS.CONNECTOR_FAILED:
        if (
          state.status === "paused" ||
          state.connector.status !== "requesting" ||
          action.requestId !== state.connector.requestId
        ) {
          return state;
        }
        return set({
          connector: connectorState({
            status: "failed",
            requestId: state.connector.requestId,
            pendingTarget: state.connector.pendingTarget,
            failureReason: action.reason || "transient",
          }),
          routeRequest: null,
        });

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
        return set({
          status: "ended",
          connector: clearConnector(),
          routeRequest: null,
        });

      case NAV_ACTIONS.ERROR:
        requestSeq += 1;
        return set({
          status: "error",
          connector: clearConnector(),
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
