import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  Keyboard,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
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
import Svg, { Path } from "react-native-svg";
import { useCyclewaysApp } from "@cycleways/core/app/useCyclewaysApp.js";
import {
  catalogFilter,
  createEmptyCatalogFilters,
  DISCOVERY_FILTER_GROUPS,
  loadCatalog,
  loadPlaces,
  placeOptionsForEntries,
  routeDifficultyLabel,
  routeDisplayImage,
  routeMapImage,
  routePassesThroughPlaceIds,
  routeShapeLabel,
  routeStartPlaceIds,
  routeSurfaceLabel,
} from "@cycleways/core/data/catalog.js";
import { dataMarkerFeatureCollection } from "@cycleways/core/data/dataMarkers.js";
import {
  loadFeaturedRouteSnapshot,
  snapshotToRouteState,
} from "@cycleways/core/data/featuredRouteSnapshots.js";
import { IMAGE_ASSETS } from "@cycleways/core/platform/bundledAssets.native.js";
import { POI_LABELS, POI_COLORS } from "@cycleways/core/data/poiTypes.js";
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
import { prepareRouteNetworkFeatures } from "@cycleways/core/domain/routeNetwork.js";
import {
  getRoutePlannerPresentation,
  getRouteWarningPresentation,
} from "@cycleways/core/ui/routePlannerPresentation.js";

