import React, { useEffect, useMemo, useRef } from "react";
import {
  VIDEO_CURSOR_DEFAULT_VARIANT,
} from "@cycleways/core/map/mapStyles.js";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";
import FeaturedRouteMapSlot from "./FeaturedRouteMap.jsx";
import RoutePoiVideoPreview from "./RoutePoiVideoPreview.jsx";
import RoutePlaybackControls from "./RoutePlaybackControls.jsx";
import { routeVideoCueSlides } from "./routePoiStoryData.js";
import {
  MAP_PLAYBACK_BORING_RATE,
  MAP_PLAYBACK_PREVIEW_MAX_FRACTION,
  MAP_PLAYBACK_PREVIEW_MAX_METERS,
  MAP_PLAYBACK_ROUTE_FIT_PADDING,
  useSyntheticRoutePlayback,
} from "../routePlayback/useRoutePlayback.js";
import { useFitRouteOnPlay } from "../routePlayback/useFitRouteOnPlay.js";

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
    mapContainerRef,
    requestRouteFit,
  } = useFeaturedRoute();

  const cueSlides = useMemo(
    () => routeVideoCueSlides(meta, routeState),
    [
      meta,
      routeState.activeDataPoints,
      routeState.distance,
      routeState.geometry,
    ],
  );
  const playback = useSyntheticRoutePlayback({
    routeState,
    cueSlides,
    onCursorChange: setVideoCursor,
    onPlayingChange: setVideoPlaying,
  });

  const sectionRef = useRef(null);
  const featuredFitRegistry = useMemo(() => ([
    { selector: ".fv-video-controls", side: "bottom" },
    { selector: ".fv-video-poi-preview" },
  ]), []);

  useFitRouteOnPlay({
    isPlaying: playback.isPlaying,
    currentTime: playback.currentTime,
    geometry: routeState.geometry,
    getMapEl: () => mapContainerRef.current,
    getScopeEl: () => sectionRef.current,
    registry: featuredFitRegistry,
    onRequestFit: (req) => requestRouteFit("play-fit", { padding: req.padding }),
  });

  useEffect(() => {
    if (!playback.sync) return undefined;
    const seek = (time) => playback.seekToTime(time);
    const playRoute = () => playback.play();
    const pauseRoute = () => playback.pause();
    videoSyncRef.current = playback.sync;
    playerSeekRef.current = seek;
    playerPlayRef.current = playRoute;
    playerPauseRef.current = pauseRoute;

    return () => {
      if (videoSyncRef.current === playback.sync) videoSyncRef.current = null;
      if (playerSeekRef.current === seek) playerSeekRef.current = null;
      if (playerPlayRef.current === playRoute) playerPlayRef.current = null;
      if (playerPauseRef.current === pauseRoute) playerPauseRef.current = null;
    };
  }, [
    playback.pause,
    playback.play,
    playback.seekToTime,
    playback.sync,
    playerPauseRef,
    playerPlayRef,
    playerSeekRef,
    videoSyncRef,
  ]);

  if (!playback.sync) return null;

  return (
    <section
      ref={sectionRef}
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
        showDistantPreview={false}
      />
      <RoutePlaybackControls
        readoutMode="distance"
        isPlaying={playback.isPlaying}
        isReady={playback.isReady}
        isScrubbing={playback.isScrubbing}
        currentTime={playback.currentTime}
        duration={playback.duration}
        progressFraction={playback.cursor?.fraction}
        routeDistanceMeters={routeState.distance}
        onTogglePlayback={playback.togglePlayback}
        onScrubStart={playback.onScrubStart}
        onScrubChange={playback.onScrubChange}
        onScrubEnd={playback.onScrubEnd}
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
