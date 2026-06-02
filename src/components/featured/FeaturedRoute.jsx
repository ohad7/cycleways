import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./featured.css";
import { useIsMobile } from "./useIsMobile.js";
import RouteManager from "@cycleways/core/route-manager.js";
import { loadMapAssets } from "@cycleways/core/data/mapAssets.js";
import {
  createRouteManager,
  emptyRouteSnapshot,
  restoreRouteFromParam,
} from "@cycleways/core/routing/routeActions.js";
import MapView from "../../map/MapView.jsx";
import { dataMarkerFeaturesFromSegments } from "@cycleways/core/data/dataMarkers.js";
import { FeaturedRouteContext } from "./FeaturedRouteContext.js";
import FeaturedRouteHeader from "./Header.jsx";
import POIList from "./POIList.jsx";
import Gallery from "./Gallery.jsx";
import VideoEmbed from "./VideoEmbed.jsx";
import Warnings from "./Warnings.jsx";
import FeaturedRouteMapSlot from "./FeaturedRouteMap.jsx";
import RoutePoiGallery from "./RoutePoiGallery.jsx";
import { findFeaturedMeta } from "../../featured/index.js";

function FeaturedRoute({ slug, children, layout = "article", desktopMap = "sticky" }) {
  const isMobile = useIsMobile();
  const [meta, setMeta] = useState(null);
  const [assets, setAssets] = useState(null);
  const [routeState, setRouteState] = useState(emptyRouteSnapshot());
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);
  const [focusedPoiId, setFocusedPoiId] = useState(null);
  const [focusedCoord, setFocusedCoord] = useState(null);
  const [routeFitRequest, setRouteFitRequest] = useState(null);
  const [videoCursor, setVideoCursor] = useState(null);
  const videoSyncRef = useRef(null);
  const playerSeekRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const found = await findFeaturedMeta(slug);
      if (cancelled) return;
      if (!found) {
        setError(new Error(`featured route "${slug}" not found in catalog`));
        setStatus("error");
        return;
      }
      setMeta(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (!meta) return;
    const controller = new AbortController();
    (async () => {
      try {
        const loaded = await loadMapAssets({ signal: controller.signal });
        if (controller.signal.aborted) return;
        const manager = await createRouteManager(
          RouteManager,
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
  }, [meta]);

  useEffect(() => {
    if (!meta || status !== "ready" || routeState.geometry.length < 2) return;
    setRouteFitRequest({
      id: `featured-${meta.slug}-${Date.now()}`,
      geometry: routeState.geometry,
    });
  }, [status, meta, routeState.geometry]);

  const handleRouteClick = useCallback((latLng) => {
    const sync = videoSyncRef.current;
    const seek = playerSeekRef.current;
    if (!sync || !seek) return;
    const snap = sync.snapClickToRoute(latLng);
    if (!snap) return;
    const t = sync.positionToTime(snap.fraction);
    seek(t);
  }, []);

  const handleDataMarkerClick = useCallback((marker) => {
    setFocusedPoiId(marker.id);
    if (Number.isFinite(marker.lat) && Number.isFinite(marker.lng)) {
      setFocusedCoord({ lat: marker.lat, lng: marker.lng });
    }
  }, []);

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
      videoCursor,
      setVideoCursor,
      videoSyncRef,
      playerSeekRef,
      handleRouteClick,
    }),
    [meta, assets, routeState, status, error, focusedPoiId, focusedCoord, routeFitRequest, videoCursor, handleRouteClick],
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
        {status === "ready" && layout === "video-first" && (
          <div className="featured-route-video-first">
            <FeaturedRouteHeader />
            <div className="featured-route-body featured-route-body--video-first">{children}</div>
          </div>
        )}
        {status === "ready" && layout !== "video-first" && (
          <div className="featured-route-split">
            <div className="featured-route-content-card">
              <FeaturedRouteHeader />
              <div className="featured-route-body">{children}</div>
            </div>
            {!isMobile && desktopMap === "sticky" && (
              <aside className="featured-route-sticky-map">
                <MapView
                  geoJsonData={assets.geoJsonData}
                  dataMarkerFeatures={dataMarkerFeaturesFromSegments(assets.segmentsData)}
                  activeDataPointIds={routeState.activeDataPoints.map((p) => p.id)}
                  routeGeometry={routeState.geometry}
                  routePoints={routeState.points}
                  routeFitRequest={routeFitRequest}
                  focusedMarker={focusedMarker}
                  onDataMarkerClick={handleDataMarkerClick}
                  videoCursor={videoCursor}
                  onRouteClick={handleRouteClick}
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
FeaturedRoute.POIGallery = RoutePoiGallery;
FeaturedRoute.Video = VideoEmbed;
FeaturedRoute.Warnings = Warnings;

export default FeaturedRoute;
