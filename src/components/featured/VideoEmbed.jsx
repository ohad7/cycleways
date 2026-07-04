import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { galleryImageSlides } from "@cycleways/core/data/poiTypes.js";
import { isAppEmbedded } from "../../appEmbed.js";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";
import { previewSlideForCursor, routeVideoCueSlides } from "./routePoiStoryData.js";
import RoutePlaybackControls from "./RoutePlaybackControls.jsx";
import { useSyntheticRoutePlayback } from "../routePlayback/useRoutePlayback.js";
import { loadYouTubeIframeApi } from "./youtubeIframeApi.js";
import { createVideoSync } from "./videoSync.js";
import {
  computePlaybackRate,
  normalizePlaybackBehavior,
  RAMP_STEP_2_M,
} from "./playbackRamp.js";
import {
  loadRouteVideoIndex,
  loadRouteVideoKeyframes,
} from "./routeVideoIndex.js";

// Headroom left above the route stage when playback auto-scrolls it into view.
// On the web a 6px sliver reads as "flush to the top". In the native app a
// floating back button occupies the top-left corner (~52px tall over the web
// viewport) and the video's POI preview is pinned to that same corner, so scroll
// the stage below it — matching the scroll-margin-top used for jump targets —
// instead of tucking the POIs under the button.
const PLAYBACK_SCROLL_TOP_GAP_PX = 6;
const PLAYBACK_SCROLL_TOP_GAP_EMBED_PX = 72;

const MANUAL_SCRUB_SAMPLE_MS = 300;
const SEEK_SETTLE_MS = 4000;
const SEEK_SETTLE_TOLERANCE_SECONDS = 0.35;

