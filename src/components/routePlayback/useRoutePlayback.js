import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeMapPlaybackDuration } from "../featured/routePlaybackDuration.js";
import { createVariableSpeedRoutePlaybackSync } from "../featured/routePlaybackSync.js";

const MAP_PLAYBACK_PREVIEW_MAX_FRACTION = 0.06;
const MAP_PLAYBACK_PREVIEW_MAX_METERS = 1200;
const MAP_PLAYBACK_BORING_RATE = 4;
const MAP_PLAYBACK_DURATION_SCALE = 0.55;
const MAP_PLAYBACK_ROUTE_FIT_PADDING = Object.freeze({
  top: 24,
  right: 24,
  bottom: 108,
  left: 24,
});

function clampTime(time, duration) {
  const value = Number(time);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(duration, value));
}

export function useSyntheticRoutePlayback({
  enabled = true,
  routeState,
  cueSlides,
  onCursorChange,
  onPlayingChange,
}) {
  const safeCueSlides = Array.isArray(cueSlides) ? cueSlides : [];
  const cueCount = useMemo(
    () => safeCueSlides.filter((slide) => slide.kind !== "start" && slide.kind !== "end").length,
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
    if (
      !enabled ||
      !Array.isArray(routeState?.geometry) ||
      routeState.geometry.length < 2
    ) {
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
  }, [
    baseDuration,
    enabled,
    routeState?.distance,
    routeState?.geometry,
    safeCueSlides,
  ]);

  return useRoutePlayback({
    sync,
    fallbackDuration: baseDuration,
    onCursorChange,
    onPlayingChange,
  });
}

