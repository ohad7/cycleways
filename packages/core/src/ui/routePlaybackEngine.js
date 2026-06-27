import { useEffect, useMemo, useRef, useState } from "react";
import { computeMapPlaybackDuration } from "./routePlaybackDuration.js";
import { createVariableSpeedRoutePlaybackSync } from "./routePlaybackSync.js";

const MAP_PLAYBACK_PREVIEW_MAX_FRACTION = 0.06;
const MAP_PLAYBACK_PREVIEW_MAX_METERS = 1200;
const MAP_PLAYBACK_BORING_RATE = 4;
const MAP_PLAYBACK_DURATION_SCALE = 0.55;

function defaultClock() {
  // requestAnimationFrame / cancelAnimationFrame exist globally on web and RN.
  const raf =
    typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (cb) => setTimeout(() => cb(Date.now()), 16);
  const caf =
    typeof cancelAnimationFrame === "function"
      ? cancelAnimationFrame
      : (id) => clearTimeout(id);
  const now =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? () => performance.now()
      : () => Date.now();
  return { now, requestFrame: (cb) => raf(cb), cancelFrame: (id) => caf(id) };
}

function clampTime(time, duration) {
  const value = Number(time);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(duration, value));
}

export function createRoutePlaybackEngine({
  sync,
  fallbackDuration = 0,
  clock = defaultClock(),
  onCursorChange,
  onPlayingChange,
}) {
  const duration = sync?.durationSeconds ?? fallbackDuration;
  let currentTime = 0;
  let cursor = null;
  let isPlaying = false;
  let frameId = null;
  let lastFrameTime = null;
  const subscribers = new Set();

  function getState() {
    return { currentTime, cursor, duration, isPlaying, isReady: Boolean(sync) };
  }
  function notify() {
    const state = getState();
    subscribers.forEach((cb) => cb(state));
  }
  function subscribe(cb) {
    subscribers.add(cb);
    return () => subscribers.delete(cb);
  }
  function setPlaying(next) {
    isPlaying = next;
    onPlayingChange?.(next);
  }
  function stopTicker() {
    if (frameId !== null) {
      clock.cancelFrame(frameId);
      frameId = null;
    }
    lastFrameTime = null;
  }
  function emitCursorForTime(time) {
    if (!sync) return null;
    const t = clampTime(time, duration);
    currentTime = t;
    const position = sync.timeToPosition(t);
    cursor = { t, lat: position.lat, lng: position.lng, fraction: position.fraction };
    onCursorChange?.(cursor);
    notify();
    return cursor;
  }
  function tick(now) {
    if (!isPlaying) { frameId = null; lastFrameTime = null; return; }
    const last = Number.isFinite(lastFrameTime) ? lastFrameTime : now;
    lastFrameTime = now;
    const elapsed = Math.max(0, (now - last) / 1000);
    const nextTime = Math.min(duration, currentTime + elapsed);
    emitCursorForTime(nextTime);
    if (nextTime >= duration) {
      setPlaying(false);
      frameId = null;
      lastFrameTime = null;
      notify();
      return;
    }
    frameId = clock.requestFrame(tick);
  }
  function startTicker() {
    if (!sync || frameId !== null) return;
    lastFrameTime = clock.now();
    frameId = clock.requestFrame(tick);
  }
  function play() {
    if (!sync) return;
    if (currentTime >= duration - 0.05) emitCursorForTime(0);
    setPlaying(true);
    notify();
    startTicker();
  }
  function pause() {
    setPlaying(false);
    stopTicker();
    notify();
  }
  function seekToTime(time) {
    const next = emitCursorForTime(time);
    if (currentTime >= duration && isPlaying) pause();
    return next;
  }
  function seekToFraction(fraction) {
    if (!sync || typeof sync.positionToTime !== "function") return null;
    return seekToTime(sync.positionToTime(fraction));
  }
  function togglePlayback() {
    if (isPlaying) pause();
    else play();
  }
  function reset() {
    stopTicker();
    currentTime = 0;
    cursor = null;
    setPlaying(false);
    onCursorChange?.(null);
    notify();
  }
  function dispose() {
    stopTicker();
    subscribers.clear();
  }

  if (sync) emitCursorForTime(0);

  return {
    getState, subscribe,
    play, pause, togglePlayback,
    seekToTime, seekToFraction, reset, dispose,
  };
}

