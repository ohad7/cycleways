import React, { useMemo } from "react";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";
import RoutePoiPlaybackPreview from "../routePlayback/RoutePoiPlaybackPreview.jsx";
import { routeVideoCueSlides } from "./routePoiStoryData.js";

export default function RoutePoiVideoPreview({
  className = "",
  previewMaxFraction,
  previewMaxMeters,
  showDistantPreview = true,
}) {
  const {
    meta,
    routeState,
    videoCursor,
    setFocusedPoiId,
    setFocusedCoord,
    playerPauseRef,
  } = useFeaturedRoute();
  const slides = useMemo(
    () => routeVideoCueSlides(meta, routeState),
    [meta, routeState],
  );
  function handleCueClick({ slide, poiId }) {
    playerPauseRef.current?.();
    setFocusedPoiId(poiId);
    if (Array.isArray(slide.location) && slide.location.length >= 2) {
      const [lat, lng] = slide.location;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        setFocusedCoord({ lat, lng });
      }
    }
    const target = Array.from(document.querySelectorAll("[data-poi-id]")).find(
      (node) => node.dataset.poiId === String(poiId),
    );
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <RoutePoiPlaybackPreview
      className={className}
      slides={slides}
      cursorFraction={videoCursor?.fraction}
      routeDistanceMeters={routeState.distance}
      previewMaxFraction={previewMaxFraction}
      previewMaxMeters={previewMaxMeters}
      showDistantPreview={showDistantPreview}
      onCueClick={handleCueClick}
    />
  );
}
