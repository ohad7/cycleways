import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Mapbox, {
  Camera,
  CircleLayer,
  LineLayer,
  MapView,
  ShapeSource,
  SymbolLayer,
  UserLocation,
  UserLocationRenderMode,
  UserTrackingMode,
} from "@rnmapbox/maps";
import { useCyclewaysApp } from "@cycleways/core/app/useCyclewaysApp.js";
import { dataMarkerFeatureCollection } from "@cycleways/core/data/dataMarkers.js";
import { POI_LABELS, POI_COLORS } from "@cycleways/core/data/poiTypes.js";
import { loadRouteCatalogEntries } from "@cycleways/core/data/catalog.js";
import { navigationRouteFromRouteState } from "@cycleways/core/navigation/navigationRoute.js";
import {
  DATA_MARKERS_STYLE,
  ROUTE_DIRECTION_PULSE_CASING_STYLE,
  ROUTE_DIRECTION_PULSE_CORE_STYLE,
} from "@cycleways/core/map/mapStyles.js";
import { MAP_INITIAL_CAMERA } from "@cycleways/core/map/mapViewport.js";
import { buildRouteDirectionPulseFeatureCollection } from "@cycleways/core/map/routeDirectionPulse.js";
import { buildRoutePointDragPreviewFeatureCollection } from "@cycleways/core/map/routeDragPreview.js";
import DataMarkerImages, {
  NATIVE_DATA_MARKER_ICON_NAMESPACE,
} from "./DataMarkerImages.jsx";
import ElevationProfileChart from "./ElevationProfileChart.jsx";
import RichText from "./RichText.jsx";
import PlannerSheet from "./planner/PlannerSheet.jsx";
import TopSearch from "./planner/TopSearch.jsx";
import MapControls from "./planner/MapControls.jsx";
import DiscoverPanel from "./planner/DiscoverPanel.jsx";
import NavPanel from "./planner/NavPanel.jsx";
import { useNavigationSession } from "./navigation/useNavigationSession.js";
import Icon from "./planner/Icon.jsx";
import { palette } from "./planner/theme.js";
import { prepareRouteNetworkFeatures } from "@cycleways/core/domain/routeNetwork.js";
import { getRoutePlannerPresentation } from "@cycleways/core/ui/routePlannerPresentation.js";

// Legacy planner icon names -> Ionicons names (same set the web Icon.jsx uses).
const CHROME_IONICON = {
  search: "search-outline",
  undo: "arrow-undo-outline",
  redo: "arrow-redo-outline",
  trash: "trash-outline",
};

// Publishable token, inlined by Expo at build from EXPO_PUBLIC_MAPBOX_TOKEN.
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "";
Mapbox.setAccessToken(MAPBOX_TOKEN);

// camelCase form of the shared ROUTE_NETWORK_LINE_STYLE paint; reads the same
// routeColor/routeWidth/routeOpacity properties core bakes into each feature.
const NETWORK_LINE_STYLE = {
  lineColor: ["get", "routeColor"],
  lineWidth: ["get", "routeWidth"],
  lineOpacity: ["get", "routeOpacity"],
  lineJoin: "round",
  lineCap: "round",
};

const ROUTE_LINE_STYLE = {
  lineColor: "#006699",
  lineWidth: 5,
  lineOpacity: 0.9,
  lineJoin: "round",
  lineCap: "round",
};

const ROUTE_DIRECTION_PULSE_CASING_LINE_STYLE = {
  lineColor: ROUTE_DIRECTION_PULSE_CASING_STYLE.paint["line-color"],
  lineWidth: ROUTE_DIRECTION_PULSE_CASING_STYLE.paint["line-width"],
  lineOpacity: ROUTE_DIRECTION_PULSE_CASING_STYLE.paint["line-opacity"],
  lineBlur: ROUTE_DIRECTION_PULSE_CASING_STYLE.paint["line-blur"],
  lineJoin: ROUTE_DIRECTION_PULSE_CASING_STYLE.layout["line-join"],
  lineCap: ROUTE_DIRECTION_PULSE_CASING_STYLE.layout["line-cap"],
};

const ROUTE_DIRECTION_PULSE_CORE_LINE_STYLE = {
  lineGradient: ROUTE_DIRECTION_PULSE_CORE_STYLE.paint["line-gradient"],
  lineWidth: ROUTE_DIRECTION_PULSE_CORE_STYLE.paint["line-width"],
  lineOpacity: ROUTE_DIRECTION_PULSE_CORE_STYLE.paint["line-opacity"],
  lineJoin: ROUTE_DIRECTION_PULSE_CORE_STYLE.layout["line-join"],
  lineCap: ROUTE_DIRECTION_PULSE_CORE_STYLE.layout["line-cap"],
};

const ROUTE_POINT_STYLE = {
  circleRadius: [
    "case",
    ["boolean", ["get", "pending"], false],
    5.5,
    ["!=", ["get", "endpoint"], "middle"],
    5,
    ["boolean", ["get", "selected"], false],
    4.8,
    4.2,
  ],
  circleColor: [
    "case",
    ["boolean", ["get", "pending"], false],
    "rgba(255, 255, 255, 0.2)",
    ["==", ["get", "endpoint"], "start"],
    "#18a957",
    ["==", ["get", "endpoint"], "end"],
    "#c84c45",
    ["boolean", ["get", "selected"], false],
    "rgba(255, 255, 255, 0.16)",
    "rgba(255, 255, 255, 0.08)",
  ],
  circleOpacity: 1,
  circleStrokeWidth: [
    "case",
    ["boolean", ["get", "pending"], false],
    1.4,
    ["!=", ["get", "endpoint"], "middle"],
    1.2,
    1,
  ],
  circleStrokeColor: "#ffffff",
};

const SEARCH_HIGHLIGHT_STYLE = {
  circleRadius: 10,
  circleColor: "rgba(30, 102, 140, 0.18)",
  circleStrokeColor: "#1e668c",
  circleStrokeWidth: 2.5,
  circleStrokeOpacity: 0.95,
};

const SEARCH_HIGHLIGHT_CORE_STYLE = {
  circleRadius: 4.5,
  circleColor: "#ffffff",
  circleStrokeColor: "#1e668c",
  circleStrokeWidth: 2,
};

