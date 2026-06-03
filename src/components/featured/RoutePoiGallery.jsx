import React, { useEffect, useMemo, useState } from "react";
import {
  galleryImageSlides,
  nearestSlideIndexByFraction,
  poiLabel,
} from "@cycleways/core/data/poiTypes.js";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";

function imageSrc(item) {
  const src = item.thumbnail || item.photo || "";
  if (/^(https?:)?\/\//.test(src) || src.startsWith("/")) return src;
  return `/${src}`;
}

export default function RoutePoiGallery({ className = "" }) {
  const {
    routeState,
    focusedPoiId,
    setFocusedPoiId,
    setFocusedCoord,
    videoCursor,
    seekVideoToFraction,
    playerPauseRef,
  } = useFeaturedRoute();
  const items = useMemo(
    () => galleryImageSlides(routeState.activeDataPoints),
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
    setSelectedIndex((current) => {
      if (items[current]?.poiId === focusedPoiId) return current;
      const index = items.findIndex((item) => item.poiId === focusedPoiId);
      return index >= 0 ? index : current;
    });
  }, [focusedPoiId, items]);

  useEffect(() => {
    const index = nearestSlideIndexByFraction(items, videoCursor?.fraction);
    const next = items[index];
    if (!next) return;
    setSelectedIndex(index);
    setFocusedPoiId(next.poiId);
  }, [items, videoCursor?.fraction, setFocusedPoiId]);

  if (items.length === 0) return null;

  const currentIndex = Math.min(selectedIndex, items.length - 1);
  const selected = items[currentIndex];

  function selectByUser(index) {
    const next = items[index];
    if (!next) return;
    setSelectedIndex(index);
    setFocusedPoiId(next.poiId);
    if (Array.isArray(next.location) && next.location.length >= 2) {
      const [lat, lng] = next.location;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        setFocusedCoord({ lat, lng });
        seekVideoToFraction(next.routeFraction, { lat, lng });
      } else {
        seekVideoToFraction(next.routeFraction);
      }
    } else {
      seekVideoToFraction(next.routeFraction);
    }
    playerPauseRef.current?.();
  }

  function selectRelative(delta) {
    selectByUser((currentIndex + delta + items.length) % items.length);
  }

  return (
    <section
      className={["sbh-moments", className].filter(Boolean).join(" ")}
      aria-label="נקודות עצירה ותמונות"
    >
      <article className="sbh-moment-card">
        <figure className="sbh-moment-figure">
          <button
            type="button"
            className="sbh-moment-image-button"
            onClick={() => selectByUser(currentIndex)}
            aria-label={selected.name || selected.information || poiLabel(selected.type)}
          >
            <img src={imageSrc(selected)} alt="" />
          </button>
          {items.length > 1 && (
            <>
              <button
                type="button"
                className="sbh-carousel-arrow sbh-carousel-arrow--left"
                onClick={() => selectRelative(-1)}
                aria-label="תמונה קודמת"
              >
                {"<"}
              </button>
              <button
                type="button"
                className="sbh-carousel-arrow sbh-carousel-arrow--right"
                onClick={() => selectRelative(1)}
                aria-label="תמונה הבאה"
              >
                {">"}
              </button>
            </>
          )}
        </figure>
        <div className="sbh-moment-card-body">
          <div className="sbh-moment-title-line">
            <span className="sbh-moment-type">{poiLabel(selected.type)}</span>
            <strong>{selected.name || poiLabel(selected.type)}</strong>
          </div>
          {selected.information && <span>{selected.information}</span>}
          {selected.description && <p>{selected.description}</p>}
        </div>
      </article>

      <div className="sbh-carousel-counter" aria-live="polite">
        {currentIndex + 1} / {items.length}
      </div>
    </section>
  );
}
