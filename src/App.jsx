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
import ElevationProfile, { formatLegacyDistance } from "./components/ElevationProfile.jsx";
import PageShell from "./components/PageShell.jsx";
import { getRouteMessage } from "./components/RoutePanel.jsx";
import Tutorial from "./components/Tutorial.jsx";
import WelcomeWizard, { WELCOME_WIZARD_SKIP_FLAG } from "./components/WelcomeWizard.jsx";
import { getFeatureFlags } from "./config/featureFlags.js";
import { loadMapAssets, summarizeMapAssets } from "./data/mapAssets.js";
import {
  POI_COLORS as WARNING_COLORS,
  POI_EMOJIS as WARNING_EMOJIS,
  POI_LABELS as WARNING_TRANSLATIONS,
  POI_WARNING_PRIORITY as WARNING_PRIORITY,
} from "./data/poiTypes.js";
import MapView from "./map/MapView.jsx";
import { dataMarkerFeaturesFromSegments } from "./map/mapLayers.js";
import { createRouteDirectionAnimator } from "./map/routeDirectionAnimator.js";
import {
  addPoint,
  applyRouteSnapshot,
  buildShareInfo,
  clearRoute,
  createRouteManager,
  dragPoint,
  removePoint,
  routeStateSnapshot,
  restoreRouteFromParam,
} from "./routing/routeActions.js";
import { createBaseRoutingShardFetchLoader } from "./routing/baseRoutingShards.js";
import { createShardedRouteSession } from "./routing/shardedRouteSession.js";
import {
  initialRouteState,
  routeReducer,
} from "./routing/routeReducer.js";
import { executeDownloadGPX, generateGPX } from "../utils/gpx-generator.js";
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
  });
  const [osmDebug, setOsmDebug] = useState({
    enabled: false,
    status: "disabled",
    geoJson: null,
    graphEdgesGeoJson: null,
    graphNodesGeoJson: null,
    graphSummary: null,
    cwMatchGeoJson: null,
    cwMatchSummary: null,
    intersectionsGeoJson: null,
    summary: null,
    intersectionsSummary: null,
    error: null,
  });
  const [hoveredOsmWay, setHoveredOsmWay] = useState(null);
  const [hoveredOsmGraphEdge, setHoveredOsmGraphEdge] = useState(null);
  const [hoveredCwOsmMatch, setHoveredCwOsmMatch] = useState(null);
  const [osmDebugLayerMode, setOsmDebugLayerMode] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("osmLayer") === "graph" ? "graph" : "ways";
  });
  const [welcomeWizardOpen, setWelcomeWizardOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    const hasRoute = new URLSearchParams(window.location.search).has("route");
    if (hasRoute) return false;
    try {
      return localStorage.getItem(WELCOME_WIZARD_SKIP_FLAG) !== "1";
    } catch {
      return true;
    }
  });
  const [selectedCwReviewSegmentId, setSelectedCwReviewSegmentId] =
    useState(null);
  const routeManagerRef = useRef(null);
  const shardedRouteSessionRef = useRef(null);
  const dragStartSnapshotRef = useRef(null);
  const routeStateRef = useRef(initialRouteState);
  const routeClickQueueRef = useRef([]);
  const routeClickProcessingRef = useRef(false);
  const routeClickIdRef = useRef(0);
  const directionAnimatorRef = useRef(null);
  if (directionAnimatorRef.current === null) {
    directionAnimatorRef.current = createRouteDirectionAnimator();
  }
  const isDraggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    return () => {
      directionAnimatorRef.current?.dispose();
      directionAnimatorRef.current = null;
    };
  }, []);
  const [routeState, dispatchRoute] = useReducer(
    routeReducer,
    initialRouteState,
  );
  const [routeHistory, setRouteHistory] = useState({
    past: [],
    future: [],
  });
  const [routingShardStatus, setRoutingShardStatus] = useState(null);

  useEffect(() => {
    routeStateRef.current = routeState;
  }, [routeState]);

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
        const assets = await loadMapAssets({
          signal: controller.signal,
          baseRoutingMode: "shards",
        });
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
    const params = new URLSearchParams(window.location.search);
    const enabled = params.has("osm") || params.has("osmDebug");
    if (!enabled) return undefined;

    const controller = new AbortController();

    async function loadOsmDebugOverlay() {
      setOsmDebug({
        enabled: true,
        status: "loading",
        geoJson: null,
        graphEdgesGeoJson: null,
        graphNodesGeoJson: null,
        graphSummary: null,
        cwMatchGeoJson: null,
        cwMatchSummary: null,
        intersectionsGeoJson: null,
        summary: null,
        intersectionsSummary: null,
        error: null,
      });

      try {
        const [
          geoJsonResponse,
          summaryResponse,
          intersectionsResponse,
          intersectionsSummaryResponse,
          graphEdgesResponse,
          graphNodesResponse,
          graphSummaryResponse,
          cwMatchResponse,
          cwMatchSummaryResponse,
        ] = await Promise.all([
          fetch("/build/osm/osm-raw-ways.geojson", {
            signal: controller.signal,
          }),
          fetch("/build/osm/osm-summary.json", {
            signal: controller.signal,
          }),
          fetch("/build/osm/osm-intersections.geojson", {
            signal: controller.signal,
          }),
          fetch("/build/osm/osm-intersections-summary.json", {
            signal: controller.signal,
          }),
          fetch("/build/osm/osm-base-edges.geojson", {
            signal: controller.signal,
          }),
          fetch("/build/osm/osm-base-nodes.geojson", {
            signal: controller.signal,
          }),
          fetch("/build/osm/osm-base-graph-summary.json", {
            signal: controller.signal,
          }),
          fetch("/build/osm/cw-osm-match-preview.geojson", {
            signal: controller.signal,
          }),
          fetch("/build/osm/cw-osm-match-summary.json", {
            signal: controller.signal,
          }),
        ]);

        if (!geoJsonResponse.ok) {
          throw new Error(
            `OSM debug overlay not found: HTTP ${geoJsonResponse.status}`,
          );
        }

        const geoJson = await geoJsonResponse.json();
        const summary = summaryResponse.ok
          ? await summaryResponse.json()
          : null;
        const intersectionsGeoJson = intersectionsResponse.ok
          ? await intersectionsResponse.json()
          : null;
        const intersectionsSummary = intersectionsSummaryResponse.ok
          ? await intersectionsSummaryResponse.json()
          : null;
        const graphEdgesGeoJson = graphEdgesResponse.ok
          ? await graphEdgesResponse.json()
          : null;
        const graphNodesGeoJson = graphNodesResponse.ok
          ? await graphNodesResponse.json()
          : null;
        const graphSummary = graphSummaryResponse.ok
          ? await graphSummaryResponse.json()
          : null;
        const cwMatchGeoJson = cwMatchResponse.ok
          ? await cwMatchResponse.json()
          : null;
        const cwMatchSummary = cwMatchSummaryResponse.ok
          ? await cwMatchSummaryResponse.json()
          : null;
        if (controller.signal.aborted) return;

        setOsmDebug({
          enabled: true,
          status: "ready",
          geoJson,
          graphEdgesGeoJson,
          graphNodesGeoJson,
          graphSummary,
          cwMatchGeoJson,
          cwMatchSummary,
          intersectionsGeoJson,
          summary,
          intersectionsSummary,
          error: null,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn("Failed to load OSM debug overlay:", error);
        setOsmDebug({
          enabled: true,
          status: "error",
          geoJson: null,
          graphEdgesGeoJson: null,
          graphNodesGeoJson: null,
          graphSummary: null,
          cwMatchGeoJson: null,
          cwMatchSummary: null,
          intersectionsGeoJson: null,
          summary: null,
          intersectionsSummary: null,
          error,
        });
      }
    }

    loadOsmDebugOverlay();

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (state.status !== "ready") return undefined;

    let disposed = false;

    async function initializeRouting() {
      try {
        const shardedSession = state.assets.baseRoutingShardManifestData
          ? await createShardedRouteSession(
              window.RouteManager,
              state.assets.geoJsonData,
              state.assets.segmentsData,
              state.assets.baseRoutingShardManifestData,
              createBaseRoutingShardFetchLoader(
                state.assets.baseRoutingShardManifestPath,
                {},
                window.location,
                { format: routingShardFormat() },
              ),
              {
                cwBaseIndex: state.assets.cwBaseIndexData,
                onStatus: (status) => {
                  if (!disposed) {
                    setRoutingShardStatus(status);
                  }
                },
              },
            )
          : null;
        const manager = shardedSession
          ? shardedSession.manager
          : await createRouteManager(
              window.RouteManager,
              state.assets.geoJsonData,
              state.assets.segmentsData,
              state.assets.baseRoutingNetworkData,
            );
        if (disposed) return;

        shardedRouteSessionRef.current = shardedSession;
        if (!shardedSession) {
          setRoutingShardStatus(
            unavailableRoutingShardStatus(),
          );
        }
        routeManagerRef.current = manager;
        dispatchRoute({ type: "route/managerReady" });

        const routeParam = new URLSearchParams(window.location.search).get(
          "route",
        );
        if (routeParam) {
          const snapshot = shardedSession
            ? await shardedSession.restoreRouteParam(routeParam)
            : restoreRouteFromParam(
                manager,
                routeParam,
                state.assets.segmentsData,
                state.assets.cwBaseIndexData,
              );
          if (shardedSession) {
            routeManagerRef.current = shardedSession.manager;
          }
          if (snapshot) {
            routeStateRef.current = routeStateFromSnapshot(
              routeStateRef.current,
              snapshot,
            );
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
      shardedRouteSessionRef.current = null;
    };
  }, [state.assets, state.status]);

  const handleSegmentHover = useCallback((segmentName) => {
    dispatchRoute({ type: "route/setHoveredSegment", segmentName });
  }, []);

  const handleOsmDebugHover = useCallback((osmWay) => {
    setHoveredOsmWay((current) => {
      if (!osmWay) return current ? null : current;
      if (current?.osmId === osmWay.osmId) return current;
      return osmWay;
    });
  }, []);

  const handleOsmGraphEdgeHover = useCallback((graphEdge) => {
    setHoveredOsmGraphEdge((current) => {
      if (!graphEdge) return current ? null : current;
      if (current?.edgeId === graphEdge.edgeId) return current;
      return graphEdge;
    });
  }, []);

  const handleCwOsmMatchHover = useCallback((matchFeature) => {
    setHoveredCwOsmMatch((current) => {
      if (!matchFeature) return current ? null : current;
      if (
        current?.segmentId === matchFeature.segmentId &&
        current?.edgeId === matchFeature.edgeId &&
        current?.kind === matchFeature.kind
      ) {
        return current;
      }
      return matchFeature;
    });
  }, []);

  const handleOsmDebugLayerModeChange = useCallback((mode) => {
    setOsmDebugLayerMode(mode);
    setHoveredOsmWay(null);
    setHoveredOsmGraphEdge(null);
    setHoveredCwOsmMatch(null);

    const url = new URL(window.location.href);
    if (mode === "graph") {
      url.searchParams.set("osmLayer", "graph");
    } else {
      url.searchParams.delete("osmLayer");
    }
    window.history.replaceState(null, "", url.toString());
  }, []);

  const handleCwReviewSegmentSelect = useCallback(
    (segmentId) => {
      handleOsmDebugLayerModeChange("graph");
      setSelectedCwReviewSegmentId(segmentId);
    },
    [handleOsmDebugLayerModeChange],
  );

  const handleSegmentFocus = useCallback((segmentName) => {
    dispatchRoute({ type: "route/setFocusedSegment", segmentName });
  }, []);

  const handleElevationHover = useCallback((elevationHover) => {
    setMapUi((current) => ({
      ...current,
      elevationHover,
    }));
  }, []);

  useEffect(() => {
    const animator = directionAnimatorRef.current;
    if (!animator) return;
    if (isDragging) return;

    const geometry = routeState.geometry;
    const points = routeState.points || [];

    if (!Array.isArray(geometry) || geometry.length < 2 || points.length < 2) {
      animator.cancel();
      return;
    }

    const indices = snapRoutePointsToGeometryIndices(points, geometry);
    if (indices.length < 2) {
      animator.cancel();
      return;
    }

    animator.trigger(geometry, indices);
  }, [routeState.geometry, routeState.points, isDragging]);

  const clearRouteUrl = useCallback(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("route")) return;

    url.searchParams.delete("route");
    window.history.replaceState(null, "", url.toString());
  }, []);

  const commitRouteSnapshot = useCallback(
    (snapshot, options = {}) => {
      const {
        clearUrl = true,
        preservePending = false,
        previousSnapshot = null,
        recordHistory = true,
      } = options;
      if (recordHistory) {
        setRouteHistory((current) => ({
          past: [
            ...current.past,
            previousSnapshot || routeStateSnapshot(routeStateRef.current),
          ],
          future: [],
        }));
      }

      routeStateRef.current = routeStateFromSnapshot(
        routeStateRef.current,
        snapshot,
        { preservePending },
      );
      dispatchRoute({ type: "route/update", snapshot, preservePending });
      setMapUi((current) => ({
        ...current,
        selectedRoutePointIndex: null,
      }));

      if (clearUrl) {
        clearRouteUrl();
      }
    },
    [clearRouteUrl],
  );

  const processRouteClickQueue = useCallback(async () => {
    if (routeClickProcessingRef.current) return;
    if (!routeManagerRef.current || state.status !== "ready") return;

    routeClickProcessingRef.current = true;
    try {
      while (routeClickQueueRef.current.length > 0) {
        const pendingPoint = routeClickQueueRef.current[0];
        const shardedSession = shardedRouteSessionRef.current;
        const previousSnapshot = routeStateSnapshot(routeStateRef.current);

        dispatchRoute({
          type: "route/setRoutingPhase",
          phase: shardedSession ? "loading-shards" : "routing",
        });

        try {
          const snapshot = shardedSession
            ? await shardedSession.addPoint(pendingPoint)
            : addPoint(
                routeManagerRef.current,
                pendingPoint,
                state.assets.segmentsData,
              );
          if (shardedSession) {
            routeManagerRef.current = shardedSession.manager;
          }

          routeStateRef.current = removePendingRoutePoint(
            routeStateRef.current,
            pendingPoint.id,
          );
          dispatchRoute({
            type: "route/removePendingPoint",
            id: pendingPoint.id,
          });

          if (snapshot.points.length === previousSnapshot.points.length) {
            dispatchRoute({
              type: "route/error",
              error: new Error(
                "הנקודה רחוקה מדי מרשת הדרכים. בחרו נקודה ליד דרך או שביל.",
              ),
            });
            continue;
          }

          commitRouteSnapshot(snapshot, {
            preservePending: true,
            previousSnapshot,
          });
          if (snapshot.routeFailure) {
            dispatchRoute({
              type: "route/error",
              error: new Error("לא נמצא חיבור ברשת הדרכים בין הנקודות שנבחרו."),
            });
          }
          trackRoutePointEvent(snapshot.points, snapshot.selectedSegments, "click");
        } catch (error) {
          routeStateRef.current = removePendingRoutePoint(
            routeStateRef.current,
            pendingPoint.id,
          );
          dispatchRoute({
            type: "route/removePendingPoint",
            id: pendingPoint.id,
          });
          dispatchRoute({ type: "route/error", error });
        } finally {
          routeClickQueueRef.current.shift();
        }
      }
    } finally {
      routeClickProcessingRef.current = false;
      if (routeClickQueueRef.current.length === 0) {
        dispatchRoute({ type: "route/setRoutingPhase", phase: "idle" });
      }
    }
  }, [commitRouteSnapshot, state.assets, state.status]);

  const handleMapClick = useCallback((point) => {
    if (!routeManagerRef.current || state.status !== "ready") return;

    const pendingPoint = {
      ...point,
      id: `pending-route-point-${Date.now()}-${routeClickIdRef.current++}`,
      pending: true,
    };
    routeClickQueueRef.current.push(pendingPoint);
    const phase = shardedRouteSessionRef.current ? "loading-shards" : "routing";
    routeStateRef.current = addPendingRoutePoint(
      routeStateRef.current,
      pendingPoint,
      phase,
    );
    dispatchRoute({
      type: "route/addPendingPoint",
      point: pendingPoint,
      phase,
    });
    processRouteClickQueue();
  }, [processRouteClickQueue, state.status]);

  const handleViewportIdle = useCallback((bounds) => {
    const shardedSession = shardedRouteSessionRef.current;
    if (!shardedSession || state.status !== "ready") return;

    shardedSession
      .prefetchBounds(bounds, { maxShards: 48 })
      .catch((error) => {
        console.warn("Routing shard prefetch failed:", error);
      });
  }, [state.status]);

  const handleRoutePointDragStart = useCallback(() => {
    dragStartSnapshotRef.current = routeStateSnapshot(routeState);
    isDraggingRef.current = true;
    setIsDragging(true);
  }, [routeState]);

  const handleRoutePointDrag = useCallback(async (index, point) => {
    if (!routeManagerRef.current || state.status !== "ready") return;

    try {
      const shardedSession = shardedRouteSessionRef.current;
      const snapshot = shardedSession
        ? await shardedSession.dragPoint(routeState.points, index, point)
        : dragPoint(
            routeManagerRef.current,
            routeState.points,
            index,
            point,
            state.assets.segmentsData,
          );
      if (shardedSession) {
        routeManagerRef.current = shardedSession.manager;
      }
      routeStateRef.current = routeStateFromSnapshot(
        routeStateRef.current,
        snapshot,
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
    isDraggingRef.current = false;
    setIsDragging(false);
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
    routeClickQueueRef.current = [];
    if (!routeManagerRef.current) {
      routeStateRef.current = {
        ...routeStateRef.current,
        ...clearRouteStateFields(),
      };
      dispatchRoute({ type: "route/clear" });
      return;
    }

    const previousSnapshot = routeStateSnapshot(routeStateRef.current);
    const snapshot = clearRoute(routeManagerRef.current);
    setRouteHistory((current) => ({
      past: [...current.past, previousSnapshot],
      future: [],
    }));
    routeStateRef.current = routeStateFromSnapshot(
      routeStateRef.current,
      snapshot,
    );
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
      routeStateRef.current = routeStateFromSnapshot(
        routeStateRef.current,
        snapshot,
      );
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

  const inspectedOsmFeature = mapUi.elevationHover
    ? null
    : osmDebugLayerMode === "graph"
      ? hoveredCwOsmMatch || hoveredOsmGraphEdge
      : hoveredOsmWay;
  const inspectedSegment = mapUi.elevationHover || osmDebug.enabled
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
  const shareInfo = useMemo(() => {
    if (
      state.status !== "ready" ||
      routeState.points.length === 0 ||
      !routeManagerRef.current
    ) {
      return { url: "", status: "unavailable", length: 0, format: null };
    }

    return buildShareInfo(
      routeState,
      state.assets.segmentsData,
      routeManagerRef.current,
      window.location,
      state.assets.cwBaseIndexData,
    );
  }, [
    routeState.geometry,
    routeState.points,
    routeState.selectedSegments,
    state.assets,
    state.status,
  ]);
  const shareUrl = shareInfo.url;
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
  const selectedCwReviewFeature = useMemo(() => {
    if (state.status !== "ready" || selectedCwReviewSegmentId === null) {
      return null;
    }
    return findCyclewaysFeatureById(
      state.assets.geoJsonData,
      selectedCwReviewSegmentId,
    );
  }, [selectedCwReviewSegmentId, state.assets, state.status]);
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
  const displayedRoutePoints = useMemo(
    () => [...routeState.points, ...routeState.pendingPoints],
    [routeState.pendingPoints, routeState.points],
  );

  return (
    <>
      <WelcomeWizard
        visible={welcomeWizardOpen}
        onDismiss={() => setWelcomeWizardOpen(false)}
      />
      <PageShell onOpenTutorial={handleOpenTutorial} onOpenWizard={() => setWelcomeWizardOpen(true)}>
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

                {osmDebug.enabled && (
                  <OsmDebugLayerToggle
                    mode={osmDebugLayerMode}
                    status={osmDebug.status}
                    onChange={handleOsmDebugLayerModeChange}
                  />
                )}

                {osmDebug.enabled && (
                  <OsmMatchReviewPanel
                    mode={osmDebugLayerMode}
                    selectedSegmentId={selectedCwReviewSegmentId}
                    summary={osmDebug.cwMatchSummary}
                    onOpenGraph={() => handleOsmDebugLayerModeChange("graph")}
                    onSelectSegment={handleCwReviewSegmentSelect}
                  />
                )}

                <MapView
                  activeDataPointIds={activeDataPointIds}
                  animator={directionAnimatorRef.current}
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
                  onViewportIdle={handleViewportIdle}
                  onOsmDebugHover={handleOsmDebugHover}
                  onOsmGraphEdgeHover={handleOsmGraphEdgeHover}
                  onCwOsmMatchHover={handleCwOsmMatchHover}
                  osmDebugGeoJson={osmDebug.geoJson}
                  osmGraphEdgesGeoJson={osmDebug.graphEdgesGeoJson}
                  osmGraphNodesGeoJson={osmDebug.graphNodesGeoJson}
                  cwOsmMatchGeoJson={osmDebug.cwMatchGeoJson}
                  osmIntersectionsGeoJson={osmDebug.intersectionsGeoJson}
                  osmDebugMode={osmDebug.enabled}
                  osmDebugLayerMode={osmDebugLayerMode}
                  routeFitRequest={mapUi.routeFitRequest}
                  routeGeometry={routeState.geometry}
                  routePoints={displayedRoutePoints}
                  searchHighlight={mapUi.searchHighlight}
                  selectedCwOsmReviewFeature={selectedCwReviewFeature}
                  selectedCwOsmReviewSegmentId={selectedCwReviewSegmentId}
                  selectedRoutePointIndex={mapUi.selectedRoutePointIndex}
                />

                <RouteDescription
                  animator={directionAnimatorRef.current}
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
                  inspectedSegment={inspectedSegment}
                  osmFeature={inspectedOsmFeature}
                />
              </>
            )}
          </div>
        </div>

        <ContentSections onFocusSegment={handleSegmentFocus} />
      </PageShell>

      {state.status === "ready" && mapUi.downloadModalOpen && (
        <DownloadModal
          activeDataPoints={routeState.activeDataPoints}
          featureFlags={featureFlags}
          routeState={routeState}
          segmentsData={state.assets.segmentsData}
          shareUrl={shareUrl}
          shareStatus={shareInfo.status}
          shareUrlLength={shareInfo.length}
          onClose={handleCloseDownload}
          onDownload={handleDownloadGpx}
        />
      )}
      <Tutorial open={mapUi.tutorialOpen} onClose={handleCloseTutorial} />
    </>
  );
}

function routeStateFromSnapshot(current, snapshot, options = {}) {
  const preservePending = Boolean(options.preservePending);
  return {
    ...current,
    status: "ready",
    points: snapshot.points,
    selectedSegments: snapshot.selectedSegments,
    geometry: snapshot.geometry,
    distance: snapshot.distance,
    elevationGain: snapshot.elevationGain,
    elevationLoss: snapshot.elevationLoss,
    activeDataPoints: snapshot.activeDataPoints,
    routeFailure: snapshot.routeFailure || null,
    pendingPoints: preservePending ? current.pendingPoints : [],
    routingPhase:
      preservePending && current.pendingPoints.length > 0
        ? current.routingPhase
        : "idle",
    hoveredSegment: null,
    focusedSegment: null,
    error: null,
  };
}

function clearRouteStateFields() {
  return {
    points: [],
    selectedSegments: [],
    geometry: [],
    distance: 0,
    elevationGain: 0,
    elevationLoss: 0,
    activeDataPoints: [],
    routeFailure: null,
    pendingPoints: [],
    routingPhase: "idle",
    error: null,
  };
}

function addPendingRoutePoint(current, point, phase = "loading-shards") {
  return {
    ...current,
    pendingPoints: [...current.pendingPoints, point],
    routingPhase: phase,
    error: null,
  };
}

function removePendingRoutePoint(current, pointId) {
  const pendingPoints = current.pendingPoints.filter(
    (point) => point.id !== pointId,
  );
  return {
    ...current,
    pendingPoints,
    routingPhase: pendingPoints.length > 0 ? current.routingPhase : "idle",
  };
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

function routingShardFormat() {
  const params = new URLSearchParams(window.location.search);
  const format = params.get("routingShardFormat");
  if (format === "msgpack" || format === "compact" || format === "cwb") {
    return format;
  }
  return "default";
}

function unavailableRoutingShardStatus() {
  console.warn(
    "[routing-shards] unavailable: public-data/map-manifest.json has no baseRoutingShards asset",
  );
  return {
    phase: "unavailable",
    batchShardIds: [],
    loadedShards: [],
    loadedCompactBytes: 0,
    loadedEdges: 0,
  };
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
  animator,
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
        routeState.points.length === 0 &&
        routeState.pendingPoints.length === 0 &&
        !error
          ? " empty"
          : ""
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
                animator={animator}
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
  if (routeState.pendingPoints.length > 0) {
    const pendingCount = routeState.pendingPoints.length;
    return (
      <span className="react-route-loading">
        <span className="react-route-loading__spinner" aria-hidden="true" />
        {pendingCount === 1
          ? "בודק את נקודת המסלול על רשת הדרכים..."
          : `בודק ${pendingCount} נקודות מסלול על רשת הדרכים...`}
      </span>
    );
  }

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

function snapRoutePointsToGeometryIndices(routePoints, geometry) {
  if (!Array.isArray(routePoints) || !Array.isArray(geometry)) return [];
  const indices = [];
  for (const point of routePoints) {
    if (point?.pending) continue;
    if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lng)) continue;
    let bestIndex = 0;
    let bestDist = Infinity;
    for (let i = 0; i < geometry.length; i++) {
      const g = geometry[i];
      const dLat = g.lat - point.lat;
      const dLng = g.lng - point.lng;
      const d = dLat * dLat + dLng * dLng;
      if (d < bestDist) {
        bestDist = d;
        bestIndex = i;
      }
    }
    indices.push(bestIndex);
  }
  return indices;
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : "";
}

function formatMeters(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} m` : "";
}

function failureClassLabel(value) {
  const labels = {
    accepted: "accepted",
    partial_gap: "partial gap",
    osm_missing: "OSM missing",
    matcher_failed: "matcher failed",
    source_geometry_mismatch: "source mismatch",
    ambiguous_parallel: "ambiguous",
    outside_base_area: "outside area",
    needs_split: "needs split",
    manual_review: "manual review",
  };
  return labels[value] || value || "review";
}

function findCyclewaysFeatureById(geoJsonData, segmentId) {
  const numericSegmentId = Number(segmentId);
  if (!Number.isFinite(numericSegmentId)) return null;

  return (
    geoJsonData?.features?.find(
      (feature) =>
        feature?.geometry?.type === "LineString" &&
        Number(feature?.properties?.id) === numericSegmentId,
    ) || null
  );
}

function OsmDebugLayerToggle({ mode, status, onChange }) {
  const isLoading = status === "loading";
  const options = [
    ["ways", "OSM ways"],
    ["graph", "Graph edges"],
  ];

  return (
    <div
      className="react-osm-layer-toggle"
      role="group"
      aria-label="OSM debug layer"
    >
      {options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          className={
            value === mode
              ? "react-osm-layer-toggle__button react-osm-layer-toggle__button--active"
              : "react-osm-layer-toggle__button"
          }
          aria-pressed={value === mode}
          disabled={isLoading}
          onClick={() => onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function OsmMatchReviewPanel({
  mode,
  selectedSegmentId,
  summary,
  onOpenGraph,
  onSelectSegment,
}) {
  const [filter, setFilter] = useState("issues");
  const segments = Array.isArray(summary?.segments) ? summary.segments : [];
  if (!summary || segments.length === 0) return null;

  const issueSegments = segments.filter(
    (segment) => segment.failureClass !== "accepted",
  );
  const visibleSegments = filter === "all" ? segments : issueSegments;
  const selectedSegment = segments.find(
    (segment) => segment.segmentId === selectedSegmentId,
  );

  return (
    <section className="react-osm-review-panel" aria-label="CW OSM match review">
      <div className="react-osm-review-panel__header">
        <div>
          <strong>Match review</strong>
          <span>
            {formatPercent(Number(summary.coverageRatio))} coverage,{" "}
            {issueSegments.length} issues
          </span>
        </div>
        {mode !== "graph" && (
          <button type="button" onClick={onOpenGraph}>
            Graph
          </button>
        )}
      </div>

      {mode !== "graph" && (
        <p className="react-osm-review-panel__hint">
          Switch to graph mode to inspect matched edges and gaps.
        </p>
      )}

      <div className="react-osm-review-panel__filters" role="group" aria-label="Review filter">
        <button
          type="button"
          className={filter === "issues" ? "is-active" : ""}
          onClick={() => setFilter("issues")}
        >
          Issues {issueSegments.length}
        </button>
        <button
          type="button"
          className={filter === "all" ? "is-active" : ""}
          onClick={() => setFilter("all")}
        >
          All {segments.length}
        </button>
      </div>

      {selectedSegment && (
        <div className="react-osm-review-panel__selected">
          <strong>{selectedSegment.segmentName}</strong>
          <div>
            {failureClassLabel(selectedSegment.failureClass)} ·{" "}
            {formatPercent(Number(selectedSegment.coverageRatio))} · gaps{" "}
            {selectedSegment.gapCount}
          </div>
          <p>{selectedSegment.reviewReason}</p>
        </div>
      )}

      <div className="react-osm-review-list">
        {visibleSegments.map((segment) => (
          <button
            key={segment.segmentId}
            type="button"
            className={
              segment.segmentId === selectedSegmentId
                ? "react-osm-review-item react-osm-review-item--selected"
                : "react-osm-review-item"
            }
            onClick={() => onSelectSegment(segment.segmentId)}
          >
            <span className="react-osm-review-item__title">
              {segment.segmentName || `Segment ${segment.segmentId}`}
            </span>
            <span className="react-osm-review-item__meta">
              <span className={`react-osm-review-chip react-osm-review-chip--${segment.failureClass}`}>
                {failureClassLabel(segment.failureClass)}
              </span>
              <span>{formatPercent(Number(segment.coverageRatio))}</span>
              <span>{segment.confidence}</span>
              <span>{segment.gapCount} gaps</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function SegmentNameDisplay({
  details,
  inspectedSegment,
  osmFeature,
}) {
  if (osmFeature) {
    const isGraphEdge = osmFeature.debugType === "graphEdge";
    const isCwMatch =
      osmFeature.debugType === "cwMatchEdge" || osmFeature.debugType === "cwMatchGap";
    const title = isCwMatch
      ? osmFeature.segmentName || "CycleWays match"
      : isGraphEdge
      ? osmFeature.edgeId
        ? `Graph edge ${osmFeature.edgeId}`
        : "Graph edge"
      : osmFeature.name ||
        osmFeature.ref ||
        (osmFeature.osmId ? `OSM way ${osmFeature.osmId}` : "OSM way");
    const rows = (isCwMatch
      ? [
          ["kind", osmFeature.kind],
          ["segmentId", osmFeature.segmentId],
          ["confidence", osmFeature.confidence],
          ["coverage", formatPercent(Number(osmFeature.coverageRatio))],
          ["edge", osmFeature.edgeId],
          ["osmWay", osmFeature.osmWayId],
          ["direction", osmFeature.direction],
          ["avgDistance", formatMeters(Number(osmFeature.avgDistanceMeters))],
          ["gapDistance", formatMeters(Number(osmFeature.distanceMeters))],
          ["highway", osmFeature.graphHighway],
          ["class", osmFeature.graphClass],
          ["status", osmFeature.graphAccessStatus],
        ]
      : isGraphEdge
      ? [
          ["osmWay", osmFeature.osmWayId],
          ["slice", osmFeature.sliceIndex],
          ["from", osmFeature.fromNodeId],
          ["to", osmFeature.toNodeId],
          ["highway", osmFeature.highway],
          ["surface", osmFeature.surface],
          ["tracktype", osmFeature.tracktype],
          ["bicycle", osmFeature.bicycle],
          ["access", osmFeature.access],
          ["class", osmFeature.osmRouteClass],
          ["status", osmFeature.accessStatus],
        ]
      : [
          ["highway", osmFeature.highway],
          ["surface", osmFeature.surface],
          ["tracktype", osmFeature.tracktype],
          ["bicycle", osmFeature.bicycle],
          ["access", osmFeature.access],
          ["class", osmFeature.osmRouteClass],
          ["status", osmFeature.accessStatus],
        ]
    ).filter(([, value]) => value !== undefined && value !== null && value !== "");

    return (
      <div className="segment-name-display react-segment-name-display--active react-segment-name-display--osm" id="segment-name-display">
        <strong>{title}</strong>
        <br />
        {osmFeature.distanceMeters && (
          <>
            📏 {formatLegacyDistance(Number(osmFeature.distanceMeters))}
            <br />
          </>
        )}
        <div className="react-segment-data-list react-osm-data-list">
          {rows.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>: {value}
            </div>
          ))}
        </div>
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
