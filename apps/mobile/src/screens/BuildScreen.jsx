import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Location from "expo-location";
import { useSyntheticRoutePlaybackEngine } from "@cycleways/core/ui/routePlaybackEngine.js";
import PlaybackControls from "../planner/PlaybackControls.jsx";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Dimensions,
  Keyboard,
  Linking,
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
  MarkerView,
  ShapeSource,
  SymbolLayer,
  UserLocation,
  UserLocationRenderMode,
  UserTrackingMode,
} from "@rnmapbox/maps";
import { useCyclewaysApp } from "@cycleways/core/app/useCyclewaysApp.js";
import { dataMarkerFeatureCollection } from "@cycleways/core/data/dataMarkers.js";
import { POI_LABELS, POI_COLORS } from "@cycleways/core/data/poiTypes.js";
import {
  loadRouteCatalogEntries,
  routeShapeType,
} from "@cycleways/core/data/catalog.js";
import { navigationRouteFromRouteState } from "@cycleways/core/navigation/navigationRoute.js";
import {
  canFastStartRidePlan,
  createRidePlan,
} from "@cycleways/core/navigation/ridePlan.js";
import { traveledCoordinates } from "@cycleways/core/navigation/routeProgress.js";
import { createPuckAnchor } from "@cycleways/core/navigation/puckAnchor.js";
import {
  cameraHeadingTarget,
  createCameraHeadingGovernor,
} from "@cycleways/core/navigation/cameraHeading.js";
import { getNavigationPresentation } from "@cycleways/core/navigation/navigationPresentation.js";
import { buildAppUrl } from "@cycleways/core/navigation/externalNav.js";
import { scenarios as devScenarios } from "@cycleways/core/navigation/scenarios/index.js";
import { resolveScenario } from "@cycleways/core/navigation/scenarios/resolve.js";
import {
  precomputeArcLength,
  pointAndBearingAtDistance,
} from "@cycleways/core/utils/geometry.js";
import {
  nextSmoothedMeters,
  shortestAngleLerp,
} from "@cycleways/core/navigation/navigationSmoothing.js";
import {
  DATA_MARKERS_STYLE,
  ROUTE_GEOMETRY_LINE_STYLE,
} from "@cycleways/core/map/mapStyles.js";
import { MAP_INITIAL_CAMERA } from "@cycleways/core/map/mapViewport.js";
import { buildRoutePointDragPreviewFeatureCollection } from "@cycleways/core/map/routeDragPreview.js";
import DataMarkerImages, {
  NATIVE_DATA_MARKER_ICON_NAMESPACE,
} from "../DataMarkerImages.jsx";
import ElevationProfileChart from "../ElevationProfileChart.jsx";
import RichText from "../RichText.jsx";
import PlannerSheet from "../planner/PlannerSheet.jsx";
import TopSearch from "../planner/TopSearch.jsx";
import MapControls from "../planner/MapControls.jsx";
import BackButton from "./BackButton.jsx";
import RoutePoiList from "../planner/RoutePoiList.jsx";
import NavPanel from "../planner/NavPanel.jsx";
import DestinationSheet from "../planner/DestinationSheet.jsx";
import RideSetupSheet from "../planner/RideSetupSheet.jsx";
import { useNavigationSession } from "../navigation/useNavigationSession.js";
import {
  createDefaultLocationSource,
  getRideSetupLocation,
} from "../navigation/locationService.js";
import { createSimulateRideSource } from "../navigation/simulateRideSource.js";
import {
  clearPendingRideIntent,
  savePendingRideIntent,
} from "../navigation/pendingRidePlanStore.js";
import {
  setNavigationTelemetrySink,
  trackNavigationEvent,
} from "../navigation/navigationTelemetry.js";

// Dev builds surface navigation telemetry (connector results, ride setup…) in
// the Metro console — the only way to see WHY an approach suggestion failed
// on a device (reason: no-router / snap-failed / transient, plus durationMs).
if (__DEV__) {
  setNavigationTelemetrySink((name, fields) => {
    console.log(`[nav] ${name} ${JSON.stringify(fields)}`);
  });
}
import { routeRestoreDecision } from "../navigation/routeRestorePolicy.js";
import DevScenarioPicker from "../planner/DevScenarioPicker.jsx";
import Icon from "../planner/Icon.jsx";
import { palette } from "../planner/theme.js";
import { prepareRouteNetworkFeatures } from "@cycleways/core/domain/routeNetwork.js";
import {
  getPlannerBuildModel,
  getRoutePlannerPresentation,
} from "@cycleways/core/ui/routePlannerPresentation.js";
import { routeNetworkPresentation } from "@cycleways/core/map/networkPresentation.js";
import { paintToRNStyle } from "@cycleways/core/map/paintToRNStyle.js";
import {
  routeNetworkLineStyleForPresentation,
  routeNetworkCasingStyleForPresentation,
  routeNetworkShadowStyleForPresentation,
  routeGeometryLineStyleForPresentation,
  routeGeometryCasingStyleForPresentation,
} from "@cycleways/core/map/networkPresentation.js";

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

// Completed portion of the route during navigation: muted, drawn over the route
// line so the remaining route reads as the emphasized one.
const ROUTE_TRAVELED_LINE_STYLE = {
  lineColor: "#9aa6ab",
  lineWidth: 5,
  lineOpacity: 0.85,
  lineJoin: "round",
  lineCap: "round",
};

// Thin/faint straight line rider→target: the persistent "the route is there"
// anchor. Heavier dashed line: the road-preferring suggested connector (the
// way you might take). Differentiated so they read as two different answers.
const APPROACH_DIRECT_LINE_STYLE = {
  lineColor: "#6b7280",
  lineWidth: 2,
  lineOpacity: 0.6,
  lineDasharray: [1, 2],
  lineJoin: "round",
  lineCap: "round",
};
const APPROACH_SUGGESTION_LINE_STYLE = {
  lineColor: "#2563eb",
  lineWidth: 4,
  lineOpacity: 0.9,
  lineDasharray: [2, 1.5],
  lineJoin: "round",
  lineCap: "round",
};
const SETUP_PREVIEW_LINE_STYLE = {
  lineColor: "#2f6b3c",
  lineWidth: 7,
  lineOpacity: 0.92,
  lineJoin: "round",
  lineCap: "round",
};

// Adaptive rider puck colors: on-route uses the brand blue; approaching /
// off-route is muted gray (matches the traveled line) to signal "not snapped".
const RIDER_PUCK_COLOR = "#006699";
const RIDER_PUCK_MUTED_COLOR = "#9aa6ab";
// Camera zoom while following the rider during navigation.
const NAV_FOLLOW_ZOOM = 16.5;
// Tilt for the heading-up follow camera so the rider sees the route ahead from
// near ground level (also makes the view read as adaptive to the phone facing).
const NAV_FOLLOW_PITCH = 50;
// Time constant (ms) for the puck/camera heading lerp: a frame's lerp fraction
// is dt / BEARING_SMOOTH_MS (clamped to 1), so larger = slower rotation.
const BEARING_SMOOTH_MS = 260;
// Time constant (ms) for the puck position lerp used when the puck detaches
// from the route line (parallel path) or glides back onto it.
const PUCK_GLIDE_MS = 450;
// Time constant (ms) for rotating the camera to a heading the governor
// adopted — deliberately slower than the puck arrow so map re-orientations
// read as calm, occasional pans.
const CAMERA_ROTATE_MS = 800;

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
const NO_CUE_SLIDES = [];

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
// Bottom camera padding used when the playback panel is docked at ~48% height,
// so the route stays framed in the uncovered upper area during preview.
const PLAYBACK_FIT_BOTTOM_PADDING = Math.round(Dimensions.get("window").height * 0.48) + 24;
const DEFAULT_RIDE_SETUP_SELECTION = {
  direction: "forward",
  startMode: "official",
  selectedPoint: null,
};
const ACQUIRED_BANNER_MS = 4000;

