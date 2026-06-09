import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./featured.css";
import { useIsMobile } from "./useIsMobile.js";
import { emptyRouteSnapshot } from "@cycleways/core/routing/routeSnapshot.js";
import {
  loadFeaturedRouteSnapshot,
  snapshotToRouteState,
} from "@cycleways/core/data/featuredRouteSnapshots.js";
import MapView from "../../map/MapView.jsx";
import { computeOverlayFitPadding } from "../../map/routeFitPadding.js";
import { FeaturedRouteContext } from "./FeaturedRouteContext.js";
import FeaturedRouteHeader from "./Header.jsx";
import POIList from "./POIList.jsx";
import Gallery from "./Gallery.jsx";
import VideoEmbed from "./VideoEmbed.jsx";
import Warnings from "./Warnings.jsx";
import FeaturedRouteMapSlot from "./FeaturedRouteMap.jsx";
import RoutePoiGallery from "./RoutePoiGallery.jsx";
import RoutePoiStoryList from "./RoutePoiStoryList.jsx";
import RoutePoiVideoPreview from "./RoutePoiVideoPreview.jsx";
import RouteMapPlayback from "./RouteMapPlayback.jsx";
import RouteProgressDistance from "./RouteProgressDistance.jsx";
import { findRouteMeta } from "../../featured/index.js";

