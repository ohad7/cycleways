import React, { useMemo } from "react";
import { galleryImageSlides, poiLabel } from "@cycleways/core/data/poiTypes.js";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";
import {
  endpointLabel,
  imageSrc,
  nearestPreviewForCursor,
  routeEndpointSlides,
} from "./routePoiStoryData.js";

export default function RoutePoiVideoPreview({ className = "" }) {
  const {
    meta,
    routeState,
    videoCursor,
    setFocusedPoiId,
    setFocusedCoord,
    playerPauseRef,
  } = useFeaturedRoute();
  const slides = useMemo(() => {
    const gallery = galleryImageSlides(routeState.activeDataPoints);
    const endpoints = routeEndpointSlides(meta, routeState);
    const start = endpoints.filter((s) => s.kind === "start");
    const end = endpoints.filter((s) => s.kind === "end");
    return [...start, ...gallery, ...end];
  }, [meta, routeState]);
  const { slide, near } = useMemo(
    () => nearestPreviewForCursor(slides, videoCursor?.fraction, routeState.distance),
    [slides, routeState.distance, videoCursor?.fraction],
  );

  if (!slide) return null;

  const poiId = slide.poiId || `${slide.type}-${slide.location?.join(",")}`;
  const typeLabel = endpointLabel(slide.kind) || poiLabel(slide.type);
  const name = slide.name || typeLabel;

  function handleClick() {
    playerPauseRef.current?.();
    setFocusedPoiId(poiId);
    if (Array.isArray(slide.location) && slide.location.length >= 2) {
      const [lat, lng] = slide.location;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        setFocusedCoord({ lat, lng });
      }
    }
    const target = Array.from(document.querySelectorAll(".sbh-poi-story")).find(
      (node) => node.dataset.poiId === String(poiId),
    );
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <button
      type="button"
      className={[
        "sbh-video-poi-preview",
        near ? "" : "sbh-video-poi-preview--mini",
        className,
      ].filter(Boolean).join(" ")}
      onClick={handleClick}
      aria-label={`עבור אל ${name}`}
    >
      <img src={imageSrc(slide)} alt="" />
      <div>
        <span>{typeLabel}</span>
        <strong>{name}</strong>
        {slide.information && <p>{slide.information}</p>}
      </div>
    </button>
  );
}