export default function BuildScreen({ navigation, route }) {
  const cameraRef = useRef(null);
  const routePointPressGuardRef = useRef(0);
  const [locationState, setLocationState] = useState({
    enabled: false,
    following: false,
    point: null,
    status: "idle",
  });
  const [catalogEntries, setCatalogEntries] = useState([]);
  const [pendingRideSetupToken, setPendingRideSetupToken] = useState(null);
  const routeTokenParam = route?.params?.routeToken ?? null;
  const routeSlugParam = route?.params?.slug ?? null;
  const routeNameParam = route?.params?.name ?? null;
  const openRideSetupParam = route?.params?.openRideSetup === true;
  const rideSetupSelectionParam = route?.params?.rideSetupSelection ?? null;
  const [routeRestoreAttempt, setRouteRestoreAttempt] = useState(0);
  const [routeRestoreStatus, setRouteRestoreStatus] = useState(
    routeTokenParam ? "waiting" : "idle",
  );
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
    computeConnector,
  } = useCyclewaysApp({ enableRouteDirectionAnimation: false });

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
  const plannerSheetRef = useRef(null);
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
          !pickOnMapModeRef.current &&
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
      // "Pick a point on the route" mode: snap the tapped point onto the route
      // as the approach target, then exit the mode (route edits stay locked).
      if (pickOnMapModeRef.current) {
        const tapped = pointFromFeature(feature);
        if (tapped) mapPickHandlerRef.current?.(tapped);
        setPickOnMapMode(false);
        return;
      }
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
  const sourceNavigationRoute = useMemo(
    () =>
      navigationRouteFromRouteState(routeState, shareInfo, {
        source: selectedCatalogEntry ? "catalog" : "built",
        slug: selectedCatalogEntry?.slug || "",
        name: selectedCatalogEntry?.name || "המסלול שלי",
        summary: selectedCatalogEntry?.summary || "",
        routeShape: selectedCatalogEntry
          ? { type: routeShapeType(selectedCatalogEntry) }
          : null,
        start: selectedCatalogEntry?.start || null,
        end: selectedCatalogEntry?.end || null,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeState.geometry, shareInfo.param, selectedCatalogSlug, selectedCatalogEntry],
  );

  const [rideSetupVisible, setRideSetupVisible] = useState(false);
  const [rideSetupSelection, setRideSetupSelection] = useState(DEFAULT_RIDE_SETUP_SELECTION);
  const [rideSetupFix, setRideSetupFix] = useState(null);
  const [rideSetupNow, setRideSetupNow] = useState(Date.now());
  const [rideSetupLocationStatus, setRideSetupLocationStatus] = useState("idle");
  const [confirmedRidePlan, setConfirmedRidePlan] = useState(null);
  const [pendingNavigationRouteId, setPendingNavigationRouteId] = useState(null);
  const [pendingExternalPlan, setPendingExternalPlan] = useState(null);
  const [devPickerVisible, setDevPickerVisible] = useState(false);
  const [devSpeed, setDevSpeed] = useState(4);
  const [devScenarioRoute, setDevScenarioRoute] = useState(null);
  const setupRequestRef = useRef(0);

  const ridePlan = useMemo(
    () =>
      createRidePlan(
        sourceNavigationRoute,
        rideSetupSelection,
        rideSetupFix,
        rideSetupNow,
      ),
    [sourceNavigationRoute, rideSetupSelection, rideSetupFix, rideSetupNow],
  );

  const navigationRoute =
    (__DEV__ && devScenarioRoute) ||
    confirmedRidePlan?.effectiveRoute ||
    sourceNavigationRoute;

  const refreshRideSetupLocation = useCallback(async () => {
    const requestId = setupRequestRef.current + 1;
    setupRequestRef.current = requestId;
    setRideSetupLocationStatus("loading");
    const result = await getRideSetupLocation();
    if (setupRequestRef.current !== requestId) return;
    setRideSetupNow(Date.now());
    setRideSetupFix(result.fix || null);
    setRideSetupLocationStatus(result.status);
  }, []);

  const openRideSetup = useCallback(
    (options = {}) => {
      const preserveSelection = options?.preserveSelection === true;
      if (!preserveSelection) {
        setRideSetupSelection(DEFAULT_RIDE_SETUP_SELECTION);
      }
      setPendingExternalPlan(null);
      setRideSetupVisible(true);
      trackNavigationEvent("ride_setup_opened", {
        restored: preserveSelection,
      });
      void refreshRideSetupLocation();
    },
    [refreshRideSetupLocation],
  );

  // --- Dev-only simulate-ride harness + GPS recorder (Task 17) ---------------
  // A stable proxy source delegates to whichever inner source the dev buttons
  // install synchronously before calling nav.start(). In production __DEV__ is
  // false, so devLocationSource is never passed and this block is dead code
  // eliminated by Metro's inliner + the minifier.
  //
  // The recorder button wraps the real GPS source and captures every onFix call
  // into recorderFixesRef; on stop() the full array is logged as JSON so it can
  // be copied into tests/fixtures/*.json for deterministic replay (Task 18).
  const devInnerSourceRef = useRef(null);
  const recorderFixesRef = useRef([]);
  // Stable proxy: created once, delegates to devInnerSourceRef at call time.
  const devSourceProxy = useRef(null);
  if (devSourceProxy.current === null) {
    devSourceProxy.current = {
      requestPermissions: (opts) =>
        (devInnerSourceRef.current ?? createDefaultLocationSource()).requestPermissions(opts),
      startWatch: (handlers) =>
        (devInnerSourceRef.current ?? createDefaultLocationSource()).startWatch(handlers),
    };
  }

  const nav = useNavigationSession(navigationRoute, {
    locationSource: __DEV__ ? devSourceProxy.current : undefined,
    computeConnector,
  });
  const navStatus = nav.state?.status ?? "idle";
  const isNavigating =
    navStatus === "navigating" ||
    navStatus === "approaching" ||
    navStatus === "off-route" ||
    navStatus === "paused" ||
    navStatus === "requesting-permission";

  const activeRouteGeometry = useMemo(
    () => buildRouteGeometryFeatureCollection(navigationRoute?.geometry),
    [navigationRoute?.geometry],
  );
  const setupPreviewGeometry = useMemo(
    () => buildRouteGeometryFeatureCollection(ridePlan?.effectiveRoute?.geometry),
    [ridePlan?.effectiveRoute?.geometry],
  );
  const displayedRouteGeometry = isNavigating ? activeRouteGeometry : routeGeometry;

  const confirmRidePlan = useCallback((plan, options = {}) => {
    if (!plan?.effectiveRoute?.canNavigate) return;
    setConfirmedRidePlan(plan);
    trackNavigationEvent(
      options.fastStart ? "ride_setup_fast_started" : "ride_setup_confirmed",
      {
        direction: plan.direction,
        startMode: plan.startMode,
        approachTier: plan.approachTier,
      },
    );
    setRideSetupVisible(false);
    if (plan.approachTier === "far" || plan.approachTier === "unknown") {
      setPendingExternalPlan(plan);
      setDestSheetVisible(true);
      return;
    }
    void clearPendingRideIntent();
    setPendingNavigationRouteId(plan.effectiveRoute.id);
  }, []);

  const handleRideSetupConfirm = useCallback(() => {
    confirmRidePlan(ridePlan);
  }, [confirmRidePlan, ridePlan]);

  const handleStartNavigation = useCallback(async () => {
    const selection = DEFAULT_RIDE_SETUP_SELECTION;
    const requestId = setupRequestRef.current + 1;
    setupRequestRef.current = requestId;
    setRideSetupSelection(selection);
    setPendingExternalPlan(null);
    setRideSetupLocationStatus("loading");
    const result = await getRideSetupLocation();
    if (setupRequestRef.current !== requestId) return;
    const now = Date.now();
    const fix = result.fix || null;
    const plan = createRidePlan(sourceNavigationRoute, selection, fix, now);
    setRideSetupNow(now);
    setRideSetupFix(fix);
    setRideSetupLocationStatus(result.status);
    if (canFastStartRidePlan(plan, selection)) {
      confirmRidePlan(plan, { fastStart: true });
      return;
    }
    setRideSetupVisible(true);
    trackNavigationEvent("ride_setup_opened", {
      restored: false,
      fastStartEligible: false,
    });
  }, [confirmRidePlan, sourceNavigationRoute]);

  const handleChangeRideSettings = useCallback(() => {
    const reopen = () => {
      nav.stop();
      setConfirmedRidePlan(null);
      setPendingNavigationRouteId(null);
      openRideSetup({ preserveSelection: true });
    };
    if (nav.state?.progress?.hasAcquiredRoute) {
      Alert.alert(
        "שינוי הגדרות הרכיבה",
        "כדי לשנות כיוון או נקודת התחלה צריך לסיים את הניווט הנוכחי.",
        [
          { text: "ביטול", style: "cancel" },
          { text: "סיום ושינוי", style: "destructive", onPress: reopen },
        ],
      );
      return;
    }
    reopen();
  }, [nav.state?.progress?.hasAcquiredRoute, nav.stop, openRideSetup]);

  useEffect(() => {
    if (!pendingNavigationRouteId) return;
    if (nav.state?.route?.id !== pendingNavigationRouteId) return;
    if (!new Set(["idle", "ended", "error"]).has(navStatus)) return;
    setPendingNavigationRouteId(null);
    void nav.start();
  }, [nav.start, nav.state?.route?.id, navStatus, pendingNavigationRouteId]);

  // Ref mirror so the earlier-defined map-press / point-drag gesture handlers can
  // lock out route edits while navigating without a declaration-order dependency.
  const isNavigatingRef = useRef(false);
  useEffect(() => {
    isNavigatingRef.current = isNavigating;
  }, [isNavigating]);

  const handleDevSimulate = useCallback(() => {
    if (!__DEV__) return;
    setDevPickerVisible(true);
  }, []);

  // Resolve the picked scenario through the same resolver the headless suite
  // uses (identical fixes for the same seed), install the simulated source on
  // the dev proxy, and start. Scenarios that carry their own route go through
  // the pendingNavigationRouteId effect so nav.start() runs only after the
  // session has re-bound to the scenario route.
  const handleDevScenarioSelect = useCallback(
    (scenario) => {
      if (!__DEV__) return;
      let resolved;
      try {
        resolved = resolveScenario(scenario, {
          currentNavigationRoute: navigationRoute,
        });
      } catch (error) {
        Alert.alert("Scenario error", String(error?.message || error));
        return;
      }
      setDevPickerVisible(false);
      devInnerSourceRef.current = createSimulateRideSource(resolved.fixes, {
        intervalMs: Math.max(60, Math.round(1000 / devSpeed)),
      });
      if (resolved.navigationRoute.id !== navigationRoute?.id) {
        setDevScenarioRoute(resolved.navigationRoute);
        setPendingNavigationRouteId(resolved.navigationRoute.id);
      } else {
        void nav.start();
      }
    },
    [devSpeed, nav, navigationRoute],
  );

  const handleDevRecord = useCallback(() => {
    if (!__DEV__) return;
    recorderFixesRef.current = [];
    const base = createDefaultLocationSource();
    devInnerSourceRef.current = {
      requestPermissions: (opts) => base.requestPermissions(opts),
      startWatch: async ({ onFix, onError }) => {
        const handle = await base.startWatch({
          onFix: (fix) => {
            recorderFixesRef.current.push(fix);
            onFix(fix);
          },
          onError,
        });
        return {
          stop: () => {
            handle.stop();
            // Log the captured fix array so it can be saved as a test fixture.
            console.log(
              "[NAV-RECORDER] " +
                recorderFixesRef.current.length +
                " fixes captured:\n" +
                JSON.stringify(recorderFixesRef.current),
            );
          },
        };
      },
    };
    nav.start();
  }, [nav]);

  // When a dev session ends, drop the scenario route override and the injected
  // source so the next navigation uses the real route and real GPS. (Also
  // fixes the pre-existing leak where a SIM source survived into later rides.)
  useEffect(() => {
    if (!__DEV__) return;
    if (pendingNavigationRouteId) return;
    if (navStatus !== "ended" && navStatus !== "error") return;
    if (devScenarioRoute) setDevScenarioRoute(null);
    devInnerSourceRef.current = null;
  }, [devScenarioRoute, navStatus, pendingNavigationRouteId]);

  // Derive build-panel presentation options (matches the web's typed-cased variant).
  const mapPresentationActive = !isNavigating;

  // Route playback engine: drives the scrub marker along the route while
  // the build sheet is open and the user presses play / scrubs.
  const playback = useSyntheticRoutePlaybackEngine({
    enabled: mapPresentationActive,
    routeState,
    cueSlides: NO_CUE_SLIDES,
    onCursorChange: (cursor) => {
      setScrubPoint(cursor ? { coord: { lng: cursor.lng, lat: cursor.lat } } : null);
    },
  });
  const seekToFraction = useCallback(
    (fraction) => { playback.seekToFraction(fraction); },
    [playback.seekToFraction],
  );

  // Clear the scrub marker immediately when the build panel is closed or
  // navigation starts; the engine never emits onCursorChange(null) on teardown.
  useEffect(() => {
    if (!mapPresentationActive) setScrubPoint(null);
  }, [mapPresentationActive]);

  // Dock the planner sheet to the partial snap (48%, index 1) when playback
  // starts so the playback area is visible while the upper map stays uncovered.
  useEffect(() => {
    if (playback.isPlaying) {
      plannerSheetRef.current?.snapToIndex?.(1);
    }
  }, [playback.isPlaying]);

  const networkPresentationOptions = useMemo(
    () => ({
      variant: mapPresentationActive ? "typed-cased" : "current",
      routeBuilding: mapPresentationActive,
      baseMapProfile: "mapbox-outdoors",
      colorScheme: "auto",
    }),
    [mapPresentationActive],
  );
  const networkPresentation = useMemo(
    () => routeNetworkPresentation(networkPresentationOptions),
    [networkPresentationOptions],
  );
  const networkLayerStyles = useMemo(
    () => ({
      shadow: paintToRNStyle(
        routeNetworkShadowStyleForPresentation(networkPresentation),
      ),
      casing: paintToRNStyle(
        routeNetworkCasingStyleForPresentation(networkPresentation),
      ),
      core: paintToRNStyle(
        routeNetworkLineStyleForPresentation(networkPresentation),
      ),
    }),
    [networkPresentation],
  );
  const routeLineStyles = useMemo(() => {
    const variant = mapPresentationActive ? "dark" : "current";
    const casingSpec = routeGeometryCasingStyleForPresentation(variant);
    const coreSpec =
      routeGeometryLineStyleForPresentation(variant) || ROUTE_GEOMETRY_LINE_STYLE;
    return {
      casing: casingSpec ? paintToRNStyle(casingSpec) : null,
      core: paintToRNStyle(coreSpec),
    };
  }, [mapPresentationActive]);

  const networkFeatures = useMemo(() => {
    if (state.status !== "ready") return EMPTY_FEATURE_COLLECTION;
    return {
      type: "FeatureCollection",
      features: prepareRouteNetworkFeatures(
        state.assets.geoJsonData,
        networkPresentationOptions,
      ),
    };
  }, [state.assets, state.status, networkPresentationOptions]);

  // --- Adaptive smoothed rider puck + camera (Task 15) --------------------
  // The raw GPS arrives ~1 Hz and jumps; we render ONE puck that glides between
  // fixes. On-route it rides a smoothed along-route distance; approaching /
  // off-route it sits at the (smoothed-heading) raw GPS fix. A single RAF loop
  // tweens the position/heading and drives the camera from the SAME values.
  const navProgress = nav.state?.progress ?? null;
  const navPresentation = useMemo(
    () => getNavigationPresentation(nav.state ?? {}),
    [nav.state],
  );
  const [showAcquiredBanner, setShowAcquiredBanner] = useState(false);
  const acquiredBannerTimerRef = useRef(null);
  useEffect(() => {
    if (!nav.state?.justAcquired) return undefined;
    setShowAcquiredBanner(true);
    if (acquiredBannerTimerRef.current !== null) {
      clearTimeout(acquiredBannerTimerRef.current);
    }
    acquiredBannerTimerRef.current = setTimeout(() => {
      acquiredBannerTimerRef.current = null;
      setShowAcquiredBanner(false);
    }, ACQUIRED_BANNER_MS);
    return undefined;
  }, [nav.state?.justAcquired]);
  useEffect(() => () => {
    if (acquiredBannerTimerRef.current !== null) {
      clearTimeout(acquiredBannerTimerRef.current);
    }
  }, []);
  useEffect(() => {
    if (["idle", "ended", "error"].includes(navStatus)) {
      setShowAcquiredBanner(false);
    }
  }, [navStatus]);
  const navPanelState = useMemo(
    () =>
      showAcquiredBanner && nav.state
        ? { ...nav.state, justAcquired: true }
        : nav.state,
    [nav.state, showAcquiredBanner],
  );
  const telemetryStateRef = useRef({ status: null, connectorResultRequestId: null });
  useEffect(() => {
    const previous = telemetryStateRef.current;
    const connectorResult = nav.state?.connectorResult ?? null;
    if (
      connectorResult?.requestId &&
      connectorResult.requestId !== previous.connectorResultRequestId
    ) {
      const durationMs = Number(connectorResult.durationMs);
      trackNavigationEvent("approach_connector_result", {
        result: connectorResult.result,
        reason: connectorResult.reason || null,
        targetMode: connectorResult.targetMode || null,
        isRetry: connectorResult.isRetry === true,
        attempt: Number.isFinite(Number(connectorResult.attempt))
          ? Number(connectorResult.attempt)
          : null,
        durationMs: Number.isFinite(durationMs)
          ? Math.round(durationMs / 250) * 250
          : null,
        distanceSource: navPresentation.approachDistanceSource,
      });
    }
    if (nav.state?.justAcquired && previous.status !== "navigating") {
      trackNavigationEvent("route_acquired", {
        direction: confirmedRidePlan?.direction || "forward",
        startMode: confirmedRidePlan?.startMode || "official",
      });
    }
    telemetryStateRef.current = {
      status: navStatus,
      connectorResultRequestId: connectorResult?.requestId ?? null,
    };
  }, [
    confirmedRidePlan?.direction,
    confirmedRidePlan?.startMode,
    nav.state?.connectorResult,
    nav.state?.justAcquired,
    navPresentation.approachDistanceSource,
    navStatus,
  ]);
  // The puck/camera always ride the main route now; the connector is only a
  // static suggestion overlay, never a navigated phase.
  const navGeometry = navigationRoute?.geometry || [];
  const activeGeometryKey = "main";

  // Approach overlays (while approaching / off-route): a thin direct line
  // rider→target plus, in the near tier, a dashed road-preferring suggestion.
  const approach = nav.state?.approach ?? null;
  const latestFix = nav.state?.latestFix ?? null;
  const approachTargetPoint = approach?.target?.point ?? null;
  const showApproachLines =
    navStatus === "approaching" || navStatus === "off-route";
  const directLineGeometry = useMemo(() => {
    if (!showApproachLines || !latestFix || !approachTargetPoint) {
      return EMPTY_FEATURE_COLLECTION;
    }
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [
              [latestFix.lng, latestFix.lat],
              [approachTargetPoint.lng, approachTargetPoint.lat],
            ],
          },
        },
      ],
    };
  }, [
    showApproachLines,
    latestFix?.lat,
    latestFix?.lng,
    approachTargetPoint?.lat,
    approachTargetPoint?.lng,
  ]);

  const externalBackgroundedRef = useRef(false);
  const externalHandoffOpenedAtRef = useRef(null);
  useEffect(() => {
    if (!pendingExternalPlan) {
      externalBackgroundedRef.current = false;
      externalHandoffOpenedAtRef.current = null;
      return undefined;
    }
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background" || nextState === "inactive") {
        externalBackgroundedRef.current = true;
        return;
      }
      const openedAt = externalHandoffOpenedAtRef.current;
      if (nextState === "active" && externalBackgroundedRef.current) {
        externalBackgroundedRef.current = false;
        const shouldReopen = openedAt !== null && Date.now() - openedAt >= 1000;
        externalHandoffOpenedAtRef.current = null;
        if (!shouldReopen) return;
        setConfirmedRidePlan(null);
        openRideSetup({ preserveSelection: true });
      }
    });
    return () => subscription.remove();
  }, [openRideSetup, pendingExternalPlan]);

  const handleOpenExternalApp = useCallback(
    async (app) => {
      const target =
        pendingExternalPlan?.selectedPoint ||
        confirmedRidePlan?.selectedPoint ||
        navPresentation.externalNavTarget;
      const url = buildAppUrl(app, target);
      if (!url) return;
      const routeToken = routeTokenParam || shareInfo.param;
      if (routeToken) {
        await savePendingRideIntent({
          routeToken,
          slug: routeSlugParam || selectedCatalogSlug,
          name: routeNameParam || selectedCatalogEntry?.name || null,
          direction: confirmedRidePlan?.direction || rideSetupSelection.direction,
          startMode: confirmedRidePlan?.startMode || rideSetupSelection.startMode,
          selectedPoint: target,
        });
      }
      trackNavigationEvent("approach_external_handoff", {
        app: app?.id || "unknown",
        approachTier: pendingExternalPlan?.approachTier || "near",
      });
      setDestSheetVisible(false);
      externalHandoffOpenedAtRef.current = Date.now();
      Linking.openURL(url).catch(() => {
        externalHandoffOpenedAtRef.current = null;
        setDestSheetVisible(true);
      });
    },
    [
      confirmedRidePlan,
      navPresentation.externalNavTarget,
      pendingExternalPlan,
      rideSetupSelection,
      routeNameParam,
      routeSlugParam,
      routeTokenParam,
      selectedCatalogEntry?.name,
      selectedCatalogSlug,
      shareInfo.param,
    ],
  );
  const suggestionGeometry = approach?.suggestionGeometry;
  const showSuggestion =
    showApproachLines &&
    navPresentation.tier === "near" &&
    Array.isArray(suggestionGeometry) &&
    suggestionGeometry.length >= 2;
  const suggestionFeature = useMemo(
    () =>
      Array.isArray(suggestionGeometry) && suggestionGeometry.length >= 2
        ? buildRouteGeometryFeatureCollection(suggestionGeometry)
        : EMPTY_FEATURE_COLLECTION,
    [suggestionGeometry],
  );
  const cameraIntent = nav.state?.cameraIntent ?? "follow";

  // Cumulative arc length for the active route; null until there are >=2 points.
  const arc = useMemo(
    () =>
      Array.isArray(navGeometry) && navGeometry.length >= 2
        ? precomputeArcLength(navGeometry)
        : null,
    [navGeometry],
  );

  // Smoothed puck position/heading and the (throttled) traveled line, rendered
  // from React state updated by the RAF loop.
  const [riderPuck, setRiderPuck] = useState(null);
  const [navTraveled, setNavTraveled] = useState(EMPTY_FEATURE_COLLECTION);

  // Latest inputs mirrored into refs so the RAF loop reads current values
  // without restarting on every render.
  const progressRef = useRef(null);
  const cameraIntentRef = useRef("follow");
  const rawFixRef = useRef(null);
  const arcRef = useRef(null);
  const navGeometryRef = useRef([]);
  const mapHeadingRef = useRef(0);
  const smoothedMetersRef = useRef(0);
  const smoothedBearingRef = useRef(0);
  const travelIndexRef = useRef(-1);
  const rafRef = useRef(0);
  const navStatusRef = useRef("idle");
  const lastPushedPuckRef = useRef(null);
  // Snap-vs-detected puck anchoring (hysteresis lives in @cycleways/core) and
  // the lerped position used while the puck is away from the route line.
  const puckAnchorRef = useRef(null);
  const puckGlideRef = useRef(null);
  // Camera heading is governed separately from the puck arrow: the arrow
  // tracks the rider's direction in real time, the map frame re-orients only
  // for persistent or sharp direction changes.
  const cameraGovernorRef = useRef(null);
  const cameraBearingRef = useRef(0);
  // Stable handle to userPanned() so the (deps-[]) camera-change handler can
  // disengage follow on a user gesture without re-subscribing every render.
  const navUserPannedRef = useRef(null);
  const mapPickHandlerRef = useRef(null);
  // Live device-compass heading (deg). Drives the heading-up camera and the
  // to-route arrow so the view is adaptive to the phone's facing direction even
  // when stationary (GPS course is unreliable below walking speed).
  const deviceHeadingRef = useRef(null);
  const [compassHeading, setCompassHeading] = useState(null);
  // External navigation chooser + ride-setup "tap a point" mode.
  const [destSheetVisible, setDestSheetVisible] = useState(false);
  const [pickOnMapMode, setPickOnMapMode] = useState(false);
  const pickOnMapModeRef = useRef(false);
  pickOnMapModeRef.current = pickOnMapMode;
  progressRef.current = navProgress;
  cameraIntentRef.current = cameraIntent;
  rawFixRef.current = nav.state?.latestFix ?? null;
  arcRef.current = arc;
  navGeometryRef.current = navGeometry;
  navStatusRef.current = navStatus;
  navUserPannedRef.current = nav.userPanned;
  mapPickHandlerRef.current = (point) => {
    setRideSetupSelection((current) => ({
      ...current,
      startMode: "custom",
      selectedPoint: point,
    }));
    setRideSetupVisible(true);
  };

  // Distances are local to the active geometry. Reset interpolation state when
  // switching main route ↔ connector so metres from one path are never applied
  // to the other.
  useEffect(() => {
    smoothedMetersRef.current = navProgress?.progressMeters ?? 0;
    smoothedBearingRef.current =
      navProgress?.smoothedCourseDeg ?? navProgress?.courseDeg ?? 0;
    travelIndexRef.current = -1;
    lastPushedPuckRef.current = null;
    setNavTraveled(EMPTY_FEATURE_COLLECTION);
  }, [activeGeometryKey]);

  // RAF loop: runs only while navigating. Tweens smoothedMetersRef toward the
  // reported along-route distance and smoothedBearingRef toward the target
  // heading, then positions the puck, advances the traveled line, and (when the
  // camera intent is "follow") drives the camera from the same smoothed values.
  useEffect(() => {
    if (!isNavigating) {
      setRiderPuck(null);
      setNavTraveled(EMPTY_FEATURE_COLLECTION);
      travelIndexRef.current = -1;
      lastPushedPuckRef.current = null;
      puckAnchorRef.current = null;
      puckGlideRef.current = null;
      cameraGovernorRef.current = null;
      return undefined;
    }
    puckAnchorRef.current = createPuckAnchor();
    puckGlideRef.current = null;
    cameraGovernorRef.current = createCameraHeadingGovernor();
    const startProgress = progressRef.current;
    smoothedMetersRef.current = startProgress?.progressMeters ?? 0;
    smoothedBearingRef.current =
      startProgress?.bearingToNextDeg ?? startProgress?.smoothedCourseDeg ?? 0;
    cameraBearingRef.current = smoothedBearingRef.current;
    let lastTs = 0;
    const tick = (ts) => {
      const dtMs = lastTs ? Math.max(0, ts - lastTs) : 16;
      lastTs = ts;
      const progress = progressRef.current;
      const arcNow = arcRef.current;
      const geom = navGeometryRef.current;
      if (progress) {
        const onRoute =
          progress.hasAcquiredRoute &&
          !progress.offRoute &&
          arcNow &&
          Array.isArray(geom) &&
          geom.length >= 2;
        let lng;
        let lat;
        let targetBearing;
        if (onRoute) {
          smoothedMetersRef.current = nextSmoothedMeters({
            current: smoothedMetersRef.current,
            target: progress.progressMeters ?? 0,
            dtMs,
          });
          const { point, bearingDeg } = pointAndBearingAtDistance(
            arcNow,
            geom,
            smoothedMetersRef.current,
          );
          // Snap to the line only while the cross-track error is within GPS
          // noise; on a parallel path (detached) show the detected location,
          // lerping so both leaving and rejoining the line read as a glide.
          const anchorMode =
            puckAnchorRef.current?.update(progress.crossTrackMeters) ?? "route";
          const rawFix = anchorMode === "detected" ? rawFixRef.current : null;
          const glideTarget =
            rawFix && Number.isFinite(rawFix.lat) && Number.isFinite(rawFix.lng)
              ? rawFix
              : point;
          if (glideTarget === point && !puckGlideRef.current) {
            lng = point.lng;
            lat = point.lat;
          } else {
            const glide = puckGlideRef.current ?? { lat: point.lat, lng: point.lng };
            const fraction = Math.min(1, dtMs / PUCK_GLIDE_MS);
            glide.lat += (glideTarget.lat - glide.lat) * fraction;
            glide.lng += (glideTarget.lng - glide.lng) * fraction;
            const converged =
              glideTarget === point &&
              Math.abs(glide.lat - point.lat) < 1e-5 &&
              Math.abs(glide.lng - point.lng) < 1e-5;
            puckGlideRef.current = converged ? null : glide;
            lng = glide.lng;
            lat = glide.lat;
          }
          // Orientation stays locked to the route even while the puck is
          // detached: a parallel path runs in the route's direction, and the
          // instantaneous GPS course is far too noisy to steer the camera.
          targetBearing = progress.bearingToNextDeg ?? bearingDeg;
          // Advance the traveled (muted) line up to the smoothed point, but only
          // when the underlying segment index changes — keeps the per-frame cost
          // bounded while the puck itself stays smooth.
          const idx = arcIndexForMeters(arcNow.cumDist, smoothedMetersRef.current);
          if (idx !== travelIndexRef.current) {
            travelIndexRef.current = idx;
            setNavTraveled(
              buildRouteGeometryFeatureCollection(
                traveledCoordinates(geom, idx, point),
              ),
            );
          }
        } else {
          // Approaching / off-route: ride the latest raw GPS fix.
          const raw =
            rawFixRef.current ||
            progress.snappedPoint ||
            progress.guidanceTargetPoint ||
            null;
          if (raw && Number.isFinite(raw.lng) && Number.isFinite(raw.lat)) {
            lng = raw.lng;
            lat = raw.lat;
            // Remember where the puck is so recovering onto the route glides
            // back to the line instead of teleporting.
            puckGlideRef.current = { lat: raw.lat, lng: raw.lng };
          }
          // Steer by the rider's general direction of travel — the per-fix
          // GPS course is too noisy for the camera. Hold the current heading
          // while it is unknown (stopped / not enough movement yet).
          targetBearing =
            progress.smoothedCourseDeg ?? smoothedBearingRef.current;
        }
        // Prefer the live device compass so the view follows where the phone
        // points (adaptive even when stationary); fall back to GPS course.
        if (Number.isFinite(deviceHeadingRef.current)) {
          targetBearing = deviceHeadingRef.current;
        }
        if (Number.isFinite(lng) && Number.isFinite(lat)) {
          if (Number.isFinite(targetBearing)) {
            smoothedBearingRef.current = shortestAngleLerp(
              smoothedBearingRef.current,
              targetBearing,
              Math.min(1, dtMs / BEARING_SMOOTH_MS),
            );
          }
          // The puck arrow tracks the rider's direction in real time; the
          // camera aims where cameraHeadingTarget says (route-up on route,
          // toward the start while approaching, held still off-route), with
          // the governor gating adoption and a slower ease. The compass, when
          // live, keeps steering the view to the phone's facing direction.
          const heading = smoothedBearingRef.current;
          const cameraTarget = Number.isFinite(deviceHeadingRef.current)
            ? deviceHeadingRef.current
            : cameraHeadingTarget(progress);
          const governedHeading =
            cameraGovernorRef.current?.update(cameraTarget, ts) ??
            cameraBearingRef.current;
          if (Number.isFinite(governedHeading)) {
            cameraBearingRef.current = shortestAngleLerp(
              cameraBearingRef.current,
              governedHeading,
              Math.min(1, dtMs / CAMERA_ROTATE_MS),
            );
          }
          // MarkerView is screen-aligned, so rotate the arrow by the puck's
          // geographic heading minus the map's heading (the live map heading,
          // so the arrow stays true while the camera holds still).
          const rotation = ((heading - mapHeadingRef.current) % 360 + 360) % 360;
          const muted = !onRoute;
          // Only push puck state when the *displayed* value actually changes:
          // round lng/lat to ~6dp and rotation to whole degrees so identical
          // frames (e.g. stationary) don't re-render the screen at ~60fps.
          const last = lastPushedPuckRef.current;
          const candidate = {
            lng: Math.round(lng * 1e6) / 1e6,
            lat: Math.round(lat * 1e6) / 1e6,
            rotation: Math.round(rotation),
            muted,
          };
          if (
            !last ||
            last.lng !== candidate.lng ||
            last.lat !== candidate.lat ||
            last.rotation !== candidate.rotation ||
            last.muted !== candidate.muted
          ) {
            lastPushedPuckRef.current = candidate;
            setRiderPuck({ lng, lat, rotation, muted });
          }
          // Camera (suppressed while paused, and disengaged when the rider pans —
          // cameraIntent flips to "free" on a user gesture, re-engaged by the
          // recenter button). setCamera/fitBounds are off the React tree, so this
          // is intentionally NOT gated on the puck-change check.
          if (
            cameraIntentRef.current === "follow" &&
            navStatusRef.current !== "paused"
          ) {
            // Heading-up follow on the rider, tilted to a near-ground
            // perspective. Used both on-route and while approaching so the view
            // stays first-person and adaptive to the phone's facing direction;
            // the direct line + dashed suggestion lead the eye to the route.
            cameraRef.current?.setCamera?.({
              centerCoordinate: [lng, lat],
              heading: cameraBearingRef.current,
              pitch: NAV_FOLLOW_PITCH,
              zoomLevel: NAV_FOLLOW_ZOOM,
              animationDuration: 0,
            });
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNavigating]);

  // Device-compass heading watch (active only while navigating). Updates a ref
  // (read by the RAF camera each frame) and a throttled state (the to-route
  // arrow in NavPanel) so a small phone rotation doesn't re-render at sensor
  // rate. Best-effort: if the sensor/permission is unavailable we silently fall
  // back to GPS course.
  useEffect(() => {
    if (!isNavigating) return undefined;
    let subscription = null;
    let cancelled = false;
    Location.watchHeadingAsync((reading) => {
      const next = reading?.trueHeading >= 0 ? reading.trueHeading : reading?.magHeading;
      if (!Number.isFinite(next)) return;
      deviceHeadingRef.current = next;
      setCompassHeading((prev) =>
        prev === null || Math.abs(((next - prev + 540) % 360) - 180) >= 2 ? next : prev,
      );
    })
      .then((sub) => {
        if (cancelled) sub.remove();
        else subscription = sub;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (subscription) subscription.remove();
      deviceHeadingRef.current = null;
    };
  }, [isNavigating]);

  const handleCameraChanged = useCallback((mapState) => {
    const heading = Number(mapState?.properties?.heading);
    if (Number.isFinite(heading)) mapHeadingRef.current = heading;
    // A user pan/zoom while navigating disengages camera follow so the rider can
    // look around / zoom out (the RAF stops driving the camera). Only fire on the
    // follow→free transition; the recenter button re-engages.
    if (
      isNavigatingRef.current &&
      mapState?.gestures?.isGestureActive &&
      cameraIntentRef.current === "follow"
    ) {
      navUserPannedRef.current?.();
    }
  }, []);

  // Recenter button: re-engage camera follow on the rider.
  const handleRecenter = useCallback(() => {
    nav.recenter();
  }, [nav]);

  // Any hand edit detaches the route from the catalog entry it was loaded from.
  const handleClearRoute = useCallback(() => {
    setSelectedCatalogSlug(null);
    handleRouteClear();
  }, [handleRouteClear]);

  // In-app selection: Discover navigates here with the chosen route's encoded
  // token. Load it through the same shared path used by deep links and record
  // it as a recent. Cold-start deep links instead seed the native href (read by
  // the controller on init), so this only runs for explicit in-app picks.
  useEffect(() => {
    const restoreDecision = routeRestoreDecision(
      routeTokenParam,
      routeState.status,
    );
    if (restoreDecision === "idle") {
      setRouteRestoreStatus("idle");
      return undefined;
    }
    // Asset loading and routing-manager initialization are separate async
    // phases. Waiting for the route reducer's managerReady state prevents a
    // one-shot load from racing the manager and silently leaving an empty map.
    if (restoreDecision === "wait") {
      setRouteRestoreStatus("waiting");
      return undefined;
    }
    let cancelled = false;
    setRouteRestoreStatus("loading");
    setPendingRideSetupToken(null);
    setConfirmedRidePlan(null);
    (async () => {
      const loaded = await handleLoadRouteParam(routeTokenParam);
      if (cancelled) return;
      if (!loaded) {
        setRouteRestoreStatus("error");
        return;
      }
      setRouteRestoreStatus("ready");
      setSelectedCatalogSlug(routeSlugParam);
      if (rideSetupSelectionParam) {
        setRideSetupSelection({
          direction:
            rideSetupSelectionParam.direction === "reverse" ? "reverse" : "forward",
          startMode: ["official", "nearest", "custom"].includes(
            rideSetupSelectionParam.startMode,
          )
            ? rideSetupSelectionParam.startMode
            : "official",
          selectedPoint: rideSetupSelectionParam.selectedPoint || null,
        });
      }
      if (openRideSetupParam) {
        setPendingRideSetupToken(routeTokenParam);
      }
      handleAddRecentRoute?.({
        name: routeNameParam,
        slug: routeSlugParam,
        param: routeTokenParam,
        source: "catalog",
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [
    openRideSetupParam,
    routeTokenParam,
    routeSlugParam,
    routeNameParam,
    rideSetupSelectionParam,
    handleLoadRouteParam,
    handleAddRecentRoute,
    routeRestoreAttempt,
    routeState.status,
  ]);

  // A featured-page Navigate action opens ride setup after its encoded route is
  // loaded. It never starts a continuous GPS navigation session implicitly.
  useEffect(() => {
    if (!pendingRideSetupToken || pendingRideSetupToken !== routeTokenParam) return;
    if (state.status !== "ready" || !sourceNavigationRoute?.canNavigate) return;
    setPendingRideSetupToken(null);
    openRideSetup({ preserveSelection: Boolean(rideSetupSelectionParam) });
  }, [
    openRideSetup,
    pendingRideSetupToken,
    routeTokenParam,
    rideSetupSelectionParam,
    sourceNavigationRoute,
    state.status,
  ]);

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
      mapPresentationActive ? PLAYBACK_FIT_BOTTOM_PADDING : 84,
    );
  }, [mapPresentationActive, routeState.geometry, routeState.points, stopFollowingLocation]);

  useEffect(() => {
    if (!mapUi.routeFitRequest) return;
    stopFollowingLocation();
    fitCameraToPoints(
      cameraRef.current,
      mapUi.routeFitRequest.geometry,
      mapPresentationActive ? PLAYBACK_FIT_BOTTOM_PADDING : 84,
    );
  }, [mapPresentationActive, mapUi.routeFitRequest, stopFollowingLocation]);

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
        onCameraChanged={handleCameraChanged}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={INITIAL_CAMERA_SETTINGS}
          animationDuration={0}
          animationMode="none"
          // While navigating the camera is driven imperatively from the smoothed
          // puck position via setCamera in the RAF loop; followUserLocation is
          // only used in planning mode (it follows the raw GPS).
          followUserLocation={locationState.following && !isNavigating}
          followUserMode={UserTrackingMode.FollowWithHeading}
          followZoomLevel={14.5}
        />
        {/* Raw GPS puck: hidden while navigating (the custom adaptive puck takes
            over) but kept mounted so onUpdate keeps feeding the latest raw fix
            used to place the puck while approaching / off-route. */}
        {locationState.enabled || isNavigating ? (
          <UserLocation
            visible={!isNavigating}
            onUpdate={handleUserLocationUpdate}
            renderMode={UserLocationRenderMode.Native}
            showsUserHeadingIndicator
          />
        ) : null}
        <ShapeSource id="network" shape={networkFeatures}>
          <LineLayer id="network-shadow" style={networkLayerStyles.shadow} />
          <LineLayer id="network-casing" style={networkLayerStyles.casing} />
          <LineLayer id="network-line" style={networkLayerStyles.core} />
        </ShapeSource>
        <ShapeSource id="route-geometry" shape={displayedRouteGeometry}>
          {routeLineStyles.casing ? (
            <LineLayer id="route-casing" style={routeLineStyles.casing} />
          ) : null}
          <LineLayer id="route-line" style={routeLineStyles.core} />
        </ShapeSource>
        {(rideSetupVisible || pickOnMapMode) && ridePlan?.effectiveRoute ? (
          <ShapeSource id="ride-setup-preview" shape={setupPreviewGeometry}>
            <LineLayer id="ride-setup-preview-line" style={SETUP_PREVIEW_LINE_STYLE} />
          </ShapeSource>
        ) : null}
        {(rideSetupVisible || pickOnMapMode) && ridePlan?.selectedPoint ? (
          <MarkerView
            coordinate={[ridePlan.selectedPoint.lng, ridePlan.selectedPoint.lat]}
            anchor={{ x: 0.5, y: 1 }}
            allowOverlap
          >
            <View style={styles.setupStartMarker}>
              <Icon name="flag" size={18} color={palette.white} />
            </View>
          </MarkerView>
        ) : null}
        {showApproachLines ? (
          <ShapeSource id="approach-direct" shape={directLineGeometry}>
            <LineLayer
              id="approach-direct-line"
              style={APPROACH_DIRECT_LINE_STYLE}
            />
          </ShapeSource>
        ) : null}
        {showSuggestion ? (
          <ShapeSource id="approach-suggestion" shape={suggestionFeature}>
            <LineLayer
              id="approach-suggestion-line"
              style={APPROACH_SUGGESTION_LINE_STYLE}
            />
          </ShapeSource>
        ) : null}
        {isNavigating ? (
          <>
            <ShapeSource id="route-traveled" shape={navTraveled}>
              <LineLayer id="route-traveled-line" style={ROUTE_TRAVELED_LINE_STYLE} />
            </ShapeSource>
            {riderPuck ? (
              <MarkerView
                coordinate={[riderPuck.lng, riderPuck.lat]}
                anchor={{ x: 0.5, y: 0.5 }}
                allowOverlap
                allowOverlapWithPuck
              >
                <View
                  pointerEvents="none"
                  style={[
                    styles.riderPuck,
                    { transform: [{ rotate: `${riderPuck.rotation}deg` }] },
                  ]}
                >
                  <View
                    style={[
                      styles.riderPuckArrow,
                      {
                        borderBottomColor: riderPuck.muted
                          ? RIDER_PUCK_MUTED_COLOR
                          : RIDER_PUCK_COLOR,
                      },
                    ]}
                  />
                  <View
                    style={[
                      styles.riderPuckDot,
                      {
                        backgroundColor: riderPuck.muted
                          ? RIDER_PUCK_MUTED_COLOR
                          : RIDER_PUCK_COLOR,
                      },
                    ]}
                  />
                </View>
              </MarkerView>
            ) : null}
          </>
        ) : null}
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
          <BackButton onPress={() => navigation?.goBack?.()} />
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
      {routeTokenParam &&
      (routeRestoreStatus === "waiting" || routeRestoreStatus === "loading") ? (
        <View style={styles.routeRestoreOverlay} pointerEvents="auto">
          <View style={styles.routeRestoreCard}>
            <ActivityIndicator color={palette.forest} size="small" />
            <Text style={styles.routeRestoreText}>טוען מסלול לעריכה…</Text>
          </View>
        </View>
      ) : null}
      {routeTokenParam && routeRestoreStatus === "error" ? (
        <View style={styles.routeRestoreOverlay} pointerEvents="auto">
          <View style={styles.routeRestoreCard}>
            <Text style={styles.routeRestoreTitle}>המסלול לא נטען</Text>
            <Text style={styles.routeRestoreText}>
              לא הצלחנו לשחזר את המסלול לעריכה.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="נסה לטעון שוב"
              onPress={() => setRouteRestoreAttempt((attempt) => attempt + 1)}
              style={({ pressed }) => [
                styles.routeRestoreRetry,
                pressed ? styles.routeRestoreRetryPressed : null,
              ]}
            >
              <Text style={styles.routeRestoreRetryText}>נסה שוב</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
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
      {/* Dev-only simulate + record controls. __DEV__ is false in production
          builds so this entire block is dead-code-eliminated by Metro. */}
      {__DEV__ && !isNavigating ? (
        <View pointerEvents="box-none" style={styles.devControls}>
          <Pressable
            accessibilityLabel="Dev: simulate ride"
            onPress={handleDevSimulate}
            style={styles.devButton}
          >
            <Text style={styles.devButtonText}>SIM</Text>
          </Pressable>
          {navigationRoute?.geometry?.length >= 2 ? (
            <Pressable
              accessibilityLabel="Dev: record GPS fixes"
              onPress={handleDevRecord}
              style={styles.devButton}
            >
              <Text style={styles.devButtonText}>REC</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {__DEV__ ? (
        <DevScenarioPicker
          visible={devPickerVisible}
          scenarios={devScenarios}
          speed={devSpeed}
          onSelectSpeed={setDevSpeed}
          onSelect={handleDevScenarioSelect}
          onClose={() => setDevPickerVisible(false)}
        />
      ) : null}
      {isNavigating ? (
        <>
          <NavPanel
            sessionState={navPanelState}
            hapticsEnabled={nav.hapticsEnabled}
            onToggleHaptics={() => nav.setHapticsEnabled(!nav.hapticsEnabled)}
            onRecenter={handleRecenter}
            onPauseResume={() =>
              navStatus === "paused" ? nav.resume() : nav.pause()
            }
            onStop={nav.stop}
            onOpenExternal={() => setDestSheetVisible(true)}
            onChangeRideSettings={handleChangeRideSettings}
            compassHeading={compassHeading}
          />
        </>
      ) : (
        <PlannerSheet sheetRef={plannerSheetRef}>
          <BuildPanelContent
            canDownload={canDownload}
            canRedo={canRedo}
            canShare={Boolean(shareUrl) && shareInfo.status !== "too_long"}
            canUndo={canUndo}
            catalogEntry={selectedCatalogEntry}
            locationState={locationState}
            onClear={handleClearRoute}
            onOpenSummary={handleOpenDownload}
            onRedo={handleRedo}
            onSeekToFraction={seekToFraction}
            onShare={shareRoute}
            onStartNavigation={handleStartNavigation}
            onUndo={handleUndo}
            playback={playback}
            presentation={routePresentation}
            routePoints={displayedRoutePoints}
            routeState={routeState}
          />
        </PlannerSheet>
      )}
      <RideSetupSheet
        visible={rideSetupVisible}
        plan={ridePlan}
        selection={rideSetupSelection}
        locationStatus={rideSetupLocationStatus}
        reverseAllowed={sourceNavigationRoute?.routeShape?.type !== "one_way"}
        onDirectionChange={(direction) =>
          setRideSetupSelection((current) => ({ ...current, direction }))
        }
        onStartModeChange={(startMode) =>
          setRideSetupSelection((current) => ({ ...current, startMode }))
        }
        onPickCustom={() => {
          setRideSetupVisible(false);
          setPickOnMapMode(true);
        }}
        onRefreshLocation={refreshRideSetupLocation}
        onConfirm={handleRideSetupConfirm}
        onClose={() => {
          setRideSetupVisible(false);
          trackNavigationEvent("ride_setup_cancelled");
          void clearPendingRideIntent();
        }}
      />
      <DestinationSheet
        visible={destSheetVisible}
        disclaimerText={navPresentation.disclaimerText}
        onOpenApp={handleOpenExternalApp}
        onClose={() => {
          setDestSheetVisible(false);
          if (pendingExternalPlan) setRideSetupVisible(true);
        }}
      />
      {pickOnMapMode ? (
        <View style={styles.pickHint} pointerEvents="box-none">
          <View style={styles.pickHintCard}>
            <Text style={styles.pickHintText} numberOfLines={2}>
              הקש על המסלול כדי לבחור נקודת התחלה
            </Text>
            <Pressable
              onPress={() => {
                setPickOnMapMode(false);
                setRideSetupVisible(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="ביטול"
            >
              <Text style={styles.pickHintCancel}>ביטול</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function BuildPanelContent({
  canDownload,
  canRedo,
  canShare,
  canUndo,
  catalogEntry,
  locationState,
  onClear,
  onOpenSummary,
  onRedo,
  onSeekToFraction,
  onShare,
  onStartNavigation,
  onUndo,
  playback,
  presentation,
  routePoints,
  routeState,
}) {
  const buildModel = getPlannerBuildModel(routeState);
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

      {hasElevationProfile ? (
        <View testID="playback-area">
          <PlaybackControls
            isPlaying={playback.isPlaying}
            isReady={playback.isReady}
            currentTime={playback.currentTime}
            duration={playback.duration}
            onTogglePlayback={playback.togglePlayback}
            onSeekToFraction={onSeekToFraction}
            onScrubStart={playback.pause}
          />
          <ElevationProfileChart
            cursorFraction={playback.cursor?.fraction ?? null}
            onSeekFraction={onSeekToFraction}
            onScrubStart={playback.pause}
            distance={routeState.distance}
            geometry={routeState.geometry}
          />
        </View>
      ) : null}

      {buildModel.hasRoute ? (
        <View testID="route-stats" style={styles.statGrid}>
          {buildModel.stats.map(([label, value]) => (
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

      <RoutePoiList activeDataPoints={routeState.activeDataPoints} />

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

// Data-marker info card (shown when the user taps a map marker).
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

// Largest index i with cumDist[i] <= meters (the segment the smoothed distance
// falls on), so the traveled line can be cut at the smoothed point.
function arcIndexForMeters(cumDist, meters) {
  let lo = 0;
  let hi = cumDist.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumDist[mid] <= meters) lo = mid;
    else hi = mid;
  }
  return lo;
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

function fitCameraToPoints(camera, points, bottomPadding = 84) {
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
  camera.fitBounds?.([east, north], [west, south], [96, 42, bottomPadding, 42], 550);
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  hint: { fontSize: 15, textAlign: "center", color: "#333" },
  pickHint: {
    position: "absolute",
    top: 120,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  pickHintCard: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 16,
    backgroundColor: "#172026",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 18,
    maxWidth: "90%",
  },
  pickHintText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
    writingDirection: "rtl",
    textAlign: "right",
    flexShrink: 1,
  },
  pickHintCancel: {
    color: "#9ec6a6",
    fontSize: 14,
    fontWeight: "800",
    writingDirection: "rtl",
  },
  setupStartMarker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.forest,
    borderWidth: 3,
    borderColor: palette.white,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 4,
  },
  routeRestoreOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "rgba(237, 237, 237, 0.72)",
  },
  routeRestoreCard: {
    width: "100%",
    maxWidth: 320,
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 22,
    paddingVertical: 20,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.98)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 6,
  },
  routeRestoreTitle: {
    color: palette.ink,
    fontSize: 17,
    fontWeight: "900",
    textAlign: "center",
    writingDirection: "rtl",
  },
  routeRestoreText: {
    color: palette.muted,
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
    writingDirection: "rtl",
  },
  routeRestoreRetry: {
    marginTop: 2,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: palette.forest,
  },
  routeRestoreRetryPressed: { opacity: 0.78 },
  routeRestoreRetryText: {
    color: palette.white,
    fontSize: 14,
    fontWeight: "800",
    writingDirection: "rtl",
  },
  // Adaptive rider puck: a colored dot with a heading arrow. The whole view is
  // rotated by the RAF loop; the arrow points "up" (north) at rotation 0.
  riderPuck: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  riderPuckArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 10,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    marginBottom: -3,
  },
  riderPuckDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: "#ffffff",
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
  // Dev-only simulate/record overlay — dead code in production builds.
  devControls: {
    position: "absolute",
    bottom: 128,
    right: 12,
    flexDirection: "row",
    gap: 4,
    zIndex: 100,
  },
  devButton: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: "rgba(0,0,0,0.62)",
    borderRadius: 4,
  },
  devButtonText: {
    color: "#ffe600",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
});
