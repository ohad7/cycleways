import React, { useCallback, useEffect, useRef } from "react";
import { postToApp } from "../../appEmbed.js";
import ElevationProfile from "../ElevationProfile.jsx";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";

export default function FeaturedElevation({ chartId = "elevation-chart" }) {
  const {
    routeState,
    videoCursor,
    videoPlaying,
    setVideoCursorFromFraction,
    seekVideoToFraction,
    playerPauseRef,
  } = useFeaturedRoute();
  const pendingScrubPayloadRef = useRef(null);
  const scrubFrameRef = useRef(null);

  const clearScheduledScrub = useCallback(() => {
    if (scrubFrameRef.current === null) return;
    window.cancelAnimationFrame(scrubFrameRef.current);
    scrubFrameRef.current = null;
  }, []);

  const seekToPayload = useCallback(
    (payload) => {
      if (!payload) return;
      seekVideoToFraction(payload.t, payload.coord || null);
    },
    [seekVideoToFraction],
  );

  const scheduleSeekToPayload = useCallback(
    (payload) => {
      if (!payload) return;
      pendingScrubPayloadRef.current = payload;
      if (scrubFrameRef.current !== null) return;
      scrubFrameRef.current = window.requestAnimationFrame(() => {
        scrubFrameRef.current = null;
        const next = pendingScrubPayloadRef.current;
        pendingScrubPayloadRef.current = null;
        seekToPayload(next);
      });
    },
    [seekToPayload],
  );

  const releaseNativeGestureLock = useCallback(() => {
    postToApp({ type: "gesture-lock", locked: false, reason: "elevation" });
  }, []);

  useEffect(
    () => () => {
      clearScheduledScrub();
      releaseNativeGestureLock();
    },
    [clearScheduledScrub, releaseNativeGestureLock],
  );

  const handleHover = useCallback(
    (payload) => {
      if (!payload) return;
      setVideoCursorFromFraction(payload.t, payload.coord || null);
    },
    [setVideoCursorFromFraction],
  );

  const handleSelect = useCallback(
    (payload) => {
      if (!payload) return;
      seekVideoToFraction(payload.t, payload.coord || null);
    },
    [seekVideoToFraction],
  );

  const handleScrubStart = useCallback(
    (payload) => {
      postToApp({ type: "gesture-lock", locked: true, reason: "elevation" });
      playerPauseRef.current?.();
      scheduleSeekToPayload(payload);
    },
    [playerPauseRef, scheduleSeekToPayload],
  );

  const handleScrub = useCallback(
    (payload) => {
      scheduleSeekToPayload(payload);
    },
    [scheduleSeekToPayload],
  );

  const handleScrubEnd = useCallback(
    (payload) => {
      clearScheduledScrub();
      pendingScrubPayloadRef.current = null;
      seekToPayload(payload);
      releaseNativeGestureLock();
    },
    [clearScheduledScrub, releaseNativeGestureLock, seekToPayload],
  );

  if (!routeState || routeState.geometry.length < 2) return null;

  return (
    <ElevationProfile
      chartId={chartId}
      geometry={routeState.geometry}
      distance={routeState.distance}
      cursorFraction={Number.isFinite(videoCursor?.fraction) ? videoCursor.fraction : null}
      cursorPlaying={videoPlaying}
      cursorInfoVisible={Number.isFinite(videoCursor?.fraction)}
      onElevationHover={handleHover}
      onElevationSelect={handleSelect}
      onElevationScrubStart={handleScrubStart}
      onElevationScrub={handleScrub}
      onElevationScrubEnd={handleScrubEnd}
    />
  );
}
