import React, { useMemo } from "react";
import {
  isWarningType,
  POI_EMOJIS,
  poiLabel,
} from "@cycleways/core/data/poiTypes.js";
import {
  endpointLabel,
  imageSrc,
  nearestPreviewForCursor,
} from "../featured/routePoiStoryData.js";

export default function RoutePoiPlaybackPreview({
  className = "",
  slides,
  cursorFraction,
  routeDistanceMeters,
  previewMaxFraction,
  previewMaxMeters,
  showDistantPreview = false,
  onCueClick,
}) {
  const { slide, near } = useMemo(
    () => nearestPreviewForCursor(
      slides,
      cursorFraction,
      routeDistanceMeters,
      {
        maxFraction: previewMaxFraction,
        maxMeters: previewMaxMeters,
      },
    ),
    [
      cursorFraction,
      previewMaxFraction,
      previewMaxMeters,
      routeDistanceMeters,
      slides,
    ],
  );

  if (!slide) return null;
  if (!near && !showDistantPreview) return null;

  const poiId = slide.poiId || `${slide.type}-${slide.location?.join(",")}`;
  const typeLabel = endpointLabel(slide.kind) || poiLabel(slide.type);
  const name = slide.name || typeLabel;
  const src = imageSrc(slide);
  const isWarning = slide.kind === "warning" || isWarningType(slide.type);

  function handleClick() {
    onCueClick?.({ slide, poiId, name });
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
