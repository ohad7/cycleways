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
  createNavigationEventClock,
  shouldPersistNavigationSnapshot,
} from "@cycleways/core/navigation/persistencePolicy.js";
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
import { createNavigationFinalizer } from "./navigationLifecycle.js";
import { createNavigationResumeCoordinator } from "./navigationResume.js";

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
    intersectionCrossingGuidanceEnabled = true,
    locationSource,
    computeConnector,
    captureEventSink = null,
    resumeSessionId = null,
    ...sessionOptions
  } = options;

  // Stable ref so start/beginWatch always read the current source at call time
  // without needing to be listed as a useCallback dependency.
  const locationSourceRef = useRef(null);
  locationSourceRef.current = locationSource ?? createDefaultLocationSource();
  const computeConnectorRef = useRef(computeConnector);
  computeConnectorRef.current = computeConnector;
  const captureEventSinkRef = useRef(captureEventSink);
  captureEventSinkRef.current = captureEventSink;
  const effectsSuppressedRef = useRef(false);
  const dispatchMetaRef = useRef(null);

  const sessionRef = useRef(null);
  const sessionIdRef = useRef(`nav-${Date.now()}`);
  const watchRef = useRef(null);
  const watchActiveRef = useRef(false);
  const latestFixRef = useRef(null);
  const lastProcessedFixKeyRef = useRef(null);
  const lastPersistRef = useRef({ atMs: null, status: null });
  const eventClockRef = useRef(createNavigationEventClock());
  const persistGenerationRef = useRef(0);
  const finalizerRef = useRef(null);
  const backgroundRequestedRef = useRef(background === true);
  backgroundRequestedRef.current = background === true;
  const intersectionCrossingGuidanceEnabledRef = useRef(
    intersectionCrossingGuidanceEnabled !== false,
  );

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
  const [restoreStatus, setRestoreStatus] = useState("idle");

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
          intersectionCrossingGuidanceEnabled:
            intersectionCrossingGuidanceEnabledRef.current,
        },
        voicePlanner: voicePlannerRef.current,
        latestFix,
      });
    },
    [navigationRoute],
  );

  const schedulePersist = useCallback(
    (latestFix = latestFixRef.current, policyState = null) => {
      const generation = persistGenerationRef.current;
      return persistCurrent(latestFix)
        .then((saved) => {
          // Only a successful write in the current route/clock generation moves
          // the throttle window. Failed writes remain immediately retryable.
          if (
            saved === true &&
            policyState &&
            generation === persistGenerationRef.current &&
            (lastPersistRef.current.atMs === null ||
              !Number.isFinite(Number(lastPersistRef.current.atMs)) ||
              Number(policyState.atMs) >= Number(lastPersistRef.current.atMs))
          ) {
            lastPersistRef.current = policyState;
          }
          return saved === true;
        })
        .catch(() => false);
    },
    [persistCurrent],
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
      const eventTime = eventClockRef.current.timestamp(action?.fix);
      const eventNowMs = eventTime.nowMs;
      if (eventTime.resetPolicy) {
        persistGenerationRef.current += 1;
        lastPersistRef.current = { atMs: null, status: null };
      }

      const captureMeta = dispatchMetaRef.current || {};
      captureEventSinkRef.current?.("navigation-state", {
        status: next.status || null,
        offRoute: next.offRoute === true,
        progressMeters: next.progress?.progressMeters ?? null,
        remainingMeters: next.progress?.remainingMeters ?? null,
        cueKind: next.cueEvent?.kind ?? null,
        activeCueType: next.activeCue?.cue?.type ?? null,
      }, {
        mediaTimeMs: action?.fix?.timestamp ?? captureMeta.mediaTimeMs,
        dispatchLatenessMs: captureMeta.dispatchLatenessMs,
        warmup: captureMeta.warmup,
      });

      if (next.cueEvent && hapticsEnabledRef.current && !effectsSuppressedRef.current) {
        const plan = hapticPlannerRef.current.plan(next.cueEvent, eventNowMs);
        if (plan.kind) fireHaptic(plan.kind);
      }
      if (next.cueEvent && voiceEnabledRef.current && !effectsSuppressedRef.current) {
        const plan = voicePlannerRef.current.plan(next.cueEvent, next, eventNowMs, {
          enabled: voiceEnabledRef.current,
        });
        if (plan.utterance) {
          const speechPayload = {
            utteranceId: plan.utterance.utteranceId || null,
            text: plan.utterance.text,
            language: plan.utterance.language || "he-IL",
            rate: plan.utterance.rate ?? 0.92,
            priority: plan.utterance.priority ?? null,
            interruptsCurrentSpeech: plan.utterance.interruptsCurrentSpeech === true,
          };
          captureEventSinkRef.current?.("speech-request", speechPayload, { mediaTimeMs: action?.fix?.timestamp });
          void speakUtterance(plan.utterance, {
            onStart: () => captureEventSinkRef.current?.("speech-start", speechPayload),
            onDone: () => captureEventSinkRef.current?.("speech-done", speechPayload),
            onStopped: () => captureEventSinkRef.current?.("speech-done", { ...speechPayload, stopped: true }),
            onError: (error) => captureEventSinkRef.current?.("speech-error", { ...speechPayload, error: String(error?.message || error) }),
          });
        }
      }
      if (
        shouldPersist(next) &&
        shouldPersistNavigationSnapshot({
          lastPersistAtMs: lastPersistRef.current.atMs,
          lastStatus: lastPersistRef.current.status,
          status: next.status,
          hasCueEvent: Boolean(next.cueEvent),
          nowMs: eventTime.nowMs,
        })
      ) {
        void schedulePersist(action?.fix || latestFixRef.current, {
          atMs: eventTime.nowMs,
          status: next.status,
        });
      }
      return next;
    },
    [apply, schedulePersist],
  );

  const processLocationFix = useCallback(
    (fix, meta = {}) => {
      const key = fixKey(fix);
      if (key && key === lastProcessedFixKeyRef.current) {
        return sessionRef.current?.getState?.() || null;
      }
      if (key) lastProcessedFixKeyRef.current = key;
      latestFixRef.current = fix;
      dispatchMetaRef.current = meta;
      effectsSuppressedRef.current = meta.effectsSuppressed === true;
      captureEventSinkRef.current?.("fix-dispatched", {
        warmup: meta.warmup === true,
      }, {
        mediaTimeMs: fix?.timestamp,
        dispatchLatenessMs: meta.dispatchLatenessMs,
        warmup: meta.warmup,
      });
      try {
        return dispatch({ type: NAV_ACTIONS.LOCATION, fix });
      } finally {
        effectsSuppressedRef.current = false;
        dispatchMetaRef.current = null;
      }
    },
    [dispatch],
  );

  // Create a clean session for ordinary routes. Crash resume is explicit and
  // session-id-gated so it cannot race a normal start or silently reset progress.
  const routeId = navigationRoute?.id ?? null;
  const crossingGuidanceKey = intersectionCrossingGuidanceEnabled !== false
    ? "intersection-crossings-on"
    : "intersection-crossings-off";
  useEffect(() => {
    let cancelled = false;
    const requestedIntersectionCrossingGuidanceEnabled =
      intersectionCrossingGuidanceEnabled !== false;
    intersectionCrossingGuidanceEnabledRef.current =
      requestedIntersectionCrossingGuidanceEnabled;
    finalizerRef.current = createNavigationFinalizer({
      stopWatch: () => {
        persistGenerationRef.current += 1;
        stopWatch();
        setLockScreenGuidanceActive(false);
      },
      stopBackgroundUpdates: stopNavigationBackgroundUpdates,
      deactivateKeepAwake: deactivateNavigationKeepAwake,
      stopSpeech: stopNavigationSpeech,
      clearPersisted: clearForegroundNavigation,
    });
    if (!navigationRoute) {
      sessionRef.current = null;
      latestFixRef.current = null;
      lastProcessedFixKeyRef.current = null;
      lastPersistRef.current = { atMs: null, status: null };
      eventClockRef.current = createNavigationEventClock();
      persistGenerationRef.current += 1;
      setState(null);
      setRestoreStatus("idle");
      return undefined;
    }

    const installRestoredSession = (restored, record) => {
      if (cancelled) return;
      sessionRef.current = restored;
      sessionIdRef.current = record.sessionId;
      hapticPlannerRef.current.reset();
      const restoredState = restored.getState();
      const restoredAt = Number(record.lastProcessedFixTimestamp);
      lastPersistRef.current = {
        atMs: Number.isFinite(restoredAt) ? restoredAt : null,
        status: restoredState.status,
      };
      eventClockRef.current = createNavigationEventClock();
      persistGenerationRef.current += 1;
      latestFixRef.current = restoredState.latestFix || null;
      lastProcessedFixKeyRef.current = fixKey(latestFixRef.current);
      const restoredVoice = record.settings?.voiceEnabled !== false;
      const restoredHaptics = record.settings?.hapticsEnabled !== false;
      intersectionCrossingGuidanceEnabledRef.current =
        record.settings?.intersectionCrossingGuidanceEnabled !== false;
      voiceEnabledRef.current = restoredVoice;
      setVoiceEnabledState(restoredVoice);
      hapticsEnabledRef.current = restoredHaptics;
      setHapticsEnabledState(restoredHaptics);
      voicePlannerRef.current = createNavigationVoicePlanner({
        enabled: restoredVoice,
        memory: record.voiceMemory,
      });
      setState(restoredState);
    };

    if (resumeSessionId) {
      sessionRef.current = null;
      latestFixRef.current = null;
      lastProcessedFixKeyRef.current = null;
      setState(null);
      setRestoreStatus("restoring");
      const coordinator = createNavigationResumeCoordinator({
        loadRecord: loadActiveNavigationSession,
        createSession: createNavigationSession,
        installSession: installRestoredSession,
        beginWatch,
        startBackgroundUpdates: startNavigationBackgroundUpdates,
        stopBackgroundUpdates: stopNavigationBackgroundUpdates,
        activateKeepAwake: activateNavigationKeepAwake,
        deactivateKeepAwake: deactivateNavigationKeepAwake,
        clearPersisted: clearForegroundNavigation,
        markForegroundOnly: (restored) => {
          const next = restored.dispatch({ type: NAV_ACTIONS.BACKGROUND_UNAVAILABLE });
          if (!cancelled && sessionRef.current === restored) setState(next);
        },
        setBackgroundActive: (active) => {
          if (!cancelled) setLockScreenGuidanceActive(active);
        },
        recordSessionOptions: (record) => ({
          intersectionCrossingGuidanceEnabled:
            record.settings?.intersectionCrossingGuidanceEnabled !== false,
        }),
      });
      void coordinator
        .activate({
          navigationRoute,
          sessionId: resumeSessionId,
          sessionOptions: {
            ...sessionOptions,
            intersectionCrossingGuidanceEnabled:
              requestedIntersectionCrossingGuidanceEnabled,
          },
        })
        .then((result) => {
          if (!cancelled) {
            setRestoreStatus(result.status === "restored" ? "restored" : "failed");
          }
        });
    } else {
      sessionIdRef.current = `nav-${Date.now()}`;
      sessionRef.current = createNavigationSession(navigationRoute, {
        ...sessionOptions,
        intersectionCrossingGuidanceEnabled:
          requestedIntersectionCrossingGuidanceEnabled,
      });
      hapticPlannerRef.current.reset();
      voicePlannerRef.current = createNavigationVoicePlanner({
        enabled: voiceEnabledRef.current,
      });
      latestFixRef.current = null;
      lastProcessedFixKeyRef.current = null;
      lastPersistRef.current = { atMs: null, status: null };
      eventClockRef.current = createNavigationEventClock();
      persistGenerationRef.current += 1;
      setLockScreenGuidanceActive(false);
      setState(sessionRef.current.getState());
      setRestoreStatus("idle");
    }

    return () => {
      cancelled = true;
      stopWatch();
      void stopNavigationBackgroundUpdates();
      void deactivateNavigationKeepAwake();
    };
    // sessionOptions intentionally excluded: thresholds are stable per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crossingGuidanceKey, routeId]);

  useEffect(() => {
    if (state?.status === "ended" && state?.endReason === "arrived") {
      void finalizerRef.current?.();
    }
  }, [state?.endReason, state?.status]);

  useEffect(
    () =>
      registerForegroundNavigationProcessor(async (fixes = []) => {
        if (!sessionRef.current) return false;
        for (const fix of fixes) processLocationFix(fix);
        return true;
      }),
    [processLocationFix],
  );

  useEffect(() => {
    if (shouldPersist(sessionRef.current?.getState?.())) void schedulePersist();
  }, [hapticsEnabled, lockScreenGuidanceActive, schedulePersist, voiceEnabled]);

  // Request policy stays in the pure session. Native code only executes the
  // current async request and reports its result. Background task fixes that
  // arrive while this foreground hook is mounted still use this path, because
  // the app has access to the route manager and shard-backed connector here.
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
    Promise.resolve().then(() => compute(request.from, request.to, request))
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
          connectorResult: result,
          geometry: result?.geometry,
          distanceMeters: result?.distanceMeters,
          snappedEndpoints: result?.snappedEndpoints,
          durationMs: Date.now() - startedAt,
        });
      })
      .catch((error) => {
        if (!cancelled) {
          if (__DEV__ && error?.scenarioConnector === true) {
            console.error(error);
            dispatch({
              type: NAV_ACTIONS.ERROR,
              message: error.message || "scenario-connector-mismatch",
            });
            return;
          }
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
        onFix: (fix, meta) => processLocationFix(fix, meta),
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

    // dispatch() persists this status transition itself; no explicit persist.
    dispatch({
      type: NAV_ACTIONS.PERMISSION_GRANTED,
      background: backgroundActive,
    });
    beginWatch();
  }, [
    apply,
    beginWatch,
    dispatch,
    setLockScreenGuidanceActive,
  ]);

  const stop = useCallback(() => {
    const next = dispatch({ type: NAV_ACTIONS.STOP });
    void finalizerRef.current?.();
    return next;
  }, [dispatch]);

  const pause = useCallback(() => {
    stopWatch();
    setLockScreenGuidanceActive(false);
    void stopNavigationBackgroundUpdates();
    void deactivateNavigationKeepAwake();
    // dispatch() persists the pause transition itself; no explicit persist.
    const next = dispatch({ type: NAV_ACTIONS.PAUSE });
    return next;
  }, [dispatch, setLockScreenGuidanceActive, stopWatch]);

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
    () =>
      dispatch({
        type: NAV_ACTIONS.USER_PANNED,
        timestamp: latestFixRef.current?.timestamp ?? Date.now(),
      }),
    [dispatch],
  );

  return {
    state,
    restoreStatus,
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
