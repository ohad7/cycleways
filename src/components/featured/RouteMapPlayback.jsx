import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  VIDEO_CURSOR_DEFAULT_VARIANT,
} from "@cycleways/core/map/mapStyles.js";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";
import FeaturedRouteMapSlot from "./FeaturedRouteMap.jsx";
import RoutePoiVideoPreview from "./RoutePoiVideoPreview.jsx";
import RoutePlaybackControls from "./RoutePlaybackControls.jsx";
import { routeVideoCueSlides } from "./routePoiStoryData.js";
import { computeMapPlaybackDuration } from "./routePlaybackDuration.js";
import { createVariableSpeedRoutePlaybackSync } from "./routePlaybackSync.js";

const MAP_PLAYBACK_PREVIEW_MAX_FRACTION = 0.06;
const MAP_PLAYBACK_PREVIEW_MAX_METERS = 1200;
const MAP_PLAYBACK_BORING_RATE = 2;
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

export default function RouteMapPlayback({
  className = "",
  autoResetAfterInteraction = true,
  autoResetDelayMs = 5000,
  routeFitPadding = MAP_PLAYBACK_ROUTE_FIT_PADDING,
  videoCursorVariant = VIDEO_CURSOR_DEFAULT_VARIANT,
}) {
  const {
    meta,
    routeState,
    setVideoCursor,
    setVideoPlaying,
    videoSyncRef,
    playerSeekRef,
    playerPlayRef,
    playerPauseRef,
  } = useFeaturedRoute();
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const currentTimeRef = useRef(0);
  const playingRef = useRef(false);
  const scrubbingRef = useRef(false);
  const wasPlayingBeforeScrubRef = useRef(false);
  const tickerRef = useRef(null);
  const lastFrameTimeRef = useRef(null);

  const cueSlides = useMemo(
    () => routeVideoCueSlides(meta, routeState),
    [meta, routeState],
  );
  const cueCount = useMemo(
    () => cueSlides.filter((slide) => slide.kind !== "start" && slide.kind !== "end").length,
    [cueSlides],
  );
  const baseDuration = useMemo(
    () => computeMapPlaybackDuration({
      distanceMeters: routeState.distance,
      elevationGainMeters: routeState.elevationGain,
      cueCount,
    }),
    [cueCount, routeState.distance, routeState.elevationGain],
  );
  const sync = useMemo(() => {
    if (!Array.isArray(routeState.geometry) || routeState.geometry.length < 2) {
      return null;
    }
    return createVariableSpeedRoutePlaybackSync({
      baseDurationSeconds: baseDuration,
      routeGeometry: routeState.geometry,
      routeDistanceMeters: routeState.distance,
      cueSlides,
      cueMaxFraction: MAP_PLAYBACK_PREVIEW_MAX_FRACTION,
      cueMaxMeters: MAP_PLAYBACK_PREVIEW_MAX_METERS,
      fastRate: MAP_PLAYBACK_BORING_RATE,
    });
  }, [baseDuration, cueSlides, routeState.distance, routeState.geometry]);
  const duration = sync?.durationSeconds ?? baseDuration;

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
    const cursor = {
      t,
      lat: position.lat,
      lng: position.lng,
      fraction: position.fraction,
    };
    setVideoCursor(cursor);
    return cursor;
  }, [duration, setVideoCursor, sync]);

  const stopPlayback = useCallback(() => {
    playingRef.current = false;
    setIsPlaying(false);
    setVideoPlaying(false);
    stopTicker();
  }, [setVideoPlaying, stopTicker]);

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
        playingRef.current = false;
        setIsPlaying(false);
        setVideoPlaying(false);
        tickerRef.current = null;
        lastFrameTimeRef.current = null;
        return;
      }
      tickerRef.current = window.requestAnimationFrame(tick);
    };
    tickerRef.current = window.requestAnimationFrame(tick);
  }, [duration, emitCursorForTime, setVideoPlaying, sync]);

  const play = useCallback(() => {
    if (!sync) return;
    if (currentTimeRef.current >= duration - 0.05) {
      emitCursorForTime(0);
    }
    playingRef.current = true;
    setIsPlaying(true);
    setVideoPlaying(true);
    startTicker();
  }, [duration, emitCursorForTime, setVideoPlaying, startTicker, sync]);

  const pause = useCallback(() => {
    stopPlayback();
  }, [stopPlayback]);

  const seekToTime = useCallback((time) => {
    const cursor = emitCursorForTime(time);
    if (currentTimeRef.current >= duration && playingRef.current) {
      stopPlayback();
    }
    return cursor;
  }, [duration, emitCursorForTime, stopPlayback]);

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
    if (!sync) return undefined;
    currentTimeRef.current = 0;
    setCurrentTime(0);
    setIsScrubbing(false);
    playingRef.current = false;
    setIsPlaying(false);
    setVideoPlaying(false);
    emitCursorForTime(0);

    const seek = (time) => seekToTime(time);
    const playRoute = () => play();
    const pauseRoute = () => pause();
    videoSyncRef.current = sync;
    playerSeekRef.current = seek;
    playerPlayRef.current = playRoute;
    playerPauseRef.current = pauseRoute;

    return () => {
      stopTicker();
      playingRef.current = false;
      if (videoSyncRef.current === sync) videoSyncRef.current = null;
      if (playerSeekRef.current === seek) playerSeekRef.current = null;
      if (playerPlayRef.current === playRoute) playerPlayRef.current = null;
      if (playerPauseRef.current === pauseRoute) playerPauseRef.current = null;
      setVideoPlaying(false);
      setVideoCursor(null);
    };
  }, [
    emitCursorForTime,
    pause,
    play,
    playerPauseRef,
    playerPlayRef,
    playerSeekRef,
    seekToTime,
    setVideoCursor,
    setVideoPlaying,
    stopTicker,
    sync,
    videoSyncRef,
  ]);

  if (!sync) return null;

  return (
    <section
      className={["fv-route-map-playback", className].filter(Boolean).join(" ")}
      aria-label="מפת מסלול ניתנת לניגון"
    >
      <FeaturedRouteMapSlot
        className="fv-route-stage-map"
        autoResetAfterInteraction={autoResetAfterInteraction}
        autoResetDelayMs={autoResetDelayMs}
        routeFitPadding={routeFitPadding}
        videoCursorVariant={videoCursorVariant}
      />
      <RoutePoiVideoPreview
        previewMaxFraction={MAP_PLAYBACK_PREVIEW_MAX_FRACTION}
        previewMaxMeters={MAP_PLAYBACK_PREVIEW_MAX_METERS}
      />
      <RoutePlaybackControls
        isPlaying={isPlaying}
        isReady
        isScrubbing={isScrubbing}
        currentTime={currentTime}
        duration={duration}
        onTogglePlayback={togglePlayback}
        onScrubStart={handleScrubStart}
        onScrubChange={handleScrubChange}
        onScrubEnd={handleScrubEnd}
        playLabel="נגן מסלול"
        pauseLabel="השהה מסלול"
        scrubberLabel="מעבר בזמן המסלול"
      />
    </section>
  );
}

export {
  MAP_PLAYBACK_BORING_RATE,
  MAP_PLAYBACK_PREVIEW_MAX_FRACTION,
  MAP_PLAYBACK_PREVIEW_MAX_METERS,
  MAP_PLAYBACK_ROUTE_FIT_PADDING,
};
