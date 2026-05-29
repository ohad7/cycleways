import React, { useMemo } from "react";
import { isWarningType } from "@cycleways/core/data/poiTypes.js";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";
import POICard from "./POICard.jsx";
import { MOBILE_BREAKPOINT } from "./useIsMobile.js";

export default function POIList({ exclude = [], extra = [], mode = "auto" }) {
  const { routeState, focusedPoiId, setFocusedPoiId, setFocusedCoord } =
    useFeaturedRoute();
  const excludeSet = useMemo(() => new Set(exclude), [exclude]);

  const items = useMemo(() => {
    const auto = mode === "manual"
      ? []
      : routeState.activeDataPoints
          .filter((p) => !excludeSet.has(p.id))
          .filter((p) => !isWarningType(p.type));
    return [...auto, ...extra];
  }, [routeState.activeDataPoints, excludeSet, extra, mode]);

  function handleSelect(poi) {
    setFocusedPoiId(poi.id);
    if (
      poi.location &&
      Number.isFinite(poi.location[0]) &&
      Number.isFinite(poi.location[1])
    ) {
      const [lat, lng] = poi.location;
      setFocusedCoord({ lat, lng });
    }
    if (
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia(MOBILE_BREAKPOINT).matches
    ) {
      document.querySelector(".featured-map-inline")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }

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
            onSelect={(p) => handleSelect(p)}
          />
        ))}
      </div>
    </section>
  );
}
