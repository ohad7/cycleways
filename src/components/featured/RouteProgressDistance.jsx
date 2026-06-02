import React, { useMemo } from "react";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";

function formatDistance(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return "0 מ׳";
  if (meters < 1000) return `${Math.round(meters)} מ׳`;
  return `${(meters / 1000).toFixed(1)} ק״מ`;
}

export default function RouteProgressDistance({ className = "" }) {
  const { focusedPoiId, routeState, videoCursor } = useFeaturedRoute();
  const focusedPoint = useMemo(
    () => routeState.activeDataPoints.find((point) => point.id === focusedPoiId),
    [focusedPoiId, routeState.activeDataPoints],
  );
  const fraction = Number.isFinite(videoCursor?.fraction)
    ? videoCursor.fraction
    : Number.isFinite(focusedPoint?.routeFraction)
      ? focusedPoint.routeFraction
      : 0;
  const clampedFraction = Math.max(0, Math.min(1, fraction));
  const meters = routeState.distance * clampedFraction;

  return (
    <strong className={className} aria-live="polite">
      {formatDistance(meters)}
    </strong>
  );
}