// Short placeholder for the narrow native search box (the shared web one,
// "ישוב/עיר, לדוגמא: דפנה", is too long to fit on the phone).
const SEARCH_PLACEHOLDER = "חיפוש יישוב/עיר";

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
    handleOpenDownload,
    handleCloseDownload,
    handleDownloadGpx,
    handleLoadRouteParam,
    handleAddRecentRoute,
    recentRoutes,
    handleRoutePointSelect,
    handleRoutePointDragStart,
    handleRoutePointDrag,
    handleRoutePointDragEnd,
    routePointDragPreview,
    handleDataMarkerClick,
    handleDataPointFocus,
    handleSelectedDataMarkerClear,
    handleAddDataMarkerToRoute,
    handleViewportIdle,
  } = useCyclewaysApp();
  const [panelMode, setPanelMode] = useState("build");
  const [catalogState, setCatalogState] = useState({
    status: "loading",
    catalog: null,
    places: [],
    error: null,
  });
  const [discoverFilters, setDiscoverFilters] = useState(() =>
    createEmptyCatalogFilters(),
  );
  const [detailEntry, setDetailEntry] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [catalog, places] = await Promise.all([
          loadCatalog(),
          loadPlaces(),
        ]);
        if (cancelled) return;
        setCatalogState({
          status: "ready",
          catalog,
          places,
          error: null,
        });
      } catch (error) {
        if (!cancelled) {
          setCatalogState({
            status: "error",
            catalog: null,
            places: [],
            error,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const discoverEntries = useMemo(() => {
    const entries = Array.isArray(catalogState.catalog?.entries)
      ? catalogState.catalog.entries
      : [];
    return sortNativeDiscoverRoutes(catalogFilter(entries, discoverFilters));
  }, [catalogState.catalog, discoverFilters]);

  const placeById = useMemo(
    () => new Map(catalogState.places.map((place) => [place.id, place])),
    [catalogState.places],
  );

  const startPlaceOptions = useMemo(
    () =>
      placeOptionsForEntries(
        Array.isArray(catalogState.catalog?.entries)
          ? catalogState.catalog.entries
          : [],
        placeById,
        routeStartPlaceIds,
      ),
    [catalogState.catalog, placeById],
  );
  const throughPlaceOptions = useMemo(
    () =>
      placeOptionsForEntries(
        Array.isArray(catalogState.catalog?.entries)
          ? catalogState.catalog.entries
          : [],
        placeById,
        routePassesThroughPlaceIds,
      ),
    [catalogState.catalog, placeById],
  );
  const featuredDiscoverEntries = useMemo(
    () => discoverEntries.filter((entry) => entry.featured).slice(0, 3),
    [discoverEntries],
  );
  const activeDiscoverFilterCount = useMemo(
    () =>
      Object.values(discoverFilters).reduce(
        (sum, value) => sum + (value?.size || 0),
        0,
      ),
    [discoverFilters],
  );

  const toggleDiscoverFilter = useCallback((axis, value) => {
    setDiscoverFilters((current) => {
      const next = new Set(current[axis]);
      next.has(value) ? next.delete(value) : next.add(value);
      return { ...current, [axis]: next.size > 1 ? new Set([value]) : next };
    });
  }, []);

  const clearDiscoverFilters = useCallback(() => {
    setDiscoverFilters(createEmptyCatalogFilters());
  }, []);

  const handleSelectDiscoverRoute = useCallback(
    async (entry) => {
      if (!entry?.route) return false;
      const loaded = await handleLoadRouteParam(entry.route);
      if (!loaded) return false;
      handleAddRecentRoute({
        param: entry.route,
        name: entry.name || "מסלול",
        distanceKm: Number(entry.distanceKm) || undefined,
      });
      setPanelMode("build");
      return true;
    },
    [handleAddRecentRoute, handleLoadRouteParam],
  );

  const handleOpenRouteDetails = useCallback((entry) => {
    if (entry) setDetailEntry(entry);
  }, []);

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
  const warningPresentation = useMemo(
    () =>
      getRouteWarningPresentation(
        routeState.activeDataPoints,
        mapUi.selectedDataMarker,
      ),
    [mapUi.selectedDataMarker, routeState.activeDataPoints],
  );

  const handleMapPress = useCallback(
    (feature) => {
      if (state.status !== "ready") return;
      if (Date.now() - routePointPressGuardRef.current < ADD_GUARD_MS) return;
      const point = pointFromFeature(feature);
      if (!point) return;
      handleMapClick(point);
    },
    [handleMapClick, state.status],
  );

  const handleDataMarkerPress = useCallback(
    (event) => {
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
          followUserLocation={locationState.following}
          followUserMode={UserTrackingMode.FollowWithHeading}
          followZoomLevel={14.5}
        />
        {locationState.enabled ? (
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
      <MapLegendOverlay
        hasBrokenRoute={routePresentation.hasBrokenRoute}
        warningPresentation={warningPresentation}
        onWarningFocus={handleDataPointFocus}
      />
      <RoutePlannerChrome
        animator={directionAnimatorRef.current}
        canDownload={canDownload}
        canRedo={canRedo}
        canUndo={canUndo}
        activeDiscoverFilterCount={activeDiscoverFilterCount}
        catalogState={catalogState}
        discoverEntries={discoverEntries}
        discoverFilters={discoverFilters}
        featuredDiscoverEntries={featuredDiscoverEntries}
        onOpenSummary={handleOpenDownload}
        onPanelModeChange={setPanelMode}
        onRedo={handleRedo}
        onOpenRouteDetails={handleOpenRouteDetails}
        onSearchChange={handleSearchQueryChange}
        onSearchSubmit={submitSearch}
        onSelectDiscoverRoute={handleSelectDiscoverRoute}
        onToggleDiscoverFilter={toggleDiscoverFilter}
        onClearDiscoverFilters={clearDiscoverFilters}
        onUndo={handleUndo}
        locationState={locationState}
        mapUi={mapUi}
        panelMode={panelMode}
        placeById={placeById}
        presentation={routePresentation}
        recentRoutes={recentRoutes}
        routeState={routeState}
        routePoints={displayedRoutePoints}
        startPlaceOptions={startPlaceOptions}
        throughPlaceOptions={throughPlaceOptions}
        onClear={handleRouteClear}
        onScrub={setScrubPoint}
      />
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
      <RouteDetailModal
        entry={detailEntry}
        onClose={() => setDetailEntry(null)}
        onOpenRoute={handleSelectDiscoverRoute}
        placeById={placeById}
      />
    </View>
  );
}

function MapLegendOverlay({ hasBrokenRoute, warningPresentation, onWarningFocus }) {
  const [warningsOpen, setWarningsOpen] = useState(false);
  const warningPulseOpacity = useRef(new Animated.Value(1)).current;
  const hasWarnings = warningPresentation.count > 0;

  useEffect(() => {
    if (!hasBrokenRoute && !hasWarnings) return undefined;

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(warningPulseOpacity, {
          toValue: 0.7,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(warningPulseOpacity, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();

    return () => {
      animation.stop();
      warningPulseOpacity.setValue(1);
    };
  }, [hasBrokenRoute, hasWarnings, warningPulseOpacity]);

  return (
    <View pointerEvents="box-none" style={styles.legendContainer}>
      <View style={styles.legendBox}>
        <Text style={styles.legendTitle}>סוגי דרכים</Text>
        <LegendItem color="rgb(101, 170, 162)" label="שביל סלול" />
        <LegendItem color="rgb(174, 144, 103)" label="שביל עפר" />
        <LegendItem color="rgb(138, 147, 158)" label="כביש" />
      </View>
      {hasBrokenRoute ? (
        <Animated.View
          style={[
            styles.issueChip,
            styles.issueChipRoute,
            { opacity: warningPulseOpacity },
          ]}
        >
          <Text style={styles.issueChipText}>⚠️ מסלול שבור</Text>
        </Animated.View>
      ) : null}
      {hasWarnings ? (
        <>
          <Animated.View
            style={[
              styles.issueChip,
              styles.issueChipData,
              { opacity: warningPulseOpacity },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={warningPresentation.toggleLabel}
              onPress={() => setWarningsOpen((current) => !current)}
              style={({ pressed }) => [
                styles.issueChipPressable,
                pressed ? styles.issueChipPressed : null,
              ]}
            >
              <Text style={styles.issueChipText}>
                {warningPresentation.toggleLabel}
              </Text>
            </Pressable>
          </Animated.View>
          {warningsOpen ? (
            <View style={styles.warningDetails}>
              {warningPresentation.groups.map((warningGroup) => (
                <Pressable
                  key={warningGroup.segmentName}
                  accessibilityRole="button"
                  accessibilityLabel={`${warningGroup.label} — מיקוד במפה`}
                  onPress={() => onWarningFocus?.(warningGroup.warnings?.[0])}
                  style={({ pressed }) => [
                    styles.warningDetailItem,
                    { backgroundColor: warningGroup.backgroundColor },
                    pressed ? styles.issueChipPressed : null,
                  ]}
                >
                  <Text style={styles.warningDetailLabel}>
                    {warningGroup.label}
                  </Text>
                  <Text style={styles.warningDetailIcons}>
                    {warningGroup.icons.join(" ")}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function LegendItem({ color, label }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
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

function RoutePlannerChrome({
  activeDiscoverFilterCount,
  animator,
  canDownload,
  canRedo,
  canUndo,
  catalogState,
  discoverEntries,
  discoverFilters,
  featuredDiscoverEntries,
  onClear,
  onClearDiscoverFilters,
  onOpenSummary,
  onOpenRouteDetails,
  onPanelModeChange,
  onRedo,
  onSearchChange,
  onSearchSubmit,
  onSelectDiscoverRoute,
  onToggleDiscoverFilter,
  onUndo,
  onScrub,
  locationState,
  mapUi,
  panelMode,
  placeById,
  presentation,
  recentRoutes,
  routeState,
  routePoints,
  startPlaceOptions,
  throughPlaceOptions,
}) {
  const hasPoints = routePoints.length > 0;
  const hasElevationProfile = routeState.geometry.length >= 2;
  const [sheetCollapsed, setSheetCollapsed] = useState(false);
  const searchBusy = mapUi.searchStatus === "searching";
  const locationText = locationStatusText(locationState);
  const routeMessage = routeState.error
    ? routeState.error.message || "לא הצלחנו לעדכן את המסלול"
    : presentation.message;

  return (
    <>
      <View pointerEvents="box-none" style={styles.topChrome}>
        <View style={styles.searchPanel}>
          <ChromeButton
            compact
            disabled={searchBusy}
            icon={searchBusy ? null : "search"}
            label={searchBusy ? "..." : ""}
            onPress={onSearchSubmit}
            primary
            accessibilityLabel="חיפוש"
            buttonStyle={styles.searchButton}
          />
          <TextInput
            accessibilityLabel="חיפוש מיקום"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={onSearchChange}
            onSubmitEditing={onSearchSubmit}
            placeholder={SEARCH_PLACEHOLDER}
            placeholderTextColor="#52616f"
            returnKeyType="search"
            style={styles.searchInput}
            textAlign="right"
            value={mapUi.searchQuery}
          />
        </View>
        {mapUi.searchError ? (
          <Text style={styles.searchError}>{mapUi.searchError}</Text>
        ) : null}
        <View style={styles.controlBar}>
          <View style={styles.controlGroup}>
            <ChromeButton
              compact
              rail
              label={panelMode === "discover" ? "בנה" : "מצא"}
              onPress={() =>
                onPanelModeChange?.(panelMode === "discover" ? "build" : "discover")
              }
              accessibilityLabel={
                panelMode === "discover" ? "חזרה לבניית מסלול" : "מצא מסלול מוכן"
              }
            />
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
            />
            <ChromeButton
              compact
              rail
              disabled={!canDownload}
              label="סיכום"
              onPress={onOpenSummary}
              accessibilityLabel="סיכום ושיתוף המסלול"
            />
          </View>
        </View>
      </View>

      <View pointerEvents="box-none" style={styles.bottomSheetWrap}>
        {panelMode === "discover" ? (
          <DiscoverSheet
            activeFilterCount={activeDiscoverFilterCount}
            catalogState={catalogState}
            entries={discoverEntries}
            featuredEntries={featuredDiscoverEntries}
            filters={discoverFilters}
            onBuild={() => onPanelModeChange?.("build")}
            onClearFilters={onClearDiscoverFilters}
            onOpenDetails={onOpenRouteDetails}
            onSelectRoute={onSelectDiscoverRoute}
            onToggleFilter={onToggleDiscoverFilter}
            placeById={placeById}
            recentRoutes={recentRoutes}
            startPlaceOptions={startPlaceOptions}
            throughPlaceOptions={throughPlaceOptions}
          />
        ) : (
          <View
            style={[
              styles.routeSheet,
              hasPoints ? null : styles.routeSheetEmpty,
            ]}
          >
            <View style={styles.routeSheetHeader}>
              <Text style={styles.routeSheetTitle}>מסלול</Text>
              <View style={styles.routeSheetHeaderActions}>
                {presentation.canDownload ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="סיכום ושיתוף המסלול"
                    onPress={onOpenSummary}
                    style={styles.routeSheetBadge}
                  >
                    <Text style={styles.routeSheetBadgeText}>סיכום</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    sheetCollapsed ? "הרחבת פאנל המסלול" : "מזעור פאנל המסלול"
                  }
                  onPress={() => setSheetCollapsed((current) => !current)}
                  style={styles.routeSheetCollapse}
                >
                  <Text style={styles.routeSheetCollapseText}>
                    {sheetCollapsed ? "⌃" : "⌄"}
                  </Text>
                </Pressable>
              </View>
            </View>
            <Text
              numberOfLines={sheetCollapsed ? 1 : undefined}
              style={routeState.error ? styles.errorText : styles.routeMessage}
            >
              {routeMessage}
            </Text>
            {!sheetCollapsed && presentation.warnings.length > 0 ? (
              <View style={styles.warningList}>
                {presentation.warnings.map((warning) => (
                  <Text key={warning} style={styles.warningText}>
                    {warning}
                  </Text>
                ))}
              </View>
            ) : null}
            {!sheetCollapsed && locationText ? (
              <Text style={styles.locationText}>{locationText}</Text>
            ) : null}
            {!sheetCollapsed && hasElevationProfile ? (
              <ElevationProfileChart
                animator={animator}
                distance={routeState.distance}
                geometry={routeState.geometry}
                onScrub={onScrub}
              />
            ) : null}
          </View>
        )}
      </View>
    </>
  );
}

function DiscoverSheet({
  activeFilterCount,
  catalogState,
  entries = [],
  featuredEntries = [],
  filters,
  onBuild,
  onClearFilters,
  onOpenDetails,
  onSelectRoute,
  onToggleFilter,
  placeById,
  recentRoutes = [],
  startPlaceOptions = [],
  throughPlaceOptions = [],
}) {
  return (
    <View style={[styles.routeSheet, styles.discoverSheet]}>
      <View style={styles.routeSheetHeader}>
        <View>
          <Text style={styles.discoverEyebrow}>מצא מסלול</Text>
          <Text style={styles.routeSheetTitle}>מצאו את הרכיבה הבאה</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="בנה מסלול משלך"
          onPress={onBuild}
          style={styles.routeSheetBadge}
        >
          <Text style={styles.routeSheetBadgeText}>בנה מסלול</Text>
        </Pressable>
      </View>

      {catalogState?.status === "loading" ? (
        <Text style={styles.discoverStatusText}>טוען מסלולים...</Text>
      ) : null}
      {catalogState?.status === "error" ? (
        <Text style={styles.errorText}>
          לא הצלחנו לטעון את רשימת המסלולים.
        </Text>
      ) : null}

      {catalogState?.status === "ready" ? (
        <ScrollView
          showsVerticalScrollIndicator
          contentContainerStyle={styles.discoverScrollContent}
        >
          {recentRoutes.length > 0 ? (
            <View style={styles.discoverSection}>
              <Text style={styles.discoverSectionTitle}>אחרונים</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.discoverHorizontalList}
              >
                {recentRoutes.slice(0, 6).map((route) => (
                  <Pressable
                    key={route.param}
                    accessibilityRole="button"
                    accessibilityLabel={`פתח את ${route.name || "מסלול אחרון"}`}
                    onPress={() =>
                      onSelectRoute?.({
                        route: route.param,
                        name: route.name,
                        distanceKm: route.distanceKm,
                      })
                    }
                    style={({ pressed }) => [
                      styles.recentRouteChip,
                      pressed ? styles.discoverCardPressed : null,
                    ]}
                  >
                    <Text numberOfLines={1} style={styles.recentRouteText}>
                      {route.name || "מסלול אחרון"}
                    </Text>
                    {Number.isFinite(Number(route.distanceKm)) ? (
                      <Text style={styles.recentRouteMeta}>
                        {formatRouteKm(route.distanceKm)}
                      </Text>
                    ) : null}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          {featuredEntries.length > 0 ? (
            <View style={styles.discoverSection}>
              <Text style={styles.discoverSectionTitle}>מומלצים במיוחד</Text>
              {featuredEntries.map((entry) => (
                <NativeRouteCard
                  key={`featured-${entry.slug}`}
                  entry={entry}
                  featured
                  onOpenDetails={onOpenDetails}
                  onSelect={onSelectRoute}
                  placeById={placeById}
                />
              ))}
            </View>
          ) : null}

          <View style={styles.discoverSection}>
            <View style={styles.discoverFilterHeader}>
              <Text style={styles.discoverSectionTitle}>סינון</Text>
              {activeFilterCount > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="נקה סינון"
                  onPress={onClearFilters}
                  style={styles.clearFiltersButton}
                >
                  <Text style={styles.clearFiltersText}>נקה</Text>
                </Pressable>
              ) : null}
            </View>
            <NativeFilterRow
              axis="startLocation"
              label="התחלה"
              options={startPlaceOptions}
              selected={filters.startLocation}
              onToggle={onToggleFilter}
            />
            <NativeFilterRow
              axis="throughLocation"
              label="עובר דרך"
              options={throughPlaceOptions}
              selected={filters.throughLocation}
              onToggle={onToggleFilter}
            />
            {DISCOVERY_FILTER_GROUPS.map((group) => (
              <NativeFilterRow
                key={group.axis}
                axis={group.axis}
                label={group.label}
                options={group.options}
                selected={filters[group.axis]}
                onToggle={onToggleFilter}
              />
            ))}
          </View>

          <View style={styles.discoverSection}>
            <Text style={styles.discoverSectionTitle}>
              {entries.length} מסלולים
            </Text>
            {entries.map((entry) => (
              <NativeRouteCard
                key={entry.slug}
                entry={entry}
                onOpenDetails={onOpenDetails}
                onSelect={onSelectRoute}
                placeById={placeById}
              />
            ))}
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

function NativeFilterRow({ axis, label, options = [], selected, onToggle }) {
  const shownOptions = options.slice(0, axis === "throughLocation" ? 10 : 8);
  if (shownOptions.length === 0) return null;
  return (
    <View style={styles.filterRow}>
      <Text style={styles.filterRowLabel}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterChipList}
      >
        {shownOptions.map((option) => {
          const active = selected?.has(option.value);
          return (
            <Pressable
              key={`${axis}:${option.value}`}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${label}: ${option.label}`}
              onPress={() => onToggle?.(axis, option.value)}
              style={({ pressed }) => [
                styles.nativeFilterChip,
                active ? styles.nativeFilterChipActive : null,
                pressed ? styles.discoverCardPressed : null,
              ]}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.nativeFilterChipText,
                  active ? styles.nativeFilterChipTextActive : null,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function NativeRouteCard({
  entry,
  featured = false,
  onOpenDetails,
  onSelect,
  placeById,
}) {
  const placeNames = routePlaceNames(entry, placeById);
  const shape = routeShapeLabel(entry);
  const image = routeMapImage(entry) || routeDisplayImage(entry);
  const imageSource = nativeImageSource(image?.thumbnail || image?.photo);
  const stats = [
    formatRouteKm(entry.distanceKm),
    formatRouteElevation(entry.elevationGainM),
    routeDifficultyLabel(entry),
    routeSurfaceLabel(entry),
    shape,
  ].filter(Boolean);

  return (
    <View
      style={[
        styles.discoverRouteCard,
        featured ? styles.discoverRouteCardFeatured : null,
      ]}
    >
      <View style={styles.discoverRouteCardTop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`פרטי מסלול: ${entry.name}`}
          onPress={() => onOpenDetails?.(entry)}
          style={({ pressed }) => [
            styles.discoverRouteThumb,
            pressed ? styles.discoverCardPressed : null,
          ]}
        >
          {imageSource ? (
            <Image
              source={imageSource}
              resizeMode="cover"
              style={styles.discoverRouteImage}
            />
          ) : (
            <View style={styles.discoverRouteImagePlaceholder} />
          )}
        </Pressable>
        <View style={styles.discoverRouteBody}>
          <View style={styles.discoverRouteCardHeader}>
            <Text numberOfLines={2} style={styles.discoverRouteTitle}>
              {entry.name}
            </Text>
            {featured ? (
              <Text style={styles.discoverFeaturedBadge}>מומלץ</Text>
            ) : null}
          </View>
          {entry.summary ? (
            <Text numberOfLines={2} style={styles.discoverRouteSummary}>
              {entry.summary}
            </Text>
          ) : null}
        </View>
      </View>
      {stats.length > 0 ? (
        <Text numberOfLines={2} style={styles.discoverRouteMeta}>
          {stats.join(" · ")}
        </Text>
      ) : null}
      {placeNames.length > 0 ? (
        <Text numberOfLines={1} style={styles.discoverRoutePlaces}>
          עובר ליד: {placeNames.join(" · ")}
        </Text>
      ) : null}
      <View style={styles.discoverRouteActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`פתח את ${entry.name} במפה`}
          onPress={() => onSelect?.(entry)}
          style={({ pressed }) => [
            styles.discoverPrimaryAction,
            pressed ? styles.discoverCardPressed : null,
          ]}
        >
          <Text style={styles.discoverPrimaryActionText}>פתח במפה</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`פרטים על ${entry.name}`}
          onPress={() => onOpenDetails?.(entry)}
          style={({ pressed }) => [
            styles.discoverSecondaryAction,
            pressed ? styles.discoverCardPressed : null,
          ]}
        >
          <Text style={styles.discoverSecondaryActionText}>פרטים</Text>
        </Pressable>
      </View>
    </View>
  );
}

function RouteDetailModal({ entry, onClose, onOpenRoute, placeById }) {
  const [snapshotState, setSnapshotState] = useState({
    status: "idle",
    snapshot: null,
    error: null,
  });

  useEffect(() => {
    if (!entry?.slug) {
      setSnapshotState({ status: "idle", snapshot: null, error: null });
      return undefined;
    }
    let cancelled = false;
    setSnapshotState({ status: "loading", snapshot: null, error: null });
    loadFeaturedRouteSnapshot(entry.slug)
      .then((snapshot) => {
        if (!cancelled) {
          setSnapshotState({ status: "ready", snapshot, error: null });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSnapshotState({ status: "error", snapshot: null, error });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [entry?.slug]);

  if (!entry) return null;

  const routeSnapshot = snapshotState.snapshot
    ? snapshotToRouteState(snapshotState.snapshot)
    : null;
  const image = routeDisplayImage(entry, snapshotState.snapshot) || routeMapImage(entry);
  const imageSource = nativeImageSource(image?.photo || image?.thumbnail);
  const placeNames = routePlaceNames(entry, placeById);
  const stats = [
    formatRouteKm(routeSnapshot?.distance ? routeSnapshot.distance / 1000 : entry.distanceKm),
    formatRouteElevation(routeSnapshot?.elevationGain || entry.elevationGainM),
    routeDifficultyLabel(entry),
    routeSurfaceLabel(entry),
    routeShapeLabel(entry),
  ].filter(Boolean);
  const pois = Array.isArray(snapshotState.snapshot?.pois?.activeDataPoints)
    ? snapshotState.snapshot.pois.activeDataPoints.slice(0, 8)
    : [];

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={Boolean(entry)}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.detailModal}>
          <View style={styles.summaryHeader}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="סגירה"
              onPress={onClose}
              style={styles.summaryCloseButton}
            >
              <Text style={styles.summaryCloseText}>×</Text>
            </Pressable>
            <Text style={styles.summaryTitle}>פרטי מסלול</Text>
          </View>
          <ScrollView
            contentContainerStyle={styles.detailBody}
            showsVerticalScrollIndicator
          >
            {imageSource ? (
              <Image
                source={imageSource}
                resizeMode="cover"
                style={styles.detailHeroImage}
              />
            ) : null}
            <View style={styles.detailHeaderCopy}>
              <Text style={styles.detailTitle}>{entry.name}</Text>
              {entry.summary ? (
                <Text style={styles.detailSummary}>{entry.summary}</Text>
              ) : null}
              {stats.length > 0 ? (
                <Text style={styles.detailStats}>{stats.join(" · ")}</Text>
              ) : null}
              {placeNames.length > 0 ? (
                <Text style={styles.detailPlaces}>
                  עובר ליד: {placeNames.join(" · ")}
                </Text>
              ) : null}
            </View>

            {entry.description ? (
              <SummarySection title="על המסלול">
                <RichText style={styles.summaryText} text={entry.description} />
              </SummarySection>
            ) : null}

            {snapshotState.status === "loading" ? (
              <Text style={styles.summaryMuted}>טוען נתוני מסלול...</Text>
            ) : null}
            {snapshotState.status === "error" ? (
              <Text style={styles.summaryWarningText}>
                לא הצלחנו לטעון את נתוני המסלול המלאים.
              </Text>
            ) : null}

            {pois.length > 0 ? (
              <SummarySection title="נקודות בדרך">
                <View style={styles.detailPoiList}>
                  {pois.map((poi, index) => (
                    <View key={poi.id || index} style={styles.detailPoiItem}>
                      <Text style={styles.detailPoiIcon}>
                        {poi.emoji || "📍"}
                      </Text>
                      <View style={styles.detailPoiTextWrap}>
                        {poi.segmentName ? (
                          <Text style={styles.detailPoiSegment}>
                            {poi.segmentName}
                          </Text>
                        ) : null}
                        <RichText
                          style={styles.detailPoiText}
                          text={poi.information || poi.name || ""}
                        />
                      </View>
                    </View>
                  ))}
                </View>
              </SummarySection>
            ) : null}
          </ScrollView>
          <View style={styles.summaryActions}>
            <ChromeButton label="סגור" onPress={onClose} />
            <ChromeButton
              label="פתח במפה"
              disabled={!entry.route}
              onPress={() => {
                void (async () => {
                  const loaded = await onOpenRoute?.(entry);
                  if (loaded) onClose?.();
                })();
              }}
              primary
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Bottom-sheet detail card shown when a data marker (hazard or POI) is tapped.
// Sits above the route sheet; offers adding the marker to the route or closing.
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
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
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
        <ChromeIcon
          name={icon}
          color={
            disabled ? "#777777" : primary ? "#ffffff" : "#333333"
          }
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

function ChromeIcon({ color, name, size }) {
  const common = { fill: "none", stroke: color, strokeWidth: 32 };

  if (name === "search") {
    return (
      <Svg width={size} height={size} viewBox="0 0 512 512">
        <Path
          d="M221.09 64a157.09 157.09 0 10157.09 157.09A157.1 157.1 0 00221.09 64z"
          {...common}
          strokeMiterlimit={10}
        />
        <Path
          d="M338.29 338.29L448 448"
          {...common}
          strokeLinecap="round"
          strokeMiterlimit={10}
        />
      </Svg>
    );
  }

  if (name === "undo") {
    return (
      <Svg width={size} height={size} viewBox="0 0 512 512">
        <Path
          d="M240 424v-96c116.4 0 159.39 33.76 208 96 0-119.23-39.57-240-208-240V88L64 256z"
          {...common}
          strokeLinejoin="round"
        />
      </Svg>
    );
  }

  if (name === "redo") {
    return (
      <Svg width={size} height={size} viewBox="0 0 512 512">
        <Path
          d="M448 256L272 88v96C103.57 184 64 304.77 64 424c48.61-62.24 91.6-96 208-96v96z"
          {...common}
          strokeLinejoin="round"
        />
      </Svg>
    );
  }

  if (name === "trash") {
    return (
      <Svg width={size} height={size} viewBox="0 0 512 512">
        <Path
          d="M112 112l20 320c.95 18.49 14.4 32 32 32h184c17.67 0 30.87-13.51 32-32l20-320"
          {...common}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d="M80 112h352"
          {...common}
          strokeLinecap="round"
          strokeMiterlimit={10}
        />
        <Path
          d="M192 112V72h0a23.93 23.93 0 0124-24h80a23.93 23.93 0 0124 24h0v40M256 176v224M184 176l8 224M328 176l-8 224"
          {...common}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    );
  }

  return null;
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

function sortNativeDiscoverRoutes(entries) {
  return (entries || []).slice().sort((a, b) => {
    const ao = Number(a.sortOrder);
    const bo = Number(b.sortOrder);
    const aHasOrder = Number.isFinite(ao);
    const bHasOrder = Number.isFinite(bo);
    if (aHasOrder || bHasOrder) {
      if (!aHasOrder) return 1;
      if (!bHasOrder) return -1;
      if (ao !== bo) return ao - bo;
    }
    const af = a.featured ? 1 : 0;
    const bf = b.featured ? 1 : 0;
    if (af !== bf) return bf - af;
    const aq = Number(a.qualityScore) || 0;
    const bq = Number(b.qualityScore) || 0;
    if (aq !== bq) return bq - aq;
    return (Number(a.distanceKm) || 0) - (Number(b.distanceKm) || 0);
  });
}

function routePlaceNames(entry, placeById) {
  return (entry?.passesNear || [])
    .map((id) => placeById?.get(id)?.name)
    .filter(Boolean)
    .slice(0, 3);
}

function formatRouteKm(km) {
  const value = Number(km);
  return Number.isFinite(value) ? `${value.toFixed(1)} ק״מ` : "";
}

function formatRouteElevation(meters) {
  const value = Number(meters);
  return Number.isFinite(value) ? `${Math.round(value)} מ׳ טיפוס` : "";
}

function nativeImageSource(logicalPath) {
  if (!logicalPath) return null;
  return IMAGE_ASSETS[String(logicalPath).split("?")[0].split("#")[0]] || null;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  hint: { fontSize: 15, textAlign: "center", color: "#333" },
  topChrome: {
    position: "absolute",
    top: 15,
    // Start to the right of the legend (left:15 + width:104 + gap) so the
    // search box and controls never overlap it, on any screen width.
    left: 127,
    right: 15,
    gap: 4,
  },
  searchPanel: {
    flexDirection: "row-reverse",
    alignItems: "stretch",
    // Fill the chrome band (right of the legend) instead of a fixed width, so
    // it shrinks on narrow phones rather than overrunning the legend, while
    // staying right-aligned and capped on wide screens.
    alignSelf: "flex-end",
    width: "100%",
    maxWidth: 320,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 36,
    borderTopLeftRadius: 4,
    borderBottomLeftRadius: 4,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    paddingHorizontal: 12,
    color: "#172026",
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    borderColor: "#e0e0e0",
    borderWidth: 2,
    borderRightWidth: 0,
    fontSize: 14,
    writingDirection: "rtl",
  },
  searchButton: {
    minWidth: 40,
    width: 40,
    minHeight: 36,
    height: 36,
    paddingHorizontal: 0,
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
    borderColor: "#4682B4",
    borderWidth: 2,
    borderLeftWidth: 0,
  },
  controlBar: {
    alignSelf: "flex-end",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 4,
  },
  controlGroup: {
    alignItems: "flex-end",
    gap: 4,
  },
  searchError: {
    alignSelf: "flex-end",
    maxWidth: 280,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 4,
    backgroundColor: "rgba(255, 255, 255, 0.96)",
    color: "#991b1b",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
  },
  legendContainer: {
    position: "absolute",
    top: 15,
    left: 15,
    width: 104,
    alignItems: "flex-start",
  },
  legendBox: {
    width: "100%",
    minWidth: 104,
    padding: 6,
    borderRadius: 4,
    backgroundColor: "#f8f8f8",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  legendTitle: {
    marginBottom: 4,
    color: "#333333",
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
    writingDirection: "rtl",
  },
  legendItem: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 5,
    marginBottom: 3,
  },
  legendSwatch: {
    width: 14,
    height: 3,
    borderRadius: 1,
  },
  legendLabel: {
    color: "#333333",
    fontSize: 10,
    fontWeight: "600",
    textAlign: "right",
    writingDirection: "rtl",
  },
  issueChip: {
    width: "100%",
    minHeight: 32,
    marginTop: 8,
    marginBottom: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
  },
  issueChipPressed: {
    opacity: 0.82,
  },
  issueChipPressable: {
    width: "100%",
    minHeight: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  issueChipText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
    writingDirection: "rtl",
  },
  issueChipRoute: {
    backgroundColor: "#ff9800",
    shadowColor: "#ff9800",
  },
  issueChipData: {
    backgroundColor: "#c35353",
    shadowColor: "#f44336",
  },
  warningDetails: {
    width: "100%",
    marginTop: 3,
    gap: 4,
  },
  warningDetailItem: {
    width: "100%",
    minHeight: 32,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    overflow: "hidden",
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    shadowColor: "#f44336",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
  },
  warningDetailLabel: {
    flexShrink: 1,
    flexGrow: 1,
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
    writingDirection: "rtl",
  },
  warningDetailIcons: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
  },
  bottomSheetWrap: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 14,
  },
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
  routeSheet: {
    maxHeight: 238,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "rgba(255, 255, 255, 0.94)",
    borderColor: "#c6d4cf",
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
  },
  routeSheetEmpty: {
    maxHeight: 132,
    paddingVertical: 12,
  },
  discoverSheet: {
    maxHeight: 430,
    paddingBottom: 8,
  },
  routeSheetHeader: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  routeSheetHeaderActions: { flexDirection: "row-reverse", alignItems: "center", gap: 8 },
  routeSheetTitle: {
    color: "#172026",
    fontSize: 16,
    fontWeight: "800",
    textAlign: "right",
  },
  routeSheetBadge: {
    minHeight: 26,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: "#f8f8f8",
    alignItems: "center",
    justifyContent: "center",
  },
  routeSheetBadgeText: {
    color: "#333333",
    fontSize: 12,
    fontWeight: "700",
  },
  routeSheetCollapse: {
    width: 30,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
    backgroundColor: "#f3f6f4",
  },
  routeSheetCollapseText: {
    color: "#333333",
    fontSize: 18,
    lineHeight: 20,
    fontWeight: "800",
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
  discoverEyebrow: {
    color: "#52616f",
    fontSize: 11,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  discoverStatusText: {
    color: "#52616f",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
  },
  discoverScrollContent: {
    gap: 12,
    paddingBottom: 6,
  },
  discoverSection: {
    gap: 7,
  },
  discoverSectionTitle: {
    color: "#172026",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  discoverHorizontalList: {
    flexDirection: "row-reverse",
    gap: 8,
    paddingHorizontal: 1,
  },
  recentRouteChip: {
    maxWidth: 150,
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 4,
    backgroundColor: "#f3f6f4",
    borderColor: "#d8e2dd",
    borderWidth: StyleSheet.hairlineWidth,
  },
  recentRouteText: {
    color: "#172026",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  recentRouteMeta: {
    marginTop: 2,
    color: "#52616f",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
  },
  discoverFilterHeader: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  clearFiltersButton: {
    minHeight: 26,
    paddingHorizontal: 10,
    justifyContent: "center",
    borderRadius: 4,
    backgroundColor: "#f3f6f4",
  },
  clearFiltersText: {
    color: "#333333",
    fontSize: 12,
    fontWeight: "800",
  },
  filterRow: {
    gap: 5,
  },
  filterRowLabel: {
    color: "#52616f",
    fontSize: 11,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  filterChipList: {
    flexDirection: "row-reverse",
    gap: 6,
    paddingHorizontal: 1,
  },
  nativeFilterChip: {
    maxWidth: 130,
    minHeight: 30,
    paddingHorizontal: 10,
    justifyContent: "center",
    borderRadius: 4,
    backgroundColor: "#f8f8f8",
    borderColor: "#d8e2dd",
    borderWidth: StyleSheet.hairlineWidth,
  },
  nativeFilterChipActive: {
    backgroundColor: "#4682B4",
    borderColor: "#4682B4",
  },
  nativeFilterChipText: {
    color: "#333333",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
  },
  nativeFilterChipTextActive: {
    color: "#ffffff",
  },
  discoverRouteCard: {
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 4,
    backgroundColor: "#ffffff",
    borderColor: "#d8e2dd",
    borderWidth: StyleSheet.hairlineWidth,
  },
  discoverRouteCardFeatured: {
    borderColor: "#4682B4",
    backgroundColor: "#f4fafc",
  },
  discoverRouteCardTop: {
    flexDirection: "row-reverse",
    gap: 9,
    alignItems: "stretch",
  },
  discoverRouteThumb: {
    width: 82,
    minHeight: 72,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: "#d8e2dd",
  },
  discoverRouteImage: {
    width: "100%",
    height: "100%",
  },
  discoverRouteImagePlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: "#d8e2dd",
  },
  discoverRouteBody: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  discoverCardPressed: {
    opacity: 0.76,
  },
  discoverRouteCardHeader: {
    flexDirection: "row-reverse",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  discoverRouteTitle: {
    flex: 1,
    color: "#172026",
    fontSize: 15,
    lineHeight: 19,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl",
  },
  discoverFeaturedBadge: {
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: "#4682B4",
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
    writingDirection: "rtl",
  },
  discoverRouteSummary: {
    color: "#333333",
    fontSize: 12,
    lineHeight: 17,
    textAlign: "right",
    writingDirection: "rtl",
  },
  discoverRouteMeta: {
    color: "#1f5268",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
    textAlign: "right",
    writingDirection: "rtl",
  },
  discoverRoutePlaces: {
    color: "#52616f",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
  },
  discoverRouteActions: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 8,
    marginTop: 2,
  },
  discoverPrimaryAction: {
    minHeight: 30,
    paddingHorizontal: 12,
    justifyContent: "center",
    borderRadius: 4,
    backgroundColor: "#4682B4",
  },
  discoverPrimaryActionText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  discoverSecondaryAction: {
    minHeight: 30,
    paddingHorizontal: 12,
    justifyContent: "center",
    borderRadius: 4,
    backgroundColor: "#f3f6f4",
    borderColor: "#d8e2dd",
    borderWidth: StyleSheet.hairlineWidth,
  },
  discoverSecondaryActionText: {
    color: "#333333",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  detailModal: {
    maxHeight: "84%",
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
  detailBody: {
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  detailHeroImage: {
    width: "100%",
    height: 178,
    borderRadius: 4,
    backgroundColor: "#d8e2dd",
  },
  detailHeaderCopy: {
    gap: 6,
  },
  detailTitle: {
    color: "#172026",
    fontSize: 22,
    lineHeight: 27,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl",
  },
  detailSummary: {
    color: "#333333",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "right",
    writingDirection: "rtl",
  },
  detailStats: {
    color: "#1f5268",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  detailPlaces: {
    color: "#52616f",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
  },
  detailPoiList: {
    gap: 8,
  },
  detailPoiItem: {
    flexDirection: "row-reverse",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 4,
    backgroundColor: "#f8faf9",
    borderColor: "#d8e2dd",
    borderWidth: StyleSheet.hairlineWidth,
  },
  detailPoiIcon: {
    fontSize: 18,
    lineHeight: 23,
  },
  detailPoiTextWrap: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  detailPoiSegment: {
    color: "#52616f",
    fontSize: 11,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  detailPoiText: {
    color: "#333333",
    fontSize: 12,
    lineHeight: 18,
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
    height: 36,
    minHeight: 36,
    paddingHorizontal: 2,
  },
  chromeButtonPrimary: {
    backgroundColor: "#4682B4",
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
});
