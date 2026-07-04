// React hook wiring the native location service into the pure core navigation
// session. The core session owns route progress, cue events, off-route state,
// and connector requests. This hook owns native side effects: permissions,
// foreground GPS, background task registration, keep-awake, haptics, speech,
// and persisted active-session snapshots.
//
// NOTE: native glue — only the pure navigation logic is covered by node tests.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  NAV_ACTIONS,
  createNavigationSession,
} from "@cycleways/core/navigation/navigationSession.js";
import { createCueHapticPlanner } from "@cycleways/core/navigation/cueHaptics.js";
import { createNavigationVoicePlanner } from "@cycleways/core/navigation/navigationVoice.js";
import {
  createDefaultLocationSource,
  startNavigationBackgroundUpdates,
  stopNavigationBackgroundUpdates,
} from "./locationService.js";
import { fireHaptic } from "./cueHapticsAdapter.js";
import {
  activateNavigationKeepAwake,
  deactivateNavigationKeepAwake,
} from "./keepAwakeAdapter.js";
import {
  clearForegroundNavigation,
  persistForegroundNavigation,
  registerForegroundNavigationProcessor,
} from "./navigationRuntime.js";
import { loadActiveNavigationSession } from "./activeNavigationStore.js";
import {
  speakUtterance,
  stopNavigationSpeech,
} from "./speechAdapter.js";

const ACTIVE_STATUSES = new Set(["navigating", "approaching", "off-route"]);
const PERSISTED_STATUSES = new Set([
  "requesting-permission",
  "navigating",
  "approaching",
  "off-route",
  "paused",
]);

function fixTimestamp(fix) {
  const value = Number(fix?.timestamp);
  return Number.isFinite(value) ? value : Date.now();
}

