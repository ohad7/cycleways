import React, { useMemo } from "react";
import {
  isWarningType,
  POI_EMOJIS,
  poiLabel,
} from "@cycleways/core/data/poiTypes.js";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";

function formatDistance(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return "";
  if (meters < 1000) return `${Math.round(meters)} מ׳ מההתחלה`;
  return `${(meters / 1000).toFixed(1)} ק״מ מההתחלה`;
}

function scrollRoutePlayerIntoView() {
  const target = document.querySelector("[data-route-stage]") || document.querySelector(".fv-video-shell");
  if (!target) return;
  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block: "start",
  });
}

export default function Warnings({ extra = [], hide = [] }) {
  const {
    routeState,
    focusedPoiId,
    setFocusedPoiId,
    setFocusedCoord,
    seekVideoToFraction,
    playerPauseRef,
  } = useFeaturedRoute();
  const hideSet = useMemo(() => new Set(hide), [hide]);
  const items = useMemo(() => {
    const auto = routeState.activeDataPoints
      .filter((p) => isWarningType(p.type))
      .filter((p) => !hideSet.has(p.id));
    return [...auto, ...extra].sort((a, b) => {
      const ap = Number.isFinite(a.routeProgressMeters)
        ? a.routeProgressMeters
        : Number.POSITIVE_INFINITY;
      const bp = Number.isFinite(b.routeProgressMeters)
        ? b.routeProgressMeters
        : Number.POSITIVE_INFINITY;
      if (ap !== bp) return ap - bp;
      return String(a.id || "").localeCompare(String(b.id || ""));
    });
  }, [routeState.activeDataPoints, hideSet, extra]);

  function handleSelect(warning) {
    setFocusedPoiId(warning.id);
    const location = Array.isArray(warning.location) ? warning.location : null;
    const [lat, lng] = location || [];
    const hasCoord = Number.isFinite(lat) && Number.isFinite(lng);
    if (hasCoord) {
      setFocusedCoord({ lat, lng });
      seekVideoToFraction(warning.routeFraction, { lat, lng });
    } else {
      seekVideoToFraction(warning.routeFraction);
    }
    playerPauseRef.current?.();
    window.requestAnimationFrame(scrollRoutePlayerIntoView);
  }

  if (items.length === 0) return null;

  return (
    <section
      id="fv-route-warnings"
      className="fv-route-warnings"
      aria-label="אזהרות ומידע חשוב לאורך המסלול"
    >
      <div className="fv-route-warnings-heading">
        <span>חשוב לדעת</span>
        <h2>אזהרות ומידע לאורך הדרך</h2>
      </div>
      <div className="fv-route-warning-list">
        {items.map((w, i) => (
          <button
            key={w.id || i}
            type="button"
            className={[
              "fv-route-warning-card",
              focusedPoiId === w.id ? "fv-route-warning-card--focused" : "",
            ].filter(Boolean).join(" ")}
            onClick={() => handleSelect(w)}
          >
            <span className="fv-route-warning-icon" aria-hidden="true">
              {POI_EMOJIS[w.type] || "⚠️"}
            </span>
            <span className="fv-route-warning-copy">
              <span className="fv-route-warning-meta">
                <strong>{poiLabel(w.type)}</strong>
                {w.segmentName && <span>בקטע: {w.segmentName}</span>}
                {formatDistance(w.routeProgressMeters) && (
                  <span>{formatDistance(w.routeProgressMeters)}</span>
                )}
              </span>
              <span className="fv-route-warning-text">
                {w.information || w.description || w.name || poiLabel(w.type)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
