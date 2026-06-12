import React from "react";
import { routeDifficultyLabel } from "@cycleways/core/data/catalog.js";
import { discoverRouteColor } from "@cycleways/core/map/discoverRouteColors.js";

export default function DiscoverPeekPreview({ routes, onOpen, onSelect }) {
  if (!Array.isArray(routes) || routes.length === 0) return null;
  return (
    <div className="front-sheet__discover-peek" aria-label="מסלולים מומלצים">
      <button
        type="button"
        className="front-sheet__discover-head"
        onClick={onOpen}
      >
        <span>מסלולים מומלצים</span>
        <span>סינון וחיפוש</span>
      </button>
      <div className="front-sheet__route-chips">
        {routes.map((route, index) => (
          <button
            key={route.slug}
            type="button"
            className="front-sheet__route-chip"
            onClick={() => onSelect(route)}
          >
            <span
              className="front-sheet__route-chip-swatch"
              style={{ backgroundColor: discoverRouteColor(index) }}
              aria-hidden="true"
            />
            <span className="front-sheet__route-chip-text">
              <span className="front-sheet__route-chip-title">{route.name}</span>
              <span className="front-sheet__route-chip-meta">
                {route.distanceKm} ק״מ · {routeDifficultyLabel(route.difficulty)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
