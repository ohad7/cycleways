import React, { useContext, useMemo } from "react";
import { FeaturedRouteContext } from "./FeaturedRouteContext.js";

function formatDistance(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return "0 מ׳";
  if (meters < 1000) return `${Math.round(meters)} מ׳`;
  return `${(meters / 1000).toFixed(1)} ק״מ`;
}

export default function RouteProgressDistance({
  className = "",
  progressFraction = null,
  routeDistanceMeters = null,
}) {
  const context = useContext(FeaturedRouteContext);
  const focusedPoiId = context?.focusedPoiId;
  const routeState = context?.routeState;
  const videoCursor = context?.videoCursor;
  const focusedPoint = useMemo(
    () => (routeState?.activeDataPoints || []).find((point) => point.id === focusedPoiId),
    [focusedPoiId, routeState?.activeDataPoints],
  );
  const fraction = Number.isFinite(progressFraction)
    ? progressFraction
    : Number.isFinite(videoCursor?.fraction)
    ? videoCursor.fraction
    : Number.isFinite(focusedPoint?.routeFraction)
      ? focusedPoint.routeFraction
      : 0;
  const clampedFraction = Math.max(0, Math.min(1, fraction));
  const distance = Number.isFinite(routeDistanceMeters)
    ? routeDistanceMeters
    : Number.isFinite(routeState?.distance)
      ? routeState.distance
      : 0;
  const meters = distance * clampedFraction;

  return (
    <strong className={className} aria-live="polite">
      {formatDistance(meters)}
    </strong>
  );
}