export default function VideoEmbed({ title = "סרטון", className = "" }) {
  const {
    meta,
    routeState,
    setVideoCursor,
    setVideoPlaying,
    videoSyncRef,
    playerSeekRef,
    playerPlayRef,
    playerPauseRef,
    mapPrimary,
    toggleMapPrimary,
  } = useFeaturedRoute();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading");
  const [currentTime, setCurrentTime] = useState(0);
  const [routeFraction, setRouteFraction] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const iframeContainerRef = useRef(null);
  const playerRef = useRef(null);
  const playbackScrollRef = useRef(0);
  const tickerRef = useRef(null);
  const manualScrubSamplerRef = useRef(null);
  const settleTimeoutsRef = useRef([]);
  const playingRef = useRef(false);
  const scrubbingRef = useRef(false);
  const wasPlayingBeforeScrubRef = useRef(false);
  const lastEmittedTimeRef = useRef(null);
  const pendingSeekRef = useRef(null);
  const poiSlidesRef = useRef([]);
  const routeDistanceRef = useRef(0);
  // Slow-start ramp is "armed" until it completes naturally (distance reaches
  // RAMP_STEP_2_M) or the user performs a manual seek; once disarmed the base
  // rate is 1.0 everywhere. See playbackRamp.js.
  const rampDoneRef = useRef(false);

  // In map-primary mode the live video is stopped and the route is animated by a
  // synthetic (front-page) playback engine instead. These guards + refs let the
  // two engines hand the cursor/position back and forth without fighting.
  const mapPrimaryRef = useRef(mapPrimary);
  mapPrimaryRef.current = mapPrimary;
  const routeFractionRef = useRef(0);
  const videoSyncObjRef = useRef(null);

  const scrollStageForPlayback = useCallback(() => {
    if (typeof window === "undefined") return;
    const isMobile = window.matchMedia?.("(max-width: 767px)").matches
      ?? window.innerWidth < 768;
    if (!isMobile) return;
    const now = Date.now();
    if (now - playbackScrollRef.current < 1200) return;
    const target = document.querySelector("[data-route-stage]");
    if (!target) return;
    playbackScrollRef.current = now;
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const topGap = isAppEmbedded()
      ? PLAYBACK_SCROLL_TOP_GAP_EMBED_PX
      : PLAYBACK_SCROLL_TOP_GAP_PX;
    const rect = target.getBoundingClientRect();
    window.scrollTo({
      top: Math.max(0, window.scrollY + rect.top - topGap),
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  }, []);

  const cueSlides = useMemo(
    () => routeVideoCueSlides(meta, routeState),
    [meta, routeState.activeDataPoints, routeState.distance, routeState.geometry],
  );
  const handleSyntheticCursor = useCallback((cursor) => {
    if (!mapPrimaryRef.current) return;
    if (cursor) {
      routeFractionRef.current = cursor.fraction;
      setRouteFraction(cursor.fraction);
    }
    setVideoCursor(cursor);
  }, [setVideoCursor]);
  const handleSyntheticPlaying = useCallback((playing) => {
    if (!mapPrimaryRef.current) return;
    setVideoPlaying(playing);
  }, [setVideoPlaying]);
  const synthetic = useSyntheticRoutePlayback({
    enabled: mapPrimary,
    routeState,
    cueSlides,
    onCursorChange: handleSyntheticCursor,
    onPlayingChange: handleSyntheticPlaying,
  });

  useEffect(() => {
    poiSlidesRef.current = galleryImageSlides(routeState.activeDataPoints);
  }, [routeState.activeDataPoints]);

  useEffect(() => {
    routeDistanceRef.current = routeState.distance;
  }, [routeState.distance]);

  const duration = Number.isFinite(data?.videoDuration) && data.videoDuration > 0
    ? data.videoDuration
    : 0;
  const playbackBehavior = normalizePlaybackBehavior(data?.playbackBehavior);

  const clampTime = useCallback((time) => {
    const value = Number(time);
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(duration || value, value));
  }, [duration]);

  const emitCursorForTime = useCallback((time, { force = false } = {}) => {
    const t = clampTime(time);
    if (
      !force &&
      Number.isFinite(lastEmittedTimeRef.current) &&
      Math.abs(t - lastEmittedTimeRef.current) < 0.01
    ) {
      return null;
    }
    lastEmittedTimeRef.current = t;
    setCurrentTime(t);

    // While map-primary, the synthetic engine owns the cursor; the video is paused.
    if (mapPrimaryRef.current) return { t };
    const sync = videoSyncObjRef.current;
    if (!sync) return { t };
    const pos = sync.timeToPosition(t);
    const cursor = { t, lat: pos.lat, lng: pos.lng, fraction: pos.fraction };
    routeFractionRef.current = pos.fraction;
    setRouteFraction(pos.fraction);
    setVideoCursor(cursor);
    return cursor;
  }, [clampTime, setVideoCursor, videoSyncRef]);

  const seekToTime = useCallback((time) => {
    // Any seek is user-initiated (slider scrub or map/POI click); "first play
    // only" means the ramp does not re-apply after the user has navigated.
    rampDoneRef.current = true;
    const t = clampTime(time);
    const player = playerRef.current;
    pendingSeekRef.current = {
      t,
      until: Date.now() + SEEK_SETTLE_MS,
    };
    if (player && typeof player.seekTo === "function") {
      player.seekTo(t, true);
    }
    return emitCursorForTime(t, { force: true });
  }, [clampTime, emitCursorForTime]);

  const togglePlayback = () => {
    const player = playerRef.current;
    if (!player) return;
    if (playingRef.current) {
      player.pauseVideo?.();
    } else {
      scrollStageForPlayback();
      player.playVideo?.();
    }
  };

  const handleScrubStart = (event) => {
    if (event?.currentTarget?.setPointerCapture && Number.isFinite(event.pointerId)) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {}
    }
    scrubbingRef.current = true;
    setIsScrubbing(true);
    wasPlayingBeforeScrubRef.current = playingRef.current;
    if (playingRef.current) {
      playerRef.current?.pauseVideo?.();
    }
  };

  const handleScrubChange = (event) => {
    seekToTime(event.currentTarget.value);
  };

  const handleScrubEnd = (event) => {
    if (event?.currentTarget?.releasePointerCapture && Number.isFinite(event.pointerId)) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {}
    }
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    setIsScrubbing(false);
    if (wasPlayingBeforeScrubRef.current) {
      playerRef.current?.playVideo?.();
    }
    wasPlayingBeforeScrubRef.current = false;
  };

  // Fetch the index + per-slug keyframes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const index = await loadRouteVideoIndex();
        const filename = index?.routes?.[meta.slug];
        if (!filename) {
          if (!cancelled) setStatus("absent");
          return;
        }
        const payload = await loadRouteVideoKeyframes(filename);
        if (cancelled) return;
        setData(payload);
        setStatus("ready");
      } catch (err) {
        console.warn("VideoEmbed failed to load", err);
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meta.slug]);

  // Build the videoSync instance once we have both data and route geometry.
  useEffect(() => {
    if (!data || !routeState?.geometry?.length) return;
    try {
      const sync = createVideoSync({
        keyframes: data.keyframes,
        videoDuration: data.videoDuration,
        routeGeometry: routeState.geometry,
      });
      videoSyncObjRef.current = sync;
      // While map-primary the shared videoSyncRef points at the synthetic engine.
      if (!mapPrimaryRef.current) videoSyncRef.current = sync;
    } catch (err) {
      console.warn("videoSync construction failed", err);
      videoSyncObjRef.current = null;
      if (!mapPrimaryRef.current) videoSyncRef.current = null;
    }
    return () => {
      videoSyncObjRef.current = null;
      if (!mapPrimaryRef.current) videoSyncRef.current = null;
    };
  }, [data, routeState?.geometry, videoSyncRef]);

  // Swap the active engine when entering/leaving map-primary: stop the video and
  // hand its position to the synthetic engine (and back on the way out), and point
  // the shared player refs (POI/elevation seeks) at whichever engine is active.
  // The position handoff only runs on an actual swap transition — never on the
  // initial mount — so loading the page never seeks (and so never auto-plays) the
  // video (YouTube's seekTo starts a freshly-cued player playing).
  const prevMapPrimaryRef = useRef(mapPrimary);
  useEffect(() => {
    const swapped = prevMapPrimaryRef.current !== mapPrimary;
    prevMapPrimaryRef.current = mapPrimary;
    if (mapPrimary) {
      videoSyncRef.current = synthetic.sync;
      playerSeekRef.current = synthetic.seekToTime;
      playerPlayRef.current = synthetic.play;
      playerPauseRef.current = synthetic.pause;
      if (swapped) {
        playerRef.current?.pauseVideo?.();
        if (synthetic.sync) synthetic.seekToFraction(routeFractionRef.current);
      }
    } else {
      synthetic.pause();
      videoSyncRef.current = videoSyncObjRef.current;
      playerSeekRef.current = (t) => seekToTime(t);
      playerPlayRef.current = () => playerRef.current?.playVideo?.();
      playerPauseRef.current = () => playerRef.current?.pauseVideo?.();
      if (swapped && videoSyncObjRef.current) {
        seekToTime(videoSyncObjRef.current.positionToTime(routeFractionRef.current));
      }
    }
  }, [
    mapPrimary,
    isPlayerReady,
    synthetic.sync,
    synthetic.seekToFraction,
    synthetic.seekToTime,
    synthetic.play,
    synthetic.pause,
    seekToTime,
    playerPauseRef,
    playerPlayRef,
    playerSeekRef,
    videoSyncRef,
  ]);

  // Construct YouTube player when data + container are ready.
  useEffect(() => {
    if (!data || !iframeContainerRef.current) return undefined;
    let cancelled = false;
    let timeoutId = null;
    let player = null;

    const fallback = () => {
      if (cancelled) return;
      console.warn(
        "YouTube IFrame API did not become ready; falling back to plain iframe",
      );
      const el = iframeContainerRef.current;
      if (!el) return;
      el.innerHTML = "";
      const iframe = document.createElement("iframe");
      iframe.src = `https://www.youtube.com/embed/${data.youtubeId}`;
      iframe.title = "סרטון המסלול";
      iframe.allow =
        "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
      iframe.allowFullscreen = true;
      iframe.loading = "lazy";
      el.appendChild(iframe);
    };

    timeoutId = window.setTimeout(fallback, 5000);

    (async () => {
      let YT;
      try {
        YT = await loadYouTubeIframeApi();
      } catch {
        if (timeoutId) clearTimeout(timeoutId);
        fallback();
        return;
      }
      if (cancelled) return;

      player = new YT.Player(iframeContainerRef.current, {
        videoId: data.youtubeId,
        playerVars: { controls: 0, enablejsapi: 1, playsinline: 1, rel: 0 },
        events: {
          onReady: () => {
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = null;
            playerRef.current = player;
            playerSeekRef.current = (t) => seekToTime(t);
            playerPlayRef.current = () => {
              if (typeof player.playVideo === "function") player.playVideo();
            };
            playerPauseRef.current = () => {
              if (typeof player.pauseVideo === "function") player.pauseVideo();
            };
            // Prime the rate to the ramp's opening speed before the first play
            // so the video never flashes at full speed on start.
            applyPlaybackRate(player, 0, false);
            setIsPlayerReady(true);
            startManualScrubSampler();
          },
          onStateChange: (e) => {
            const isPlaying = e.data === 1;
            playingRef.current = isPlaying;
            setIsPlaying(isPlaying);
            if (!scrubbingRef.current) {
              sampleCurrentPosition({ force: true });
              scheduleSettledPositionSamples();
            }
            // YT.PlayerState.PLAYING === 1
            if (isPlaying) {
              scrollStageForPlayback();
              setVideoPlaying(true);
              const pos = emitCurrentPosition(playerRef.current, { force: true });
              if (pos) {
                const nearPoi = Boolean(
                  previewSlideForCursor(
                    poiSlidesRef.current,
                    pos.fraction,
                    routeDistanceRef.current,
                  ),
                );
                applyPlaybackRate(playerRef.current, pos.fraction, nearPoi);
              }
              startTicker();
            } else {
              setVideoPlaying(false);
              stopTicker();
            }
          },
        },
      });
    })();

    function emitCurrentPosition(p, { force = false } = {}) {
      if (!p || typeof p.getCurrentTime !== "function") return null;
      const t = p.getCurrentTime();
      const pending = pendingSeekRef.current;
      if (pending && Number.isFinite(pending.t)) {
        const settled = Math.abs(t - pending.t) <= SEEK_SETTLE_TOLERANCE_SECONDS;
        const expired = Date.now() > pending.until;
        if (!settled && !expired) return null;
        pendingSeekRef.current = null;
      }
      return emitCursorForTime(t, { force });
    }

    function sampleCurrentPosition(options) {
      return emitCurrentPosition(playerRef.current || player, options);
    }

    function clearSettledPositionSamples() {
      settleTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
      settleTimeoutsRef.current = [];
    }

    function scheduleSettledPositionSamples() {
      clearSettledPositionSamples();
      settleTimeoutsRef.current = [120, 450, 900].map((delay) =>
        window.setTimeout(() => {
          if (scrubbingRef.current) return;
          sampleCurrentPosition({ force: true });
        }, delay),
      );
    }

    function startManualScrubSampler() {
      if (manualScrubSamplerRef.current) return;
      manualScrubSamplerRef.current = window.setInterval(() => {
        if (playingRef.current) return;
        if (scrubbingRef.current) return;
        sampleCurrentPosition();
      }, MANUAL_SCRUB_SAMPLE_MS);
    }

    function stopManualScrubSampler() {
      if (manualScrubSamplerRef.current) {
        window.clearInterval(manualScrubSamplerRef.current);
        manualScrubSamplerRef.current = null;
      }
    }

    function startTicker() {
      if (tickerRef.current) return;
      clearSettledPositionSamples();
      let lastEmit = 0;
      const loop = (now) => {
        tickerRef.current = window.requestAnimationFrame(loop);
        if (now - lastEmit < 250) return;
        lastEmit = now;
        const p = playerRef.current;
        const pos = emitCurrentPosition(p, { force: true });
        if (!pos) return;
        const nearPoi = Boolean(
          previewSlideForCursor(
            poiSlidesRef.current,
            pos.fraction,
            routeDistanceRef.current,
          ),
        );
        applyPlaybackRate(p, pos.fraction, nearPoi);
      };
      tickerRef.current = window.requestAnimationFrame(loop);
    }

    function stopTicker() {
      if (tickerRef.current) {
        window.cancelAnimationFrame(tickerRef.current);
        tickerRef.current = null;
      }
    }

    function canSetPlaybackRate(p, rate) {
      if (!p || typeof p.setPlaybackRate !== "function") return false;
      if (typeof p.getAvailablePlaybackRates !== "function") return true;
      const rates = p.getAvailablePlaybackRates();
      if (!Array.isArray(rates) || rates.length === 0) return true;
      return rates.some((availableRate) => Math.abs(availableRate - rate) < 0.001);
    }

    function setPlaybackRate(p, rate) {
      if (!canSetPlaybackRate(p, rate)) return false;
      try {
        p.setPlaybackRate(rate);
        return true;
      } catch {
        return false;
      }
    }

    // Sole writer of the playback rate: derive it from route distance + POI
    // proximity via the pure ramp function, flipping rampDone once the ramp
    // completes so later ticks short-circuit to full speed.
    function applyPlaybackRate(p, fraction, nearPoi) {
      if (!p) return;
      const distanceFromStartM =
        (Number(fraction) || 0) * (routeDistanceRef.current || 0);
      if (!rampDoneRef.current && distanceFromStartM >= RAMP_STEP_2_M) {
        rampDoneRef.current = true;
      }
      const rate = computePlaybackRate({
        distanceFromStartM,
        nearPoi,
        rampDone: rampDoneRef.current,
        playbackBehavior,
      });
      setPlaybackRate(p, rate);
    }

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      clearSettledPositionSamples();
      stopManualScrubSampler();
      stopTicker();
      playingRef.current = false;
      scrubbingRef.current = false;
      // Re-arm the slow-start ramp for the next video. This effect re-runs only
      // when `data` changes (a route/video switch), so this never re-arms mid
      // playthrough.
      rampDoneRef.current = false;
      pendingSeekRef.current = null;
      lastEmittedTimeRef.current = null;
      if (player && typeof player.destroy === "function") {
        try {
          player.destroy();
        } catch {}
      }
      playerRef.current = null;
      playerSeekRef.current = null;
      playerPlayRef.current = null;
      playerPauseRef.current = null;
      setIsPlaying(false);
      setIsPlayerReady(false);
      setIsScrubbing(false);
      setCurrentTime(0);
      setVideoPlaying(false);
      setVideoCursor(null);
    };
  }, [data, emitCursorForTime, playerPauseRef, playerPlayRef, playerSeekRef, scrollStageForPlayback, seekToTime, setVideoCursor, setVideoPlaying, videoSyncRef]);

  if (status !== "ready" || !data) return null;

  // In map-primary the synthetic engine drives the controls; otherwise the video.
  const activePlayback = mapPrimary
    ? {
        isPlaying: synthetic.isPlaying,
        isReady: synthetic.isReady,
        isScrubbing: synthetic.isScrubbing,
        currentTime: synthetic.currentTime,
        duration: synthetic.duration,
        progressFraction: synthetic.cursor?.fraction ?? 0,
        onTogglePlayback: synthetic.togglePlayback,
        onScrubStart: synthetic.onScrubStart,
        onScrubChange: synthetic.onScrubChange,
        onScrubEnd: synthetic.onScrubEnd,
      }
    : {
        isPlaying,
        isReady: isPlayerReady,
        isScrubbing,
        currentTime,
        duration,
        progressFraction: routeFraction,
        onTogglePlayback: togglePlayback,
        onScrubStart: handleScrubStart,
        onScrubChange: handleScrubChange,
        onScrubEnd: handleScrubEnd,
      };
  const posterSrc = meta?.hero
    || (data?.youtubeId ? `https://i.ytimg.com/vi/${data.youtubeId}/hqdefault.jpg` : null);

  return (
    <section
      className={[
        "featured-video",
        mapPrimary ? "featured-video--pip" : "",
        className,
      ].filter(Boolean).join(" ")}
    >
      {title && <h2>{title}</h2>}
      <div className="featured-video-frame">
        <div ref={iframeContainerRef} className="featured-video-iframe-host" />
        {mapPrimary && posterSrc && (
          <img className="fv-video-poster" src={posterSrc} alt="" aria-hidden="true" />
        )}
        <button
          type="button"
          className="fv-video-hit-shield"
          onClick={mapPrimary ? toggleMapPrimary : togglePlayback}
          disabled={!isPlayerReady && !mapPrimary}
          aria-label={
            mapPrimary
              ? "החזר את הסרטון למסך מלא"
              : isPlaying
                ? "השהה סרטון"
                : "נגן סרטון"
          }
        />
        {mapPrimary && (
          <button
            type="button"
            className="fv-video-swap-back"
            onClick={toggleMapPrimary}
            aria-label="החזר את הסרטון למסך מלא"
            title="החזר את הסרטון למסך מלא"
          >
            <span aria-hidden="true">⤡</span>
          </button>
        )}
        <RoutePlaybackControls
          readoutMode="distance"
          isPlaying={activePlayback.isPlaying}
          isReady={activePlayback.isReady}
          isScrubbing={activePlayback.isScrubbing}
          currentTime={activePlayback.currentTime}
          duration={activePlayback.duration}
          progressFraction={activePlayback.progressFraction}
          routeDistanceMeters={routeState.distance}
          onTogglePlayback={activePlayback.onTogglePlayback}
          onScrubStart={activePlayback.onScrubStart}
          onScrubChange={activePlayback.onScrubChange}
          onScrubEnd={activePlayback.onScrubEnd}
          playLabel="נגן סרטון"
          pauseLabel="השהה סרטון"
          scrubberLabel="מעבר בזמן הסרטון"
        />
      </div>
    </section>
  );
}