function FeaturedRoute({ slug, children, layout = "article", desktopMap = "sticky", kicker = null }) {
  const isMobile = useIsMobile();
  const [meta, setMeta] = useState(null);
  const [dataMarkerFeatures, setDataMarkerFeatures] = useState([]);
  const [activeDataPointIds, setActiveDataPointIds] = useState([]);
  const [routeState, setRouteState] = useState(emptyRouteSnapshot());
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);
  const [focusedPoiId, setFocusedPoiId] = useState(null);
  const [focusedCoord, setFocusedCoord] = useState(null);
  const [routeFitRequest, setRouteFitRequest] = useState(null);
  const mapContainerRef = useRef(null);
  const routeFitOverlaysRef = useRef(null);
  const registerRouteFitOverlays = useCallback((config) => {
    routeFitOverlaysRef.current = config;
  }, []);
  const [videoCursor, setVideoCursor] = useState(null);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const videoSyncRef = useRef(null);
  const playerSeekRef = useRef(null);
  const playerPlayRef = useRef(null);
  const playerPauseRef = useRef(null);
  const wasVideoPlayingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const found = await findRouteMeta(slug);
      if (cancelled) return;
      if (!found) {
        setError(new Error(`route "${slug}" not found in catalog`));
        setStatus("error");
        return;
      }
      setMeta(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Set the document title to the route name so each featured page is
  // distinguishable (and shareable) rather than inheriting the front-page
  // title. Restore the original on unmount when navigating away.
  useEffect(() => {
    if (!meta?.name) return undefined;
    const previousTitle = document.title;
    document.title = `${meta.name} | מפת שבילי אופניים - גליל עליון וגולן`;
    return () => {
      document.title = previousTitle;
    };
  }, [meta?.name]);

  useEffect(() => {
    if (!meta) return;
    const controller = new AbortController();
    (async () => {
      try {
        const snapshot = await loadFeaturedRouteSnapshot(meta.slug, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setRouteState(snapshotToRouteState(snapshot));
        setDataMarkerFeatures(snapshot.pois?.dataMarkerFeatures || []);
        setActiveDataPointIds(snapshot.pois?.activeDataPointIds || []);
        setStatus("ready");
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err);
        setStatus("error");
      }
    })();
    return () => controller.abort();
  }, [meta]);

  const requestRouteFit = useCallback((reason = "featured-route-fit", { padding } = {}) => {
    if (!meta || routeState.geometry.length < 2) return;
    let resolvedPadding = padding;
    if (!resolvedPadding && routeFitOverlaysRef.current && mapContainerRef.current) {
      const { registry, getScopeEl } = routeFitOverlaysRef.current;
      resolvedPadding = computeOverlayFitPadding({
        mapEl: mapContainerRef.current,
        registry,
        scopeEl: getScopeEl?.(),
      });
    }
    setRouteFitRequest({
      id: `${reason}-${meta.slug}-${Date.now()}`,
      geometry: routeState.geometry,
      ...(resolvedPadding ? { padding: resolvedPadding } : {}),
    });
  }, [meta, routeState.geometry]);

  useEffect(() => {
    if (!meta || status !== "ready" || routeState.geometry.length < 2) return;
    requestRouteFit("featured");
  }, [status, meta, routeState.geometry, requestRouteFit]);

  useEffect(() => {
    if (!videoPlaying) {
      wasVideoPlayingRef.current = false;
      return;
    }
    if (wasVideoPlayingRef.current) return;
    wasVideoPlayingRef.current = true;
    if (!focusedCoord || !meta || routeState.geometry.length < 2) return;
    setFocusedCoord(null);
    requestRouteFit("featured-video-resume");
  }, [videoPlaying, focusedCoord, meta, routeState.geometry, requestRouteFit]);

  const setVideoCursorFromFraction = useCallback((fraction, fallbackCoord = null) => {
    if (!Number.isFinite(fraction)) return;

    const sync = videoSyncRef.current;
    let t = null;
    let pos = null;
    if (sync) {
      t = sync.positionToTime(fraction);
      if (Number.isFinite(t)) {
        pos = sync.timeToPosition(t);
      }
    }

    const lat = Number.isFinite(pos?.lat) ? pos.lat : fallbackCoord?.lat;
    const lng = Number.isFinite(pos?.lng) ? pos.lng : fallbackCoord?.lng;
    const cursor = {
      fraction: Number.isFinite(pos?.fraction) ? pos.fraction : fraction,
    };
    if (Number.isFinite(t)) cursor.t = t;
    if (Number.isFinite(lat)) cursor.lat = lat;
    if (Number.isFinite(lng)) cursor.lng = lng;

    setVideoCursor(cursor);
  }, []);

  const seekVideoToFraction = useCallback((fraction, fallbackCoord = null) => {
    if (!Number.isFinite(fraction)) return;

    const sync = videoSyncRef.current;
    const seek = playerSeekRef.current;
    if (sync && seek) {
      seek(sync.positionToTime(fraction));
    }
    setVideoCursorFromFraction(fraction, fallbackCoord);
  }, [setVideoCursorFromFraction]);

  const handleRouteClick = useCallback((latLng) => {
    const sync = videoSyncRef.current;
    const seek = playerSeekRef.current;
    if (!sync || !seek) return;
    const snap = sync.snapClickToRoute(latLng);
    if (!snap) return;
    const t = sync.positionToTime(snap.fraction);
    seek(t);
    setVideoCursorFromFraction(snap.fraction);
    playerPauseRef.current?.();
  }, [setVideoCursorFromFraction]);

  const handleDataMarkerClick = useCallback((marker) => {
    setFocusedPoiId(marker.id);
    const matchingPoint = routeState.activeDataPoints.find((p) => p.id === marker.id);
    let fallbackCoord = null;
    if (Number.isFinite(marker.lat) && Number.isFinite(marker.lng)) {
      fallbackCoord = { lat: marker.lat, lng: marker.lng };
      setFocusedCoord(fallbackCoord);
    }
    const sync = videoSyncRef.current;
    const seek = playerSeekRef.current;
    let fraction = Number.isFinite(matchingPoint?.routeFraction)
      ? matchingPoint.routeFraction
      : null;
    if (sync && seek && Number.isFinite(marker.lat) && Number.isFinite(marker.lng)) {
      const snap = sync.snapClickToRoute({ lat: marker.lat, lng: marker.lng });
      if (snap && Number.isFinite(snap.fraction)) {
        fraction = snap.fraction;
        seek(sync.positionToTime(fraction));
      }
    }
    setVideoCursorFromFraction(fraction, fallbackCoord);
    playerPauseRef.current?.();
  }, [routeState.activeDataPoints, setVideoCursorFromFraction]);

  const contextValue = useMemo(
    () => ({
      meta,
      kicker,
      dataMarkerFeatures,
      activeDataPointIds,
      routeState,
      status,
      error,
      focusedPoiId,
      setFocusedPoiId,
      focusedCoord,
      setFocusedCoord,
      routeFitRequest,
      requestRouteFit,
      registerRouteFitOverlays,
      mapContainerRef,
      videoCursor,
      setVideoCursor,
      setVideoCursorFromFraction,
      videoPlaying,
      setVideoPlaying,
      seekVideoToFraction,
      videoSyncRef,
      playerSeekRef,
      playerPlayRef,
      playerPauseRef,
      handleRouteClick,
      handleDataMarkerClick,
    }),
    [meta, kicker, dataMarkerFeatures, activeDataPointIds, routeState, status, error, focusedPoiId, focusedCoord, routeFitRequest, requestRouteFit, registerRouteFitOverlays, mapContainerRef, videoCursor, videoPlaying, setVideoCursorFromFraction, seekVideoToFraction, handleRouteClick, handleDataMarkerClick],
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
            {meta && <FeaturedRouteHeader />}
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
                  mode="readonly-route"
                  dataMarkerFeatures={dataMarkerFeatures}
                  activeDataPointIds={activeDataPointIds}
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
FeaturedRoute.POIStories = RoutePoiStoryList;
FeaturedRoute.POIVideoPreview = RoutePoiVideoPreview;
FeaturedRoute.MapPlayback = RouteMapPlayback;
FeaturedRoute.ProgressDistance = RouteProgressDistance;
FeaturedRoute.Video = VideoEmbed;
FeaturedRoute.Warnings = Warnings;

export default FeaturedRoute;
