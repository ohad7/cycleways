// React hook wiring the native location service into the pure core navigation
// session (turn-by-turn Phase 6/7 glue).
//
// The session brain (states, progress, cues, off-route, cue events) lives in
// @cycleways/core/navigation/navigationSession.js and is fully node-tested. This
// hook only owns native side-effects: requesting permissions, running the
// location watch, re-rendering on state changes, and tearing the watch down.
//
// First release is FOREGROUND-ONLY: `background` defaults to false so we ship
// the verified path and avoid lock-screen behavior that needs device testing.
//
// NOTE: native glue — not covered by the node test suite.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  NAV_ACTIONS,
  createNavigationSession,
} from "@cycleways/core/navigation/navigationSession.js";
import { createCueHapticPlanner } from "@cycleways/core/navigation/cueHaptics.js";
import { createDefaultLocationSource } from "./locationService.js";
import { fireHaptic } from "./cueHapticsAdapter.js";

export function useNavigationSession(navigationRoute, options = {}) {
  const {
    background = false,
    haptics = true,
    locationSource,
    computeConnector,
    ...sessionOptions
  } = options;

  // Stable ref so start/beginWatch always read the current source at call time
  // without needing to be listed as a useCallback dependency. Updated each
  // render (synchronous, before any effect) so that the caller can set a new
  // source (e.g. a dev simulate source) before calling start(), and the hook
  // picks it up on the very next start() invocation.
  const locationSourceRef = useRef(null);
  locationSourceRef.current = locationSource ?? createDefaultLocationSource();
  const computeConnectorRef = useRef(computeConnector);
  computeConnectorRef.current = computeConnector;

  const sessionRef = useRef(null);
  const watchRef = useRef(null);
  const watchActiveRef = useRef(false);
  const hapticPlannerRef = useRef(createCueHapticPlanner());
  const hapticsEnabledRef = useRef(haptics);
  const [hapticsEnabled, setHapticsEnabledState] = useState(haptics);
  const [state, setState] = useState(null);

  const setHapticsEnabled = useCallback((next) => {
    hapticsEnabledRef.current = next;
    setHapticsEnabledState(next);
  }, []);

  // (Re)create the session whenever the route identity changes.
  const routeId = navigationRoute?.id ?? null;
  useEffect(() => {
    if (!navigationRoute) {
      sessionRef.current = null;
      setState(null);
      return undefined;
    }
    sessionRef.current = createNavigationSession(navigationRoute, sessionOptions);
    hapticPlannerRef.current.reset();
    setState(sessionRef.current.getState());
    return () => {
      stopWatch();
    };
    // sessionOptions intentionally excluded: thresholds are stable per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId]);

  const apply = useCallback((next) => {
    setState(next);
    return next;
  }, []);

  const stopWatch = useCallback(() => {
    watchActiveRef.current = false;
    if (watchRef.current) {
      watchRef.current.stop();
      watchRef.current = null;
    }
  }, []);

  const dispatch = useCallback(
    (action) => {
      const session = sessionRef.current;
      if (!session) return null;
      const next = apply(session.dispatch(action));
      if (next.cueEvent && hapticsEnabledRef.current) {
        const plan = hapticPlannerRef.current.plan(next.cueEvent, Date.now());
        if (plan.kind) fireHaptic(plan.kind);
      }
      return next;
    },
    [apply],
  );

  // Request policy stays in the pure session. Native code only executes the
  // current async request and reports its result.
  useEffect(() => {
    const request = state?.routeRequest;
    if (
      !request ||
      state?.status === "paused" ||
      state?.route?.id !== routeId
    ) {
      return undefined;
    }
    let cancelled = false;
    const startedAt = Date.now();
    const compute = computeConnectorRef.current;
    if (typeof compute !== "function") {
      dispatch({
        type: NAV_ACTIONS.CONNECTOR_FAILED,
        requestId: request.requestId,
        reason: "no-router",
        durationMs: Date.now() - startedAt,
      });
      return undefined;
    }
    Promise.resolve(compute(request.from, request.to))
      .then((result) => {
        if (cancelled) return;
        if (result?.failure) {
          dispatch({
            type: NAV_ACTIONS.CONNECTOR_FAILED,
            requestId: request.requestId,
            reason: result.failure,
            durationMs: Date.now() - startedAt,
          });
          return;
        }
        dispatch({
          type: NAV_ACTIONS.CONNECTOR_READY,
          requestId: request.requestId,
          geometry: result?.geometry,
          distanceMeters: result?.distanceMeters,
          snappedEndpoints: result?.snappedEndpoints,
          durationMs: Date.now() - startedAt,
        });
      })
      .catch(() => {
        if (!cancelled) {
          dispatch({
            type: NAV_ACTIONS.CONNECTOR_FAILED,
            requestId: request.requestId,
            reason: "transient",
            durationMs: Date.now() - startedAt,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dispatch, routeId, state?.routeRequest?.requestId, state?.status]);

  const beginWatch = useCallback(() => {
    watchActiveRef.current = true;
    // Route through the current source (real GPS or injected simulate/recorder).
    // The race-guard pattern (watchActiveRef / watchRef) is preserved exactly:
    // if stop() fires before the async startWatch resolves, the handle is
    // dropped immediately rather than stored.
    locationSourceRef.current.startWatch({
      onFix: (fix) => dispatch({ type: NAV_ACTIONS.LOCATION, fix }),
      onError: (error) =>
        dispatch({ type: NAV_ACTIONS.ERROR, message: String(error?.message || error) }),
    }).then((handle) => {
      // If navigation was stopped while the watch was starting, drop the handle.
      if (watchActiveRef.current) {
        watchRef.current = handle;
      } else {
        handle.stop();
      }
    });
  }, [dispatch]);

  const start = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    const requested = apply(session.dispatch({ type: NAV_ACTIONS.START }));
    if (requested.status === "error") return; // non-navigable route
    const result = await locationSourceRef.current.requestPermissions({ background });
    if (!result.granted) {
      apply(session.dispatch({ type: NAV_ACTIONS.PERMISSION_DENIED }));
      return;
    }
    apply(
      session.dispatch({
        type: NAV_ACTIONS.PERMISSION_GRANTED,
        background: result.background,
      }),
    );
    beginWatch();
  }, [apply, background, beginWatch]);

  const stop = useCallback(() => {
    stopWatch();
    dispatch({ type: NAV_ACTIONS.STOP });
  }, [dispatch, stopWatch]);

  const pause = useCallback(() => {
    stopWatch();
    return dispatch({ type: NAV_ACTIONS.PAUSE });
  }, [dispatch, stopWatch]);
  const resume = useCallback(() => {
    const wasPaused = sessionRef.current?.getState()?.status === "paused";
    const next = dispatch({ type: NAV_ACTIONS.RESUME });
    if (
      wasPaused &&
      next &&
      ["navigating", "approaching", "off-route"].includes(next.status)
    ) {
      beginWatch();
    }
    return next;
  }, [beginWatch, dispatch]);
  const recenter = useCallback(
    () => dispatch({ type: NAV_ACTIONS.RECENTER }),
    [dispatch],
  );
  const userPanned = useCallback(
    () => dispatch({ type: NAV_ACTIONS.USER_PANNED }),
    [dispatch],
  );
  return {
    state,
    start,
    stop,
    pause,
    resume,
    recenter,
    userPanned,
    hapticsEnabled,
    setHapticsEnabled,
  };
}
