import React, { useCallback, useEffect, useRef, useState } from "react";
import { galleryImageSlides } from "@cycleways/core/data/poiTypes.js";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";
import { previewSlideForCursor } from "./routePoiStoryData.js";
import RouteProgressDistance from "./RouteProgressDistance.jsx";
import { loadYouTubeIframeApi } from "./youtubeIframeApi.js";
import { createVideoSync } from "./videoSync.js";
import { computePlaybackRate, RAMP_STEP_2_M } from "./playbackRamp.js";

const MANUAL_SCRUB_SAMPLE_MS = 300;
const SEEK_SETTLE_MS = 4000;
const SEEK_SETTLE_TOLERANCE_SECONDS = 0.35;

let indexPromise = null;

function loadVideoIndex() {
  if (!indexPromise) {
    const base = (import.meta.env?.BASE_URL || "/").replace(/\/?$/, "/");
    indexPromise = fetch(`${base}public-data/route-videos/index.json`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { routes: {} }))
      .catch(() => ({ routes: {} }));
  }
  return indexPromise;
}

async function loadKeyframes(filename) {
  const base = (import.meta.env?.BASE_URL || "/").replace(/\/?$/, "/");
  const response = await fetch(`${base}public-data/route-videos/${filename}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`keyframes ${filename}: HTTP ${response.status}`);
  return response.json();
}

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
  } = useFeaturedRoute();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading");
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const iframeContainerRef = useRef(null);
  const playerRef = useRef(null);
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

  useEffect(() => {
    poiSlidesRef.current = galleryImageSlides(routeState.activeDataPoints);
  }, [routeState.activeDataPoints]);

  useEffect(() => {
    routeDistanceRef.current = routeState.distance;
  }, [routeState.distance]);

  const duration = Number.isFinite(data?.videoDuration) && data.videoDuration > 0
    ? data.videoDuration
    : 0;

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

    const sync = videoSyncRef.current;
    if (!sync) return { t };
    const pos = sync.timeToPosition(t);
    const cursor = { t, lat: pos.lat, lng: pos.lng, fraction: pos.fraction };
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
        const index = await loadVideoIndex();
        const filename = index?.routes?.[meta.slug];
        if (!filename) {
          if (!cancelled) setStatus("absent");
          return;
        }
        const payload = await loadKeyframes(filename);
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
      videoSyncRef.current = createVideoSync({
        keyframes: data.keyframes,
        videoDuration: data.videoDuration,
        routeGeometry: routeState.geometry,
      });
    } catch (err) {
      console.warn("videoSync construction failed", err);
      videoSyncRef.current = null;
    }
    return () => {
      videoSyncRef.current = null;
    };
  }, [data, routeState?.geometry, videoSyncRef]);

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
  }, [data, emitCursorForTime, playerPauseRef, playerPlayRef, playerSeekRef, seekToTime, setVideoCursor, setVideoPlaying, videoSyncRef]);

  if (status !== "ready" || !data) return null;
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  return (
    <section className={["featured-video", className].filter(Boolean).join(" ")}>
      {title && <h2>{title}</h2>}
      <div className="featured-video-frame">
        <div ref={iframeContainerRef} className="featured-video-iframe-host" />
        <button
          type="button"
          className="fv-video-hit-shield"
          onClick={togglePlayback}
          disabled={!isPlayerReady}
          aria-label={isPlaying ? "השהה סרטון" : "נגן סרטון"}
        />
        <div
          className={[
            "fv-video-controls",
            isScrubbing ? "fv-video-controls--scrubbing" : "",
          ].filter(Boolean).join(" ")}
        >
          <button
            type="button"
            className="fv-video-play-toggle"
            onClick={togglePlayback}
            disabled={!isPlayerReady}
            aria-label={isPlaying ? "השהה סרטון" : "נגן סרטון"}
          >
            <span aria-hidden="true">{isPlaying ? "❚❚" : "▶"}</span>
          </button>
          <input
            className="fv-video-scrubber"
            type="range"
            min="0"
            max={duration || 0}
            step="0.1"
            value={Math.min(currentTime, duration || currentTime)}
            onChange={handleScrubChange}
            onPointerDown={handleScrubStart}
            onPointerUp={handleScrubEnd}
            onPointerCancel={handleScrubEnd}
            onBlur={handleScrubEnd}
            disabled={!isPlayerReady || duration <= 0}
            aria-label="מעבר בזמן הסרטון"
            style={{ "--fv-video-progress": `${progressPercent}%` }}
          />
          <span className="fv-video-time">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <div className="fv-video-progress-distance" aria-label="מרחק מההתחלה">
            <span>מרחק מההתחלה</span>
            <RouteProgressDistance className="fv-video-progress-value" />
          </div>
        </div>
      </div>
    </section>
  );
}

function formatTime(seconds) {
  const totalSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}
