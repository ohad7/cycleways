import React, { useMemo } from "react";
import {
  isWarningType,
  POI_EMOJIS,
  poiLabel,
} from "@cycleways/core/data/poiTypes.js";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";
import {
  endpointLabel,
  imageSrc,
  nearestPreviewForCursor,
  routeVideoCueSlides,
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
  const slides = useMemo(
    () => routeVideoCueSlides(meta, routeState),
    [meta, routeState],
  );
  const { slide, near } = useMemo(
    () => nearestPreviewForCursor(slides, videoCursor?.fraction, routeState.distance),
    [slides, routeState.distance, videoCursor?.fraction],
  );

  if (!slide) return null;

  const poiId = slide.poiId || `${slide.type}-${slide.location?.join(",")}`;
  const typeLabel = endpointLabel(slide.kind) || poiLabel(slide.type);
  const name = slide.name || typeLabel;
  const src = imageSrc(slide);
  const isWarning = slide.kind === "warning" || isWarningType(slide.type);

  function handleClick() {
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
    <button
      type="button"
      className={[
        "fv-video-poi-preview",
        isWarning ? "fv-video-poi-preview--warning" : "",
        src ? "" : "fv-video-poi-preview--icon-only",
        near ? "" : "fv-video-poi-preview--mini",
        className,
      ].filter(Boolean).join(" ")}
      onClick={handleClick}
      aria-label={`עבור אל ${name}`}
    >
      {src ? (
        <img src={src} alt="" />
      ) : (
        <span className="fv-video-poi-preview__icon" aria-hidden="true">
          {POI_EMOJIS[slide.type] || "⚠️"}
        </span>
      )}
      <div>
        <span>{typeLabel}</span>
        <strong>{name}</strong>
        {slide.information && <p>{slide.information}</p>}
      </div>
    </button>
  );
}
