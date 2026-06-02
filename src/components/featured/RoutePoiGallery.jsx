import React, { useEffect, useMemo, useState } from "react";
import {
  isGalleryEligiblePoi,
  poiLabel,
} from "@cycleways/core/data/poiTypes.js";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";

function imageSrc(point) {
  const src = point.thumbnail || point.photo || "";
  if (/^(https?:)?\/\//.test(src) || src.startsWith("/")) return src;
  return `/${src}`;
}

function byRouteProgress(a, b) {
  const aProgress = Number.isFinite(a.routeProgressMeters)
    ? a.routeProgressMeters
    : Number.POSITIVE_INFINITY;
  const bProgress = Number.isFinite(b.routeProgressMeters)
    ? b.routeProgressMeters
    : Number.POSITIVE_INFINITY;
  if (aProgress !== bProgress) return aProgress - bProgress;
  return String(a.id || "").localeCompare(String(b.id || ""));
}

export default function RoutePoiGallery({ className = "" }) {
  const {
    routeState,
    focusedPoiId,
    setFocusedPoiId,
    setFocusedCoord,
  } = useFeaturedRoute();
  const items = useMemo(
    () =>
      routeState.activeDataPoints
        .filter(isGalleryEligiblePoi)
        .slice()
        .sort(byRouteProgress),
    [routeState.activeDataPoints],
  );
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (items.length === 0) {
      setSelectedIndex(0);
      return;
    }
    setSelectedIndex((current) => Math.min(current, items.length - 1));
  }, [items]);

  useEffect(() => {
    if (!focusedPoiId) return;
    const index = items.findIndex((item) => item.id === focusedPoiId);
    if (index >= 0) setSelectedIndex(index);
  }, [focusedPoiId, items]);

  if (items.length === 0) return null;

  const selected = items[selectedIndex];

  function selectIndex(index) {
    const next = items[index];
    if (!next) return;
    setSelectedIndex(index);
    setFocusedPoiId(next.id);
    if (Array.isArray(next.location) && next.location.length >= 2) {
      const [lat, lng] = next.location;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        setFocusedCoord({ lat, lng });
      }
    }
  }

  function selectRelative(delta) {
    selectIndex((selectedIndex + delta + items.length) % items.length);
  }

  return (
    <section
      className={["sbh-moments", className].filter(Boolean).join(" ")}
      aria-label="נקודות עצירה ותמונות"
    >
      <div className="sbh-carousel-header">
        <div className="sbh-side-heading">
          <span>לעצור ולראות</span>
          <strong>גלריית הדרך</strong>
        </div>
        <div className="sbh-carousel-controls" aria-label="מעבר בין תמונות">
          <button type="button" onClick={() => selectRelative(-1)} aria-label="תמונה קודמת">
            ‹
          </button>
          <span>
            {selectedIndex + 1}/{items.length}
          </span>
          <button type="button" onClick={() => selectRelative(1)} aria-label="תמונה הבאה">
            ›
          </button>
        </div>
      </div>

      <article className="sbh-moment-card">
        <img src={imageSrc(selected)} alt={selected.name || selected.information || poiLabel(selected.type)} />
        <div className="sbh-moment-card-body">
          <span className="sbh-moment-type">{poiLabel(selected.type)}</span>
          <strong>{selected.name || poiLabel(selected.type)}</strong>
          {selected.information && <span>{selected.information}</span>}
          {selected.description && <p>{selected.description}</p>}
        </div>
      </article>

      <div className="sbh-carousel-dots" aria-label="בחירת תמונה">
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={index === selectedIndex ? "active" : ""}
            onClick={() => selectIndex(index)}
            aria-label={item.name || item.information || poiLabel(item.type)}
          />
        ))}
      </div>
    </section>
  );
}