function fixKey(fix) {
  if (!fix) return null;
  const lat = Number(fix.lat);
  const lng = Number(fix.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const timestamp = Number.isFinite(Number(fix.timestamp))
    ? Math.round(Number(fix.timestamp))
    : "no-ts";
  return `${timestamp}:${lat.toFixed(6)}:${lng.toFixed(6)}`;
}

function shouldPersist(state) {
  return PERSISTED_STATUSES.has(state?.status);
}

export function useNavigationSession(navigationRoute, options = {}) {
  const {
    background = false,
    haptics = true,
    voice = true,
    locationSource,
    computeConnector,
    ...sessionOptions
  } = options;

  // Stable ref so start/beginWatch always read the current source at call time
  // without needing to be listed as a useCallback dependency.
  const locationSourceRef = useRef(null);
  locationSourceRef.current = locationSource ?? createDefaultLocationSource();
  const computeConnectorRef = useRef(computeConnector);
  computeConnectorRef.current = computeConnector;

  const sessionRef = useRef(null);
  const sessionIdRef = useRef(`nav-${Date.now()}`);
  const watchRef = useRef(null);
  const watchActiveRef = useRef(false);
  const latestFixRef = useRef(null);
  const lastProcessedFixKeyRef = useRef(null);
  const backgroundRequestedRef = useRef(background === true);
  backgroundRequestedRef.current = background === true;

  const hapticPlannerRef = useRef(createCueHapticPlanner());
  const hapticsEnabledRef = useRef(haptics === true);
  const [hapticsEnabled, setHapticsEnabledState] = useState(haptics === true);

  const voicePlannerRef = useRef(createNavigationVoicePlanner({ enabled: voice === true }));
  const voiceEnabledRef = useRef(voice === true);
  const [voiceEnabled, setVoiceEnabledState] = useState(voice === true);

  const lockScreenGuidanceActiveRef = useRef(false);
  const [lockScreenGuidanceActive, setLockScreenGuidanceActiveState] =
    useState(false);
  const [state, setState] = useState(null);

  const stopWatch = useCallback(() => {
    watchActiveRef.current = false;
    if (watchRef.current) {
      watchRef.current.stop();
      watchRef.current = null;
    }
  }, []);

  const setLockScreenGuidanceActive = useCallback((next) => {
    const value = next === true;
    lockScreenGuidanceActiveRef.current = value;
    setLockScreenGuidanceActiveState(value);
  }, []);

  const setHapticsEnabled = useCallback((next) => {
    const value = next === true;
    hapticsEnabledRef.current = value;
    setHapticsEnabledState(value);
  }, []);

  const setVoiceEnabled = useCallback((next) => {
    const value = next === true;
    voiceEnabledRef.current = value;
    setVoiceEnabledState(value);
    if (!value) void stopNavigationSpeech();
  }, []);

  useEffect(() => {
    setHapticsEnabled(haptics === true);
  }, [haptics, setHapticsEnabled]);

  useEffect(() => {
    setVoiceEnabled(voice === true);
  }, [setVoiceEnabled, voice]);

  const persistCurrent = useCallback(
    (latestFix = latestFixRef.current) => {
      const session = sessionRef.current;
      const currentState = session?.getState?.();
      if (!session || !navigationRoute || !shouldPersist(currentState)) {
        return Promise.resolve(false);
      }
      return persistForegroundNavigation({
        session,
        navigationRoute,
        settings: {
          sessionId: sessionIdRef.current,
          voiceEnabled: voiceEnabledRef.current,
          hapticsEnabled: hapticsEnabledRef.current,
          lockScreenGuidanceEnabled: backgroundRequestedRef.current,
          lockScreenGuidanceActive: lockScreenGuidanceActiveRef.current,
        },
        voicePlanner: voicePlannerRef.current,
        latestFix,
      });
    },
    [navigationRoute],
  );

  const apply = useCallback((next) => {
    setState(next);
    return next;
  }, []);

  const dispatch = useCallback(
    (action) => {
      const session = sessionRef.current;
      if (!session) return null;
      const next = apply(session.dispatch(action));
      const nowMs = action?.fix ? fixTimestamp(action.fix) : Date.now();

      if (next.cueEvent && hapticsEnabledRef.current) {
        const plan = hapticPlannerRef.current.plan(next.cueEvent, nowMs);
        if (plan.kind) fireHaptic(plan.kind);
      }
      if (next.cueEvent && voiceEnabledRef.current) {
        const plan = voicePlannerRef.current.plan(next.cueEvent, next, nowMs, {
          enabled: voiceEnabledRef.current,
        });
        if (plan.utterance) void speakUtterance(plan.utterance);
      }
      if (shouldPersist(next)) void persistCurrent(action?.fix || latestFixRef.current);
      return next;
    },
    [apply, persistCurrent],
  );

  const processLocationFix = useCallback(
    (fix, source = "foreground") => {
      const key = fixKey(fix);
      if (key && key === lastProcessedFixKeyRef.current) {
        return sessionRef.current?.getState?.() || null;
      }
      if (key) lastProcessedFixKeyRef.current = key;
      latestFixRef.current = fix;

      let next = dispatch({ type: NAV_ACTIONS.LOCATION, fix });
      if (source === "background" && next?.routeRequest?.requestId) {
        next = dispatch({
          type: NAV_ACTIONS.CONNECTOR_FAILED,
          requestId: next.routeRequest.requestId,
          reason: "background-no-router",
        });
      }
      return next;
    },
    [dispatch],
  );

  // (Re)create the session whenever the route identity changes. If a background
  // task persisted a matching active session while React was not mounted, restore
  // it so returning to the app renders current state instead of pre-lock state.
  const routeId = navigationRoute?.id ?? null;
  useEffect(() => {
    let cancelled = false;
    if (!navigationRoute) {
      sessionRef.current = null;
      latestFixRef.current = null;
      lastProcessedFixKeyRef.current = null;
      setState(null);
      return undefined;
    }

    sessionIdRef.current = `nav-${Date.now()}`;
    sessionRef.current = createNavigationSession(navigationRoute, sessionOptions);
    hapticPlannerRef.current.reset();
    voicePlannerRef.current = createNavigationVoicePlanner({
      enabled: voiceEnabledRef.current,
    });
    latestFixRef.current = null;
    lastProcessedFixKeyRef.current = null;
    setLockScreenGuidanceActive(false);
    setState(sessionRef.current.getState());

    loadActiveNavigationSession()
      .then((record) => {
        if (cancelled) return;
        if (record?.navigationRoute?.id !== navigationRoute.id) return;
        const restored = createNavigationSession(navigationRoute, {
          ...sessionOptions,
          snapshot: record.sessionSnapshot,
        });
        sessionRef.current = restored;
        sessionIdRef.current = record.sessionId || sessionIdRef.current;
        const restoredVoice = record.settings?.voiceEnabled !== false;
        const restoredHaptics = record.settings?.hapticsEnabled !== false;
        voiceEnabledRef.current = restoredVoice;
        setVoiceEnabledState(restoredVoice);
        hapticsEnabledRef.current = restoredHaptics;
        setHapticsEnabledState(restoredHaptics);
        voicePlannerRef.current = createNavigationVoicePlanner({
          enabled: restoredVoice,
          memory: record.voiceMemory,
        });
        const restoredLockScreen = record.settings?.lockScreenGuidanceActive === true;
        setLockScreenGuidanceActive(restoredLockScreen);
        latestFixRef.current = restored.getState()?.latestFix || null;
        const key = fixKey(latestFixRef.current);
        lastProcessedFixKeyRef.current = key;
        setState(restored.getState());
      })
      .catch(() => {
        // Invalid snapshots are cleared by the store; keep the clean session.
      });

    return () => {
      cancelled = true;
      stopWatch();
      void stopNavigationBackgroundUpdates();
      void deactivateNavigationKeepAwake();
    };
    // sessionOptions intentionally excluded: thresholds are stable per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId]);

  useEffect(
    () =>
      registerForegroundNavigationProcessor(async (fixes = []) => {
        for (const fix of fixes) processLocationFix(fix, "background");
      }),
    [processLocationFix],
  );

  useEffect(() => {
    if (shouldPersist(sessionRef.current?.getState?.())) void persistCurrent();
  }, [hapticsEnabled, lockScreenGuidanceActive, persistCurrent, voiceEnabled]);

  // Request policy stays in the pure session. Native code only executes the
  // current async request and reports its result. Background task fixes
  // deliberately fail connector requests for v1, so this effect represents the
  // mounted foreground UI path.
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
    locationSourceRef.current
      .startWatch({
        onFix: (fix) => processLocationFix(fix, "foreground"),
        onError: (error) =>
          dispatch({
            type: NAV_ACTIONS.ERROR,
            message: String(error?.message || error),
          }),
      })
      .then((handle) => {
        if (watchActiveRef.current) {
          watchRef.current = handle;
        } else {
          handle.stop();
        }
      })
      .catch((error) => {
        dispatch({
          type: NAV_ACTIONS.ERROR,
          message: String(error?.message || error),
        });
      });
  }, [dispatch, processLocationFix]);

  const start = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    const requested = apply(session.dispatch({ type: NAV_ACTIONS.START }));
    if (requested.status === "error") return;

    const wantsBackground = backgroundRequestedRef.current === true;
    let result;
    try {
      result = await locationSourceRef.current.requestPermissions({
        background: wantsBackground,
      });
    } catch {
      result = { granted: false, background: false };
    }
    if (!result.granted) {
      apply(session.dispatch({ type: NAV_ACTIONS.PERMISSION_DENIED }));
      setLockScreenGuidanceActive(false);
      await stopNavigationBackgroundUpdates();
      await deactivateNavigationKeepAwake();
      await clearForegroundNavigation();
      return;
    }

    let backgroundActive = wantsBackground && result.background === true;
    if (backgroundActive) {
      backgroundActive = await startNavigationBackgroundUpdates();
    }
    setLockScreenGuidanceActive(backgroundActive);
    if (backgroundActive) {
      await deactivateNavigationKeepAwake();
    } else {
      await stopNavigationBackgroundUpdates();
      await activateNavigationKeepAwake();
    }

    dispatch({
      type: NAV_ACTIONS.PERMISSION_GRANTED,
      background: backgroundActive,
    });
    await persistCurrent();
    beginWatch();
  }, [
    apply,
    beginWatch,
    dispatch,
    persistCurrent,
    setLockScreenGuidanceActive,
  ]);

  const stop = useCallback(() => {
    stopWatch();
    setLockScreenGuidanceActive(false);
    void stopNavigationBackgroundUpdates();
    void deactivateNavigationKeepAwake();
    void stopNavigationSpeech();
    const next = dispatch({ type: NAV_ACTIONS.STOP });
    void clearForegroundNavigation();
    return next;
  }, [dispatch, setLockScreenGuidanceActive, stopWatch]);

  const pause = useCallback(() => {
    stopWatch();
    setLockScreenGuidanceActive(false);
    void stopNavigationBackgroundUpdates();
    void deactivateNavigationKeepAwake();
    const next = dispatch({ type: NAV_ACTIONS.PAUSE });
    void persistCurrent();
    return next;
  }, [dispatch, persistCurrent, setLockScreenGuidanceActive, stopWatch]);

  const resume = useCallback(() => {
    const wasPaused = sessionRef.current?.getState()?.status === "paused";
    const next = dispatch({ type: NAV_ACTIONS.RESUME });
    if (wasPaused && next && ACTIVE_STATUSES.has(next.status)) {
      if (next.backgroundLocation) {
        void startNavigationBackgroundUpdates().then((started) => {
          setLockScreenGuidanceActive(started);
          if (!started) void activateNavigationKeepAwake();
        });
      } else {
        setLockScreenGuidanceActive(false);
        void activateNavigationKeepAwake();
      }
      beginWatch();
    }
    return next;
  }, [beginWatch, dispatch, setLockScreenGuidanceActive]);

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
    voiceEnabled,
    setVoiceEnabled,
    lockScreenGuidanceActive,
  };
}
