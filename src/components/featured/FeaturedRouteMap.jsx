import React, { useCallback, useEffect, useRef } from "react";
import MapView from "../../map/MapView.jsx";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";
import { useIsMobile } from "./useIsMobile.js";
import {
  VIDEO_CURSOR_DEFAULT_VARIANT,
} from "@cycleways/core/map/mapStyles.js";

export default function FeaturedRouteMapSlot({
  variant = "mobile",
  className = "",
  autoResetAfterInteraction = false,
  autoResetDelayMs = 8000,
  routeFitPadding,
  videoCursorVariant = VIDEO_CURSOR_DEFAULT_VARIANT,
  fitOverlayRegistry = null,
}) {
  const isMobile = useIsMobile();
  const {
    status,
    dataMarkerFeatures,
    activeDataPointIds,
    routeState,
    focusedCoord,
    requestRouteFit,
    registerRouteFitOverlays,
    mapContainerRef,
    routeFitRequest,
    videoCursor,
    videoPlaying,
    handleRouteClick,
    handleDataMarkerClick,
    mapPrimary,
    toggleMapPrimary,
  } = useFeaturedRoute();
  const resetTimerRef = useRef(null);
  const prevMapPrimaryRef = useRef(mapPrimary);

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

  // Esc swaps back to video-primary when the map is filling the stage.
  useEffect(() => {
    if (!mapPrimary) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") toggleMapPrimary();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mapPrimary, toggleMapPrimary]);

  // Register the obstruction overlays (control bar, video PiP, POI preview) so
  // requestRouteFit computes overlay-aware padding for this map, scoped to the
  // surrounding video shell.
  useEffect(() => {
    if (!fitOverlayRegistry) return undefined;
    registerRouteFitOverlays({
      registry: fitOverlayRegistry,
      getScopeEl: () =>
        mapContainerRef.current?.closest(".fv-video-shell")
        ?? mapContainerRef.current?.parentElement
        ?? null,
    });
    return () => registerRouteFitOverlays(null);
  }, [fitOverlayRegistry, registerRouteFitOverlays, mapContainerRef]);

  // On either swap direction the map container resizes; once it has settled, refit
  // the whole route with the overlay-aware fit. Only on an actual swap, not mount.
  useEffect(() => {
    const swapped = prevMapPrimaryRef.current !== mapPrimary;
    prevMapPrimaryRef.current = mapPrimary;
    if (!swapped) return undefined;
    const id = window.setTimeout(
      () => requestRouteFit?.(mapPrimary ? "map-primary-fit" : "video-primary-fit"),
      180,
    );
    return () => window.clearTimeout(id);
  }, [mapPrimary, requestRouteFit]);

  if (status !== "ready" || routeState.geometry.length < 2) return null;

  const focusedMarker = focusedCoord ? { coord: focusedCoord } : null;
  const expandLabel = isMobile ? "פתח מפה גדולה" : "הגדל מפה";

  return (
    <div
      ref={mapContainerRef}
      className={[
        "featured-map-inline",
        mapPrimary ? "featured-map-inline--map-primary" : "",
        className,
      ].filter(Boolean).join(" ")}
    >
      {!mapPrimary && (
        <button
          type="button"
          className="featured-map-expand-hit"
          onClick={toggleMapPrimary}
          aria-label={expandLabel}
        />
      )}
      <MapView
        mode="readonly-route"
        dataMarkerFeatures={dataMarkerFeatures}
        activeDataPointIds={activeDataPointIds}
        routeGeometry={routeState.geometry}
        routePoints={routeState.points}
        routeFitRequest={routeFitRequest}
        routeFitPadding={mapPrimary ? 48 : routeFitPadding}
        focusedMarker={focusedMarker}
        onDataMarkerClick={handleDataMarkerClick}
        onUserViewportChange={handleUserViewportChange}
        videoCursor={videoCursor}
        videoCursorVariant={videoCursorVariant}
        videoPlaying={videoPlaying}
        onRouteClick={handleRouteClick}
      />
      {!mapPrimary && (
        <button
          type="button"
          className="featured-map-expand-btn"
          onClick={toggleMapPrimary}
          aria-label={isMobile ? undefined : expandLabel}
          aria-hidden={isMobile ? "true" : undefined}
          tabIndex={isMobile ? -1 : undefined}
          title={expandLabel}
        >
          <span aria-hidden="true">⛶</span>
          <span className="featured-map-expand-label">{expandLabel}</span>
        </button>
      )}
    </div>
  );
}
