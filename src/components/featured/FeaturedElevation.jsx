import React, { useCallback } from "react";
import ElevationProfile from "../ElevationProfile.jsx";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";

export default function FeaturedElevation() {
  const {
    routeState,
    videoCursor,
    videoPlaying,
    setVideoCursorFromFraction,
    seekVideoToFraction,
  } = useFeaturedRoute();

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

  if (!routeState || routeState.geometry.length < 2) return null;

  return (
    <ElevationProfile
      geometry={routeState.geometry}
      distance={routeState.distance}
      cursorFraction={Number.isFinite(videoCursor?.fraction) ? videoCursor.fraction : null}
      cursorPlaying={videoPlaying}
      cursorInfoVisible={Number.isFinite(videoCursor?.fraction)}
      onElevationHover={handleHover}
      onElevationSelect={handleSelect}
    />
  );
}
