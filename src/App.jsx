import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import ContentSections from "./components/ContentSections.jsx";
import DownloadModal from "./components/DownloadModal.jsx";
import { getRouteMessage } from "./components/RoutePanel.jsx";
import TopBar from "./components/TopBar.jsx";
import Tutorial from "./components/Tutorial.jsx";
import { getFeatureFlags } from "./config/featureFlags.js";
import { loadMapAssets, summarizeMapAssets } from "./data/mapAssets.js";
import MapView from "./map/MapView.jsx";
import { dataMarkerFeaturesFromSegments } from "./map/mapLayers.js";
import {
  addPoint,
  applyRouteSnapshot,
  buildShareUrl,
  clearRoute,
  createRouteManager,
  dragPoint,
  removePoint,
  routeStateSnapshot,
  restoreRouteFromParam,
} from "./routing/routeActions.js";
import {
  initialRouteState,
  routeReducer,
} from "./routing/routeReducer.js";
import { executeDownloadGPX, generateGPX } from "../utils/gpx-generator.js";
import { smoothElevations } from "../utils/elevations.js";
import {
  trackRouteOperation,
  trackRoutePointEvent,
  trackSearchEvent,
  trackTutorial,
  trackUndoRedoEvent,
} from "../utils/analytics.js";
import { getDistance } from "../utils/distance.js";
import "./react-app.css";