const DRAG_PREVIEW_CASING_STYLE = {
  lineColor: "#ffffff",
  lineWidth: 6,
  lineOpacity: 0.95,
  lineCap: "round",
  lineJoin: "round",
};
const DRAG_PREVIEW_LINE_STYLE = {
  lineColor: "#2b7bb9",
  lineWidth: 2.5,
  lineOpacity: 0.95,
  lineDasharray: [2, 1.5],
  lineCap: "round",
  lineJoin: "round",
};
const DRAG_PREVIEW_HALO_STYLE = {
  circleRadius: 8,
  circleColor: "#2b7bb9",
  circleStrokeColor: "#ffffff",
  circleStrokeWidth: 3,
  circleOpacity: 0.95,
};
const ELEVATION_SCRUB_STYLE = {
  circleRadius: 7,
  circleColor: "#74b8c8",
  circleStrokeColor: "#ffffff",
  circleStrokeWidth: 2,
  circlePitchAlignment: "map",
};

const DATA_MARKER_SYMBOL_STYLE = {
  iconImage: DATA_MARKERS_STYLE.layout["icon-image"],
  iconSize: DATA_MARKERS_STYLE.layout["icon-size"],
  iconAllowOverlap: DATA_MARKERS_STYLE.layout["icon-allow-overlap"],
  iconIgnorePlacement: DATA_MARKERS_STYLE.layout["icon-ignore-placement"],
  iconOpacity: DATA_MARKERS_STYLE.paint["icon-opacity"],
};

const INITIAL_CAMERA_SETTINGS = {
  ...MAP_INITIAL_CAMERA,
  animationDuration: 0,
  animationMode: "none",
};

const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };

// --- Touch intent tuning (see plans/mobile-map-gesture-intent/design.md) -----
// A touch within POINT_HIT_RADIUS px of a committed route point is a candidate
// to interact with it; anything farther pans the map or adds a point. Moving a
// point requires a deliberate long-press: hold for LONG_PRESS_MS without drifting
// more than LONG_PRESS_MAX_DRIFT px to "pick it up", then drag. A quick tap (no
// hold) selects; a drift before the hold fires cancels the grab. These are
// deliberately touch-sized and centralised here for easy on-device tuning.
const POINT_HIT_RADIUS = 18;
const LONG_PRESS_MS = 300;
const LONG_PRESS_MAX_DRIFT = 12;
// After touching a point, ignore the MapView onPress for this long so a tap that
// landed on a point does not also add a new one.
const ADD_GUARD_MS = 350;

