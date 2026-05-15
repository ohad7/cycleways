import React from "react";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";

export default function FeaturedRouteHeader() {
  const { meta, routeState, status } = useFeaturedRoute();
  return (
    <header className="featured-route-header">
      {meta.hero && (
        <img className="featured-route-hero" src={meta.hero} alt={meta.name} />
      )}
      <div className="featured-route-header-body">
        <h1>{meta.name}</h1>
        {meta.summary && <p className="featured-route-summary">{meta.summary}</p>}
        {status === "ready" && (
          <div className="featured-route-stats">
            <span>📏 {(routeState.distance / 1000).toFixed(1)} ק"מ</span>
            <span>⬆️ {Math.round(routeState.elevationGain)} מ'</span>
            <span>⬇️ {Math.round(routeState.elevationLoss)} מ'</span>
          </div>
        )}
      </div>
    </header>
  );
}
