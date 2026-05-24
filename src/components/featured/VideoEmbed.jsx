import React, { useEffect, useRef, useState } from "react";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";
import { loadYouTubeIframeApi } from "./youtubeIframeApi.js";
import { createVideoSync } from "./videoSync.js";

let indexPromise = null;

function loadVideoIndex() {
  if (!indexPromise) {
    const base = (import.meta.env?.BASE_URL || "/").replace(/\/?$/, "/");
    indexPromise = fetch(`${base}public-data/route-videos/index.json`)
      .then((r) => (r.ok ? r.json() : { routes: {} }))
      .catch(() => ({ routes: {} }));
  }
  return indexPromise;
}

async function loadKeyframes(filename) {
  const base = (import.meta.env?.BASE_URL || "/").replace(/\/?$/, "/");
  const response = await fetch(`${base}public-data/route-videos/${filename}`);
  if (!response.ok) throw new Error(`keyframes ${filename}: HTTP ${response.status}`);
  return response.json();
}

export default function VideoEmbed() {
  const {
    meta,
    routeState,
    setVideoCursor,
    videoSyncRef,
    playerSeekRef,
  } = useFeaturedRoute();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading");
  const iframeContainerRef = useRef(null);
  const playerRef = useRef(null);
  const tickerRef = useRef(null);

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
        playerVars: { enablejsapi: 1, rel: 0 },
        events: {
          onReady: () => {
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = null;
            playerRef.current = player;
            playerSeekRef.current = (t) => player.seekTo(t, true);
          },
          onStateChange: (e) => {
            // YT.PlayerState.PLAYING === 1
            if (e.data === 1) startTicker();
            else stopTicker();
          },
        },
      });
    })();

    function startTicker() {
      if (tickerRef.current) return;
      let lastEmit = 0;
      const loop = (now) => {
        tickerRef.current = window.requestAnimationFrame(loop);
        if (now - lastEmit < 250) return;
        lastEmit = now;
        const p = playerRef.current;
        const sync = videoSyncRef.current;
        if (!p || !sync || typeof p.getCurrentTime !== "function") return;
        const t = p.getCurrentTime();
        const pos = sync.timeToPosition(t);
        setVideoCursor({ t, lat: pos.lat, lng: pos.lng, fraction: pos.fraction });
      };
      tickerRef.current = window.requestAnimationFrame(loop);
    }

    function stopTicker() {
      if (tickerRef.current) {
        window.cancelAnimationFrame(tickerRef.current);
        tickerRef.current = null;
      }
    }

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      stopTicker();
      if (player && typeof player.destroy === "function") {
        try {
          player.destroy();
        } catch {}
      }
      playerRef.current = null;
      playerSeekRef.current = null;
      setVideoCursor(null);
    };
  }, [data, playerSeekRef, setVideoCursor, videoSyncRef]);

  if (status !== "ready" || !data) return null;
  return (
    <section className="featured-video">
      <h2>סרטון</h2>
      <div className="featured-video-frame">
        <div ref={iframeContainerRef} />
      </div>
    </section>
  );
}
