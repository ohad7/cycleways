import React, { useEffect, useRef, useState } from "react";
import MapView from "../../map/MapView.jsx";
import { dataMarkerFeaturesFromSegments } from "../../map/mapLayers.js";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";
import { useIsMobile } from "./useIsMobile.js";

export default function FeaturedRouteMapSlot({
  variant = "mobile",
  className = "",
  allowFullscreen = true,
  routeFitPadding,
}) {
  const isMobile = useIsMobile();
  const {
    assets,
    routeState,
    focusedCoord,
    routeFitRequest,
    videoCursor,
    handleRouteClick,
    handleDataMarkerClick,
  } = useFeaturedRoute();
  const [fullscreen, setFullscreen] = useState(false);
  const triggerRef = useRef(null);
  const closeRef = useRef(null);
  const wasOpenRef = useRef(false);

  // Lock body scroll while the fullscreen overlay is mounted.
  useEffect(() => {
    if (!fullscreen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [fullscreen]);

  // Move focus to the close button and bind Escape when the overlay opens.
  useEffect(() => {
    if (!fullscreen) return undefined;
    closeRef.current?.focus();
    const onKeyDown = (e) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen]);

  // Restore focus to the trigger after the overlay closes — but not on initial render.
  useEffect(() => {
    if (fullscreen) {
      wasOpenRef.current = true;
    } else if (wasOpenRef.current) {
      triggerRef.current?.focus();
      wasOpenRef.current = false;
    }
  }, [fullscreen]);

  if (!assets) return null;
  if (variant === "mobile" && !isMobile) return null;
  if (variant === "desktop" && isMobile) return null;

  const dataMarkerFeatures = dataMarkerFeaturesFromSegments(assets.segmentsData);
  const activeDataPointIds = routeState.activeDataPoints.map((p) => p.id);
  const focusedMarker = focusedCoord ? { coord: focusedCoord } : null;

  return (
    <>
      <div
        className={[
          "featured-map-inline",
          className,
          fullscreen ? " featured-map-inline--hidden" : "",
        ].join(" ").trim()}
      >
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
          videoCursor={videoCursor}
          onRouteClick={handleRouteClick}
        />
        {allowFullscreen && (
          <button
            ref={triggerRef}
            type="button"
            className="featured-map-fullscreen-btn"
            onClick={() => setFullscreen(true)}
          >
            מפה מלאה
          </button>
        )}
      </div>
      {fullscreen && (
        <div className="featured-map-fullscreen-overlay" role="dialog" aria-modal="true">
          <button
            ref={closeRef}
            type="button"
            className="featured-map-fullscreen-close"
            onClick={() => setFullscreen(false)}
          >
            סגור
          </button>
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
          />
        </div>
      )}
    </>
  );
}
