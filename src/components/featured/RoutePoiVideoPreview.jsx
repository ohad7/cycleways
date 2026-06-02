import React, { useMemo } from "react";
import { galleryImageSlides, poiLabel } from "@cycleways/core/data/poiTypes.js";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";
import { imageSrc, previewSlideForCursor } from "./routePoiStoryData.js";

export default function RoutePoiVideoPreview({ className = "" }) {
  const { routeState, videoCursor } = useFeaturedRoute();
  const slides = useMemo(
    () => galleryImageSlides(routeState.activeDataPoints),
    [routeState.activeDataPoints],
  );
  const slide = useMemo(
    () => previewSlideForCursor(slides, videoCursor?.fraction, routeState.distance),
    [slides, routeState.distance, videoCursor?.fraction],
  );

  if (!slide) return null;

  return (
    <aside
      className={["sbh-video-poi-preview", className].filter(Boolean).join(" ")}
      aria-live="polite"
    >
      <img src={imageSrc(slide)} alt="" />
      <div>
        <span>{poiLabel(slide.type)}</span>
        <strong>{slide.name || poiLabel(slide.type)}</strong>
        {slide.information && <p>{slide.information}</p>}
      </div>
    </aside>
  );
}
