import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import MapView from "../../map/MapView.jsx";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";
import { useIsMobile } from "./useIsMobile.js";
import RouteProgressDistance from "./RouteProgressDistance.jsx";

function scrollRoutePlayerIntoView() {
  const target = document.querySelector(".fv-video-shell");
  if (!target) return;
  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block: "start",
  });
}

export default function FeaturedRouteMapSlot({
  variant = "mobile",
  className = "",
  autoResetAfterInteraction = false,
  autoResetDelayMs = 8000,
  routeFitPadding,
}) {
  const isMobile = useIsMobile();
  const {
    status,
    dataMarkerFeatures,
    activeDataPointIds,
    routeState,
    focusedCoord,
    requestRouteFit,
    routeFitRequest,
    videoCursor,
    handleRouteClick,
    handleDataMarkerClick,
    playerPauseRef,
  } = useFeaturedRoute();
  const [expanded, setExpanded] = useState(false);
  const portalElementRef = useRef(null);
  const resetTimerRef = useRef(null);
  const closeButtonRef = useRef(null);

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

  const openExpandedMap = useCallback(() => {
    if (!portalElementRef.current) {
      const portalNode = document.createElement("div");
      portalNode.className = "featured-map-portal-root";
      document.body.appendChild(portalNode);
      portalElementRef.current = portalNode;
    }
    playerPauseRef.current?.();
    setExpanded(true);
    requestRouteFit?.("featured-map-expand");
  }, [playerPauseRef, requestRouteFit]);

  const closeExpandedMap = useCallback(() => {
    setExpanded(false);
  }, []);

  useEffect(() => {
    if (!expanded) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeExpandedMap();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [expanded, closeExpandedMap]);

  useEffect(() => {
    if (expanded) {
      closeButtonRef.current?.focus();
    }
  }, [expanded]);

  useEffect(() => (
    () => {
      portalElementRef.current?.remove();
      portalElementRef.current = null;
    }
  ), []);

  if (status !== "ready" || routeState.geometry.length < 2) return null;
  if (variant === "mobile" && !isMobile) return null;
  if (variant === "desktop" && isMobile) return null;

  const focusedMarker = focusedCoord ? { coord: focusedCoord } : null;
  const variantLabel = isMobile ? "פתח מפה גדולה" : "הגדל מפה";

  const renderMap = ({
    expandedMap = false,
    onDataMarkerSelect = handleDataMarkerClick,
    onRouteSelect = handleRouteClick,
  } = {}) => (
    <MapView
      dataMarkerFeatures={dataMarkerFeatures}
      activeDataPointIds={activeDataPointIds}
      routeGeometry={routeState.geometry}
      routePoints={routeState.points}
      routeFitRequest={routeFitRequest}
      routeFitPadding={expandedMap ? 48 : routeFitPadding}
      focusedMarker={focusedMarker}
      onDataMarkerClick={onDataMarkerSelect}
      onUserViewportChange={expandedMap ? undefined : handleUserViewportChange}
      videoCursor={videoCursor}
      onRouteClick={onRouteSelect}
    />
  );

  const handleExpandedMarkerClick = (marker) => {
    handleDataMarkerClick(marker);
    closeExpandedMap();
    window.requestAnimationFrame(scrollRoutePlayerIntoView);
  };

  const handleExpandedRouteClick = (latLng) => {
    handleRouteClick(latLng);
    playerPauseRef.current?.();
  };

  const handleCloseButtonClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeExpandedMap();
  };

  return (
    <div
      className={[
        "featured-map-inline",
        expanded ? "featured-map-inline--expanded" : "",
        className,
      ].filter(Boolean).join(" ")}
    >
      <button
        type="button"
        className="featured-map-expand-hit"
        onClick={openExpandedMap}
        aria-label={variantLabel}
      />
      {renderMap()}
      <button
        type="button"
        className="featured-map-expand-btn"
        onClick={openExpandedMap}
        aria-label={isMobile ? undefined : variantLabel}
        aria-hidden={isMobile ? "true" : undefined}
        tabIndex={isMobile ? -1 : undefined}
        title={variantLabel}
      >
        <span aria-hidden="true">⛶</span>
        <span className="featured-map-expand-label">{variantLabel}</span>
      </button>
      {portalElementRef.current && createPortal((
        <div
          className={[
            "featured-map-expanded-overlay",
            expanded ? "" : "featured-map-expanded-overlay--hidden",
            isMobile ? "featured-map-expanded-overlay--mobile" : "featured-map-expanded-overlay--desktop",
          ].filter(Boolean).join(" ")}
          role={expanded ? "dialog" : undefined}
          aria-hidden={expanded ? undefined : "true"}
          aria-modal={expanded ? "true" : undefined}
          aria-label="מפת המסלול"
          onClick={closeExpandedMap}
        >
          <section className="featured-map-expanded-panel">
            <header className="featured-map-expanded-header">
              <div className="featured-map-expanded-title">
                <span>מפת המסלול</span>
                <RouteProgressDistance className="featured-map-expanded-distance" />
              </div>
              <button
                type="button"
                className="featured-map-expanded-close"
                onClick={handleCloseButtonClick}
                ref={closeButtonRef}
                aria-label="סגור מפה"
              >
                <span aria-hidden="true">×</span>
                <span className="featured-map-expanded-close-label">סגור</span>
              </button>
            </header>
            <div
              className="featured-map-expanded-body"
              onClick={(event) => event.stopPropagation()}
            >
              {renderMap({
                expandedMap: true,
                onDataMarkerSelect: handleExpandedMarkerClick,
                onRouteSelect: handleExpandedRouteClick,
              })}
            </div>
          </section>
        </div>
      ), portalElementRef.current)}
    </div>
  );
}
