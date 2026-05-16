import React, { useEffect, useMemo, useState } from "react";
import "./featured.css";
import { useIsMobile } from "./useIsMobile.js";
import { loadMapAssets } from "../../data/mapAssets.js";
import {
  createRouteManager,
  emptyRouteSnapshot,
  restoreRouteFromParam,
} from "../../routing/routeActions.js";
import MapView from "../../map/MapView.jsx";
import { dataMarkerFeaturesFromSegments } from "../../map/mapLayers.js";
import { FeaturedRouteContext } from "./FeaturedRouteContext.js";
import FeaturedRouteHeader from "./Header.jsx";
import POIList from "./POIList.jsx";
import Gallery from "./Gallery.jsx";
import VideoEmbed from "./VideoEmbed.jsx";
import Warnings from "./Warnings.jsx";
import FeaturedRouteMapSlot from "./FeaturedRouteMap.jsx";

function FeaturedRoute({ meta, children }) {
  const isMobile = useIsMobile();
  const [assets, setAssets] = useState(null);
  const [routeState, setRouteState] = useState(emptyRouteSnapshot());
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);
  const [focusedPoiId, setFocusedPoiId] = useState(null);
  const [focusedCoord, setFocusedCoord] = useState(null);
  const [routeFitRequest, setRouteFitRequest] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const loaded = await loadMapAssets({ signal: controller.signal });
        if (controller.signal.aborted) return;
        const manager = await createRouteManager(
          window.RouteManager,
          loaded.geoJsonData,
          loaded.segmentsData,
        );
        if (controller.signal.aborted) return;
        const snapshot = restoreRouteFromParam(
          manager,
          meta.route,
          loaded.segmentsData,
        );
        if (!snapshot) {
          throw new Error(`Featured route "${meta.slug}" failed to decode`);
        }
        setAssets({ ...loaded, manager });
        setRouteState(snapshot);
        setStatus("ready");
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err);
        setStatus("error");
      }
    })();
    return () => controller.abort();
  }, [meta.route, meta.slug]);

  useEffect(() => {
    if (status !== "ready" || routeState.geometry.length < 2) return;
    setRouteFitRequest({
      id: `featured-${meta.slug}-${Date.now()}`,
      geometry: routeState.geometry,
    });
  }, [status, meta.slug, routeState.geometry]);

  const contextValue = useMemo(
    () => ({
      meta,
      assets,
      routeState,
      status,
      error,
      focusedPoiId,
      setFocusedPoiId,
      focusedCoord,
      setFocusedCoord,
      routeFitRequest,
    }),
    [meta, assets, routeState, status, error, focusedPoiId, focusedCoord, routeFitRequest],
  );

  const focusedMarker = focusedCoord ? { coord: focusedCoord } : null;

  return (
    <FeaturedRouteContext.Provider value={contextValue}>
      <article className="featured-route">
        {status === "loading" && (
          <div className="page-card">
            <div className="featured-route-loading">טוען מסלול…</div>
          </div>
        )}
        {status === "error" && (
          <div className="page-card">
            <FeaturedRouteHeader />
            <div className="featured-route-error">שגיאה: {error?.message}</div>
          </div>
        )}
        {status === "ready" && (
          <div className="featured-route-split">
            <div className="featured-route-content-card">
              <FeaturedRouteHeader />
              <div className="featured-route-body">{children}</div>
            </div>
            {!isMobile && (
              <aside className="featured-route-sticky-map">
                <MapView
                  geoJsonData={assets.geoJsonData}
                  dataMarkerFeatures={dataMarkerFeaturesFromSegments(assets.segmentsData)}
                  activeDataPointIds={routeState.activeDataPoints.map((p) => p.id)}
                  routeGeometry={routeState.geometry}
                  routePoints={routeState.points}
                  routeFitRequest={routeFitRequest}
                  focusedMarker={focusedMarker}
                  onDataMarkerClick={(marker) => setFocusedPoiId(marker.id)}
                />
              </aside>
            )}
          </div>
        )}
      </article>
    </FeaturedRouteContext.Provider>
  );
}

FeaturedRoute.Map = FeaturedRouteMapSlot;
FeaturedRoute.POIs = POIList;
FeaturedRoute.Gallery = Gallery;
FeaturedRoute.Video = VideoEmbed;
FeaturedRoute.Warnings = Warnings;

export default FeaturedRoute;
