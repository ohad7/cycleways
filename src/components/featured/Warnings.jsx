import React, { useMemo } from "react";
import { isWarningType, POI_EMOJIS, POI_LABELS } from "@cycleways/core/data/poiTypes.js";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";

export default function Warnings({ extra = [], hide = [] }) {
  const { routeState } = useFeaturedRoute();
  const hideSet = useMemo(() => new Set(hide), [hide]);
  const items = useMemo(() => {
    const auto = routeState.activeDataPoints
      .filter((p) => isWarningType(p.type))
      .filter((p) => !hideSet.has(p.id));
    return [...auto, ...extra];
  }, [routeState.activeDataPoints, hideSet, extra]);

  if (items.length === 0) return null;
  return (
    <section className="featured-warnings">
      <h2>אזהרות בדרך</h2>
      <ul>
        {items.map((w, i) => (
          <li key={w.id || i}>
            <span aria-hidden="true">{POI_EMOJIS[w.type] || "⚠️"}</span>{" "}
            <strong>{POI_LABELS[w.type] || w.type}:</strong> {w.information}
          </li>
        ))}
      </ul>
    </section>
  );
}
