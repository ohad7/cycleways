// useCyclewaysApp: the platform-agnostic application controller. It owns all of
// the app's state, effects, refs, and handlers (route session, asset loading,
// sharing, map UI, and direction animator) and returns a
// plain { state + handlers } interface. The web entry (src/App.jsx) renders DOM
// from it; a future React Native app calls the same hook and renders native UI
// on top of the MapSurface contract + src/platform adapters. It must stay free
// of DOM/JSX and browser globals (browser access goes through src/platform).
// NOTE: large by design — this is a faithful one-move extraction; a follow-up
// may split it into focused hooks (useMapAssets / useRouteSession /
// useMapUiState). See
// plans/app-controller-hook/design.md.
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  featureFlagValue,
  getFeatureFlags,
} from "../config/featureFlags.js";
import { loadMapAssets, summarizeMapAssets } from "../data/mapAssets.js";
import { POI_EMOJIS as WARNING_EMOJIS } from "../data/poiTypes.js";
import RouteManager from "../../route-manager.js";
import {
  getQueryParam,
  hasQueryParam,
  removeUrlParam,
  setUrlParam,
  getShardLoaderLocation,
} from "../platform/location.js";
import { getCurrentPosition } from "../platform/geolocation.js";
import { dataMarkerFeaturesFromSegments } from "../data/dataMarkers.js";
import { POI_EMOJIS } from "../data/poiTypes.js";
import { getDataPointLocation } from "../utils/route-data.js";
import { createRouteDirectionAnimator } from "../domain/routeDirectionAnimator.js";
import {
  addPoint,
  applyRouteSnapshot,
  buildShareInfo,
  clearRoute,
  createRouteManager,
  recalculatePoints,
  removePoint,
  routeStateSnapshot,
  restoreRouteFromParam,
} from "../routing/routeActions.js";
import { createBaseRoutingShardFetchLoader } from "../routing/baseRoutingShards.js";
import { createShardedRouteSession } from "../routing/shardedRouteSession.js";
import {
  initialRouteState,
  routeReducer,
} from "../routing/routeReducer.js";
import { generateGPX } from "../utils/gpx-generator.js";
import { executeDownloadGPX } from "../platform/download.js";
import {
  trackRouteOperation,
  trackRoutePointEvent,
  trackSearchEvent,
  trackUndoRedoEvent,
} from "../platform/analytics.js";
import { getDistance } from "../utils/distance.js";
import { getStoredItem, setStoredItem } from "../platform/storage.js";
import {
  parseDraft,
  serializeDraft,
  parseRecents,
  serializeRecents,
  upsertRecent,
} from "../data/plannerMemory.js";

const PLANNER_DRAFT_KEY = "cycleways:planner-draft";
const RECENT_ROUTES_KEY = "cycleways:recent-routes";

// Records a route in the recents list and persists it. Shared by the
// callback below and the initializeRouting effect (which runs before the
// callback exists in source order).
function recordRecentRoute(setRecentRoutes, entry) {
  if (!entry?.param) return;
  setRecentRoutes((current) => {
    const next = upsertRecent(current, { savedAt: Date.now(), ...entry });
    setStoredItem(RECENT_ROUTES_KEY, serializeRecents(next));
    return next;
  });
}

