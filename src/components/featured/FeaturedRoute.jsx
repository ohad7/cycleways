import React, { useEffect, useMemo, useState } from "react";
import { loadMapAssets } from "../../data/mapAssets.js";
import {
  createRouteManager,
  emptyRouteSnapshot,
  restoreRouteFromParam,
} from "../../routing/routeActions.js";
import { FeaturedRouteContext } from "./FeaturedRouteContext.js";
import FeaturedRouteHeader from "./Header.jsx";

function FeaturedRoute({ meta, children }) {
  const [assets, setAssets] = useState(null);
  const [routeState, setRouteState] = useState(emptyRouteSnapshot());
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);
  const [focusedPoiId, setFocusedPoiId] = useState(null);

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

  const contextValue = useMemo(
    () => ({
      meta,
      assets,
      routeState,
      status,
      error,
      focusedPoiId,
      setFocusedPoiId,
    }),
    [meta, assets, routeState, status, error, focusedPoiId],
  );

  return (
    <FeaturedRouteContext.Provider value={contextValue}>
      <article className="featured-route">
        <FeaturedRouteHeader />
        {status === "loading" && <div className="featured-route-loading">טוען מסלול…</div>}
        {status === "error" && (
          <div className="featured-route-error">שגיאה: {error?.message}</div>
        )}
        {status === "ready" && (
          <div className="featured-route-body">{children}</div>
        )}
      </article>
    </FeaturedRouteContext.Provider>
  );
}

// Slot placeholders — filled in Phase 4. These exist so authored modules can
// reference them now without crashing.
FeaturedRoute.Map = function FeaturedRouteMapSlot() { return null; };
FeaturedRoute.POIs = function FeaturedRoutePOIsSlot() { return null; };
FeaturedRoute.Gallery = function FeaturedRouteGallerySlot() { return null; };
FeaturedRoute.Video = function FeaturedRouteVideoSlot() { return null; };
FeaturedRoute.Warnings = function FeaturedRouteWarningsSlot() { return null; };

export default FeaturedRoute;
