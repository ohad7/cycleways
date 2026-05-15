import React, { useState } from "react";
import MapView from "../../map/MapView.jsx";
import { dataMarkerFeaturesFromSegments } from "../../map/mapLayers.js";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";

const MOBILE_QUERY = "(max-width: 767px)";

function useIsMobile() {
  const [match, setMatch] = useState(() =>
    typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches
  );
  React.useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = (e) => setMatch(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return match;
}

export default function FeaturedRouteMapSlot() {
  const isMobile = useIsMobile();
  const { assets, routeState, focusedPoiId, setFocusedPoiId } = useFeaturedRoute();
  const [fullscreen, setFullscreen] = useState(false);

  if (!isMobile || !assets) return null;

  const dataMarkerFeatures = dataMarkerFeaturesFromSegments(assets.segmentsData);
  const activeDataPointIds = routeState.activeDataPoints.map((p) => p.id);

  return (
    <>
      <div className={`featured-map-inline${fullscreen ? " featured-map-inline--hidden" : ""}`}>
        <MapView
          geoJsonData={assets.geoJsonData}
          dataMarkerFeatures={dataMarkerFeatures}
          activeDataPointIds={activeDataPointIds}
          routeGeometry={routeState.geometry}
          routePoints={routeState.points}
          onDataMarkerClick={(marker) => setFocusedPoiId(marker.id)}
        />
        <button
          type="button"
          className="featured-map-fullscreen-btn"
          onClick={() => setFullscreen(true)}
        >
          מפה מלאה
        </button>
      </div>
      {fullscreen && (
        <div className="featured-map-fullscreen-overlay" role="dialog" aria-modal="true">
          <button
            type="button"
            className="featured-map-fullscreen-close"
            onClick={() => setFullscreen(false)}
          >
            סגור
          </button>
          <MapView
            geoJsonData={assets.geoJsonData}
            dataMarkerFeatures={dataMarkerFeatures}
            activeDataPointIds={activeDataPointIds}
            routeGeometry={routeState.geometry}
            routePoints={routeState.points}
            onDataMarkerClick={(marker) => setFocusedPoiId(marker.id)}
          />
        </div>
      )}
    </>
  );
}
