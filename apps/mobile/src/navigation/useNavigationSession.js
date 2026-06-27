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
import {
  requestNavigationPermissions,
  startNavigationWatch,
} from "./locationService.js";

export function useNavigationSession(navigationRoute, options = {}) {
  const { background = false, ...sessionOptions } = options;

  const sessionRef = useRef(null);
  const watchRef = useRef(null);
  const watchActiveRef = useRef(false);
  const [state, setState] = useState(null);

  // (Re)create the session whenever the route identity changes.
  const routeId = navigationRoute?.id ?? null;
  useEffect(() => {
    if (!navigationRoute) {
      sessionRef.current = null;
      setState(null);
      return undefined;
    }
    sessionRef.current = createNavigationSession(navigationRoute, sessionOptions);
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
      return apply(session.dispatch(action));
    },
    [apply],
  );

  const beginWatch = useCallback(() => {
    watchActiveRef.current = true;
    startNavigationWatch({
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
    const result = await requestNavigationPermissions({ background });
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

  const pause = useCallback(() => dispatch({ type: NAV_ACTIONS.PAUSE }), [dispatch]);
  const resume = useCallback(() => dispatch({ type: NAV_ACTIONS.RESUME }), [dispatch]);
  const recenter = useCallback(
    () => dispatch({ type: NAV_ACTIONS.RECENTER }),
    [dispatch],
  );
  const userPanned = useCallback(
    () => dispatch({ type: NAV_ACTIONS.USER_PANNED }),
    [dispatch],
  );

  return { state, start, stop, pause, resume, recenter, userPanned };
}