export function useRoutePlaybackEngine({
  sync,
  fallbackDuration = 0,
  onCursorChange,
  onPlayingChange,
  clock,
}) {
  const onCursorChangeRef = useRef(onCursorChange);
  const onPlayingChangeRef = useRef(onPlayingChange);
  useEffect(() => { onCursorChangeRef.current = onCursorChange; }, [onCursorChange]);
  useEffect(() => { onPlayingChangeRef.current = onPlayingChange; }, [onPlayingChange]);

  const engine = useMemo(
    () => createRoutePlaybackEngine({
      sync,
      fallbackDuration,
      clock,
      onCursorChange: (c) => onCursorChangeRef.current?.(c),
      onPlayingChange: (p) => onPlayingChangeRef.current?.(p),
    }),
    [sync, fallbackDuration, clock],
  );

  const [state, setState] = useState(() => engine.getState());
  useEffect(() => {
    setState(engine.getState());
    const unsubscribe = engine.subscribe(setState);
    return () => { unsubscribe(); engine.dispose(); };
  }, [engine]);

  return {
    sync,
    currentTime: state.currentTime,
    cursor: state.cursor,
    duration: state.duration,
    isPlaying: state.isPlaying,
    isReady: state.isReady,
    hasCursor: Boolean(state.cursor),
    play: engine.play,
    pause: engine.pause,
    togglePlayback: engine.togglePlayback,
    seekToTime: engine.seekToTime,
    seekToFraction: engine.seekToFraction,
    reset: engine.reset,
  };
}

export function useSyntheticRoutePlaybackEngine({
  enabled = true,
  routeState,
  cueSlides,
  onCursorChange,
  onPlayingChange,
  clock,
}) {
  const safeCueSlides = Array.isArray(cueSlides) ? cueSlides : [];
  const cueCount = useMemo(
    () => safeCueSlides.filter((s) => s.kind !== "start" && s.kind !== "end").length,
    [safeCueSlides],
  );
  const baseDuration = useMemo(
    () => computeMapPlaybackDuration({
      distanceMeters: routeState?.distance,
      elevationGainMeters: routeState?.elevationGain,
      cueCount,
    }),
    [cueCount, routeState?.distance, routeState?.elevationGain],
  );
  const sync = useMemo(() => {
    if (!enabled || !Array.isArray(routeState?.geometry) || routeState.geometry.length < 2) {
      return null;
    }
    return createVariableSpeedRoutePlaybackSync({
      baseDurationSeconds: baseDuration * MAP_PLAYBACK_DURATION_SCALE,
      routeGeometry: routeState.geometry,
      routeDistanceMeters: routeState.distance,
      cueSlides: safeCueSlides,
      cueMaxFraction: MAP_PLAYBACK_PREVIEW_MAX_FRACTION,
      cueMaxMeters: MAP_PLAYBACK_PREVIEW_MAX_METERS,
      fastRate: MAP_PLAYBACK_BORING_RATE,
    });
  }, [baseDuration, enabled, routeState?.distance, routeState?.geometry, safeCueSlides]);

  return useRoutePlaybackEngine({
    sync,
    fallbackDuration: baseDuration,
    onCursorChange,
    onPlayingChange,
    clock,
  });
}

export {
  MAP_PLAYBACK_BORING_RATE,
  MAP_PLAYBACK_DURATION_SCALE,
  MAP_PLAYBACK_PREVIEW_MAX_FRACTION,
  MAP_PLAYBACK_PREVIEW_MAX_METERS,
};
