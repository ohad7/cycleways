import React, { useMemo } from "react";
import { isWarningType } from "../../data/poiTypes.js";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";
import POICard from "./POICard.jsx";

export default function POIList({ exclude = [], extra = [], mode = "auto" }) {
  const { routeState, focusedPoiId, setFocusedPoiId } = useFeaturedRoute();
  const excludeSet = useMemo(() => new Set(exclude), [exclude]);

  const items = useMemo(() => {
    const auto = mode === "manual"
      ? []
      : routeState.activeDataPoints
          .filter((p) => !excludeSet.has(p.id))
          .filter((p) => !isWarningType(p.type));
    return [...auto, ...extra];
  }, [routeState.activeDataPoints, excludeSet, extra, mode]);

  if (items.length === 0) return null;

  return (
    <section className="poi-list">
      <h2>נקודות עניין בדרך</h2>
      <div className="poi-list-grid">
        {items.map((poi) => (
          <POICard
            key={poi.id || `${poi.type}-${poi.location?.join(",")}`}
            poi={poi}
            focused={focusedPoiId === poi.id}
            onSelect={(p) => setFocusedPoiId(p.id)}
          />
        ))}
      </div>
    </section>
  );
}