function App() {
  const [state, setState] = useState({
    status: "loading",
    assets: null,
    summary: null,
    error: null,
  });
  const [mapUi, setMapUi] = useState({
    downloadModalOpen: false,
    routeFitRequest: null,
    searchError: null,
    searchHighlight: null,
    searchQuery: "",
    searchStatus: "idle",
    selectedRoutePointIndex: null,
    selectedDataMarker: null,
    elevationHover: null,
    tutorialOpen: false,
    mobileMenuOpen: false,
  });
  const routeManagerRef = useRef(null);
  const dragStartSnapshotRef = useRef(null);
  const [routeState, dispatchRoute] = useReducer(
    routeReducer,
    initialRouteState,
  );
  const [routeHistory, setRouteHistory] = useState({
    past: [],
    future: [],
  });

  useEffect(() => {
    if (!routeState.error) return undefined;

    const timeoutId = window.setTimeout(() => {
      dispatchRoute({ type: "route/clearError" });
    }, 3500);

    return () => window.clearTimeout(timeoutId);
  }, [routeState.error]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setState({ status: "loading", assets: null, summary: null, error: null });
      try {
        const assets = await loadMapAssets({ signal: controller.signal });
        if (controller.signal.aborted) return;
        setState({
          status: "ready",
          assets,
          summary: summarizeMapAssets(assets),
          error: null,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          assets: null,
          summary: null,
          error,
        });
      }
    }

    load();

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (state.status !== "ready") return undefined;

    let disposed = false;

    async function initializeRouting() {
      try {
        const manager = await createRouteManager(
          window.RouteManager,
          state.assets.geoJsonData,
          state.assets.segmentsData,
        );
        if (disposed) return;

        routeManagerRef.current = manager;
        dispatchRoute({ type: "route/managerReady" });

        const routeParam = new URLSearchParams(window.location.search).get(
          "route",
        );
        if (routeParam) {
          const snapshot = restoreRouteFromParam(
            manager,
            routeParam,
            state.assets.segmentsData,
          );
          if (snapshot) {
            dispatchRoute({ type: "route/update", snapshot });
            setMapUi((current) => ({
              ...current,
              routeFitRequest: {
                id: `restore-${Date.now()}`,
                geometry: snapshot.geometry,
              },
            }));
          }
        }
      } catch (error) {
        if (disposed) return;
        dispatchRoute({ type: "route/error", error });
      }
    }

    initializeRouting();

    return () => {
      disposed = true;
      routeManagerRef.current = null;
    };
  }, [state.assets, state.status]);

  const handleSegmentHover = useCallback((segmentName) => {
    dispatchRoute({ type: "route/setHoveredSegment", segmentName });
  }, []);

  const handleSegmentFocus = useCallback((segmentName) => {
    dispatchRoute({ type: "route/setFocusedSegment", segmentName });
  }, []);

  const handleElevationHover = useCallback((elevationHover) => {
    setMapUi((current) => ({
      ...current,
      elevationHover,
    }));
  }, []);

  const clearRouteUrl = useCallback(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("route")) return;

    url.searchParams.delete("route");
    window.history.replaceState(null, "", url.toString());
  }, []);

  const commitRouteSnapshot = useCallback(
    (snapshot, options = {}) => {
      const { clearUrl = true, recordHistory = true } = options;
      if (recordHistory) {
        setRouteHistory((current) => ({
          past: [...current.past, routeStateSnapshot(routeState)],
          future: [],
        }));
      }

      dispatchRoute({ type: "route/update", snapshot });
      setMapUi((current) => ({
        ...current,
        selectedRoutePointIndex: null,
      }));

      if (clearUrl) {
        clearRouteUrl();
      }
    },
    [clearRouteUrl, routeState],
  );

  const handleMapClick = useCallback((point) => {
    if (!routeManagerRef.current || state.status !== "ready") return;

    try {
      const snapshot = addPoint(
        routeManagerRef.current,
        point,
        state.assets.segmentsData,
      );
      if (snapshot.points.length === routeState.points.length) {
        dispatchRoute({
          type: "route/error",
          error: new Error(
            "הנקודה רחוקה מדי מרשת CycleWays. בחרו נקודה ליד שביל מסומן.",
          ),
        });
        return;
      }

      commitRouteSnapshot(snapshot);
      trackRoutePointEvent(snapshot.points, snapshot.selectedSegments, "click");
    } catch (error) {
      dispatchRoute({ type: "route/error", error });
    }
  }, [commitRouteSnapshot, routeState.points.length, state.assets, state.status]);

  const handleRoutePointDragStart = useCallback(() => {
    dragStartSnapshotRef.current = routeStateSnapshot(routeState);
  }, [routeState]);

  const handleRoutePointDrag = useCallback((index, point) => {
    if (!routeManagerRef.current || state.status !== "ready") return;

    try {
      const snapshot = dragPoint(
        routeManagerRef.current,
        routeState.points,
        index,
        point,
        state.assets.segmentsData,
      );
      dispatchRoute({ type: "route/update", snapshot });
      clearRouteUrl();
    } catch (error) {
      dispatchRoute({ type: "route/error", error });
    }
  }, [clearRouteUrl, routeState.points, state.assets, state.status]);

  const handleRoutePointDragEnd = useCallback(() => {
    if (!dragStartSnapshotRef.current) return;

    const startSnapshot = dragStartSnapshotRef.current;
    dragStartSnapshotRef.current = null;
    setRouteHistory((current) => ({
      past: [...current.past, startSnapshot],
      future: [],
    }));
    trackRoutePointEvent(routeState.points, routeState.selectedSegments, "drag");
  }, [routeState.points, routeState.selectedSegments]);

  const handleRoutePointRemove = useCallback((index) => {
    if (!routeManagerRef.current || state.status !== "ready") return;

    try {
      const snapshot = removePoint(
        routeManagerRef.current,
        index,
        state.assets.segmentsData,
      );
      commitRouteSnapshot(snapshot);
      trackRoutePointEvent(snapshot.points, snapshot.selectedSegments, "remove");
    } catch (error) {
      dispatchRoute({ type: "route/error", error });
    }
  }, [commitRouteSnapshot, state.assets, state.status]);

  const handleRouteClear = useCallback(() => {
    if (!routeManagerRef.current) {
      dispatchRoute({ type: "route/clear" });
      return;
    }

    const previousSnapshot = routeStateSnapshot(routeState);
    const snapshot = clearRoute(routeManagerRef.current);
    setRouteHistory((current) => ({
      past: [...current.past, previousSnapshot],
      future: [],
    }));
    dispatchRoute({ type: "route/update", snapshot });
    setMapUi((current) => ({
      ...current,
      selectedRoutePointIndex: null,
    }));
    clearRouteUrl();
    trackRouteOperation("reset", previousSnapshot.points, previousSnapshot.selectedSegments, {
      cleared_points: previousSnapshot.points.length,
      cleared_segments: previousSnapshot.selectedSegments.length,
    });
  }, [clearRouteUrl, routeState]);

  const restoreHistorySnapshot = useCallback(
    (snapshot, action) => {
      if (!routeManagerRef.current) return;

      applyRouteSnapshot(routeManagerRef.current, snapshot);
      dispatchRoute({ type: "route/update", snapshot });
      setMapUi((current) => ({
        ...current,
        selectedRoutePointIndex: null,
      }));
      clearRouteUrl();
      trackUndoRedoEvent(
        action,
        routeHistory.past,
        routeHistory.future,
        snapshot.points,
        snapshot.selectedSegments,
      );
    },
    [clearRouteUrl, routeHistory.future, routeHistory.past],
  );

  const handleUndo = useCallback(() => {
    if (routeHistory.past.length === 0) return;

    const previous = routeHistory.past[routeHistory.past.length - 1];
    const currentSnapshot = routeStateSnapshot(routeState);
    setRouteHistory((current) => ({
      past: current.past.slice(0, -1),
      future: [currentSnapshot, ...current.future],
    }));
    restoreHistorySnapshot(previous, "undo");
  }, [restoreHistorySnapshot, routeHistory.past, routeState]);

  const handleRedo = useCallback(() => {
    if (routeHistory.future.length === 0) return;

    const next = routeHistory.future[0];
    const currentSnapshot = routeStateSnapshot(routeState);
    setRouteHistory((current) => ({
      past: [...current.past, currentSnapshot],
      future: current.future.slice(1),
    }));
    restoreHistorySnapshot(next, "redo");
  }, [restoreHistorySnapshot, routeHistory.future, routeState]);

  const handleOpenDownload = useCallback(() => {
    setMapUi((current) => ({
      ...current,
      downloadModalOpen: true,
    }));
  }, []);

  const handleCloseDownload = useCallback(() => {
    setMapUi((current) => ({
      ...current,
      downloadModalOpen: false,
    }));
  }, []);

  const handleOpenTutorial = useCallback(() => {
    setMapUi((current) => ({
      ...current,
      tutorialOpen: true,
    }));
    trackTutorial(
      "started",
      routeState.selectedSegments.length > 0,
      "help_button",
    );
  }, [routeState.selectedSegments.length]);

  const handleCloseTutorial = useCallback(() => {
    setMapUi((current) => ({
      ...current,
      tutorialOpen: false,
    }));
  }, []);

  const handleMobileMenuToggle = useCallback(() => {
    setMapUi((current) => ({
      ...current,
      mobileMenuOpen: !current.mobileMenuOpen,
    }));
  }, []);

  const handleDataMarkerClick = useCallback((dataMarker) => {
    setMapUi((current) => ({
      ...current,
      selectedDataMarker: dataMarker,
    }));
  }, []);

  const handleRoutePointSelect = useCallback((index) => {
    setMapUi((current) => ({
      ...current,
      selectedRoutePointIndex: index,
    }));
  }, []);

  const handleSearchQueryChange = useCallback((query) => {
    setMapUi((current) => ({
      ...current,
      searchError: null,
      searchQuery: query,
    }));
  }, []);

  const handleSearchSubmit = useCallback(
    async (event) => {
      event.preventDefault();

      const query = mapUi.searchQuery.trim();
      if (!query) {
        setMapUi((current) => ({
          ...current,
          searchError: "נא להכניס מיקום לחיפוש",
        }));
        return;
      }

      trackSearchEvent(query, routeState.points, routeState.selectedSegments);
      setMapUi((current) => ({
        ...current,
        searchError: null,
        searchStatus: "searching",
      }));

      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`,
        );
        const results = await response.json();
        const result = Array.isArray(results) ? results[0] : null;
        if (!result) {
          setMapUi((current) => ({
            ...current,
            searchError: "מיקום לא נמצא. נא לנסות מונח חיפוש אחר.",
            searchStatus: "idle",
          }));
          return;
        }

        const lat = Number(result.lat);
        const lng = Number(result.lon);
        const bounds = getGeoJsonCoordinateBounds(state.assets.geoJsonData);
        const withinBounds = isPointWithinBounds({ lat, lng }, bounds);
        if (!withinBounds) {
          setMapUi((current) => ({
            ...current,
            searchError: "המיקום מחוץ לאזור מפת CycleWays.",
            searchStatus: "idle",
          }));
          trackSearchEvent(query, routeState.points, routeState.selectedSegments, true, {
            lat,
            lng,
            within_bounds: false,
          });
          return;
        }

        setMapUi((current) => ({
          ...current,
          searchError: null,
          searchHighlight: {
            id: `search-${Date.now()}`,
            label: result.display_name || query,
            lat,
            lng,
          },
          searchQuery: "",
          searchStatus: "idle",
        }));
        trackSearchEvent(query, routeState.points, routeState.selectedSegments, true, {
          lat,
          lng,
          within_bounds: true,
        });
      } catch (error) {
        setMapUi((current) => ({
          ...current,
          searchError: "שגיאה בחיפוש מיקום. נא לנסות שוב.",
          searchStatus: "idle",
        }));
      }
    },
    [
      mapUi.searchQuery,
      routeState.points,
      routeState.selectedSegments,
      state.assets,
    ],
  );

  useEffect(() => {
    const selectedIndex = mapUi.selectedRoutePointIndex;
    if (
      selectedIndex !== null &&
      (selectedIndex < 0 || selectedIndex >= routeState.points.length)
    ) {
      setMapUi((current) => ({
        ...current,
        selectedRoutePointIndex: null,
      }));
    }
  }, [mapUi.selectedRoutePointIndex, routeState.points.length]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setMapUi((current) => ({
          ...current,
          downloadModalOpen: false,
          tutorialOpen: false,
        }));
        return;
      }

      const isUndo =
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        event.key.toLowerCase() === "z";
      const isRedo =
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "z";

      if (isUndo) {
        event.preventDefault();
        handleUndo();
      } else if (isRedo) {
        event.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleRedo, handleUndo]);

  const inspectedSegment = mapUi.elevationHover
    ? null
    : routeState.focusedSegment || routeState.hoveredSegment || null;
  const dataMarkerFeatures = useMemo(
    () =>
      state.status === "ready"
        ? dataMarkerFeaturesFromSegments(state.assets.segmentsData)
        : [],
    [state.assets, state.status],
  );
  const activeDataPointIds = useMemo(
    () => routeState.activeDataPoints.map((dataPoint) => dataPoint.id),
    [routeState.activeDataPoints],
  );
  const shareUrl = useMemo(() => {
    if (
      state.status !== "ready" ||
      routeState.points.length === 0 ||
      !routeManagerRef.current
    ) {
      return "";
    }

    return buildShareUrl(
      routeState,
      state.assets.segmentsData,
      routeManagerRef.current,
      window.location,
    );
  }, [routeState, state.assets, state.status]);
  const featureFlags = useMemo(() => getFeatureFlags(), []);
  const canDownload = routeState.geometry.length >= 2;
  const canUndo = routeHistory.past.length > 0;
  const canRedo = routeHistory.future.length > 0;
  const inspectedSegmentDetails = useMemo(() => {
    if (state.status !== "ready" || !inspectedSegment) return null;
    return getSegmentDetails(
      inspectedSegment,
      state.assets.geoJsonData,
      state.assets.segmentsData,
      routeManagerRef.current,
    );
  }, [inspectedSegment, state.assets, state.status]);
  const handleDownloadGpx = useCallback(() => {
    if (routeState.geometry.length < 2) return;

    const routeParam = shareUrl
      ? new URL(shareUrl).searchParams.get("route")
      : "";
    const filename = routeParam
      ? `route_${routeParam.substring(0, 32)}.gpx`
      : "bike_route.gpx";
    trackRouteOperation("download", routeState.points, routeState.selectedSegments, {
      distance: routeState.distance,
    });
    executeDownloadGPX(generateGPX(routeState.geometry), filename);
    handleCloseDownload();
  }, [
    handleCloseDownload,
    routeState.distance,
    routeState.geometry,
    routeState.points,
    routeState.selectedSegments,
    shareUrl,
  ]);

  const hasBrokenRoute =
    routeState.points.length >= 2 && routeState.geometry.length < 2;

  return (
    <>
      <TopBar
        mobileMenuOpen={mapUi.mobileMenuOpen}
        onMobileMenuToggle={handleMobileMenuToggle}
        onOpenTutorial={handleOpenTutorial}
      />

      <div className="main-container react-main-container">
        <div
          id="error-message"
          className={state.status === "error" ? "show" : ""}
          role={state.status === "error" ? "alert" : undefined}
        >
          {state.status === "error" ? (
            <ErrorState error={state.error} />
          ) : null}
        </div>

        <div className="container">
          <div className="map-container">
            {state.status === "loading" && <LoadingState />}
            {state.status === "ready" && (
              <>
                <div className="search-container">
                  <form
                    className="search-input-group"
                    onSubmit={handleSearchSubmit}
                  >
                    <button
                      id="search-btn"
                      type="submit"
                      disabled={mapUi.searchStatus === "searching"}
                      title="חיפוש מיקום"
                      aria-label="חיפוש"
                    >
                      <ion-icon name="search-outline" />
                    </button>
                    <input
                      id="location-search"
                      type="text"
                      placeholder="ישוב/עיר, לדוגמא: דפנה"
                      value={mapUi.searchQuery}
                      onChange={(event) =>
                        handleSearchQueryChange(event.target.value)
                      }
                    />
                  </form>
                  <div className="top-controls">
                    <div className="control-buttons">
                      <button
                        id="undo-btn"
                        className="control-btn"
                        disabled={!canUndo}
                        type="button"
                        title="ביטול (Ctrl+Z)"
                        aria-label="ביטול"
                        onClick={handleUndo}
                      >
                        <ion-icon name="arrow-undo-outline" />
                      </button>
                      <button
                        id="redo-btn"
                        className="control-btn"
                        disabled={!canRedo}
                        type="button"
                        title="חזרה (Ctrl+Shift+Z)"
                        aria-label="חזרה"
                        onClick={handleRedo}
                      >
                        <ion-icon name="arrow-redo-outline" />
                      </button>
                      <button
                        id="reset-btn"
                        className="control-btn"
                        disabled={routeState.points.length === 0}
                        type="button"
                        title="איפוס מסלול"
                        aria-label="איפוס מסלול"
                        onClick={handleRouteClear}
                      >
                        <ion-icon name="trash-outline" />
                      </button>
                      <button
                        id="download-gpx"
                        className="control-btn gpx-download-button"
                        disabled={!canDownload}
                        type="button"
                        title="סיכום, GPX, ושיתוף המסלול"
                        onClick={handleOpenDownload}
                      >
                        סיכום
                      </button>
                    </div>
                  </div>
                </div>

                <MapLegend
                  activeDataPoints={routeState.activeDataPoints}
                  hasBrokenRoute={hasBrokenRoute}
                  selectedDataMarker={mapUi.selectedDataMarker}
                />

                {mapUi.searchError && (
                  <div id="search-error" className="react-search-error">
                    {mapUi.searchError}
                  </div>
                )}

                <MapView
                  activeDataPointIds={activeDataPointIds}
                  dataMarkerFeatures={dataMarkerFeatures}
                  elevationHover={mapUi.elevationHover}
                  focusedSegment={routeState.focusedSegment}
                  geoJsonData={state.assets.geoJsonData}
                  hoveredSegment={routeState.hoveredSegment}
                  onDataMarkerClick={handleDataMarkerClick}
                  onMapClick={handleMapClick}
                  onRoutePointDrag={handleRoutePointDrag}
                  onRoutePointDragEnd={handleRoutePointDragEnd}
                  onRoutePointDragStart={handleRoutePointDragStart}
                  onRoutePointRemove={handleRoutePointRemove}
                  onRoutePointSelect={handleRoutePointSelect}
                  onSegmentFocus={handleSegmentFocus}
                  onSegmentHover={handleSegmentHover}
                  routeFitRequest={mapUi.routeFitRequest}
                  routeGeometry={routeState.geometry}
                  routePoints={routeState.points}
                  searchHighlight={mapUi.searchHighlight}
                  selectedRoutePointIndex={mapUi.selectedRoutePointIndex}
                />

                <RouteDescription
                  error={routeState.error}
                  hasBrokenRoute={hasBrokenRoute}
                  routeState={routeState}
                  selectedRoutePointIndex={mapUi.selectedRoutePointIndex}
                  onElevationHover={handleElevationHover}
                  onRemoveRoutePoint={handleRoutePointRemove}
                  onSelectRoutePoint={handleRoutePointSelect}
                />

                <SegmentNameDisplay
                  details={inspectedSegmentDetails}
                  elevationHover={mapUi.elevationHover}
                  inspectedSegment={inspectedSegment}
                />
              </>
            )}
          </div>
        </div>

        <ContentSections onFocusSegment={handleSegmentFocus} />
      </div>

      {state.status === "ready" && mapUi.downloadModalOpen && (
        <DownloadModal
          activeDataPoints={routeState.activeDataPoints}
          featureFlags={featureFlags}
          routeState={routeState}
          segmentsData={state.assets.segmentsData}
          shareUrl={shareUrl}
          onClose={handleCloseDownload}
          onDownload={handleDownloadGpx}
        />
      )}
      <Tutorial open={mapUi.tutorialOpen} onClose={handleCloseTutorial} />
    </>
  );
}

function LoadingState() {
  return (
    <div className="react-shell__state react-map-loading" aria-live="polite">
      <span className="react-shell__spinner" aria-hidden="true" />
      <div>
        <h2>טוען את המפה</h2>
        <p>טוען מקטעים, נתוני דרך ושכבות מפה.</p>
      </div>
    </div>
  );
}

function ErrorState({ error }) {
  return (
    <div className="react-shell__state react-shell__state--error">
      <div>
        <h2>טעינת המפה נכשלה</h2>
        <p>{error?.message || "שגיאה לא ידועה"}</p>
      </div>
    </div>
  );
}

function getGeoJsonCoordinateBounds(geoJsonData) {
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;

  for (const feature of geoJsonData?.features || []) {
    if (feature?.geometry?.type !== "LineString") continue;

    for (const coordinate of feature.geometry.coordinates || []) {
      const lng = Number(coordinate[0]);
      const lat = Number(coordinate[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      minLat = Math.min(minLat, lat);
      minLng = Math.min(minLng, lng);
      maxLat = Math.max(maxLat, lat);
      maxLng = Math.max(maxLng, lng);
    }
  }

  if (![minLat, minLng, maxLat, maxLng].every(Number.isFinite)) {
    return null;
  }

  return { minLat, minLng, maxLat, maxLng };
}

function isPointWithinBounds(point, bounds) {
  if (!bounds) return true;
  return (
    point.lat >= bounds.minLat &&
    point.lat <= bounds.maxLat &&
    point.lng >= bounds.minLng &&
    point.lng <= bounds.maxLng
  );
}

function MapLegend({ activeDataPoints, hasBrokenRoute, selectedDataMarker }) {
  const [warningsOpen, setWarningsOpen] = useState(false);
  const warnings =
    activeDataPoints.length > 0
      ? activeDataPoints
      : selectedDataMarker
        ? [selectedDataMarker]
        : [];
  const warningsBySegment = useMemo(
    () => groupWarningsBySegment(warnings),
    [warnings],
  );
  const warningCountText = warnings.length > 1 ? ` (${warnings.length})` : "";

  return (
    <div className="legend-container">
      <div className="legend-box open" id="legend-box">
        <div className="legend-title">סוגי דרכים</div>
        <div className="legend-item">
          <div className="legend-color paved-trail" />
          <div className="legend-label">שביל סלול</div>
        </div>
        <div className="legend-item">
          <div className="legend-color dirt-trail" />
          <div className="legend-label">שביל עפר</div>
        </div>
        <div className="legend-item">
          <div className="legend-color road" />
          <div className="legend-label">כביש</div>
        </div>
      </div>
      {hasBrokenRoute && (
        <div className="route-warning issue-warning" id="route-warning">
          ⚠️ מסלול שבור
        </div>
      )}
      {warnings.length > 0 && (
        <>
          <button
            className="segment-warning issue-warning react-warning-toggle"
            id="segment-warning"
            type="button"
            onClick={() => setWarningsOpen((current) => !current)}
          >
            ⚠️ מידע חשוב {warningCountText}
          </button>
          <div
            className="individual-warnings-container"
            id="individual-warnings-container"
            style={{ display: warningsOpen ? "block" : "none" }}
          >
            {[...warningsBySegment.entries()].map(([segmentName, segmentWarnings]) => (
              <button
                className="individual-warning-item react-individual-warning-item"
                key={segmentName}
                type="button"
                style={{
                  backgroundColor: getWarningBackgroundColor(segmentWarnings),
                }}
              >
                <span className="warning-text">
                  {getWarningLabel(segmentWarnings)}
                </span>
                <span className="warning-icons" aria-hidden="true">
                  {getWarningTypes(segmentWarnings).map((type) => (
                    <span className="warning-icon react-warning-icon" key={type}>
                      {WARNING_EMOJIS[type] || "⚠️"}
                    </span>
                  ))}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const WARNING_TRANSLATIONS = {
  payment: "תשלום",
  gate: "שער",
  mud: "בוץ",
  warning: "אזהרה",
  slope: "שיפוע",
  narrow: "שוליים צרים",
  severe: "סכנה",
};

const WARNING_COLORS = {
  payment: "#4a5783",
  mud: "#9d744d",
  warning: "#FF9800",
  slope: "#8e5b9a",
  narrow: "#d6568b",
  severe: "#ff675b",
  gate: "#FF5722",
};

const WARNING_EMOJIS = {
  payment: "💵",
  gate: "🚧",
  mud: "⚠️",
  warning: "⚠️",
  slope: "⛰️",
  narrow: "⛍",
  severe: "‼️",
};

const WARNING_PRIORITY = [
  "severe",
  "narrow",
  "gate",
  "slope",
  "mud",
  "payment",
  "warning",
];

function groupWarningsBySegment(warnings) {
  const grouped = new Map();
  warnings.forEach((warning) => {
    const segmentName = warning.segmentName || "מידע חשוב";
    if (!grouped.has(segmentName)) {
      grouped.set(segmentName, []);
    }
    grouped.get(segmentName).push(warning);
  });
  return grouped;
}

function getWarningTypes(warnings) {
  return [...new Set(warnings.map((warning) => warning.type || "warning"))];
}

function getWarningLabel(warnings) {
  const warningTypes = getWarningTypes(warnings);
  if (warningTypes.length === 1) {
    return WARNING_TRANSLATIONS[warningTypes[0]] || warningTypes[0];
  }
  return "אזהרות";
}

function getWarningBackgroundColor(warnings) {
  const warningTypes = getWarningTypes(warnings);
  if (warningTypes.length === 1) {
    return WARNING_COLORS[warningTypes[0]] || "#f44336";
  }

  const highestPriority = WARNING_PRIORITY.find((type) =>
    warningTypes.includes(type),
  );
  return WARNING_COLORS[highestPriority] || "#f44336";
}

function RouteDescription({
  error,
  hasBrokenRoute,
  onElevationHover,
  onRemoveRoutePoint,
  onSelectRoutePoint,
  routeState,
  selectedRoutePointIndex,
}) {
  return (
    <div
      className={`route-description-panel${
        routeState.points.length === 0 && !error ? " empty" : ""
      }`}
      id="route-description-panel"
    >
      <div id="route-description" className="react-route-description-content">
        {error && (
          <span className="route-inline-warning">
            {error.message || "לא הצלחנו לעדכן את המסלול"}
          </span>
        )}
        {!error && (
          <>
            <div className="react-route-description-main">
              <RouteDescriptionText routeState={routeState} />
            </div>
            {hasBrokenRoute && (
              <div className="react-route-panel__warnings">מסלול שבור בין הנקודות שנבחרו.</div>
            )}
            {routeState.geometry.length >= 2 && (
              <ElevationProfile
                distance={routeState.distance}
                geometry={routeState.geometry}
                onElevationHover={onElevationHover}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function RouteDescriptionText({ routeState }) {
  if (routeState.geometry.length < 2) {
    return getRouteMessage(routeState);
  }

  return (
    <>
      <strong>מרחק:</strong> {formatLegacyDistance(routeState.distance)} •{" "}
      <strong>⬆️</strong> {Math.round(routeState.elevationGain || 0)} מ' •{" "}
      <strong>⬇️</strong> {Math.round(routeState.elevationLoss || 0)} מ'
    </>
  );
}

function ElevationProfile({ distance, geometry, onElevationHover }) {
  const profile = useMemo(() => buildElevationProfile(geometry), [geometry]);
  if (!profile) return null;

  const handleInteraction = (event) => {
    const clientX = event.touches?.[0]?.clientX ?? event.clientX;
    if (!Number.isFinite(clientX)) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const xPercent = ((clientX - rect.left) / rect.width) * 100;
    const closestPoint = findClosestElevationPoint(profile.elevationData, xPercent);
    if (!closestPoint) return;

    onElevationHover?.({
      coord: closestPoint.coord,
      distance: closestPoint.distance,
      elevation: closestPoint.elevation,
    });
  };

  const clearHover = () => {
    onElevationHover?.(null);
  };

  return (
    <div className="elevation-profile">
      <h4>גרף גובה (Elevation Profile)</h4>
      <div className="elevation-chart" id="elevation-chart">
        <svg
          aria-hidden="true"
          focusable="false"
          preserveAspectRatio="none"
          viewBox="0 0 100 100"
        >
          <defs>
            <linearGradient id="reactElevationGradient" x1="0%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%" stopColor="#748873" stopOpacity="1" />
              <stop offset="33%" stopColor="#D1A980" stopOpacity="1" />
              <stop offset="66%" stopColor="#E5E0D8" stopOpacity="1" />
              <stop offset="100%" stopColor="#F8F8F8" stopOpacity="1" />
            </linearGradient>
          </defs>
          <path
            d={profile.pathData}
            fill="url(#reactElevationGradient)"
            stroke="#748873"
            strokeWidth="0.5"
          />
        </svg>
        <div
          className="elevation-hover-overlay"
          onMouseMove={handleInteraction}
          onMouseLeave={clearHover}
          onTouchStart={handleInteraction}
          onTouchMove={handleInteraction}
          onTouchEnd={clearHover}
        />
      </div>
      <div className="elevation-labels">
        <span className="distance-label">{formatLegacyDistance(distance)}</span>
        <span className="distance-label">0 ק"מ</span>
      </div>
    </div>
  );
}

function buildElevationProfile(geometry) {
  const routeWithElevation = (geometry || []).map((point) => ({
    lat: point.lat,
    lng: point.lng,
    elevation: Number(point.elevation ?? point.ele ?? point.altitude),
  }));

  if (routeWithElevation.length < 2) return null;

  const smoothedRouteCoords = smoothElevations(routeWithElevation, 100);
  const totalDistance = smoothedRouteCoords.reduce((total, coord, index) => {
    if (index === 0) return 0;
    return total + getDistance(smoothedRouteCoords[index - 1], coord);
  }, 0);

  if (totalDistance === 0) return null;

  const coordsWithElevation = smoothedRouteCoords.map((coord, index) => {
    const pointDistance =
      index === 0
        ? 0
        : smoothedRouteCoords.slice(0, index + 1).reduce((total, candidate, idx) => {
            if (idx === 0) return 0;
            return total + getDistance(smoothedRouteCoords[idx - 1], candidate);
          }, 0);
    return { ...coord, distance: pointDistance };
  });

  const minElevation = Math.min(...coordsWithElevation.map((point) => point.elevation));
  const maxElevation = Math.max(...coordsWithElevation.map((point) => point.elevation));
  const range = maxElevation - minElevation || 100;
  const profileWidth = 300;
  const elevationData = [];

  for (let x = 0; x <= profileWidth; x++) {
    const distanceAtX = (x / profileWidth) * totalDistance;
    let beforePoint = null;
    let afterPoint = null;

    for (let index = 0; index < coordsWithElevation.length - 1; index++) {
      if (
        coordsWithElevation[index].distance <= distanceAtX &&
        coordsWithElevation[index + 1].distance >= distanceAtX
      ) {
        beforePoint = coordsWithElevation[index];
        afterPoint = coordsWithElevation[index + 1];
        break;
      }
    }

    let elevation;
    let coord;
    if (beforePoint && afterPoint) {
      const ratio =
        (distanceAtX - beforePoint.distance) /
        (afterPoint.distance - beforePoint.distance || 1);
      elevation =
        beforePoint.elevation +
        (afterPoint.elevation - beforePoint.elevation) * ratio;
      coord = {
        lat: beforePoint.lat + (afterPoint.lat - beforePoint.lat) * ratio,
        lng: beforePoint.lng + (afterPoint.lng - beforePoint.lng) * ratio,
      };
    } else if (beforePoint) {
      elevation = beforePoint.elevation;
      coord = beforePoint;
    } else {
      elevation = coordsWithElevation[0].elevation;
      coord = coordsWithElevation[0];
    }

    const heightPercent = Math.max(
      5,
      ((elevation - minElevation) / range) * 80 + 10,
    );
    const distancePercent = (x / profileWidth) * 100;
    elevationData.push({
      elevation,
      distance: distanceAtX,
      coord,
      heightPercent,
      distancePercent,
    });
  }

  let pathData = "";
  elevationData.forEach((point, index) => {
    const x = point.distancePercent;
    const y = 100 - point.heightPercent;
    pathData += `${index === 0 ? "M" : " L"} ${x} ${y}`;
  });

  return {
    elevationData,
    pathData: `${pathData} L 100 100 L 0 100 Z`,
  };
}

function findClosestElevationPoint(elevationData, xPercent) {
  if (!Array.isArray(elevationData) || elevationData.length === 0) return null;

  return elevationData.reduce((closest, point) => {
    const distanceFromPointer = Math.abs(point.distancePercent - xPercent);
    if (!closest || distanceFromPointer < closest.distanceFromPointer) {
      return { ...point, distanceFromPointer };
    }
    return closest;
  }, null);
}

function formatLegacyDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return "0 ק\"מ";
  return `${(distanceMeters / 1000).toFixed(1)} ק"מ`;
}

function SegmentNameDisplay({ details, elevationHover, inspectedSegment }) {
  if (elevationHover) {
    return (
      <div className="segment-name-display react-segment-name-display--active" id="segment-name-display">
        📍 מרחק: {(elevationHover.distance / 1000).toFixed(1)} km • גובה:{" "}
        {Math.round(elevationHover.elevation)} m
      </div>
    );
  }

  if (!inspectedSegment) {
    return (
      <div className="segment-name-display" id="segment-name-display">
        No segment selected
      </div>
    );
  }

  return (
    <div className="segment-name-display react-segment-name-display--active" id="segment-name-display">
      <strong>{inspectedSegment}</strong>
      <br />
      📏 {details?.distanceKm || "0.0"} ק"מ • ⬆️{" "}
      {details?.elevationGain || 0} מ' • ⬇️ {details?.elevationLoss || 0} מ'
      {details?.dataPoints?.length > 0 && (
        <div className="react-segment-data-list">
          {details.dataPoints.map((dataPoint, index) => (
            <div key={`${dataPoint.type}-${index}`}>
              {dataPoint.emoji || WARNING_EMOJIS[dataPoint.type] || "⚠️"}{" "}
              {dataPoint.information}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getSegmentDetails(
  segmentName,
  geoJsonData,
  segmentsData,
  routeManager,
) {
  const managerMetrics = routeManager?.segmentMetrics?.get?.(segmentName);
  const segmentMetadata = segmentsData?.[segmentName] || {};
  const dataPoints = Array.isArray(segmentMetadata.data)
    ? segmentMetadata.data.map((dataPoint) => ({
        ...dataPoint,
        emoji: WARNING_EMOJIS[dataPoint.type] || dataPoint.emoji || "⚠️",
      }))
    : [];

  if (managerMetrics) {
    return {
      distanceKm: managerMetrics.distanceKm,
      elevationGain: managerMetrics.forward?.elevationGain || 0,
      elevationLoss: managerMetrics.forward?.elevationLoss || 0,
      dataPoints,
    };
  }

  const feature = (geoJsonData?.features || []).find(
    (candidate) => candidate?.properties?.name === segmentName,
  );
  const coordinates = Array.isArray(feature?.geometry?.coordinates)
    ? feature.geometry.coordinates
    : [];

  let distance = 0;
  let elevationGain = Number(segmentMetadata.elevation_gain_m || 0);
  let elevationLoss = Number(segmentMetadata.elevation_loss_m || 0);

  for (let index = 0; index < coordinates.length - 1; index++) {
    const current = coordinates[index];
    const next = coordinates[index + 1];
    distance += getDistance(
      { lng: Number(current[0]), lat: Number(current[1]) },
      { lng: Number(next[0]), lat: Number(next[1]) },
    );
  }

  return {
    distanceKm: (distance / 1000).toFixed(1),
    elevationGain: Math.round(elevationGain || 0),
    elevationLoss: Math.round(elevationLoss || 0),
    dataPoints,
  };
}

export default App;
