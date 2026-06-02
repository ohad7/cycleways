import React, { useCallback, useEffect, useRef } from "react";
import MapView from "../../map/MapView.jsx";
import { dataMarkerFeaturesFromSegments } from "../../map/mapLayers.js";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";
import { useIsMobile } from "./useIsMobile.js";

export default function FeaturedRouteMapSlot({
  variant = "mobile",
  className = "",
  autoResetAfterInteraction = false,
  autoResetDelayMs = 8000,
  routeFitPadding,
}) {
  const isMobile = useIsMobile();
  const {
    assets,
    routeState,
    focusedCoord,
    requestRouteFit,
    routeFitRequest,
    videoCursor,
    handleRouteClick,
    handleDataMarkerClick,
  } = useFeaturedRoute();
  const resetTimerRef = useRef(null);

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearResetTimer, [clearResetTimer]);

  useEffect(() => {
    clearResetTimer();
  }, [focusedCoord, routeFitRequest]);

  const handleUserViewportChange = useCallback(() => {
    if (!autoResetAfterInteraction) return;
    clearResetTimer();
    resetTimerRef.current = window.setTimeout(() => {
      resetTimerRef.current = null;
      requestRouteFit?.("featured-map-auto-reset");
    }, autoResetDelayMs);
  }, [
    autoResetAfterInteraction,
    autoResetDelayMs,
    clearResetTimer,
    requestRouteFit,
  ]);

  if (!assets) return null;
  if (variant === "mobile" && !isMobile) return null;
  if (variant === "desktop" && isMobile) return null;

  const dataMarkerFeatures = dataMarkerFeaturesFromSegments(assets.segmentsData);
  const activeDataPointIds = routeState.activeDataPoints.map((p) => p.id);
  const focusedMarker = focusedCoord ? { coord: focusedCoord } : null;

  return (
    <div className={["featured-map-inline", className].join(" ").trim()}>
      <MapView
        geoJsonData={assets.geoJsonData}
        dataMarkerFeatures={dataMarkerFeatures}
        activeDataPointIds={activeDataPointIds}
        routeGeometry={routeState.geometry}
        routePoints={routeState.points}
        routeFitRequest={routeFitRequest}
        routeFitPadding={routeFitPadding}
        focusedMarker={focusedMarker}
        onDataMarkerClick={handleDataMarkerClick}
        onUserViewportChange={handleUserViewportChange}
        videoCursor={videoCursor}
        onRouteClick={handleRouteClick}
      />
    </div>
  );
}
