import React from "react";
import {
  routeDifficultyLabel,
  routeDisplayImage,
  routeShapeLabel,
} from "@cycleways/core/data/catalog.js";
import { routeImageSrc } from "../routes/routeImageSrc.js";
import { discoverRouteColor } from "@cycleways/core/map/discoverRouteColors.js";

// Minimal horizontal route card for the narrow Discover panel: thumbnail +
// title + a compact meta line (distance · level · via). The whole card loads
// the route into the planner. The richer RouteCard is for the wide /routes page.
export default function PanelRouteCard({ entry, places, onSelect, onHover, index = 0, cardRef, distanceFromUserLabel = "" }) {
  const photo = routeDisplayImage(entry);
  const placeNames = routePlaceNames(entry, places, 2);
  const summary = typeof entry.summary === "string" ? entry.summary.trim() : "";
  return (
    <div
      ref={cardRef}
      className="panel-route-card-wrap"
      onMouseEnter={() => onHover?.(entry.slug)}
      onMouseLeave={() => onHover?.(null)}
    >
      <button
        type="button"
        className="panel-route-card"
        onClick={() => onSelect(entry)}
        onFocus={() => onHover?.(entry.slug)}
        onBlur={() => onHover?.(null)}
        aria-label={`פתח את ${entry.name} במפה`}
      >
        <span className="panel-route-card__thumb" aria-hidden="true">
          {photo ? (
            <img
              src={routeImageSrc(photo.thumbnail || photo.photo)}
              alt=""
              loading="lazy"
            />
          ) : null}
        </span>
        <span className="panel-route-card__body">
          <span className="panel-route-card__title">
            <span
              className="panel-route-card__swatch"
              style={{ backgroundColor: discoverRouteColor(index) }}
              aria-hidden="true"
            />
            {entry.name}
          </span>
          <span className="panel-route-card__meta">
            <b>{entry.distanceKm} ק״מ</b>
            <span>· {routeDifficultyLabel(entry.difficulty)}</span>
            {routeShapeLabel(entry) && <span>· {routeShapeLabel(entry)}</span>}
            {placeNames.length > 0 && <span>· {placeNames.join(" · ")}</span>}
            {distanceFromUserLabel && (
              <span className="panel-route-card__near"> · {distanceFromUserLabel}</span>
            )}
          </span>
          {summary && (
            <span className="panel-route-card__summary">
              {summary}
            </span>
          )}
        </span>
      </button>
      <a
        className="panel-route-card__story-link"
        href={`/routes/${entry.slug}`}
        aria-label="לעמוד המסלול"
        onClick={(event) => event.stopPropagation()}
      >
        לעמוד המסלול ←
      </a>
    </div>
  );
}

export function PanelRouteHeroCard({
  entry,
  places,
  onSelect,
  onHover,
  index = 0,
  cardRef,
  distanceFromUserLabel = "",
}) {
  if (!entry) return null;
  const photo = routeDisplayImage(entry);
  const placeNames = routePlaceNames(entry, places, 2);
  const summary = typeof entry.summary === "string" ? entry.summary.trim() : "";
  const meta = [
    Number.isFinite(entry.distanceKm) ? `${entry.distanceKm} ק״מ` : null,
    routeDifficultyLabel(entry.difficulty),
    routeShapeLabel(entry),
    placeNames.length ? placeNames.join(" · ") : null,
    distanceFromUserLabel || null,
  ].filter(Boolean);

  return (
    <div
      ref={cardRef}
      className="panel-route-hero-wrap"
      onMouseEnter={() => onHover?.(entry.slug)}
      onMouseLeave={() => onHover?.(null)}
    >
      <button
        type="button"
        className={[
          "panel-route-hero",
          photo ? "panel-route-hero--image" : "",
        ].filter(Boolean).join(" ")}
        onClick={() => onSelect(entry)}
        onFocus={() => onHover?.(entry.slug)}
        onBlur={() => onHover?.(null)}
        aria-label={`פתח את ${entry.name} במפה`}
      >
        <span className="panel-route-hero__media" aria-hidden="true">
          {photo ? (
            <img
              src={routeImageSrc(photo.thumbnail || photo.photo)}
              alt=""
              loading="lazy"
            />
          ) : null}
        </span>
        <span className="panel-route-hero__overlay">
          <span className="panel-route-hero__kicker">
            <span
              className="panel-route-hero__swatch"
              style={{ backgroundColor: discoverRouteColor(index) }}
              aria-hidden="true"
            />
            מסלול מומלץ
          </span>
          <span className="panel-route-hero__title">{entry.name}</span>
          {summary && <span className="panel-route-hero__summary">{summary}</span>}
          {meta.length ? (
            <span className="panel-route-hero__meta">{meta.join(" · ")}</span>
          ) : null}
          <span className="panel-route-hero__cta">פתח במפה</span>
        </span>
      </button>
    </div>
  );
}

function routePlaceNames(entry, places, limit) {
  return (entry?.passesNear || [])
    .map((id) => places.find((p) => p.id === id)?.name)
    .filter(Boolean)
    .slice(0, limit);
}
