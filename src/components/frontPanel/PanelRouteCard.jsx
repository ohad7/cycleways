import React from "react";
import {
  routeDifficultyLabel,
  routeDisplayImage,
  routeShapeLabel,
} from "@cycleways/core/data/catalog.js";
import { routeImageSrc } from "../routes/routeImageSrc.js";
import { discoverRouteColor } from "@cycleways/core/map/discoverRouteColors.js";

// Minimal horizontal route card for the narrow Discover panel: thumbnail +
// title + a compact meta line (distance · level · via). The whole card opens
// the dedicated route page; the route page owns the explicit planner CTA.
export default function PanelRouteCard({ entry, places, onHover, index = 0, cardRef, distanceFromUserLabel = "" }) {
  const photo = routeDisplayImage(entry);
  const placeNames = routePlaceNames(entry, places, 2);
  const summary = typeof entry.summary === "string" ? entry.summary.trim() : "";
  return (
    <a
      ref={cardRef}
      className="panel-route-card-wrap"
      href={`/routes/${entry.slug}`}
      onMouseEnter={() => onHover?.(entry.slug)}
      onMouseLeave={() => onHover?.(null)}
      onFocus={() => onHover?.(entry.slug)}
      onBlur={() => onHover?.(null)}
      aria-label={`לעמוד המסלול ${entry.name}`}
    >
      <span className="panel-route-card">
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
      </span>
      <span
        className="panel-route-card__story-link"
      >
        לעמוד המסלול ←
      </span>
    </a>
  );
}

export function PanelRouteHeroCard({
  entry,
  places,
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
  ].filter(Boolean).slice(0, 3);

  return (
    <a
      ref={cardRef}
      className="panel-route-hero-wrap"
      href={`/routes/${entry.slug}`}
      onMouseEnter={() => onHover?.(entry.slug)}
      onMouseLeave={() => onHover?.(null)}
      onFocus={() => onHover?.(entry.slug)}
      onBlur={() => onHover?.(null)}
      aria-label={`לעמוד המסלול ${entry.name}`}
    >
      <span
        className={[
          "panel-route-hero",
          photo ? "panel-route-hero--image" : "",
        ].filter(Boolean).join(" ")}
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
          <span className="panel-route-hero__copy">
            <span className="panel-route-hero__title">{entry.name}</span>
          </span>
        </span>
      </span>
      <div className="panel-route-hero__details">
        {summary && <p className="panel-route-hero__summary">{summary}</p>}
        {meta.length ? (
          <div className="panel-route-hero__meta" aria-label="פרטי מסלול">
            {meta.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        ) : null}
        <div className="panel-route-hero__actions">
          <span
            className="panel-route-hero__story-link"
          >
            לעמוד המסלול
          </span>
        </div>
      </div>
    </a>
  );
}

function routePlaceNames(entry, places, limit) {
  return (entry?.passesNear || [])
    .map((id) => places.find((p) => p.id === id)?.name)
    .filter(Boolean)
    .slice(0, limit);
}