export function useRoutePlayback({
  sync,
  fallbackDuration = 0,
  onCursorChange,
  onPlayingChange,
}) {
  const duration = sync?.durationSeconds ?? fallbackDuration;
  const [currentTime, setCurrentTime] = useState(0);
  const [cursor, setCursor] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const currentTimeRef = useRef(0);
  const playingRef = useRef(false);
  const scrubbingRef = useRef(false);
  const wasPlayingBeforeScrubRef = useRef(false);
  const tickerRef = useRef(null);
  const lastFrameTimeRef = useRef(null);
  const onCursorChangeRef = useRef(onCursorChange);
  const onPlayingChangeRef = useRef(onPlayingChange);

  useEffect(() => {
    onCursorChangeRef.current = onCursorChange;
  }, [onCursorChange]);

  useEffect(() => {
    onPlayingChangeRef.current = onPlayingChange;
  }, [onPlayingChange]);

  const setPlaying = useCallback((nextPlaying) => {
    playingRef.current = nextPlaying;
    setIsPlaying(nextPlaying);
    onPlayingChangeRef.current?.(nextPlaying);
  }, []);

  const stopTicker = useCallback(() => {
    if (tickerRef.current) {
      window.cancelAnimationFrame(tickerRef.current);
      tickerRef.current = null;
    }
    lastFrameTimeRef.current = null;
  }, []);

  const emitCursorForTime = useCallback((time) => {
    if (!sync) return null;
    const t = clampTime(time, duration);
    currentTimeRef.current = t;
    setCurrentTime(t);
    const position = sync.timeToPosition(t);
    const nextCursor = {
      t,
      lat: position.lat,
      lng: position.lng,
      fraction: position.fraction,
    };
    setCursor(nextCursor);
    onCursorChangeRef.current?.(nextCursor);
    return nextCursor;
  }, [duration, sync]);

  const stopPlayback = useCallback(() => {
    setPlaying(false);
    stopTicker();
  }, [setPlaying, stopTicker]);

  const startTicker = useCallback(() => {
    if (!sync || tickerRef.current) return;
    lastFrameTimeRef.current = window.performance.now();
    const tick = (now) => {
      if (!playingRef.current) {
        tickerRef.current = null;
        lastFrameTimeRef.current = null;
        return;
      }
      const last = Number.isFinite(lastFrameTimeRef.current)
        ? lastFrameTimeRef.current
        : now;
      lastFrameTimeRef.current = now;
      const elapsedSeconds = Math.max(0, (now - last) / 1000);
      const nextTime = Math.min(duration, currentTimeRef.current + elapsedSeconds);
      emitCursorForTime(nextTime);
      if (nextTime >= duration) {
        setPlaying(false);
        tickerRef.current = null;
        lastFrameTimeRef.current = null;
        return;
      }
      tickerRef.current = window.requestAnimationFrame(tick);
    };
    tickerRef.current = window.requestAnimationFrame(tick);
  }, [duration, emitCursorForTime, setPlaying, sync]);

  const play = useCallback(() => {
    if (!sync) return;
    if (currentTimeRef.current >= duration - 0.05) {
      emitCursorForTime(0);
    }
    setPlaying(true);
    startTicker();
  }, [duration, emitCursorForTime, setPlaying, startTicker, sync]);

  const pause = useCallback(() => {
    stopPlayback();
  }, [stopPlayback]);

  const seekToTime = useCallback((time) => {
    const nextCursor = emitCursorForTime(time);
    if (currentTimeRef.current >= duration && playingRef.current) {
      stopPlayback();
    }
    return nextCursor;
  }, [duration, emitCursorForTime, stopPlayback]);

  const seekToFraction = useCallback((fraction) => {
    if (!sync || typeof sync.positionToTime !== "function") return null;
    return seekToTime(sync.positionToTime(fraction));
  }, [seekToTime, sync]);

  const togglePlayback = useCallback(() => {
    if (playingRef.current) pause();
    else play();
  }, [pause, play]);

  const handleScrubStart = useCallback((event) => {
    if (event?.currentTarget?.setPointerCapture && Number.isFinite(event.pointerId)) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {}
    }
    scrubbingRef.current = true;
    setIsScrubbing(true);
    wasPlayingBeforeScrubRef.current = playingRef.current;
    if (playingRef.current) pause();
  }, [pause]);

  const handleScrubChange = useCallback((event) => {
    seekToTime(event.currentTarget.value);
  }, [seekToTime]);

  const handleScrubEnd = useCallback((event) => {
    if (event?.currentTarget?.releasePointerCapture && Number.isFinite(event.pointerId)) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {}
    }
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    setIsScrubbing(false);
    if (wasPlayingBeforeScrubRef.current) play();
    wasPlayingBeforeScrubRef.current = false;
  }, [play]);

  useEffect(() => {
    if (!sync) {
      stopTicker();
      currentTimeRef.current = 0;
      setCurrentTime(0);
      setCursor(null);
      setIsScrubbing(false);
      setPlaying(false);
      onCursorChangeRef.current?.(null);
      return undefined;
    }

    currentTimeRef.current = 0;
    setCurrentTime(0);
    setIsScrubbing(false);
    scrubbingRef.current = false;
    setPlaying(false);
    emitCursorForTime(0);

    return () => {
      stopTicker();
      playingRef.current = false;
      setCursor(null);
      onCursorChangeRef.current?.(null);
      onPlayingChangeRef.current?.(false);
    };
  }, [emitCursorForTime, setPlaying, stopTicker, sync]);

  return {
    currentTime,
    cursor,
    duration,
    hasCursor: Boolean(cursor),
    isPlaying,
    isReady: Boolean(sync),
    isScrubbing,
    pause,
    play,
    seekToFraction,
    seekToTime,
    togglePlayback,
    onScrubStart: handleScrubStart,
    onScrubChange: handleScrubChange,
    onScrubEnd: handleScrubEnd,
    sync,
  };
}

export {
  MAP_PLAYBACK_BORING_RATE,
  MAP_PLAYBACK_DURATION_SCALE,
  MAP_PLAYBACK_PREVIEW_MAX_FRACTION,
  MAP_PLAYBACK_PREVIEW_MAX_METERS,
  MAP_PLAYBACK_ROUTE_FIT_PADDING,
};
