import React from "react";
import {
  routeDifficultyLabel,
  routeDisplayImage,
} from "@cycleways/core/data/catalog.js";
import { routeImageSrc } from "../routes/routeImageSrc.js";
import { discoverRouteColor } from "@cycleways/core/map/discoverRouteColors.js";

// Minimal horizontal route card for the narrow Discover panel: thumbnail +
// title + a compact meta line (distance · level · via). The whole card loads
// the route into the planner. The richer RouteCard is for the wide /routes page.
export default function PanelRouteCard({ entry, places, onSelect, onHover, index = 0 }) {
  const photo = routeDisplayImage(entry);
  const placeNames = (entry.passesNear || [])
    .map((id) => places.find((p) => p.id === id)?.name)
    .filter(Boolean)
    .slice(0, 2);
  return (
    <button
      type="button"
      className="panel-route-card"
      onClick={() => onSelect(entry)}
      onMouseEnter={() => onHover?.(entry.slug)}
      onMouseLeave={() => onHover?.(null)}
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
          {placeNames.length > 0 && <span>· {placeNames.join(" · ")}</span>}
        </span>
      </span>
    </button>
  );
}