export function useCyclewaysApp({
  enableRouteDirectionAnimation = true,
} = {}) {
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
    dataMarkerFocus: null,
    elevationHover: null,
    locationFix: null,
    locateStatus: "idle",
  });
  const [welcomeWizardOpen, setWelcomeWizardOpen] = useState(false);
  // Draft offered for restore (read once at mount); null once consumed/dismissed.
  const [plannerDraft, setPlannerDraft] = useState(() =>
    parseDraft(getStoredItem(PLANNER_DRAFT_KEY)),
  );
  const [recentRoutes, setRecentRoutes] = useState(() =>
    parseRecents(getStoredItem(RECENT_ROUTES_KEY)),
  );
  const routeManagerRef = useRef(null);
  const shardedRouteSessionRef = useRef(null);
  const dragStartSnapshotRef = useRef(null);
  const routeStateRef = useRef(initialRouteState);
  const routeClickQueueRef = useRef([]);
  const routeClickProcessingRef = useRef(false);
  const routeClickIdRef = useRef(0);
  const routeParamLoadingRef = useRef(false);
  const directionAnimatorRef = useRef(null);
  if (enableRouteDirectionAnimation && directionAnimatorRef.current === null) {
    directionAnimatorRef.current = createRouteDirectionAnimator();
  }
  const isDraggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [routePointDragPreview, setRoutePointDragPreview] = useState(null);
  const routePointDragPreviewRef = useRef(null);

  const setRoutePointDragPreviewState = useCallback((nextOrUpdater) => {
    setRoutePointDragPreview((current) => {
      const next =
        typeof nextOrUpdater === "function"
          ? nextOrUpdater(current)
          : nextOrUpdater;
      routePointDragPreviewRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    routePointDragPreviewRef.current = routePointDragPreview;
  }, [routePointDragPreview]);

  useEffect(() => {
    if (enableRouteDirectionAnimation || !directionAnimatorRef.current) {
      return undefined;
    }
    directionAnimatorRef.current.dispose();
    directionAnimatorRef.current = null;
    return undefined;
  }, [enableRouteDirectionAnimation]);

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

    const timeoutId = setTimeout(() => {
      dispatchRoute({ type: "route/clearError" });
    }, 3500);

    return () => clearTimeout(timeoutId);
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
    if (state.status !== "ready") return undefined;

    let disposed = false;

    async function initializeRouting() {
      try {
        const shardedSession = state.assets.baseRoutingShardManifestData
          ? await createShardedRouteSession(
              RouteManager,
              state.assets.geoJsonData,
              state.assets.segmentsData,
              state.assets.baseRoutingShardManifestData,
              createBaseRoutingShardFetchLoader(
                state.assets.baseRoutingShardManifestPath,
                {},
                getShardLoaderLocation(),
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
              RouteManager,
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

        const routeParam = getQueryParam("route");
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
            recordRecentRoute(setRecentRoutes, {
              param: routeParam,
              name: "מסלול משותף",
              distanceKm: Math.round((snapshot.distance / 1000) * 10) / 10,
            });
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
    if (!enableRouteDirectionAnimation) return;
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
  }, [enableRouteDirectionAnimation, routeState.geometry, routeState.points, isDragging]);

  const clearRouteUrl = useCallback(() => {
    if (!hasQueryParam("route")) return;
    removeUrlParam("route");
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

    // Adding a route point dismisses any open data-marker detail card.
    setMapUi((current) =>
      current.selectedDataMarker
        ? { ...current, selectedDataMarker: null }
        : current,
    );

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

  const handleRoutePointDragStart = useCallback((index) => {
    const startSnapshot = routeStateSnapshot(routeState);
    const point = startSnapshot.points[index];
    if (!point) return;

    dragStartSnapshotRef.current = startSnapshot;
    isDraggingRef.current = true;
    setIsDragging(true);
    setRoutePointDragPreviewState({
      mode: "move",
      index,
      points: startSnapshot.points,
      lng: point.lng,
      lat: point.lat,
    });
  }, [routeState, setRoutePointDragPreviewState]);

  const handleRouteLineDragStart = useCallback((insertIndex, point) => {
    const startSnapshot = routeStateSnapshot(routeState);
    dragStartSnapshotRef.current = startSnapshot;
    isDraggingRef.current = true;
    setIsDragging(true);
    setRoutePointDragPreviewState({
      mode: "insert",
      insertIndex,
      points: startSnapshot.points,
      lng: point.lng,
      lat: point.lat,
    });
  }, [routeState, setRoutePointDragPreviewState]);

  const updateRouteDragPreview = useCallback((point) => {
    if (state.status !== "ready") return;
    setRoutePointDragPreviewState((current) => {
      if (!current) return current;
      return {
        ...current,
        lng: point.lng,
        lat: point.lat,
      };
    });
  }, [setRoutePointDragPreviewState, state.status]);

  const handleRoutePointDrag = useCallback((index, point) => {
    updateRouteDragPreview(point);
  }, [updateRouteDragPreview]);

  const handleRouteLineDrag = useCallback((insertIndex, point) => {
    updateRouteDragPreview(point);
  }, [updateRouteDragPreview]);

  const handleRoutePointDragEnd = useCallback(async () => {
    const preview = routePointDragPreviewRef.current;
    if (!dragStartSnapshotRef.current || !preview) {
      dragStartSnapshotRef.current = null;
      setRoutePointDragPreviewState(null);
      isDraggingRef.current = false;
      setIsDragging(false);
      return;
    }

    const startSnapshot = dragStartSnapshotRef.current;
    dragStartSnapshotRef.current = null;
    isDraggingRef.current = false;
    setIsDragging(false);
    setRoutePointDragPreviewState(null);

    if (!routeManagerRef.current || state.status !== "ready") return;

    const nextPoints = routePointsFromDragPreview(preview);
    if (!nextPoints) return;

    try {
      const shardedSession = shardedRouteSessionRef.current;
      const snapshot = shardedSession
        ? await shardedSession.recalculatePoints(nextPoints)
        : recalculatePoints(
            routeManagerRef.current,
            nextPoints,
            state.assets.segmentsData,
          );
      if (shardedSession) {
        routeManagerRef.current = shardedSession.manager;
      }
      setRouteHistory((current) => ({
        past: [...current.past, startSnapshot],
        future: [],
      }));
      routeStateRef.current = routeStateFromSnapshot(
        routeStateRef.current,
        snapshot,
      );
      dispatchRoute({ type: "route/update", snapshot });
      const selectedIndex =
        preview.mode === "insert" ? preview.insertIndex : preview.index;
      setMapUi((current) => ({
        ...current,
        selectedRoutePointIndex: Number.isInteger(selectedIndex)
          ? selectedIndex
          : null,
      }));
      clearRouteUrl();
      trackRoutePointEvent(snapshot.points, snapshot.selectedSegments, "drag");
    } catch (error) {
      dispatchRoute({ type: "route/error", error });
    }
  }, [clearRouteUrl, setRoutePointDragPreviewState, state.assets, state.status]);

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
    setStoredItem(PLANNER_DRAFT_KEY, "");
    setPlannerDraft(null);
    trackRouteOperation("reset", previousSnapshot.points, previousSnapshot.selectedSegments, {
      cleared_points: previousSnapshot.points.length,
      cleared_segments: previousSnapshot.selectedSegments.length,
    });
  }, [clearRouteUrl, routeState]);

  // Loads an encoded route (the ?route= share format) into the live planner
  // session — the in-app path for "open this recommended route" without a
  // full page reload. Pushes the previous route state onto the undo stack,
  // requests a map fit to the loaded geometry, and mirrors the param onto the
  // URL. Returns false when the routing session isn't ready or the param
  // doesn't decode, so callers can fall back to a full-page restore.
  // Concurrent loads are rejected while one is already in flight.
  const handleLoadRouteParam = useCallback(
    async (routeParam) => {
      if (
        !routeParam ||
        !routeManagerRef.current ||
        state.status !== "ready" ||
        routeParamLoadingRef.current
      ) {
        return false;
      }
      routeParamLoadingRef.current = true;
      try {
        const shardedSession = shardedRouteSessionRef.current;
        const snapshot = shardedSession
          ? await shardedSession.restoreRouteParam(routeParam)
          : restoreRouteFromParam(
              routeManagerRef.current,
              routeParam,
              state.assets.segmentsData,
              state.assets.cwBaseIndexData,
            );
        // The routing session may have been torn down while we awaited
        // (initializeRouting cleanup nulls the refs); don't resurrect it.
        const sessionAlive = shardedSession
          ? shardedRouteSessionRef.current === shardedSession
          : routeManagerRef.current !== null;
        if (!sessionAlive) return false;
        if (shardedSession) {
          routeManagerRef.current = shardedSession.manager;
        }
        if (!snapshot) return false;
        const previousSnapshot = routeStateSnapshot(routeStateRef.current);
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
          routeFitRequest: {
            id: `select-${Date.now()}`,
            geometry: snapshot.geometry,
          },
        }));
        setUrlParam("route", routeParam);
        return true;
      } catch (error) {
        dispatchRoute({ type: "route/error", error });
        return false;
      } finally {
        routeParamLoadingRef.current = false;
      }
    },
    [state.assets, state.status],
  );

  // Records a route in the recents list ("המסלולים שלי"). Callers supply the
  // best name they have (catalog name for Discover selects, a generic label
  // for downloads of a hand-built route).
  const handleAddRecentRoute = useCallback((entry) => {
    recordRecentRoute(setRecentRoutes, entry);
  }, []);

  // Restores the autosaved draft into the live session. Dismissing the offer
  // deletes the stored draft; restoring leaves autosave in charge of the route.
  const handleRestoreDraft = useCallback(async () => {
    const draft = plannerDraft;
    setPlannerDraft(null);
    if (!draft?.param) return false;
    return handleLoadRouteParam(draft.param);
  }, [plannerDraft, handleLoadRouteParam]);

  const handleDismissDraft = useCallback(() => {
    setStoredItem(PLANNER_DRAFT_KEY, "");
    setPlannerDraft(null);
  }, []);

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

  const handleDataMarkerClick = useCallback((dataMarker) => {
    setMapUi((current) => ({
      ...current,
      selectedDataMarker: dataMarker,
    }));
  }, []);

  // Clicking a route warning focuses the map on the landmark and opens its
  // detail card. The marker is flagged `onRoute` so the card hides "add to
  // route" (the point is already on the route). dataMarkerFocus is a camera
  // request both platforms watch (token bumps so identical coords re-trigger).
  const handleDataPointFocus = useCallback((dataPoint) => {
    const location = getDataPointLocation(dataPoint);
    if (!location) return;
    setMapUi((current) => ({
      ...current,
      selectedDataMarker: {
        id: dataPoint?.id,
        type: dataPoint?.type,
        emoji: dataPoint?.emoji || POI_EMOJIS[dataPoint?.type] || "📍",
        information: dataPoint?.information || "",
        segmentName: dataPoint?.segmentName || "",
        lng: location.lng,
        lat: location.lat,
        onRoute: true,
      },
      dataMarkerFocus: {
        lng: location.lng,
        lat: location.lat,
        token: (current.dataMarkerFocus?.token || 0) + 1,
      },
    }));
  }, []);

  const handleSelectedDataMarkerClear = useCallback(() => {
    setMapUi((current) =>
      current.selectedDataMarker
        ? { ...current, selectedDataMarker: null }
        : current,
    );
  }, []);

  // Append the marker's coordinate to the route, just like tapping the map there
  // (handleMapClick snaps the point and clears the selected marker).
  const handleAddDataMarkerToRoute = useCallback(
    (dataMarker) => {
      const lng = Number(dataMarker?.lng);
      const lat = Number(dataMarker?.lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
      handleMapClick({ lng, lat });
    },
    [handleMapClick],
  );

  const handleRoutePointSelect = useCallback((index) => {
    setMapUi((current) => ({
      ...current,
      selectedRoutePointIndex: index,
    }));
  }, []);

  // One-shot locate-me: resolves the device position (permission is requested
  // by the browser only at this tap), stores a fix for the map marker and the
  // Discover near-me labels, and flags whether it's inside the map area so the
  // camera only flies to in-bounds fixes. Never watches/tracks position.
  const handleLocateMe = useCallback(async () => {
    setMapUi((current) => ({
      ...current,
      locateStatus: "locating",
      searchError: null,
    }));
    try {
      const fix = await getCurrentPosition();
      const bounds = getGeoJsonCoordinateBounds(state.assets.geoJsonData);
      const withinBounds = isPointWithinBounds(
        { lat: fix.lat, lng: fix.lng },
        bounds,
      );
      setMapUi((current) => ({
        ...current,
        locateStatus: "idle",
        locationFix: { id: `locate-${Date.now()}`, ...fix, withinBounds },
        searchError: withinBounds ? null : "המיקום שלך מחוץ לאזור המפה",
      }));
    } catch {
      setMapUi((current) => ({
        ...current,
        locateStatus: "error",
        searchError: "לא הצלחנו לאתר את המיקום שלך",
      }));
    }
  }, [state.assets]);

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
    if (
      typeof window === "undefined" ||
      typeof window.addEventListener !== "function"
    ) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setMapUi((current) => ({
          ...current,
          downloadModalOpen: false,
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
  const shareInfo = useMemo(() => {
    if (
      state.status !== "ready" ||
      routeState.points.length === 0 ||
      !routeManagerRef.current
    ) {
      return { url: "", status: "unavailable", length: 0, format: null, param: "" };
    }

    return buildShareInfo(
      routeState,
      state.assets.segmentsData,
      routeManagerRef.current,
      getShardLoaderLocation(),
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

  // Autosave the in-progress route as a draft (the encoded ?route= param is
  // the storage format). Empty routes don't overwrite an existing draft —
  // clearing is explicit (handleRouteClear) or via restore/dismiss.
  useEffect(() => {
    if (!shareInfo.param || routeState.points.length === 0) return undefined;
    const timer = setTimeout(() => {
      setStoredItem(
        PLANNER_DRAFT_KEY,
        serializeDraft({
          param: shareInfo.param,
          distanceKm: Math.round((routeState.distance / 1000) * 10) / 10,
          savedAt: Date.now(),
        }),
      );
    }, 800);
    return () => clearTimeout(timer);
  }, [shareInfo.param, routeState.distance, routeState.points.length]);

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
    if (shareInfo.param) {
      recordRecentRoute(setRecentRoutes, {
        param: shareInfo.param,
        name: "מסלול שבניתי",
        distanceKm: Math.round((routeState.distance / 1000) * 10) / 10,
      });
    }
  }, [
    handleCloseDownload,
    routeState.distance,
    routeState.geometry,
    routeState.points,
    routeState.selectedSegments,
    shareInfo.param,
    shareUrl,
  ]);

  const hasBrokenRoute =
    routeState.points.length >= 2 && routeState.geometry.length < 2;
  const displayedRoutePoints = useMemo(
    () => [...routeState.points, ...routeState.pendingPoints],
    [routeState.pendingPoints, routeState.points],
  );

  return {
    welcomeWizardOpen,
    setWelcomeWizardOpen,
    state,
    mapUi,
    routeState,
    canUndo,
    canRedo,
    canDownload,
    hasBrokenRoute,
    activeDataPointIds,
    dataMarkerFeatures,
    routePointDragPreview,
    displayedRoutePoints,
    inspectedSegmentDetails,
    inspectedSegment,
    shareUrl,
    shareInfo,
    featureFlags,
    directionAnimatorRef,
    handleSearchSubmit,
    handleSearchQueryChange,
    handleLocateMe,
    handleUndo,
    handleRedo,
    handleRouteClear,
    handleLoadRouteParam,
    handleOpenDownload,
    handleCloseDownload,
    handleDownloadGpx,
    handleDataMarkerClick,
    handleDataPointFocus,
    handleSelectedDataMarkerClear,
    handleAddDataMarkerToRoute,
    handleMapClick,
    handleRoutePointDrag,
    handleRoutePointDragEnd,
    handleRoutePointDragStart,
    handleRoutePointRemove,
    handleRoutePointSelect,
    handleRouteLineDrag,
    handleRouteLineDragStart,
    handleSegmentFocus,
    handleSegmentHover,
    handleViewportIdle,
    handleElevationHover,
    plannerDraft,
    recentRoutes,
    handleRestoreDraft,
    handleDismissDraft,
    handleAddRecentRoute,
  };
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

function routingShardFormat() {
  const format = getQueryParam("routingShardFormat");
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

function routePointsFromDragPreview(preview) {
  const cursor = routePointDragCursor(preview);
  if (!cursor || !Array.isArray(preview?.points)) return null;

  if (preview.mode === "insert") {
    const insertIndex = Math.max(
      0,
      Math.min(preview.insertIndex, preview.points.length),
    );
    return [
      ...preview.points.slice(0, insertIndex).map((point) => ({ ...point })),
      {
        id: `route-point-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        lat: cursor.lat,
        lng: cursor.lng,
      },
      ...preview.points.slice(insertIndex).map((point) => ({ ...point })),
    ];
  }

  if (!Number.isInteger(preview.index)) return null;
  return preview.points.map((point, index) =>
    index === preview.index
      ? routePointWithCoordinates(point, cursor)
      : { ...point },
  );
}

function routePointDragCursor(preview) {
  const lat = Number(preview?.lat);
  const lng = Number(preview?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function routePointWithCoordinates(point, cursor) {
  const {
    baseEdgeDistanceMeters,
    baseEdgeId,
    distanceMeters,
    segmentName,
    unsnapped,
    ...routePoint
  } = point || {};
  return {
    ...routePoint,
    lat: cursor.lat,
    lng: cursor.lng,
  };
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

  const feature = (geoJsonData?.features || []).find(
    (candidate) => candidate?.properties?.name === segmentName,
  );
  const roadType = feature?.properties?.roadType || null;

  if (managerMetrics) {
    return {
      distanceKm: managerMetrics.distanceKm,
      elevationGain: managerMetrics.forward?.elevationGain || 0,
      elevationLoss: managerMetrics.forward?.elevationLoss || 0,
      roadType,
      dataPoints,
    };
  }

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
    roadType,
    dataPoints,
  };
}