export default function MapScreen() {
  const cameraRef = useRef(null);
  const routePointPressGuardRef = useRef(0);
  const [locationState, setLocationState] = useState({
    enabled: false,
    following: false,
    point: null,
    status: "idle",
  });
  // Front-panel mode (mirrors the web FrontPanel / PanelStateToggle): "discover"
  // browses the bundled route catalog, "build" is the planner. The native app
  // starts in build to keep the map-first planner as the primary surface.
  const [panelState, setPanelState] = useState("build");
  const [catalogEntries, setCatalogEntries] = useState([]);
  // Slug of the catalog route currently loaded in the planner; drives the Build
  // panel's "מסלול מומלץ" eyebrow. Cleared once the rider edits the route.
  const [selectedCatalogSlug, setSelectedCatalogSlug] = useState(null);
  const {
    state,
    mapUi,
    routeState,
    displayedRoutePoints,
    canUndo,
    canRedo,
    canDownload,
    directionAnimatorRef,
    activeDataPointIds,
    dataMarkerFeatures,
    shareInfo,
    shareUrl,
    handleMapClick,
    handleSearchQueryChange,
    handleSearchSubmit,
    handleUndo,
    handleRedo,
    handleRouteClear,
    handleLoadRouteParam,
    handleAddRecentRoute,
    handleOpenDownload,
    handleCloseDownload,
    handleDownloadGpx,
    handleRoutePointSelect,
    handleRoutePointDragStart,
    handleRoutePointDrag,
    handleRoutePointDragEnd,
    routePointDragPreview,
    handleDataMarkerClick,
    handleSelectedDataMarkerClear,
    handleAddDataMarkerToRoute,
    handleViewportIdle,
  } = useCyclewaysApp();

  const networkFeatures = useMemo(() => {
    if (state.status !== "ready") return EMPTY_FEATURE_COLLECTION;
    return {
      type: "FeatureCollection",
      features: prepareRouteNetworkFeatures(state.assets.geoJsonData),
    };
  }, [state.assets, state.status]);

  const routeGeometry = useMemo(
    () => buildRouteGeometryFeatureCollection(routeState.geometry),
    [routeState.geometry],
  );

  const searchHighlight = useMemo(
    () => buildSearchHighlightFeatureCollection(mapUi.searchHighlight),
    [mapUi.searchHighlight],
  );

  const dragPreview = useMemo(
    () => buildRoutePointDragPreviewFeatureCollection(routePointDragPreview),
    [routePointDragPreview],
  );

  const dataMarkers = useMemo(
    () =>
      dataMarkerFeatureCollection(dataMarkerFeatures, activeDataPointIds, {
        iconNamespace: NATIVE_DATA_MARKER_ICON_NAMESPACE,
      }),
    [activeDataPointIds, dataMarkerFeatures],
  );

  const routePoints = useMemo(
    () =>
      buildRoutePointFeatureCollection(
        displayedRoutePoints,
        mapUi.selectedRoutePointIndex,
      ),
    [displayedRoutePoints, mapUi.selectedRoutePointIndex],
  );

  // --- Waypoint drag (immediate, no long-press) ---------------------------
  // We run a PanResponder over the map: a touch that lands on a committed route
  // point and is HELD (long-press) "picks it up" and feeds the shared
  // handleRoutePointDrag* handlers as the finger moves; a quick tap selects the
  // point; anything else (no hold, or off-point) falls through to the map for
  // pan/zoom/add. Screen<->coord conversion goes through the MapView ref.
  const mapViewRef = useRef(null);
  const pointScreenPositionsRef = useRef([]);
  const dragRef = useRef({ index: null, armed: false, startX: 0, startY: 0 });
  const longPressTimerRef = useRef(null);
  const [pointGestureActive, setPointGestureActive] = useState(false);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const refreshPointScreenPositions = useCallback(async () => {
    const map = mapViewRef.current;
    if (!map) {
      pointScreenPositionsRef.current = [];
      return;
    }
    const positions = [];
    for (let index = 0; index < displayedRoutePoints.length; index++) {
      const point = displayedRoutePoints[index];
      if (point?.pending) continue;
      const lng = Number(point?.lng);
      const lat = Number(point?.lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      try {
        const screen = await map.getPointInView([lng, lat]);
        if (Array.isArray(screen) && screen.length >= 2) {
          positions.push({ index, x: screen[0], y: screen[1] });
        }
      } catch {
        // ignore points the map can't project right now
      }
    }
    pointScreenPositionsRef.current = positions;
  }, [displayedRoutePoints]);

  useEffect(() => {
    refreshPointScreenPositions();
  }, [refreshPointScreenPositions]);

  const hitTestRoutePoint = useCallback((x, y) => {
    let best = null;
    for (const pos of pointScreenPositionsRef.current) {
      const distance = Math.hypot(pos.x - x, pos.y - y);
      if (distance <= POINT_HIT_RADIUS && (!best || distance < best.distance)) {
        best = { index: pos.index, distance };
      }
    }
    return best ? best.index : null;
  }, []);

  const routePointPanResponder = useMemo(
    () =>
      PanResponder.create({
        // Single-finger touches that land on a committed point are point
        // candidates. Multi-finger touches (pinch zoom/rotate) are never
        // claimed so they pass straight through to Mapbox.
        onStartShouldSetPanResponder: (evt) =>
          !isNavigatingRef.current &&
          evt.nativeEvent.touches.length <= 1 &&
          hitTestRoutePoint(
            evt.nativeEvent.locationX,
            evt.nativeEvent.locationY,
          ) !== null,
        // Only stay with the point gesture once it has been "picked up" by a
        // long-press. Never hijack an in-progress map pan.
        onMoveShouldSetPanResponder: (evt) =>
          evt.nativeEvent.touches.length <= 1 && dragRef.current.armed,
        // Let the map reclaim the gesture (e.g. a pinch begins) until the point
        // has actually been picked up.
        onPanResponderTerminationRequest: () => !dragRef.current.armed,
        onPanResponderGrant: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          const index =
            evt.nativeEvent.touches.length <= 1
              ? hitTestRoutePoint(locationX, locationY)
              : null;
          dragRef.current = {
            index,
            armed: false,
            startX: locationX,
            startY: locationY,
          };
          clearLongPressTimer();
          if (index !== null) {
            routePointPressGuardRef.current = Date.now();
            setPointGestureActive(true);
            // Hold in place to pick the point up; movement/lift before this
            // fires cancels it (handled in move/release).
            longPressTimerRef.current = setTimeout(() => {
              longPressTimerRef.current = null;
              if (dragRef.current.index === index && !dragRef.current.armed) {
                dragRef.current.armed = true;
                routePointPressGuardRef.current = Date.now();
                handleRoutePointDragStart(index);
              }
            }, LONG_PRESS_MS);
          }
        },
        onPanResponderMove: (evt) => {
          const drag = dragRef.current;
          if (drag.index === null) return;
          // A second finger arrived before pick-up: abort so Mapbox can pinch.
          if (!drag.armed && evt.nativeEvent.touches.length > 1) {
            clearLongPressTimer();
            dragRef.current = { index: null, armed: false, startX: 0, startY: 0 };
            setPointGestureActive(false);
            return;
          }
          const { locationX, locationY } = evt.nativeEvent;
          if (!drag.armed) {
            // Drifting before the long-press fires cancels the grab; the point
            // is no longer a candidate, so the release won't select or move it.
            if (
              Math.hypot(locationX - drag.startX, locationY - drag.startY) >=
              LONG_PRESS_MAX_DRIFT
            ) {
              clearLongPressTimer();
              dragRef.current = { index: null, armed: false, startX: 0, startY: 0 };
              setPointGestureActive(false);
            }
            return;
          }
          // Picked up: the point follows the finger.
          const map = mapViewRef.current;
          if (!map) return;
          map
            .getCoordinateFromView([locationX, locationY])
            .then((coord) => {
              if (
                dragRef.current.armed &&
                dragRef.current.index === drag.index &&
                Array.isArray(coord) &&
                coord.length >= 2
              ) {
                handleRoutePointDrag(drag.index, {
                  lng: coord[0],
                  lat: coord[1],
                });
              }
            })
            .catch(() => {});
        },
        onPanResponderRelease: () => {
          const drag = dragRef.current;
          clearLongPressTimer();
          if (drag.index !== null) {
            if (drag.armed) {
              handleRoutePointDragEnd();
            } else {
              // Quick tap (released before the long-press) selects the point.
              handleRoutePointSelect(drag.index);
            }
          }
          dragRef.current = { index: null, armed: false, startX: 0, startY: 0 };
          setPointGestureActive(false);
        },
        onPanResponderTerminate: () => {
          clearLongPressTimer();
          if (dragRef.current.armed) handleRoutePointDragEnd();
          dragRef.current = { index: null, armed: false, startX: 0, startY: 0 };
          setPointGestureActive(false);
        },
      }),
    [
      clearLongPressTimer,
      hitTestRoutePoint,
      handleRoutePointDragStart,
      handleRoutePointDrag,
      handleRoutePointDragEnd,
      handleRoutePointSelect,
    ],
  );

  const [scrubPoint, setScrubPoint] = useState(null);

  const scrubMarker = useMemo(() => {
    const coord = scrubPoint?.coord;
    if (!coord || !Number.isFinite(coord.lng) || !Number.isFinite(coord.lat)) {
      return EMPTY_FEATURE_COLLECTION;
    }
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [coord.lng, coord.lat] },
        },
      ],
    };
  }, [scrubPoint]);
  const routePresentation = useMemo(
    () =>
      getRoutePlannerPresentation(
        routeState,
        mapUi.selectedRoutePointIndex,
      ),
    [mapUi.selectedRoutePointIndex, routeState],
  );

  const handleMapPress = useCallback(
    (feature) => {
      if (state.status !== "ready") return;
      if (isNavigatingRef.current) return; // route edits are locked while navigating
      if (Date.now() - routePointPressGuardRef.current < ADD_GUARD_MS) return;
      const point = pointFromFeature(feature);
      if (!point) return;
      setSelectedCatalogSlug(null);
      handleMapClick(point);
    },
    [handleMapClick, state.status],
  );

  const handleDataMarkerPress = useCallback(
    (event) => {
      if (isNavigatingRef.current) return; // marker add-to-route is locked while navigating
      const marker = dataMarkerFromPressEvent(event);
      if (!marker) return;
      handleDataMarkerClick(marker);
    },
    [handleDataMarkerClick],
  );

  const stopFollowingLocation = useCallback(() => {
    setLocationState((current) => {
      if (!current.following) return current;
      return {
        ...current,
        following: false,
        status: current.point ? "located" : "idle",
      };
    });
  }, []);

  const handleUserLocationUpdate = useCallback((location) => {
    const point = pointFromLocationEvent(location);
    if (!point) return;
    setLocationState((current) => ({
      ...current,
      enabled: true,
      point,
      status: current.following ? "following" : "located",
    }));
  }, []);

  const handleLocatePress = useCallback(() => {
    if (locationState.following) {
      stopFollowingLocation();
      return;
    }

    setLocationState((current) => ({
      ...current,
      enabled: true,
      following: true,
      status: current.point ? "following" : "locating",
    }));

    if (locationState.point) {
      cameraRef.current?.setCamera?.({
        type: "CameraStop",
        centerCoordinate: [locationState.point.lng, locationState.point.lat],
        zoomLevel: 14.5,
        animationDuration: 500,
        animationMode: "easeTo",
      });
    }
  }, [locationState.following, locationState.point, stopFollowingLocation]);

  const submitSearch = useCallback(() => {
    Keyboard.dismiss();
    handleSearchSubmit({ preventDefault() {} });
  }, [handleSearchSubmit]);

  const shareRoute = useCallback(() => {
    if (!shareUrl) return;
    void Share.share({
      title: "שיתוף המסלול",
      message: shareUrl,
      url: shareUrl,
    }).catch((error) => {
      console.warn("Native route share failed:", error);
    });
  }, [shareUrl]);

  // Load the bundled route catalog once for the native Discover list. The
  // catalog already loads through the native asset adapter (see
  // @cycleways/core/data/catalog.js + bundledAssets.native.js).
  useEffect(() => {
    let cancelled = false;
    loadRouteCatalogEntries()
      .then((entries) => {
        if (!cancelled) setCatalogEntries(Array.isArray(entries) ? entries : []);
      })
      .catch((error) => {
        console.warn("Native route catalog load failed:", error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedCatalogEntry = useMemo(
    () =>
      selectedCatalogSlug
        ? catalogEntries.find((entry) => entry.slug === selectedCatalogSlug) ||
          null
        : null,
    [catalogEntries, selectedCatalogSlug],
  );

  // --- Turn-by-turn navigation (Phase 8) ----------------------------------
  // Normalize the loaded route (built or catalog) into the shared NavigationRoute
  // the session consumes. Memoized on the route geometry + share token so its id
  // stays stable while navigating (edits are locked, so it will not churn).
  const navigationRoute = useMemo(
    () =>
      navigationRouteFromRouteState(routeState, shareInfo, {
        source: selectedCatalogEntry ? "catalog" : "built",
        slug: selectedCatalogEntry?.slug || "",
        name: selectedCatalogEntry?.name || "המסלול שלי",
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeState.geometry, shareInfo.param, selectedCatalogSlug],
  );

  const nav = useNavigationSession(navigationRoute);
  const navStatus = nav.state?.status ?? "idle";
  const isNavigating =
    navStatus === "navigating" ||
    navStatus === "off-route" ||
    navStatus === "paused" ||
    navStatus === "requesting-permission";

  // Ref mirror so the earlier-defined map-press / point-drag gesture handlers can
  // lock out route edits while navigating without a declaration-order dependency.
  const isNavigatingRef = useRef(false);
  useEffect(() => {
    isNavigatingRef.current = isNavigating;
  }, [isNavigating]);

  // Discover -> Build: restore the catalog entry's encoded route token through
  // the same shared path used by deep links, record it in recents, and switch
  // to the planner. The map auto-fits via the routeFitRequest effect.
  const handleSelectCatalogRoute = useCallback(
    async (entry) => {
      if (!entry?.route) return;
      const loaded = await handleLoadRouteParam(entry.route);
      if (!loaded) return;
      setSelectedCatalogSlug(entry.slug ?? null);
      setPanelState("build");
      handleAddRecentRoute?.({
        name: entry.name,
        slug: entry.slug,
        param: entry.route,
        source: "catalog",
      });
    },
    [handleAddRecentRoute, handleLoadRouteParam],
  );

  // Any hand edit detaches the route from the catalog entry it was loaded from.
  const handleClearRoute = useCallback(() => {
    setSelectedCatalogSlug(null);
    handleRouteClear();
  }, [handleRouteClear]);

  const handleMapIdle = useCallback(
    (mapState) => {
      refreshPointScreenPositions();
      const bounds = boundsFromMapState(mapState);
      if (!bounds) return;
      handleViewportIdle(bounds);
    },
    [handleViewportIdle, refreshPointScreenPositions],
  );

  const fitRoute = useCallback(() => {
    stopFollowingLocation();
    fitCameraToPoints(
      cameraRef.current,
      routeState.geometry.length >= 2 ? routeState.geometry : routeState.points,
    );
  }, [routeState.geometry, routeState.points, stopFollowingLocation]);

  useEffect(() => {
    if (!mapUi.routeFitRequest) return;
    stopFollowingLocation();
    fitCameraToPoints(cameraRef.current, mapUi.routeFitRequest.geometry);
  }, [mapUi.routeFitRequest, stopFollowingLocation]);

  useEffect(() => {
    const point = pointFromSearchHighlight(mapUi.searchHighlight);
    if (!point) return;
    stopFollowingLocation();
    cameraRef.current?.setCamera?.({
      type: "CameraStop",
      centerCoordinate: [point.lng, point.lat],
      zoomLevel: 12.8,
      animationDuration: 650,
      animationMode: "easeTo",
    });
  }, [mapUi.searchHighlight, stopFollowingLocation]);

  // Clicking a route warning focuses the camera on the landmark (token changes
  // each request so re-tapping the same warning re-centres).
  useEffect(() => {
    const focus = mapUi.dataMarkerFocus;
    const lng = Number(focus?.lng);
    const lat = Number(focus?.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    stopFollowingLocation();
    cameraRef.current?.setCamera?.({
      type: "CameraStop",
      centerCoordinate: [lng, lat],
      zoomLevel: 14.5,
      animationDuration: 600,
      animationMode: "easeTo",
    });
  }, [mapUi.dataMarkerFocus, stopFollowingLocation]);

  useEffect(() => {
    if (!routeState.points || routeState.points.length === 0) {
      setScrubPoint(null);
    }
  }, [routeState.points]);

  if (!MAPBOX_TOKEN) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>
          Set EXPO_PUBLIC_MAPBOX_TOKEN (your pk... token) and rebuild.
        </Text>
      </View>
    );
  }

  if (state.status === "loading") {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>Loading offline map data...</Text>
      </View>
    );
  }

  if (state.status === "error") {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>
          Could not load bundled map data: {state.error?.message}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.fill} {...routePointPanResponder.panHandlers}>
      <MapView
        ref={mapViewRef}
        style={styles.fill}
        styleURL={Mapbox.StyleURL.Outdoors}
        scrollEnabled={!pointGestureActive}
        onPress={handleMapPress}
        onMapIdle={handleMapIdle}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={INITIAL_CAMERA_SETTINGS}
          animationDuration={0}
          animationMode="none"
          followUserLocation={
            locationState.following ||
            (isNavigating &&
              navStatus !== "paused" &&
              nav.state?.cameraIntent === "follow")
          }
          followUserMode={UserTrackingMode.FollowWithHeading}
          followZoomLevel={isNavigating ? 16.5 : 14.5}
        />
        {locationState.enabled || isNavigating ? (
          <UserLocation
            visible
            onUpdate={handleUserLocationUpdate}
            renderMode={UserLocationRenderMode.Native}
            showsUserHeadingIndicator
          />
        ) : null}
        <ShapeSource id="network" shape={networkFeatures}>
          <LineLayer id="network-line" style={NETWORK_LINE_STYLE} />
        </ShapeSource>
        <ShapeSource id="route-geometry" shape={routeGeometry}>
          <LineLayer id="route-line" style={ROUTE_LINE_STYLE} />
        </ShapeSource>
        <RouteDirectionPulseLayer
          animator={directionAnimatorRef.current}
          routeGeometry={routeState.geometry}
        />
        <DataMarkerImages />
        <ShapeSource id="search-highlight" shape={searchHighlight}>
          <CircleLayer
            id="search-highlight-halo"
            style={SEARCH_HIGHLIGHT_STYLE}
          />
          <CircleLayer
            id="search-highlight-core"
            style={SEARCH_HIGHLIGHT_CORE_STYLE}
          />
        </ShapeSource>
        <ShapeSource
          id="data-markers"
          shape={dataMarkers}
          hitbox={{ width: 44, height: 44 }}
          onPress={handleDataMarkerPress}
        >
          <SymbolLayer
            id="data-markers-symbol"
            style={DATA_MARKER_SYMBOL_STYLE}
          />
        </ShapeSource>
        <ShapeSource id="elevation-scrub" shape={scrubMarker}>
          <CircleLayer id="elevation-scrub-core" style={ELEVATION_SCRUB_STYLE} />
        </ShapeSource>
        <ShapeSource id="route-drag-preview" shape={dragPreview}>
          <LineLayer
            id="route-drag-preview-casing"
            filter={["==", ["geometry-type"], "LineString"]}
            style={DRAG_PREVIEW_CASING_STYLE}
          />
          <LineLayer
            id="route-drag-preview-line"
            filter={["==", ["geometry-type"], "LineString"]}
            style={DRAG_PREVIEW_LINE_STYLE}
          />
          <CircleLayer
            id="route-drag-preview-halo"
            filter={["==", ["geometry-type"], "Point"]}
            style={DRAG_PREVIEW_HALO_STYLE}
          />
        </ShapeSource>
        <ShapeSource id="route-points" shape={routePoints}>
          <CircleLayer id="route-points-circle" style={ROUTE_POINT_STYLE} />
        </ShapeSource>
      </MapView>
      {!isNavigating ? (
        <>
          <TopSearch
            query={mapUi.searchQuery}
            onChange={handleSearchQueryChange}
            onSubmit={submitSearch}
            busy={mapUi.searchStatus === "searching"}
            error={mapUi.searchError}
          />
          <MapControls
            onLocate={handleLocatePress}
            onFit={fitRoute}
            following={locationState.following}
          />
        </>
      ) : null}
      <DataMarkerCard
        marker={mapUi.selectedDataMarker}
        onAddToRoute={handleAddDataMarkerToRoute}
        onClose={handleSelectedDataMarkerClear}
      />
      <RouteSummaryModal
        activeDataPoints={routeState.activeDataPoints}
        canDownload={canDownload}
        onClose={handleCloseDownload}
        onDownloadGpx={handleDownloadGpx}
        onShareRoute={shareRoute}
        presentation={routePresentation}
        routeState={routeState}
        shareStatus={shareInfo.status}
        shareUrlLength={shareInfo.length}
        shareUrl={shareUrl}
        visible={mapUi.downloadModalOpen}
      />
      {isNavigating ? (
        <NavPanel
          sessionState={nav.state}
          onRecenter={nav.recenter}
          onPauseResume={() =>
            navStatus === "paused" ? nav.resume() : nav.pause()
          }
          onStop={nav.stop}
        />
      ) : (
        <PlannerSheet
          panelState={panelState}
          onPanelStateChange={setPanelState}
          discover={
            <DiscoverPanel
              entries={catalogEntries}
              onSelect={handleSelectCatalogRoute}
              fix={
                locationState.enabled && locationState.point
                  ? {
                      lat: locationState.point.lat,
                      lng: locationState.point.lng,
                    }
                  : null
              }
            />
          }
          build={
            <BuildPanelContent
              animator={directionAnimatorRef.current}
              canDownload={canDownload}
              canRedo={canRedo}
              canShare={Boolean(shareUrl) && shareInfo.status !== "too_long"}
              canUndo={canUndo}
              catalogEntry={selectedCatalogEntry}
              locationState={locationState}
              onClear={handleClearRoute}
              onOpenSummary={handleOpenDownload}
              onRedo={handleRedo}
              onScrub={setScrubPoint}
              onShare={shareRoute}
              onStartNavigation={nav.start}
              onUndo={handleUndo}
              presentation={routePresentation}
              routePoints={displayedRoutePoints}
              routeState={routeState}
            />
          }
        />
      )}
    </View>
  );
}

function RouteDirectionPulseLayer({ animator, routeGeometry }) {
  const [routePulse, setRoutePulse] = useState(EMPTY_FEATURE_COLLECTION);

  useEffect(() => {
    if (!animator) return undefined;

    const unsubscribe = animator.subscribe("chevron", (payload) => {
      setRoutePulse(
        payload
          ? buildRouteDirectionPulseFeatureCollection(routeGeometry, payload.t)
          : EMPTY_FEATURE_COLLECTION,
      );
    });

    return () => {
      unsubscribe();
      setRoutePulse(EMPTY_FEATURE_COLLECTION);
    };
  }, [animator, routeGeometry]);

  return (
    <ShapeSource id="route-direction-pulse" lineMetrics shape={routePulse}>
      <LineLayer
        id="route-direction-pulse-casing"
        style={ROUTE_DIRECTION_PULSE_CASING_LINE_STYLE}
      />
      <LineLayer
        id="route-direction-pulse-core"
        style={ROUTE_DIRECTION_PULSE_CORE_LINE_STYLE}
      />
    </ShapeSource>
  );
}

function BuildPanelContent({
  animator,
  canDownload,
  canRedo,
  canShare,
  canUndo,
  catalogEntry,
  locationState,
  onClear,
  onOpenSummary,
  onRedo,
  onScrub,
  onShare,
  onStartNavigation,
  onUndo,
  presentation,
  routePoints,
  routeState,
}) {
  const hasPoints = routePoints.length > 0;
  const hasElevationProfile = routeState.geometry.length >= 2;
  const locationText = locationStatusText(locationState);
  const routeMessage = routeState.error
    ? routeState.error.message || "לא הצלחנו לעדכן את המסלול"
    : presentation.message;

  return (
    <ScrollView
      contentContainerStyle={styles.buildBody}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.buildHead}>
        <View style={styles.buildHeadText}>
          <Text style={styles.buildEyebrow}>
            {catalogEntry ? "מסלול מומלץ" : "המסלול שלי · טיוטה"}
          </Text>
          <Text style={styles.buildTitle} numberOfLines={1}>
            {catalogEntry?.name || "מסלול חדש"}
          </Text>
        </View>
        <View style={styles.buildTools}>
          <ChromeButton
            compact
            rail
            disabled={!canUndo}
            icon="undo"
            label=""
            onPress={onUndo}
            accessibilityLabel="ביטול"
          />
          <ChromeButton
            compact
            rail
            disabled={!canRedo}
            icon="redo"
            label=""
            onPress={onRedo}
            accessibilityLabel="חזרה"
          />
          <ChromeButton
            compact
            rail
            disabled={!hasPoints}
            icon="trash"
            label=""
            onPress={onClear}
            accessibilityLabel="איפוס מסלול"
            testID="tool-clear"
          />
        </View>
      </View>

      <Text style={routeState.error ? styles.errorText : styles.routeMessage}>
        {routeMessage}
      </Text>

      {hasPoints ? (
        <View testID="route-stats" style={styles.statGrid}>
          {presentation.stats.map(([label, value]) => (
            <View key={label} style={styles.statTile}>
              <Text style={styles.statValue}>{value}</Text>
              <Text style={styles.statLabel}>{label}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {presentation.warnings.length > 0 ? (
        <View style={styles.warningList}>
          {presentation.warnings.map((warning) => (
            <Text key={warning} style={styles.warningText}>
              {warning}
            </Text>
          ))}
        </View>
      ) : null}

      {locationText ? (
        <Text style={styles.locationText}>{locationText}</Text>
      ) : null}

      {hasElevationProfile ? (
        <ElevationProfileChart
          animator={animator}
          distance={routeState.distance}
          geometry={routeState.geometry}
          onScrub={onScrub}
        />
      ) : null}

      {canDownload ? (
        <>
          <View style={styles.buildActions}>
            <ChromeButton
              label="סיכום"
              onPress={onOpenSummary}
              accessibilityLabel="סיכום ושיתוף המסלול"
              testID="action-summary"
            />
            <ChromeButton
              disabled={!canShare}
              label="שיתוף"
              onPress={onShare}
              accessibilityLabel="שיתוף המסלול"
            />
          </View>
          <ChromeButton
            icon="navigate"
            label="התחל ניווט"
            onPress={onStartNavigation}
            primary
            accessibilityLabel="התחל ניווט מונחה במסלול"
            testID="action-start-navigation"
          />
        </>
      ) : null}
    </ScrollView>
  );
}

// Native equivalent of the web DiscoverPanel: a scrollable list of bundled
// catalog routes. Selecting a card loads the route into the planner.
function DataMarkerCard({ marker, onAddToRoute, onClose }) {
  if (!marker) return null;
  const label = POI_LABELS[marker.type] || marker.type || "מידע";
  const accent = POI_COLORS[marker.type] || "#4682B4";
  const hasCoords =
    Number.isFinite(Number(marker.lng)) && Number.isFinite(Number(marker.lat));

  return (
    <View pointerEvents="box-none" style={styles.markerCardWrap}>
      <View style={[styles.markerCard, { borderColor: accent }]}>
        <View style={styles.markerCardHeader}>
          <View style={styles.markerCardTitleRow}>
            <Text style={styles.markerCardEmoji}>{marker.emoji || "📍"}</Text>
            <Text style={[styles.markerCardTitle, { color: accent }]}>
              {label}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="סגירה"
            onPress={onClose}
            style={styles.markerCardClose}
          >
            <Text style={styles.markerCardCloseText}>×</Text>
          </Pressable>
        </View>
        {marker.segmentName ? (
          <Text style={styles.markerCardSegment}>{marker.segmentName}</Text>
        ) : null}
        <RichText style={styles.markerCardInfo} text={marker.information} />
        {hasCoords && !marker.onRoute ? (
          <View style={styles.markerCardActions}>
            <ChromeButton
              label="הוסף למסלול"
              onPress={() => onAddToRoute(marker)}
              primary
              accessibilityLabel="הוסף את הנקודה למסלול"
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function RouteSummaryModal({
  activeDataPoints = [],
  canDownload,
  onClose,
  onDownloadGpx,
  onShareRoute,
  presentation,
  routeState,
  shareStatus,
  shareUrlLength,
  shareUrl,
  visible,
}) {
  const hasSegments = routeState.selectedSegments.length > 0;
  const hasDataPoints = activeDataPoints.length > 0;
  const canShareRoute = Boolean(shareUrl) && shareStatus !== "too_long";

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.summaryModal}>
          <View style={styles.summaryHeader}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="סגירה"
              onPress={onClose}
              style={styles.summaryCloseButton}
            >
              <Text style={styles.summaryCloseText}>×</Text>
            </Pressable>
            <Text style={styles.summaryTitle}>סיכום המסלול</Text>
          </View>
          <ScrollView
            contentContainerStyle={styles.summaryBody}
            showsVerticalScrollIndicator={false}
          >
            <SummarySection title="נקודות המסלול">
              <Text style={styles.summaryText}>
                {routeState.points.length} נקודות במסלול
              </Text>
            </SummarySection>
            <SummarySection title="דרך המסלול">
              {hasSegments ? (
                routeState.selectedSegments.map((segmentName, index) => (
                  <Text
                    key={`${segmentName}-${index}`}
                    style={styles.summarySegmentText}
                  >
                    {index + 1}. {segmentName}
                  </Text>
                ))
              ) : (
                <Text style={styles.summaryMuted}>עדיין אין דרך במסלול</Text>
              )}
            </SummarySection>
            <SummarySection title="מידע חשוב על המסלול">
              {hasDataPoints ? (
                activeDataPoints.map((dataPoint) => (
                  <Text key={dataPoint.id} style={styles.summaryWarningText}>
                    {dataPoint.emoji} {dataPoint.information}
                  </Text>
                ))
              ) : (
                <Text style={styles.summaryMuted}>אין מידע מיוחד למסלול זה</Text>
              )}
            </SummarySection>
            <SummarySection title="תיאור המסלול">
              <Text style={styles.summaryText}>{presentation.message}</Text>
            </SummarySection>
            {shareUrl && shareStatus === "long" ? (
              <Text style={styles.summaryWarningText}>
                קישור השיתוף ארוך ({shareUrlLength} תווים) ועלול לא לעבוד בכל
                אפליקציה.
              </Text>
            ) : null}
            {shareUrl && shareStatus === "too_long" ? (
              <Text style={styles.summaryWarningText}>
                המסלול ארוך מדי לשיתוף כקישור ({shareUrlLength} תווים). אפשר
                להוריד GPX במקום.
              </Text>
            ) : null}
          </ScrollView>
          <View style={styles.summaryActions}>
            <ChromeButton
              disabled={!canDownload}
              label="GPX"
              onPress={onDownloadGpx}
            />
            <ChromeButton
              disabled={!canShareRoute}
              label="שיתוף מסלול"
              onPress={onShareRoute}
              primary
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SummarySection({ children, title }) {
  return (
    <View style={styles.summarySection}>
      <Text style={styles.summarySectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function ChromeButton({
  accessibilityLabel,
  buttonStyle,
  compact = false,
  disabled = false,
  icon,
  label,
  onPress,
  primary = false,
  rail = false,
  symbol = false,
  testID,
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chromeButton,
        compact ? styles.chromeButtonCompact : null,
        rail ? styles.chromeButtonRail : null,
        primary ? styles.chromeButtonPrimary : null,
        buttonStyle,
        pressed && !disabled ? styles.chromeButtonPressed : null,
        disabled ? styles.chromeButtonDisabled : null,
      ]}
    >
      {icon ? (
        <Icon
          name={CHROME_IONICON[icon] || icon}
          color={disabled ? palette.muted : primary ? palette.white : palette.ink}
          size={rail ? 19 : 16}
        />
      ) : null}
      {label ? (
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={[
            styles.chromeButtonText,
            primary ? styles.chromeButtonTextPrimary : null,
            symbol ? styles.chromeButtonTextSymbol : null,
            disabled ? styles.chromeButtonTextDisabled : null,
          ]}
        >
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

function locationStatusText(locationState) {
  if (!locationState?.enabled) return "";
  if (locationState.following) {
    return locationState.point ? "עוקב אחרי המיקום" : "מאתר מיקום...";
  }
  if (locationState.status === "locating") return "מאתר מיקום...";
  return "";
}

function buildRouteGeometryFeatureCollection(routeGeometry) {
  const coordinates = Array.isArray(routeGeometry)
    ? routeGeometry
        .map((point) => [Number(point?.lng), Number(point?.lat)])
        .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))
    : [];

  if (coordinates.length < 2) return EMPTY_FEATURE_COLLECTION;

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates },
        properties: { affected: false },
      },
    ],
  };
}

function buildRoutePointFeatureCollection(points, selectedRoutePointIndex) {
  if (!Array.isArray(points) || points.length === 0) {
    return EMPTY_FEATURE_COLLECTION;
  }

  const lastRoutePointIndex = points.length - 1;
  return {
    type: "FeatureCollection",
    features: points
      .map((point, index) => {
        const lng = Number(point?.lng);
        const lat = Number(point?.lat);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
        const endpoint =
          index === 0
            ? "start"
            : index === lastRoutePointIndex
              ? "end"
              : "middle";
        return {
          type: "Feature",
          id: point.id || `route-point-${index}`,
          geometry: {
            type: "Point",
            coordinates: [lng, lat],
          },
          properties: {
            id: point.id || `route-point-${index}`,
            index,
            endpoint,
            pending: Boolean(point.pending),
            selected: index === selectedRoutePointIndex,
          },
        };
      })
      .filter(Boolean),
  };
}

function buildSearchHighlightFeatureCollection(searchHighlight) {
  const point = pointFromSearchHighlight(searchHighlight);
  if (!point) return EMPTY_FEATURE_COLLECTION;

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [point.lng, point.lat],
        },
        properties: {
          label: searchHighlight.label || "",
        },
      },
    ],
  };
}

function pointFromFeature(feature) {
  const coordinates = feature?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const lng = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
}

function pointFromSearchHighlight(searchHighlight) {
  const lng = Number(searchHighlight?.lng);
  const lat = Number(searchHighlight?.lat);
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
}

function pointFromLocationEvent(location) {
  const coordinates =
    location?.geometry?.coordinates ||
    (location?.coords
      ? [location.coords.longitude, location.coords.latitude]
      : null) ||
    (location?.nativeEvent?.coords
      ? [
          location.nativeEvent.coords.longitude,
          location.nativeEvent.coords.latitude,
        ]
      : null);
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const lng = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
}

function routePointIndexFromPressEvent(event) {
  const feature = event?.features?.[0] || event?.nativeEvent?.features?.[0];
  const index = Number(feature?.properties?.index);
  return Number.isInteger(index) ? index : null;
}

function dataMarkerFromPressEvent(event) {
  const feature = event?.features?.[0] || event?.nativeEvent?.features?.[0];
  const properties = feature?.properties;
  const coordinates = feature?.geometry?.coordinates;
  if (!properties || !Array.isArray(coordinates) || coordinates.length < 2) {
    return null;
  }
  const lng = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  return {
    id: properties.dataPointId,
    type: properties.type,
    information: properties.information,
    segmentName: properties.segmentName,
    emoji: properties.emoji,
    lng: Number.isFinite(lng) ? lng : null,
    lat: Number.isFinite(lat) ? lat : null,
  };
}

function boundsFromMapState(mapState) {
  const ne = mapState?.properties?.bounds?.ne;
  const sw = mapState?.properties?.bounds?.sw;
  if (!Array.isArray(ne) || !Array.isArray(sw)) return null;
  const west = Number(sw[0]);
  const south = Number(sw[1]);
  const east = Number(ne[0]);
  const north = Number(ne[1]);
  if (![west, south, east, north].every(Number.isFinite)) return null;
  return { west, south, east, north };
}

function fitCameraToPoints(camera, points) {
  const normalizedPoints = Array.isArray(points)
    ? points
        .map((point) => ({
          lng: Number(point?.lng),
          lat: Number(point?.lat),
        }))
        .filter((point) => Number.isFinite(point.lng) && Number.isFinite(point.lat))
    : [];

  if (!camera || normalizedPoints.length === 0) return;

  if (normalizedPoints.length === 1) {
    const [point] = normalizedPoints;
    camera.setCamera?.({
      type: "CameraStop",
      centerCoordinate: [point.lng, point.lat],
      zoomLevel: 13.5,
      animationDuration: 450,
      animationMode: "easeTo",
    });
    return;
  }

  const west = Math.min(...normalizedPoints.map((point) => point.lng));
  const east = Math.max(...normalizedPoints.map((point) => point.lng));
  const south = Math.min(...normalizedPoints.map((point) => point.lat));
  const north = Math.max(...normalizedPoints.map((point) => point.lat));
  camera.fitBounds?.([east, north], [west, south], [96, 42, 84, 42], 550);
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  hint: { fontSize: 15, textAlign: "center", color: "#333" },
  markerCardWrap: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 14,
  },
  markerCard: {
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "rgba(255, 255, 255, 0.97)",
    borderWidth: 1.5,
    gap: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
  },
  markerCardHeader: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  markerCardTitleRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },
  markerCardEmoji: {
    fontSize: 20,
  },
  markerCardTitle: {
    fontSize: 16,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
    flexShrink: 1,
  },
  markerCardClose: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
    backgroundColor: "#f3f6f4",
  },
  markerCardCloseText: {
    color: "#333333",
    fontSize: 22,
    lineHeight: 24,
    fontWeight: "700",
  },
  markerCardSegment: {
    color: "#52616f",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
  },
  markerCardInfo: {
    color: "#333333",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "right",
    writingDirection: "rtl",
  },
  markerCardActions: {
    flexDirection: "row",
    justifyContent: "flex-start",
    marginTop: 2,
  },
  routeMessage: {
    color: "#333333",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
    textAlign: "right",
    writingDirection: "rtl",
  },
  warningList: {
    gap: 3,
  },
  warningText: {
    color: "#92400e",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
  },
  locationText: {
    color: "#52616f",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
  },
  errorText: {
    color: "#991b1b",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: 12,
    paddingBottom: 16,
    backgroundColor: "rgba(15, 23, 42, 0.28)",
  },
  summaryModal: {
    maxHeight: "78%",
    borderRadius: 6,
    overflow: "hidden",
    backgroundColor: "rgba(255, 255, 255, 0.98)",
    borderColor: "#c6d4cf",
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 18,
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomColor: "#d9e2de",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  summaryTitle: {
    flex: 1,
    color: "#172026",
    fontSize: 17,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  summaryCloseButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
    backgroundColor: "#f3f6f4",
  },
  summaryCloseText: {
    color: "#333333",
    fontSize: 24,
    lineHeight: 26,
    fontWeight: "700",
  },
  summaryBody: {
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  summarySection: {
    gap: 6,
  },
  summarySectionTitle: {
    color: "#172026",
    fontSize: 14,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  summaryText: {
    color: "#333333",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "right",
    writingDirection: "rtl",
  },
  summaryMuted: {
    color: "#666666",
    fontSize: 13,
    fontStyle: "italic",
    textAlign: "right",
    writingDirection: "rtl",
  },
  summarySegmentText: {
    color: "#333333",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "right",
    writingDirection: "rtl",
  },
  summaryWarningText: {
    color: "#92400e",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
  },
  summaryActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopColor: "#d9e2de",
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: "#f8faf9",
  },
  chromeButton: {
    minWidth: 50,
    minHeight: 40,
    paddingHorizontal: 10,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8f8f8",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 5,
  },
  chromeButtonCompact: {
    minHeight: 38,
    minWidth: 52,
    paddingHorizontal: 9,
  },
  chromeButtonRail: {
    width: 40,
    minWidth: 40,
    height: 40,
    minHeight: 40,
    borderRadius: 20,
    paddingHorizontal: 0,
    backgroundColor: palette.cream,
    shadowOpacity: 0,
  },
  chromeButtonPrimary: {
    backgroundColor: palette.forest,
  },
  chromeButtonPressed: {
    backgroundColor: "#e0e0e0",
  },
  chromeButtonDisabled: {
    backgroundColor: "#dddddd",
    shadowOpacity: 0,
  },
  chromeButtonText: {
    color: "#333333",
    fontSize: 13,
    fontWeight: "700",
  },
  chromeButtonTextSymbol: {
    fontSize: 21,
    fontWeight: "800",
    lineHeight: 24,
  },
  chromeButtonTextPrimary: {
    color: "#ffffff",
  },
  chromeButtonTextDisabled: {
    color: "#777777",
  },
  buildBody: {
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  buildHead: {
    flexDirection: "row-reverse",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  buildHeadText: {
    flexShrink: 1,
    flexGrow: 1,
  },
  buildEyebrow: {
    color: "#6b8f86",
    fontSize: 11,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  buildTitle: {
    color: "#172026",
    fontSize: 16,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  buildTools: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 4,
  },
  statGrid: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: 6,
  },
  statTile: {
    minWidth: 64,
    flexGrow: 1,
    flexBasis: 64,
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 4,
    backgroundColor: "#f3f6f4",
  },
  statValue: {
    color: "#172026",
    fontSize: 14,
    fontWeight: "800",
    writingDirection: "rtl",
  },
  statLabel: {
    color: "#52616f",
    fontSize: 10,
    fontWeight: "700",
    writingDirection: "rtl",
  },
  buildActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 2,
  },
});
