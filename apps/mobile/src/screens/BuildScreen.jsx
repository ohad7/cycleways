import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Location from "expo-location";
import { useSyntheticRoutePlaybackEngine } from "@cycleways/core/ui/routePlaybackEngine.js";
import PlaybackControls from "../planner/PlaybackControls.jsx";
import { fontSizes, text } from "../theme/typography.js";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSharedValue } from "react-native-reanimated";
import { useCyclewaysApp } from "@cycleways/core/app/useCyclewaysApp.js";
import { dataMarkerFeatureCollection } from "@cycleways/core/data/dataMarkers.js";
import { POI_LABELS, POI_COLORS } from "@cycleways/core/data/poiTypes.js";
import {
  loadRouteCatalogEntries,
  routeShapeType,
} from "@cycleways/core/data/catalog.js";
import { navigationRouteFromRouteState } from "@cycleways/core/navigation/navigationRoute.js";
import {
  createRidePlan,
  ridePlanNeedsDirectApproachPreview,
  ridePlanNeedsConnectorPreview,
} from "@cycleways/core/navigation/ridePlan.js";
import { confirmDistanceBucket } from "@cycleways/core/navigation/rideIntroPresentation.js";
import { traveledCoordinates } from "@cycleways/core/navigation/routeProgress.js";
import { createPuckAnchor } from "@cycleways/core/navigation/puckAnchor.js";
import {
  cameraHeadingTargetForState,
  createCameraHeadingGovernor,
} from "@cycleways/core/navigation/cameraHeading.js";
import { createCameraDirector } from "@cycleways/core/navigation/cameraDirector.js";
import { plannerLocateCameraView } from "@cycleways/core/navigation/plannerLocateCamera.js";
import {
  cameraCorridorForProgress,
  cameraGeometryKey,
  cameraManeuverCorridor,
  cameraTargetZoom,
  nextAppliedZoom,
  shouldReframeOverview,
} from "@cycleways/core/navigation/cameraViewport.js";
import { getNavigationPresentation } from "@cycleways/core/navigation/navigationPresentation.js";
import { navigationLinePresentationForState } from "@cycleways/core/navigation/navigationLinePresentation.js";
import { buildAppUrl } from "@cycleways/core/navigation/externalNav.js";
import { scenarios as devScenarios } from "@cycleways/core/navigation/scenarios/index.js";
import { resolveScenario } from "@cycleways/core/navigation/scenarios/resolve.js";
import { bookmarkPlaybackWindow } from "@cycleways/core/navigation/scenarios/journeySchema.js";
import {
  computeBearing,
  precomputeArcLength,
  pointAndBearingAtDistance,
} from "@cycleways/core/utils/geometry.js";
import { getDistance } from "@cycleways/core/utils/distance.js";
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
import MapControls from "../planner/MapControls.jsx";
import MapLegend from "../planner/MapLegend.jsx";
import BuildEmptyActions from "../planner/BuildEmptyActions.jsx";
import BackButton from "./BackButton.jsx";
import RoutePoiList from "../planner/RoutePoiList.jsx";
import NavPanel from "../planner/NavPanel.jsx";
import ApproachPanel from "../planner/ApproachPanel.jsx";
import DestinationSheet from "../planner/DestinationSheet.jsx";
import RideSetupSheet from "../planner/RideSetupSheet.jsx";
import RideIntroCard from "../planner/RideIntroCard.jsx";
import { useNavigationSession } from "../navigation/useNavigationSession.js";
import {
  createDefaultLocationSource,
  getRideSetupLocation,
  stopNavigationBackgroundUpdates,
} from "../navigation/locationService.js";
import { clearActiveNavigationSession } from "../navigation/activeNavigationStore.js";
import { createJourneyPlaybackSource } from "../navigation/journeyPlaybackSource.js";
import {
  deriveRidePlanJourneyFixes,
  initialJourneyPlaybackState,
  journeyPlaybackPatch,
  journeyRequiresRideIntro,
  shouldAcceptNativeLocationUpdate,
} from "../navigation/journeyHarnessState.js";
import { useNavigationCamera } from "../navigation/useNavigationCamera.js";
import { normalizeCameraViewport } from "../navigation/navigationCameraAdapter.js";
import {
  SETUP_CONNECTOR_PREVIEW_STYLES,
  SETUP_ROUTE_PREVIEW_STYLES,
  navigationConnectorLineStyles,
  navigationMainRouteLineStyle,
} from "../navigation/navigationLineStyles.js";
import { connectorRouterForScenario } from "@cycleways/core/navigation/scenarioConnector.js";
import {
  clearPendingRideIntent,
  savePendingRideIntent,
} from "../navigation/pendingRidePlanStore.js";
import {
  setNavigationTelemetrySink,
  trackNavigationEvent,
} from "../navigation/navigationTelemetry.js";
import { speakSampleNavigationPrompt } from "../navigation/speechAdapter.js";

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
import DevCameraOverlay from "../planner/DevCameraOverlay.jsx";
import DevJourneyControls from "../planner/DevJourneyControls.jsx";
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
// Telemetry stays off: PrivacyInfo.xcprivacy and the App Store privacy labels
// declare that the app collects no data. Re-enabling requires updating both.
Mapbox.setTelemetryEnabled(false);

// Completed portion of the route during navigation: muted, drawn over the route
// line so the remaining route reads as the emphasized one.
const ROUTE_TRAVELED_LINE_STYLE = {
  lineColor: "#9aa6ab",
  lineWidth: 5,
  lineOpacity: 0.85,
  lineJoin: "round",
  lineCap: "round",
};
const APPROACH_DIRECT_LINE_STYLES = navigationConnectorLineStyles("direct");

// Adaptive rider puck colors: on-route uses the brand blue; approaching /
// off-route is muted gray (matches the traveled line) to signal "not snapped".
const RIDER_PUCK_COLOR = "#006699";
const RIDER_PUCK_MUTED_COLOR = "#9aa6ab";
// Camera zoom while following the rider during navigation.
const NAV_FOLLOW_ZOOM = 16.5;
// Tilt for the heading-up follow camera so the rider sees the route ahead from
// near ground level (also makes the view read as adaptive to the phone facing).
const NAV_FOLLOW_PITCH = 55;
// Approach/rejoin fit shots include a small slice of the main route after the
// join point so a straight-line connector still frames "where this ride goes".
const APPROACH_ROUTE_LOOKAHEAD_M = 180;
// Off-route rejoin fit shots include the live rider point, so raw GPS movement
// would otherwise restart a bounds animation on every fix.
const REJOIN_CAMERA_FIT_MIN_INTERVAL_MS = 1500;
const REJOIN_CAMERA_FIT_KEY_DECIMALS = 4;
const DEFAULT_CAMERA_FIT_KEY_DECIMALS = 5;
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
const RIDE_INTRO_FIT_BOTTOM_PADDING = 320;
const RIDE_INTRO_MARKER_CLEARANCE = 56;
const RIDE_INTRO_FIT_PITCH = NAV_FOLLOW_PITCH;
const RIDE_INTRO_PITCH_MIN_DISTANCE_M = 25;
const RIDE_INTRO_START_TOP_PADDING = 132;
const RIDE_INTRO_START_SAFE_AREA_GAP = 112;
const RIDE_INTRO_RIDER_CARD_GAP = 96;
const RIDE_INTRO_MIN_MARKER_SPAN_PX = 180;
const RIDE_INTRO_MIN_ZOOM = 8.8;
const RIDE_INTRO_MAX_ZOOM = 16.8;
const DEFAULT_RIDE_SETUP_SELECTION = {
  direction: "forward",
  startMode: "official",
  selectedPoint: null,
  startProgressMeters: null,
};
const ACQUIRED_BANNER_MS = 4000;

export default function BuildScreen({ navigation, route }) {
  const cameraRef = useRef(null);
  const routePointPressGuardRef = useRef(0);
  const devJourneyOwnsLocationRef = useRef(false);
  const retainedIntroCameraStateRef = useRef(null);
  const screenInsets = useSafeAreaInsets();
  const [locationState, setLocationState] = useState({
    enabled: false,
    following: false,
    point: null,
    status: "idle",
  });
  const [catalogEntries, setCatalogEntries] = useState([]);
  const [pendingRideSetupToken, setPendingRideSetupToken] = useState(null);
  const routeTokenParam = route?.params?.routeToken ?? null;
  const resumeRideParam = route?.params?.resumeRide ?? null;
  const resumeRideHandledRef = useRef(false);
  const resumeFailureShownRef = useRef(false);
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
    computeRouteJunctions,
    plannerDraft,
    handleRestoreDraft,
  } = useCyclewaysApp({ enableRouteDirectionAnimation: false, includeRoundabouts: true });

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
  // Legend open/close (closed by default) + the planner sheet's live top-edge Y,
  // so the bottom-left MapLegend can ride just above the drawer as it's dragged.
  const [legendOpen, setLegendOpen] = useState(false);
  const sheetTop = useSharedValue(Dimensions.get("window").height * 0.52);
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
          !introFlowActiveRef.current &&
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
      if (introFlowActiveRef.current) return;
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
      if (introFlowActiveRef.current) return;
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
    if (!shouldAcceptNativeLocationUpdate({
      journeyActive: __DEV__ && devJourneyOwnsLocationRef.current,
    })) return;
    const point = pointFromLocationEvent(location);
    if (!point) return;
    setLocationState((current) => ({
      ...current,
      enabled: true,
      point,
      status: current.following ? "following" : "located",
    }));
    if (introFlowActiveRef.current && !isNavigatingRef.current) {
      setRideSetupFix((current) => ({
        ...(current || {}),
        lat: point.lat,
        lng: point.lng,
        timestamp: Date.now(),
      }));
      setRideSetupLocationStatus((current) =>
        current === "loading" ? "ready" : current,
      );
    }
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
      const retainedView = plannerLocateCameraView({
        zoom: mapZoomRef.current,
        pitch: mapPitchRef.current,
      });
      cameraRef.current?.setCamera?.({
        type: "CameraStop",
        centerCoordinate: [locationState.point.lng, locationState.point.lat],
        ...retainedView,
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

  const [rideIntroVisible, setRideIntroVisible] = useState(false);
  const [rideIntroCardHeight, setRideIntroCardHeight] = useState(0);
  const [rideSettingsVisible, setRideSettingsVisible] = useState(false);
  const rideSettingsOriginRef = useRef("intro");
  const [rideSetupSelection, setRideSetupSelection] = useState(DEFAULT_RIDE_SETUP_SELECTION);
  const [destSheetVisible, setDestSheetVisible] = useState(false);
  const [pickOnMapMode, setPickOnMapMode] = useState(false);
  const [rideSetupFix, setRideSetupFix] = useState(null);
  const [rideSetupNow, setRideSetupNow] = useState(Date.now());
  const [rideSetupLocationStatus, setRideSetupLocationStatus] = useState("idle");
  const [rideSetupConnector, setRideSetupConnector] = useState({
    key: "",
    status: "idle",
    geometry: [],
    distanceMeters: null,
  });
  const [voiceGuidanceEnabled, setVoiceGuidanceEnabled] = useState(true);
  const [lockScreenGuidanceEnabled, setLockScreenGuidanceEnabled] = useState(true);
  const [confirmedRidePlan, setConfirmedRidePlan] = useState(null);
  const [preparedRouteJunctions, setPreparedRouteJunctions] = useState({
    routeId: null,
    status: "idle",
    junctions: null,
  });
  const [pendingNavigationRouteId, setPendingNavigationRouteId] = useState(null);
  const [pendingExternalPlan, setPendingExternalPlan] = useState(null);
  const [devPickerVisible, setDevPickerVisible] = useState(false);
  const [devPickerMode, setDevPickerMode] = useState("sim");
  const [devCameraDiagnostics, setDevCameraDiagnostics] = useState(null);
  const [devSpeed, setDevSpeed] = useState(4);
  const [devScenarioRoute, setDevScenarioRoute] = useState(null);
  const [devRideIntroRoute, setDevRideIntroRoute] = useState(null);
  const [pendingDevRideIntro, setPendingDevRideIntro] = useState(null);
  const [devPlaybackState, setDevPlaybackState] = useState(null);
  const devPlaybackRef = useRef(null);
  const devRideSetupRestoreRef = useRef(null);
  const pendingDevReplayRef = useRef(false);
  const devPlaybackUiAtRef = useRef(0);
  const initialWindow = Dimensions.get("window");
  const [mapViewportSize, setMapViewportSize] = useState({
    width: initialWindow.width,
    height: initialWindow.height,
  });
  const [navigationOcclusion, setNavigationOcclusion] = useState({
    topOverlayBottom: screenInsets.top + 96,
    bottomOverlayTop: initialWindow.height - screenInsets.bottom - 96,
  });
  const navigationViewport = useMemo(
    () =>
      normalizeCameraViewport({
        ...mapViewportSize,
        safeInsets: screenInsets,
        ...navigationOcclusion,
        horizontalMargin: 16,
        clearance: 12,
      }),
    [mapViewportSize, navigationOcclusion, screenInsets],
  );
  const navigationViewportRef = useRef(navigationViewport);
  navigationViewportRef.current = navigationViewport;
  const handleCameraAdapterDiagnostics = useCallback((adapterDiagnostics) => {
    if (!__DEV__) return;
    setDevCameraDiagnostics((current) => current
      ? { ...current, ...adapterDiagnostics }
      : { ...adapterDiagnostics });
  }, []);
  const navigationCameraRef = useNavigationCamera({
    cameraRef,
    mapViewRef,
    onDiagnostics: handleCameraAdapterDiagnostics,
  });
  const handleNavigationOverlayLayout = useCallback((patch) => {
    if (!patch || typeof patch !== "object") return;
    setNavigationOcclusion((current) => {
      const next = { ...current, ...patch };
      if (
        Math.abs(next.topOverlayBottom - current.topOverlayBottom) < 2 &&
        Math.abs(next.bottomOverlayTop - current.bottomOverlayTop) < 2
      ) return current;
      return next;
    });
  }, []);
  const handleMapViewportLayout = useCallback((event) => {
    const width = Number(event?.nativeEvent?.layout?.width);
    const height = Number(event?.nativeEvent?.layout?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return;
    }
    setMapViewportSize((current) =>
      Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1
        ? current
        : { width, height },
    );
  }, []);
  const devVisibleScenarios = useMemo(
    () =>
      devPickerMode === "cam"
        ? devScenarios.filter(
            (scenario) =>
              scenario.entryMode === "ride-intro" &&
              Array.isArray(scenario.bookmarks) &&
              scenario.bookmarks.length > 0,
          )
        : devScenarios,
    [devPickerMode],
  );
  const setupRequestRef = useRef(0);

  const rideSetupSourceRoute =
    __DEV__ &&
    devRideIntroRoute &&
    (rideIntroVisible || rideSettingsVisible || pickOnMapMode || pendingDevRideIntro)
      ? devRideIntroRoute
      : sourceNavigationRoute;

  const ridePlan = useMemo(
    () =>
      createRidePlan(
        rideSetupSourceRoute,
        rideSetupSelection,
        rideSetupFix,
        rideSetupNow,
      ),
    [rideSetupSourceRoute, rideSetupSelection, rideSetupFix, rideSetupNow],
  );

  // Warm junction data as soon as an effective route exists. Confirmation
  // itself remains immediate: if this best-effort preload is not complete, the
  // session safely retains legacy all-corners cues for that ride.
  //
  // Keyed on the effective-route *id*, not the object: ride-setup location
  // ticks rebuild the effectiveRoute object (same id, identical geometry —
  // the id encodes route/direction/loop/start-progress) every second, and an
  // object-identity dep would rerun the full shard+network scan per tick and
  // wipe an already-ready result right when the user confirms.
  const junctionSourceRouteRef = useRef(null);
  junctionSourceRouteRef.current = ridePlan?.effectiveRoute ?? null;
  const junctionSourceRouteId = ridePlan?.effectiveRoute?.canNavigate
    ? ridePlan.effectiveRoute.id
    : null;
  useEffect(() => {
    const effectiveRoute = junctionSourceRouteRef.current;
    if (!junctionSourceRouteId || effectiveRoute?.id !== junctionSourceRouteId) {
      return undefined;
    }
    if (Array.isArray(effectiveRoute.junctions)) {
      setPreparedRouteJunctions({
        routeId: effectiveRoute.id,
        status: "ready",
        junctions: effectiveRoute.junctions,
      });
      return undefined;
    }

    let cancelled = false;
    const startedAt = Date.now();
    setPreparedRouteJunctions({
      routeId: effectiveRoute.id,
      status: "loading",
      junctions: null,
    });
    Promise.resolve(computeRouteJunctions(effectiveRoute.geometry))
      .then((junctions) => {
        if (cancelled) return;
        const complete = Array.isArray(junctions);
        setPreparedRouteJunctions({
          routeId: effectiveRoute.id,
          status: complete ? "ready" : "unavailable",
          junctions: complete ? junctions : null,
        });
        trackNavigationEvent("route_junctions_computed", {
          outcome: complete ? "complete" : "unavailable",
          junctionCount: complete ? junctions.length : null,
          durationMs: Date.now() - startedAt,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setPreparedRouteJunctions({
          routeId: effectiveRoute.id,
          status: "unavailable",
          junctions: null,
        });
        trackNavigationEvent("route_junctions_computed", {
          outcome: "failed",
          junctionCount: null,
          durationMs: Date.now() - startedAt,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [computeRouteJunctions, junctionSourceRouteId]);

  useEffect(() => {
    if (
      !rideIntroVisible ||
      !ridePlan?.selectedPoint ||
      !validMapPoint(rideSetupFix) ||
      !ridePlanNeedsConnectorPreview(ridePlan)
    ) {
      setRideSetupConnector((current) =>
        current.status === "idle" && current.geometry.length === 0
          ? current
          : { key: "", status: "idle", geometry: [], distanceMeters: null },
      );
      return undefined;
    }

    const origin = {
      lat: Number(rideSetupFix.lat),
      lng: Number(rideSetupFix.lng),
    };
    const target = {
      lat: Number(ridePlan.selectedPoint.lat),
      lng: Number(ridePlan.selectedPoint.lng),
    };
    const key = [
      origin.lat.toFixed(4),
      origin.lng.toFixed(4),
      target.lat.toFixed(5),
      target.lng.toFixed(5),
    ].join(":");

    setRideSetupConnector((current) =>
      current.key === key && current.status === "ready"
        ? current
        : { key, status: "loading", geometry: [], distanceMeters: null },
    );

    let cancelled = false;
    Promise.resolve(computeConnector(origin, target))
      .then((result) => {
        if (cancelled) return;
        const geometry = Array.isArray(result?.geometry) ? result.geometry : [];
        setRideSetupConnector({
          key,
          status: geometry.length >= 2 && !result?.failure ? "ready" : "unavailable",
          geometry: geometry.length >= 2 && !result?.failure ? geometry : [],
          distanceMeters: Number.isFinite(Number(result?.distanceMeters))
            ? Number(result.distanceMeters)
            : null,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setRideSetupConnector({
          key,
          status: "unavailable",
          geometry: [],
          distanceMeters: null,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    computeConnector,
    rideIntroVisible,
    ridePlan?.approachTier,
    ridePlan?.selectedPoint,
    rideSetupFix?.lat,
    rideSetupFix?.lng,
  ]);

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
    if (validMapPoint(result.fix)) {
      setLocationState((current) => ({
        ...current,
        enabled: true,
        point: { lat: Number(result.fix.lat), lng: Number(result.fix.lng) },
        status: current.following ? "following" : "located",
      }));
    }
    setRideSetupLocationStatus(result.status);
  }, []);

  const openRideIntro = useCallback(
    (options = {}) => {
      const preserveSelection = options?.preserveSelection === true;
      if (!preserveSelection) {
        setRideSetupSelection(DEFAULT_RIDE_SETUP_SELECTION);
      }
      setPendingExternalPlan(null);
      setRideIntroVisible(true);
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
  const devScenarioConnectorRef = useRef(null);
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

  const clearDevJourneyState = useCallback(() => {
    const restore = devRideSetupRestoreRef.current;
    devJourneyOwnsLocationRef.current = false;
    devInnerSourceRef.current = null;
    devScenarioConnectorRef.current = null;
    devPlaybackRef.current = null;
    devRideSetupRestoreRef.current = null;
    pendingDevReplayRef.current = false;
    setDevPlaybackState(null);
    setDevCameraDiagnostics(null);
    setDevRideIntroRoute(null);
    setDevScenarioRoute(null);
    setPendingDevRideIntro(null);
    setPendingNavigationRouteId(null);
    setConfirmedRidePlan(null);
    setRideSetupConnector({
      key: "",
      status: "idle",
      geometry: [],
      distanceMeters: null,
    });
    if (restore) {
      setRideSetupFix(restore.rideSetupFix);
      setRideSetupNow(restore.rideSetupNow);
      setRideSetupLocationStatus(restore.rideSetupLocationStatus);
      setLocationState(restore.locationState);
    }
  }, []);

  const computeNavigationConnector = useCallback(
    (from, to, request) => {
      const scenarioConnector = devScenarioConnectorRef.current;
      if (__DEV__ && scenarioConnector?.active) {
        if (typeof scenarioConnector.router !== "function") {
          // `connector: "none"` deliberately leaves the request pending. It
          // must never fall through to the real routing network.
          return new Promise(() => {});
        }
        return scenarioConnector.router(request || { from, to });
      }
      return computeConnector(from, to);
    },
    [computeConnector],
  );

  const navigationSessionRoute =
    resumeRideParam && !confirmedRidePlan ? null : navigationRoute;
  const nav = useNavigationSession(navigationSessionRoute, {
    background: lockScreenGuidanceEnabled,
    voice: voiceGuidanceEnabled,
    locationSource: __DEV__ ? devSourceProxy.current : undefined,
    computeConnector: computeNavigationConnector,
    resumeSessionId:
      confirmedRidePlan?.effectiveRoute?.id === navigationSessionRoute?.id
        ? resumeRideParam?.sessionId ?? null
        : null,
  });
  const navStatus = nav.state?.status ?? "idle";
  const isNavigating =
    navStatus === "navigating" ||
    navStatus === "approaching" ||
    navStatus === "off-route" ||
    navStatus === "paused" ||
    navStatus === "requesting-permission";

  useEffect(() => {
    if (
      isNavigating &&
      lockScreenGuidanceEnabled &&
      nav.state?.foregroundOnly &&
      !nav.lockScreenGuidanceActive
    ) {
      setLockScreenGuidanceEnabled(false);
      trackNavigationEvent("lock_screen_guidance_fallback", {
        reason: "foreground-only",
      });
    }
  }, [
    isNavigating,
    lockScreenGuidanceEnabled,
    nav.lockScreenGuidanceActive,
    nav.state?.foregroundOnly,
  ]);

  const handleToggleVoiceGuidance = useCallback(() => {
    setVoiceGuidanceEnabled((current) => {
      const next = !current;
      nav.setVoiceEnabled(next);
      trackNavigationEvent("voice_guidance_toggled", { enabled: next });
      return next;
    });
  }, [nav]);

  const handleToggleLockScreenGuidance = useCallback(() => {
    const next = !lockScreenGuidanceEnabled;
    setLockScreenGuidanceEnabled(next);
    trackNavigationEvent("lock_screen_guidance_toggled", { enabled: next });
  }, [lockScreenGuidanceEnabled]);

  const handleTestVoiceGuidance = useCallback(() => {
    trackNavigationEvent("voice_guidance_tested");
    void speakSampleNavigationPrompt();
  }, []);

  const activeRouteGeometry = useMemo(
    () => buildRouteGeometryFeatureCollection(navigationRoute?.geometry),
    [navigationRoute?.geometry],
  );
  const setupPreviewGeometry = useMemo(
    () => buildRouteGeometryFeatureCollection(ridePlan?.effectiveRoute?.geometry),
    [ridePlan?.effectiveRoute?.geometry],
  );
  const setupConnectorGeometry = useMemo(
    () => buildRouteGeometryFeatureCollection(rideSetupConnector.geometry),
    [rideSetupConnector.geometry],
  );
  const setupDirectGeometry = useMemo(
    () =>
      buildRouteGeometryFeatureCollection(
        [rideSetupFix, ridePlan?.selectedPoint].filter(validMapPoint),
      ),
    [
      ridePlan?.selectedPoint?.lat,
      ridePlan?.selectedPoint?.lng,
      rideSetupFix?.lat,
      rideSetupFix?.lng,
    ],
  );
  const displayedRouteGeometry = isNavigating ? activeRouteGeometry : routeGeometry;
  const rideIntroFitBottomPadding =
    rideIntroCardHeight > 0
      ? Math.max(
          RIDE_INTRO_FIT_BOTTOM_PADDING,
          Math.ceil(rideIntroCardHeight + RIDE_INTRO_MARKER_CLEARANCE),
        )
      : RIDE_INTRO_FIT_BOTTOM_PADDING;

  const handleRideIntroCardLayout = useCallback((event) => {
    const height = Number(event?.nativeEvent?.layout?.height);
    if (!Number.isFinite(height) || height <= 0) return;
    setRideIntroCardHeight((current) =>
      Math.abs(current - height) >= 2 ? height : current,
    );
  }, []);

  const resetMapToOverhead = useCallback((animationDuration = 450) => {
    retainedIntroCameraStateRef.current = null;
    cameraPitchRef.current = 0;
    cameraBearingRef.current = 0;
    cameraFitKeyRef.current = null;
    cameraFitAtRef.current = 0;
    cameraOverviewFrameRef.current = null;
    cameraRef.current?.setCamera?.({
      pitch: 0,
      heading: 0,
      animationDuration,
      animationMode: "easeTo",
    });
  }, []);

  const adaptDevJourneyToRidePlan = useCallback((plan) => {
    if (!__DEV__ || !plan?.effectiveRoute?.canNavigate) return;
    const playback = devPlaybackRef.current;
    if (!playback?.source?.setTrack) return;

    if (plan.startMode === "official" && plan.direction === "forward") {
      if (!playback.modifiedRidePlan) return;
      playback.source.setTrack(playback.originalFixes, playback.originalWindow);
      playback.fixes = playback.originalFixes;
      playback.bookmark = playback.originalBookmark;
      playback.isFullJourney = playback.originalIsFullJourney;
      playback.rideSelection = null;
      playback.modifiedRidePlan = false;
      setDevPlaybackState(initialJourneyPlaybackState({
        resolved: playback.resolved,
        bookmark: playback.bookmark,
        mode: playback.mode,
      }));
      setDevCameraDiagnostics((current) => ({
        ...(current || {}),
        bookmark: playback.bookmark?.id || "",
        expectedStage: playback.bookmark?.expectedStage || "",
        journeyTime: playback.originalFixes[0]?.timestamp ?? null,
      }));
      return;
    }

    // A nearest/custom point that is already reached removes the approach leg.
    // Derive movement along the selected effective route so CAM does not keep
    // replaying the now-invalid official-start connector.
    if (plan.approachTier !== "at") return;
    const isCameraPlayback = playback.mode === "cam";
    const derivedFixes = deriveRidePlanJourneyFixes(plan, {
      mode: playback.mode,
      startTimestamp: playback.originalFixes[0]?.timestamp ?? 0,
    });
    if (derivedFixes.length < 2) return;

    const originalBookmark = playback.originalBookmark;
    const preStart = originalBookmark?.phase === "pre-start";
    const branchLabel = plan.startMode === "nearest"
      ? "Nearest start"
      : plan.direction === "reverse"
        ? "Reverse start"
        : "Selected start";
    const derivedBookmark = isCameraPlayback
      ? {
          id: `modified-${plan.startMode}`,
          label: preStart
            ? `${branchLabel} · inspect intro`
            : `${branchLabel} · main-route start`,
          phase: preStart ? "pre-start" : "post-start",
          startAction: preStart ? "hold" : "require-confirm",
          targetTimestamp: preStart
            ? derivedFixes[0].timestamp
            : derivedFixes.at(-1).timestamp,
          preRollMs: 0,
          holdMs: 0,
          expectedStage: preStart ? "intro-overhead" : "ride",
        }
      : null;
    const derivedWindow = {
      warmupEndIndex: -1,
      startIndex: 0,
      endIndex: derivedFixes.length - 1,
    };

    playback.fixes = derivedFixes;
    playback.bookmark = derivedBookmark;
    playback.isFullJourney = !isCameraPlayback;
    playback.rideSelection = {
      direction: plan.direction,
      startMode: plan.startMode,
      startProgressMeters: plan.startProgressMeters,
      selectedPoint: plan.selectedPoint,
    };
    playback.modifiedRidePlan = true;
    playback.source.setTrack(derivedFixes, derivedWindow);
    setDevPlaybackState(initialJourneyPlaybackState({
      resolved: { ...playback.resolved, fixes: derivedFixes },
      bookmark: derivedBookmark,
      mode: playback.mode,
    }));
    setDevCameraDiagnostics((current) => ({
      ...(current || {}),
      bookmark: derivedBookmark?.id || "modified-start",
      expectedStage: derivedBookmark?.expectedStage || "ride",
      journeyTime: derivedFixes[0]?.timestamp ?? null,
    }));
  }, []);

  const confirmRidePlan = useCallback(
    (plan, { startSession = true } = {}) => {
      if (!plan?.effectiveRoute?.canNavigate) return;
      const prepared =
        preparedRouteJunctions.routeId === plan.effectiveRoute.id &&
        preparedRouteJunctions.status === "ready" &&
        Array.isArray(preparedRouteJunctions.junctions)
          ? preparedRouteJunctions.junctions
          : null;
      const confirmedPlan =
        Array.isArray(plan.effectiveRoute.junctions) || prepared === null
          ? plan
          : {
              ...plan,
              effectiveRoute: { ...plan.effectiveRoute, junctions: prepared },
            };
      const completeConfirmation = () => {
        const confirmedRouteId = confirmedPlan.effectiveRoute.id;
        setConfirmedRidePlan(confirmedPlan);
        if (__DEV__ && devRideIntroRoute) {
          setDevScenarioRoute(null);
          setDevRideIntroRoute(null);
        }
        trackNavigationEvent("ride_setup_confirmed", {
          direction: confirmedPlan.direction,
          startMode: confirmedPlan.startMode,
          distanceBucket: confirmDistanceBucket(
            confirmedPlan.distanceToStartMeters,
          ),
          voiceGuidance: voiceGuidanceEnabled,
          lockScreenGuidance: lockScreenGuidanceEnabled,
          junctionCoverage: Array.isArray(
            confirmedPlan.effectiveRoute.junctions,
          )
            ? "complete"
            : "fallback",
        });
        setRideIntroVisible(false);
        setRideSettingsVisible(false);
        if (__DEV__ && devPlaybackRef.current) {
          setDevPlaybackState((current) => current
            ? {
                ...current,
                lifecycle: "starting-session",
                waitingForStart: false,
              }
            : current);
        }
        void clearPendingRideIntent();
        if (startSession) setPendingNavigationRouteId(confirmedRouteId);
      };

      const confirmWithCurrentPermission = async () => {
        if (startSession && rideSetupLocationStatus === "denied") {
          Alert.alert(
            "צריך הרשאת מיקום",
            "כדי להתחיל לעקוב בדרך למסלול צריך לאפשר מיקום לאפליקציה.",
            [
              { text: "ביטול", style: "cancel" },
              { text: "נסה שוב", onPress: () => void refreshRideSetupLocation() },
            ],
          );
          return;
        }
        completeConfirmation();
      };

      void confirmWithCurrentPermission();
    },
    [
      lockScreenGuidanceEnabled,
      devRideIntroRoute,
      preparedRouteJunctions,
      refreshRideSetupLocation,
      rideSetupLocationStatus,
      voiceGuidanceEnabled,
    ],
  );

  const handleStartNavigation = useCallback(() => {
    openRideIntro();
  }, [openRideIntro]);

  const openExternalHandoff = useCallback((plan, origin = "intro") => {
    if (!plan) return;
    setPendingExternalPlan({ plan, origin });
    if (origin === "intro") setRideIntroVisible(false);
    setDestSheetVisible(true);
  }, []);

  const handleIntroConfirm = useCallback(() => {
    confirmRidePlan(ridePlan);
  }, [confirmRidePlan, ridePlan]);

  const handleIntroOpenSettings = useCallback(() => {
    rideSettingsOriginRef.current = "intro";
    setRideIntroVisible(false);
    setRideSettingsVisible(true);
    trackNavigationEvent("ride_settings_opened", { origin: "intro" });
  }, []);

  const handleIntroClose = useCallback(() => {
    setRideIntroVisible(false);
    if (__DEV__) {
      if (devPlaybackRef.current) clearDevJourneyState();
      else {
        setDevRideIntroRoute(null);
        setDevScenarioRoute(null);
        setPendingDevRideIntro(null);
        devInnerSourceRef.current = null;
        setDevCameraDiagnostics(null);
      }
    }
    resetMapToOverhead();
    trackNavigationEvent("ride_setup_cancelled");
    void clearPendingRideIntent();
  }, [clearDevJourneyState, resetMapToOverhead]);

  const handleRideSettingsConfirm = useCallback(() => {
    setRideSettingsVisible(false);
    if (rideSettingsOriginRef.current === "approach") {
      confirmRidePlan(ridePlan);
      return;
    }
    adaptDevJourneyToRidePlan(ridePlan);
    setRideIntroVisible(true);
  }, [adaptDevJourneyToRidePlan, confirmRidePlan, ridePlan]);

  const handleRideSettingsClose = useCallback(() => {
    setRideSettingsVisible(false);
    if (rideSettingsOriginRef.current === "approach") {
      resetMapToOverhead();
      return;
    }
    setRideIntroVisible(true);
  }, [resetMapToOverhead]);

  const handleStopNavigation = useCallback(() => {
    nav.stop();
    resetMapToOverhead();
  }, [nav, resetMapToOverhead]);

  const handleChangeRideSettings = useCallback(() => {
    const reopen = () => {
      nav.stop();
      setConfirmedRidePlan(null);
      setPendingNavigationRouteId(null);
      rideSettingsOriginRef.current = "approach";
      setRideSettingsVisible(true);
      trackNavigationEvent("ride_settings_opened", { origin: "approach" });
      void refreshRideSetupLocation();
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
  }, [
    nav.state?.progress?.hasAcquiredRoute,
    nav.stop,
    refreshRideSetupLocation,
  ]);

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
  const introFlowActiveRef = useRef(false);
  introFlowActiveRef.current =
    rideIntroVisible || rideSettingsVisible || pickOnMapMode;

  const armDevJourneyIntro = useCallback((playback) => {
    if (!__DEV__ || !playback?.resolved || !playback?.source) return;
    devJourneyOwnsLocationRef.current = true;
    const { resolved, bookmark, mode, source } = playback;
    source.restart();
    devInnerSourceRef.current = source;
    devScenarioConnectorRef.current = {
      active: true,
      name: resolved.name,
      router: connectorRouterForScenario(resolved),
    };
    setConfirmedRidePlan(null);
    setPendingNavigationRouteId(null);
    setPendingExternalPlan(null);
    setRideIntroVisible(false);
    setRideSettingsVisible(false);
    setPickOnMapMode(false);
    setRideSetupSelection(
      playback.rideSelection || DEFAULT_RIDE_SETUP_SELECTION,
    );
    setDevScenarioRoute(resolved.navigationRoute);
    setDevRideIntroRoute(resolved.navigationRoute);
    setPendingDevRideIntro({
      routeId: resolved.navigationRoute.id,
      fix: resolved.fixes[0] || null,
    });
    setDevPlaybackState(initialJourneyPlaybackState({
      resolved: { ...resolved, fixes: playback.fixes || resolved.fixes },
      bookmark,
      mode,
    }));
    setDevCameraDiagnostics({
      stage: "intro-loading",
      mode: "overview",
      approachTier: "-",
      cameraIntent: "intro",
      journey: resolved.name,
      bookmark: bookmark?.id || "",
      expectedStage: bookmark?.expectedStage || "",
      journeyTime: (playback.fixes || resolved.fixes)[0]?.timestamp ?? null,
    });
  }, []);

  const handleDevSimulate = useCallback(() => {
    if (!__DEV__) return;
    if (devPlaybackRef.current) clearDevJourneyState();
    setRideIntroVisible(false);
    setDevPickerMode("sim");
    setDevCameraDiagnostics(null);
    setDevRideIntroRoute(null);
    setPendingDevRideIntro(null);
    setDevPickerVisible(true);
  }, [clearDevJourneyState]);

  const handleDevCameraStoryboard = useCallback(() => {
    if (!__DEV__) return;
    if (devPlaybackRef.current) clearDevJourneyState();
    setRideIntroVisible(false);
    setDevPickerMode("cam");
    setDevCameraDiagnostics(null);
    setDevPickerVisible(true);
  }, [clearDevJourneyState]);

  // Resolve the picked scenario through the same resolver the headless suite
  // uses (identical fixes for the same seed) and install its simulated source.
  // Shared journeys arm Ride Intro and wait for its real Start action. Legacy
  // session-only scenarios still use pendingNavigationRouteId so nav.start()
  // runs only after the session has re-bound to the scenario route.
  const handleDevScenarioSelect = useCallback(
    (scenario, bookmark = null) => {
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
      devJourneyOwnsLocationRef.current = true;
      setDevRideIntroRoute(null);
      setPendingDevRideIntro(null);
      const playbackMode = bookmark ? "cam" : "sim";
      if (journeyRequiresRideIntro(resolved) && !devRideSetupRestoreRef.current) {
        devRideSetupRestoreRef.current = {
          rideSetupFix,
          rideSetupNow,
          rideSetupLocationStatus,
          locationState,
        };
      }
      const window = bookmark
        ? bookmarkPlaybackWindow(resolved.fixes, bookmark)
        : { warmupEndIndex: -1, startIndex: 0, endIndex: resolved.fixes.length - 1 };
      const playbackSource = createJourneyPlaybackSource(resolved.fixes, {
        ...window,
        speed: playbackMode === "cam" ? 1 : devSpeed,
        onStateChange: (playback) => {
          const uiNow = Date.now();
          if (
            playback.completed !== true &&
            uiNow - devPlaybackUiAtRef.current < 200
          ) return;
          devPlaybackUiAtRef.current = uiNow;
          const activePlayback = devPlaybackRef.current;
          const activeFixes = activePlayback?.fixes || resolved.fixes;
          const activeBookmark = activePlayback?.bookmark ?? bookmark;
          const fixIndex = Math.max(0, Math.min(activeFixes.length - 1, playback.index - 1));
          const timestamp = activeFixes[fixIndex]?.timestamp ?? null;
          const lifecyclePatch = journeyPlaybackPatch(playback);
          setDevPlaybackState((current) => ({
            ...(current || initialJourneyPlaybackState({
              resolved: { ...resolved, fixes: activeFixes },
              bookmark: activeBookmark,
              mode: playbackMode,
            })),
            ...lifecyclePatch,
            timestamp,
          }));
          if (playbackMode === "cam") {
            setDevCameraDiagnostics((current) => ({
              ...(current || {}),
              journey: resolved.name,
              bookmark: activeBookmark?.id || "",
              journeyTime: timestamp,
            }));
          }
        },
      });
      devPlaybackRef.current = {
        source: playbackSource,
        resolved,
        fixes: resolved.fixes,
        bookmark,
        mode: playbackMode,
        isFullJourney: !bookmark,
        originalFixes: resolved.fixes,
        originalBookmark: bookmark,
        originalWindow: window,
        originalIsFullJourney: !bookmark,
        rideSelection: null,
        modifiedRidePlan: false,
      };
      devInnerSourceRef.current = playbackSource;
      devScenarioConnectorRef.current = {
        active: true,
        name: resolved.name,
        router: connectorRouterForScenario(resolved),
      };
      setDevPlaybackState(initialJourneyPlaybackState({
        resolved,
        bookmark,
        mode: playbackMode,
      }));
      if (bookmark || scenario.camera === true || scenario.group === "camera-journey") {
        setDevCameraDiagnostics({
          stage: "starting",
          mode: "-",
          approachTier: "-",
          cameraIntent: "follow",
          journey: resolved.name,
          bookmark: bookmark?.id || "",
          expectedStage: bookmark?.expectedStage || "",
        });
      }
      if (journeyRequiresRideIntro(resolved)) {
        armDevJourneyIntro(devPlaybackRef.current);
        return;
      }
      if (resolved.navigationRoute.id !== navigationRoute?.id) {
        setDevScenarioRoute(resolved.navigationRoute);
        setPendingNavigationRouteId(resolved.navigationRoute.id);
      } else {
        void nav.start();
      }
    },
    [
      armDevJourneyIntro,
      devSpeed,
      locationState,
      nav,
      navigationRoute,
      rideSetupFix,
      rideSetupLocationStatus,
      rideSetupNow,
    ],
  );

  const handleDevPlaybackPauseResume = useCallback(() => {
    const source = devPlaybackRef.current?.source;
    if (!source) return;
    if (source.getState().paused) source.resume();
    else source.pause();
  }, []);

  const handleDevPlaybackStep = useCallback(() => {
    devPlaybackRef.current?.source?.step?.();
  }, []);

  const handleDevPlaybackReplay = useCallback(() => {
    const playback = devPlaybackRef.current;
    if (!playback) return;
    pendingDevReplayRef.current = true;
    nav.stop();
    armDevJourneyIntro(playback);
    setTimeout(() => {
      pendingDevReplayRef.current = false;
    }, 0);
  }, [armDevJourneyIntro, nav]);

  useEffect(() => {
    if (!__DEV__ || !pendingDevRideIntro) return;
    if (devRideIntroRoute?.id !== pendingDevRideIntro.routeId) return;
    const fix = pendingDevRideIntro.fix;
    if (fix && Number.isFinite(Number(fix.lat)) && Number.isFinite(Number(fix.lng))) {
      setRideSetupFix({
        ...fix,
        lat: Number(fix.lat),
        lng: Number(fix.lng),
        timestamp: Number.isFinite(Number(fix.timestamp)) ? Number(fix.timestamp) : Date.now(),
      });
      setLocationState((current) => ({
        ...current,
        enabled: true,
        point: { lat: Number(fix.lat), lng: Number(fix.lng) },
        status: current.following ? "following" : "located",
      }));
    }
    const journeyTimestamp = Number(fix?.timestamp);
    setRideSetupNow(Number.isFinite(journeyTimestamp) ? journeyTimestamp : Date.now());
    setRideSetupLocationStatus("ready");
    setRideIntroVisible(true);
    setPendingDevRideIntro(null);
  }, [devRideIntroRoute?.id, pendingDevRideIntro]);

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
    if (pendingDevReplayRef.current) return;
    if (pendingNavigationRouteId) return;
    if (pendingDevRideIntro || rideIntroVisible || rideSettingsVisible || pickOnMapMode) return;
    if (navStatus !== "ended" && navStatus !== "error") return;
    if (!devPlaybackRef.current && !devScenarioConnectorRef.current) return;
    const scenarioConnector = devScenarioConnectorRef.current;
    if (
      navStatus === "ended" &&
      devPlaybackRef.current?.isFullJourney &&
      scenarioConnector?.router?.assertComplete
    ) {
      try {
        scenarioConnector.router.assertComplete();
      } catch (error) {
        console.error(error);
      }
    }
    clearDevJourneyState();
  }, [
    clearDevJourneyState,
    devRideIntroRoute,
    devScenarioRoute,
    navStatus,
    pendingDevRideIntro,
    pendingNavigationRouteId,
    pickOnMapMode,
    rideIntroVisible,
    rideSettingsVisible,
  ]);

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
  const navigationLineAuthority = useMemo(
    () => navigationLinePresentationForState(nav.state ?? {}),
    [
      nav.state?.approach?.ownershipTier,
      nav.state?.cameraTransition?.kind,
      nav.state?.cameraTransition?.sourceTier,
      nav.state?.offRoute,
      nav.state?.status,
    ],
  );
  const routeLineStyles = useMemo(() => {
    if (!mapPresentationActive) {
      return {
        casing: null,
        core: navigationMainRouteLineStyle(
          navigationLineAuthority.mainRouteProminence,
        ),
      };
    }
    const casingSpec = routeGeometryCasingStyleForPresentation("dark");
    const coreSpec =
      routeGeometryLineStyleForPresentation("dark") || ROUTE_GEOMETRY_LINE_STYLE;
    return {
      casing: casingSpec ? paintToRNStyle(casingSpec) : null,
      core: paintToRNStyle(coreSpec),
    };
  }, [mapPresentationActive, navigationLineAuthority.mainRouteProminence]);
  const approachSuggestionLineStyles = useMemo(
    () => navigationConnectorLineStyles(navigationLineAuthority.connectorRole),
    [navigationLineAuthority.connectorRole],
  );

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
        approachOwnershipTier: navPresentation.approachOwnershipTier,
        handoffProminence: navPresentation.handoffProminence,
        classificationReasons:
          nav.state?.approach?.classificationReasons || connectorResult.classificationReasons || [],
        connectorDistanceMeters: Number.isFinite(Number(connectorResult.distanceMeters))
          ? Math.round(Number(connectorResult.distanceMeters) / 50) * 50
          : null,
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
  // The main route remains the route-acquisition authority. During a confident
  // app-owned approach, the connector can temporarily drive cues/camera as an
  // approach leg, then clears when the main route is acquired.
  const navGeometry = navigationRoute?.geometry || [];
  const activeGeometryKey = "main";

  // Approach overlays (while approaching / off-route): a direct line when
  // there is no trusted connector, or a classified connector leg for guided
  // approach and rejoin states.
  const approach = nav.state?.approach ?? null;
  const cameraTransition = nav.state?.cameraTransition ?? null;
  const latestFix = nav.state?.latestFix ?? null;
  const approachTargetPoint = approach?.target?.point ?? null;
  const showApproachLines =
    navStatus === "approaching" ||
    navStatus === "off-route" ||
    cameraTransition?.kind === "join";
  const showDirectApproachLine =
    showApproachLines && navPresentation.showDirectApproachLine;
  const directLineGeometry = useMemo(() => {
    if (!showDirectApproachLine || !latestFix || !approachTargetPoint) {
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
    showDirectApproachLine,
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
        const origin = pendingExternalPlan?.origin || "intro";
        if (origin === "approach") {
          setPendingExternalPlan(null);
          void refreshRideSetupLocation();
          return;
        }
        setConfirmedRidePlan(null);
        openRideIntro({ preserveSelection: true });
      }
    });
    return () => subscription.remove();
  }, [openRideIntro, pendingExternalPlan, refreshRideSetupLocation]);

  const handleOpenExternalApp = useCallback(
    async (app) => {
      const handoffPlan = pendingExternalPlan?.plan ?? confirmedRidePlan;
      const target =
        handoffPlan?.selectedPoint ||
        navPresentation.externalNavTarget;
      const url = buildAppUrl(app, target);
      if (!url) return;
      const routeToken = routeTokenParam || shareInfo.param;
      if (routeToken) {
        await savePendingRideIntent({
          routeToken,
          slug: routeSlugParam || selectedCatalogSlug,
          name: routeNameParam || selectedCatalogEntry?.name || null,
          direction: handoffPlan?.direction || rideSetupSelection.direction,
          startMode: handoffPlan?.startMode || rideSetupSelection.startMode,
          startProgressMeters:
            handoffPlan?.startProgressMeters ??
            rideSetupSelection.startProgressMeters,
          selectedPoint: target,
        });
      }
      trackNavigationEvent("approach_external_handoff", {
        app: app?.id || "unknown",
        distanceBucket: confirmDistanceBucket(
          handoffPlan?.distanceToStartMeters ??
            confirmedRidePlan?.distanceToStartMeters,
        ),
        approachOwnershipTier: navPresentation.approachOwnershipTier,
        handoffProminence: navPresentation.handoffProminence,
        distanceSource: navPresentation.approachDistanceSource,
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
  const suggestionGeometry =
    approach?.suggestionGeometry || cameraTransition?.sourceGeometry;
  const showSuggestion =
    showApproachLines &&
    (cameraTransition?.kind === "join" ||
      navPresentation.showApproachLeg ||
      (navStatus === "off-route" && navPresentation.tier === "near")) &&
    Array.isArray(suggestionGeometry) &&
    suggestionGeometry.length >= 2;
  const suggestionFeature = useMemo(
    () =>
      Array.isArray(suggestionGeometry) && suggestionGeometry.length >= 2
        ? buildRouteGeometryFeatureCollection(suggestionGeometry)
        : EMPTY_FEATURE_COLLECTION,
    [suggestionGeometry],
  );
  // Midpoint of the dashed suggestion line — anchor for the approach/rejoin chip.
  const suggestionMidpoint = useMemo(() => {
    if (!Array.isArray(suggestionGeometry) || suggestionGeometry.length < 2) {
      return null;
    }
    const mid = suggestionGeometry[Math.floor(suggestionGeometry.length / 2)];
    return Number.isFinite(mid?.lat) && Number.isFinite(mid?.lng) ? mid : null;
  }, [suggestionGeometry]);
  const navChip = navPresentation.chip ?? null;
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
  const mapZoomRef = useRef(null);
  const mapPitchRef = useRef(null);
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
  const cameraDirectorRef = useRef(null);
  const cameraBearingRef = useRef(0);
  const cameraPitchRef = useRef(NAV_FOLLOW_PITCH);
  const cameraZoomRef = useRef(16.5);
  const cameraStageRef = useRef(null);
  const sessionStateRef = useRef(null);
  const cameraFitKeyRef = useRef(null);
  const cameraFitAtRef = useRef(0);
  const cameraOverviewFrameRef = useRef(null);
  const devCameraDiagnosticsAtRef = useRef(0);
  // Stable handle to userPanned() so the (deps-[]) camera-change handler can
  // disengage follow on a user gesture without re-subscribing every render.
  const navUserPannedRef = useRef(null);
  const lastPanSignalRef = useRef(0);
  const mapPickHandlerRef = useRef(null);
  // Live device-compass heading (deg). Drives the heading-up camera and the
  // to-route arrow so the view is adaptive to the phone's facing direction even
  // when stationary (GPS course is unreliable below walking speed).
  const deviceHeadingRef = useRef(null);
  const [compassHeading, setCompassHeading] = useState(null);
  // Ride-setup "tap a point" mode.
  const pickOnMapModeRef = useRef(false);
  pickOnMapModeRef.current = pickOnMapMode;
  progressRef.current = navProgress;
  cameraIntentRef.current = cameraIntent;
  rawFixRef.current = nav.state?.latestFix ?? null;
  sessionStateRef.current = nav.state;
  arcRef.current = arc;
  navGeometryRef.current = navGeometry;
  navStatusRef.current = navStatus;
  navUserPannedRef.current = nav.userPanned;
  mapPickHandlerRef.current = (point) => {
    setRideSetupSelection((current) => ({
      ...current,
      startMode: "custom",
      selectedPoint: point,
      startProgressMeters: null,
    }));
    setRideSettingsVisible(true);
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
      if (__DEV__) setDevCameraDiagnostics(null);
      travelIndexRef.current = -1;
      lastPushedPuckRef.current = null;
      puckAnchorRef.current = null;
      puckGlideRef.current = null;
      cameraGovernorRef.current = null;
      cameraDirectorRef.current = null;
      cameraStageRef.current = null;
      cameraFitKeyRef.current = null;
      cameraFitAtRef.current = 0;
      cameraOverviewFrameRef.current = null;
      return undefined;
    }
    puckAnchorRef.current = createPuckAnchor();
    puckGlideRef.current = null;
    cameraGovernorRef.current = createCameraHeadingGovernor();
    cameraDirectorRef.current = createCameraDirector();
    cameraPitchRef.current = NAV_FOLLOW_PITCH;
    cameraZoomRef.current = NAV_FOLLOW_ZOOM;
    cameraStageRef.current = null;
    cameraFitKeyRef.current = null;
    cameraFitAtRef.current = 0;
    cameraOverviewFrameRef.current = null;
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
        // Prefer the live device compass for the puck arrow so it follows where
        // the phone points; the map camera may still reject it below.
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
          // Stage-aware shot from the camera director. The shot is computed
          // before heading selection because approach-owned stages decide
          // whether the camera should use main-route or approach-leg bearings.
          const shot =
            cameraDirectorRef.current?.update(sessionStateRef.current ?? {}, ts) ??
            {
              stage: "ride",
              viewportMode: "follow",
              pitch: NAV_FOLLOW_PITCH,
              pitchRange: { min: 45, max: 55 },
              zoomPolicy: { minZoom: 15.6, maxZoom: 17 },
              riderAnchorY: 0.72,
            };
          const stageChanged = cameraStageRef.current !== shot.stage;
          cameraStageRef.current = shot.stage;
          if (
            shot.stage === "approach-too-far" &&
            retainedIntroCameraStateRef.current
          ) {
            const retained = retainedIntroCameraStateRef.current;
            cameraPitchRef.current = retained.pitch;
            cameraZoomRef.current = retained.zoom;
            cameraBearingRef.current = retained.heading;
          }
          const cameraEase = Math.min(1, dtMs / CAMERA_ROTATE_MS);
          const lastNativeValidation = navigationCameraRef.current?.getState?.();
          const validationBelongsToShot =
            (lastNativeValidation?.owner === "follow" &&
              lastNativeValidation?.key === shot.stage) ||
            (lastNativeValidation?.owner === "overview" &&
              typeof lastNativeValidation?.key === "string" &&
              lastNativeValidation.key.startsWith(`${shot.fitKind}:`));
          const requiredGeometryOutside =
            validationBelongsToShot &&
            Array.isArray(lastNativeValidation?.validation?.outside) &&
            lastNativeValidation.validation.outside.some((id) => id !== "rider");
          const targetPitch = requiredGeometryOutside
            ? shot.pitchRange?.min ?? shot.pitch
            : shot.pitch;
          cameraPitchRef.current +=
            (targetPitch - cameraPitchRef.current) * cameraEase;

          let cameraCorridor = [];
          if (shot.viewportMode === "follow") {
            const stateNow = sessionStateRef.current || {};
            const isApproachGeometry = shot.geometryRole === "approach";
            const corridorGeometry = isApproachGeometry
              ? stateNow.approach?.approachLegGeometry || []
              : geom;
            const corridorProgress = isApproachGeometry
              ? stateNow.approach?.approachProgress?.progressMeters || 0
              : smoothedMetersRef.current;
            const cueMeters = isApproachGeometry
              ? stateNow.approach?.approachActiveCue?.cue?.distanceMeters
              : stateNow.activeCue?.cue?.distanceMeters;
            cameraCorridor = Number.isFinite(cueMeters) && shot.postManeuverMeters
              ? cameraManeuverCorridor(
                  corridorGeometry,
                  corridorProgress,
                  cueMeters,
                  {
                    behindMeters: shot.behindMeters,
                    postManeuverMeters: shot.postManeuverMeters,
                  },
                )
              : cameraCorridorForProgress(corridorGeometry, corridorProgress, {
                  behindMeters: shot.behindMeters,
                  lookaheadMeters: shot.lookaheadMeters,
                });
            if (shot.geometryRole === "join") {
              const sourceGeometry = stateNow.cameraTransition?.sourceGeometry;
              if (Array.isArray(sourceGeometry) && sourceGeometry.length >= 2) {
                cameraCorridor = [...sourceGeometry.slice(-3), ...cameraCorridor];
              }
            }
            if (cameraCorridor.length >= 2) {
              const targetZoom = cameraTargetZoom({
                geometry: cameraCorridor,
                viewport: navigationViewportRef.current,
                pitch: shot.pitch,
                bearing: cameraBearingRef.current,
                minZoom: shot.zoomPolicy?.minZoom,
                maxZoom: shot.zoomPolicy?.maxZoom,
              });
              cameraZoomRef.current = nextAppliedZoom({
                current: cameraZoomRef.current,
                target: targetZoom,
                dtMs,
                force: stageChanged,
              });
            }
          }

          // The puck arrow tracks the rider's direction in real time; the
          // camera is route-up when a route/approach leg is trusted, target-up
          // for overview connector states, and held still off-route. Device
          // compass remains a puck/panel input, not a map-frame steering input.
          const heading = smoothedBearingRef.current;
          const cameraTarget = cameraHeadingTargetForState(
            sessionStateRef.current ?? { progress },
            shot,
          );
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
          if (__DEV__ && ts - devCameraDiagnosticsAtRef.current >= 200) {
            devCameraDiagnosticsAtRef.current = ts;
            const nextDiagnostics = {
              stage: shot.stage,
              mode: shot.viewportMode,
              geometryRole: shot.geometryRole,
              pitch: Number.isFinite(shot.pitch)
                ? Math.round(shot.pitch * 10) / 10
                : null,
              appliedPitch: Number.isFinite(cameraPitchRef.current)
                ? Math.round(cameraPitchRef.current * 10) / 10
                : null,
              zoom: shot.viewportMode === "follow" && Number.isFinite(cameraZoomRef.current)
                ? Math.round(cameraZoomRef.current * 10) / 10
                : null,
              appliedZoom: Number.isFinite(cameraZoomRef.current)
                ? Math.round(cameraZoomRef.current * 10) / 10
                : null,
              fitKind: shot.fitKind || "",
              focusKind: shot.focusKind || "",
              headingTarget: Number.isFinite(cameraTarget)
                ? Math.round(cameraTarget * 10) / 10
                : null,
              heading: Number.isFinite(cameraBearingRef.current)
                ? Math.round(cameraBearingRef.current * 10) / 10
                : null,
              approachTier: sessionStateRef.current?.approach?.ownershipTier || "",
              cameraIntent: cameraIntentRef.current,
              riderAnchorY: shot.riderAnchorY,
              viewport: `${Math.round(navigationViewportRef.current.top)}-${Math.round(navigationViewportRef.current.bottom)}`,
            };
            setDevCameraDiagnostics((current) =>
              current &&
              current.stage === nextDiagnostics.stage &&
              current.mode === nextDiagnostics.mode &&
              current.geometryRole === nextDiagnostics.geometryRole &&
              current.pitch === nextDiagnostics.pitch &&
              current.appliedPitch === nextDiagnostics.appliedPitch &&
              current.zoom === nextDiagnostics.zoom &&
              current.appliedZoom === nextDiagnostics.appliedZoom &&
              current.fitKind === nextDiagnostics.fitKind &&
              current.focusKind === nextDiagnostics.focusKind &&
              current.headingTarget === nextDiagnostics.headingTarget &&
              current.heading === nextDiagnostics.heading &&
              current.approachTier === nextDiagnostics.approachTier &&
              current.cameraIntent === nextDiagnostics.cameraIntent &&
              current.riderAnchorY === nextDiagnostics.riderAnchorY &&
              current.viewport === nextDiagnostics.viewport
                ? current
                : { ...(current || {}), ...nextDiagnostics },
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
          // Every navigation shot goes through the camera adapter. Follow
          // frames are app-clocked; overview fits temporarily transfer
          // ownership to one native Mapbox animation.

          if (cameraIntentRef.current === "free") {
            navigationCameraRef.current?.setFree("user-gesture");
          }

          if (shot.viewportMode === "overview") {
            const raw = rawFixRef.current;
            const suggestion = sessionStateRef.current?.approach?.suggestionGeometry;
            const target = sessionStateRef.current?.approach?.target;
            const routeEnd = Array.isArray(geom) && geom.length > 0
              ? geom[geom.length - 1]
              : null;
            const targetPoint =
              target?.point || progress.guidanceTargetPoint || routeEnd || null;
            const routeLookahead =
              shot.fitKind === "approach" ||
              shot.fitKind === "approach-start" ||
              shot.fitKind === "approach-leg" ||
              shot.fitKind === "rejoin"
                ? routeLookaheadPoint(arcNow, geom, target)
                : null;
            const fitPoints = (
              shot.fitKind === "route"
                ? geom
                : shot.fitKind === "arrival-local"
                  ? [validMapPoint(raw) ? raw : null, routeEnd]
                : [
                    validMapPoint(raw) ? raw : null,
                    targetPoint,
                    routeLookahead,
                    ...(Array.isArray(suggestion) ? suggestion : []),
                  ]
            ).filter(validMapPoint);
            const fitHeading =
              shot.fitKind === "route"
                ? 0
                : Number.isFinite(governedHeading)
                  ? governedHeading
                  : cameraBearingRef.current;
            const overviewZoom = fitPoints.length >= 2
              ? cameraTargetZoom({
                  geometry: fitPoints,
                  viewport: navigationViewportRef.current,
                  pitch: shot.pitch,
                  bearing: fitHeading,
                  minZoom: shot.zoomPolicy?.minZoom ?? 8,
                  maxZoom: shot.zoomPolicy?.maxZoom ?? 18,
                })
              : shot.zoomPolicy?.maxZoom;
            const fitPitch = Number.isFinite(shot.pitch)
              ? requiredGeometryOutside
                ? shot.pitchRange?.min ?? shot.pitch
                : shot.pitch
              : null;
            const fitKeyDecimals =
              shot.fitKind === "rejoin"
                ? REJOIN_CAMERA_FIT_KEY_DECIMALS
                : DEFAULT_CAMERA_FIT_KEY_DECIMALS;
            const fitPointKey = fitPoints
              .map((point) => cameraPointKey(point, fitKeyDecimals))
              .join("|");
            const fitKey = [
              shot.fitKind,
              cameraKeyNumber(fitHeading),
              cameraKeyNumber(fitPitch),
              fitPointKey,
              cameraKeyNumber(navigationViewportRef.current.top),
              cameraKeyNumber(navigationViewportRef.current.bottom),
            ].join(":");
            const viewportKey = [
              navigationViewportRef.current.width,
              navigationViewportRef.current.height,
              Math.round(navigationViewportRef.current.top),
              Math.round(navigationViewportRef.current.bottom),
            ].join("x");
            const stableGeometry =
              shot.fitKind === "route"
                ? geom
                : Array.isArray(suggestion) && suggestion.length >= 2
                  ? suggestion
                  : fitPoints.filter((point) =>
                      !raw || point.lat !== raw.lat || point.lng !== raw.lng,
                    );
            const overviewFrame = {
              geometryKey: `${shot.stage}:${cameraGeometryKey(stableGeometry, 5)}`,
              viewportKey,
              rider: validMapPoint(raw) ? raw : null,
            };
            const reframe = shouldReframeOverview(
              cameraOverviewFrameRef.current,
              overviewFrame,
              {
                minMoveMeters:
                  shot.fitKind === "rejoin" ? 50 :
                  shot.fitKind === "approach-leg" ? 40 : 70,
              },
            );
            if (
              shot.holdFrame !== true &&
              cameraIntentRef.current === "follow" &&
              navStatusRef.current !== "paused" &&
              fitPoints.length >= 1 &&
              cameraFitKeyRef.current !== fitKey &&
              (reframe.reframe || requiredGeometryOutside)
            ) {
              const minFitIntervalMs =
                shot.fitKind === "rejoin" ? REJOIN_CAMERA_FIT_MIN_INTERVAL_MS : 0;
              const canFitNow =
                cameraFitKeyRef.current === null ||
                minFitIntervalMs === 0 ||
                ts - cameraFitAtRef.current >= minFitIntervalMs;
              if (canFitNow) {
                const rawPoint = validMapPoint(raw) ? raw : null;
                const applied = navigationCameraRef.current?.applyOverview(
                  {
                    key: fitKey,
                    points: fitPoints,
                    requiredPoints: fitPoints.map((point, index) => ({
                      ...point,
                      id:
                        rawPoint &&
                        point.lat === rawPoint.lat &&
                        point.lng === rawPoint.lng
                          ? "rider"
                          : `required-${index}`,
                    })),
                    riderId: rawPoint ? "rider" : null,
                    riderAnchorY: shot.riderAnchorY,
                    heading: fitHeading,
                    pitch: fitPitch,
                    zoom: overviewZoom,
                    animationDuration: shot.transition?.durationMs,
                  },
                  navigationViewportRef.current,
                );
                // Only mark the fit as done when the adapter actually applied
                // it; a skip (e.g. locked screen) retries on a later tick.
                if (applied) {
                  cameraFitKeyRef.current = fitKey;
                  cameraFitAtRef.current = ts;
                  cameraOverviewFrameRef.current = overviewFrame;
                }
              }
            }
            scheduleTick();
            return;
          }
          cameraFitKeyRef.current = null;
          cameraFitAtRef.current = 0;
          cameraOverviewFrameRef.current = null;

          // Guided approach cues resolve against the temporary connector leg;
          // main-route cues continue to resolve against the primary route arc.
          let focus = null;
          if (shot.focusKind === "approach-cue") {
            const approachCueMeters =
              sessionStateRef.current?.approach?.approachActiveCue?.cue?.distanceMeters;
            const approachGeom =
              sessionStateRef.current?.approach?.approachLegGeometry || [];
            if (
              Number.isFinite(approachCueMeters) &&
              Array.isArray(approachGeom) &&
              approachGeom.length >= 2
            ) {
              focus = pointAndBearingAtDistance(
                precomputeArcLength(approachGeom),
                approachGeom,
                approachCueMeters,
              ).point;
            }
          } else if (shot.focusKind === "route-start") {
            const focusMeters = Number(progress.progressMeters ?? 0) + 150;
            if (arcNow && geom.length >= 2) {
              focus = pointAndBearingAtDistance(arcNow, geom, focusMeters).point;
            }
          } else if (shot.focusKind === "cue") {
            const cueMeters = sessionStateRef.current?.activeCue?.cue?.distanceMeters;
            if (Number.isFinite(cueMeters) && arcNow && geom.length >= 2) {
              focus = pointAndBearingAtDistance(arcNow, geom, cueMeters).point;
            }
          }
          if (
            shot.holdFrame !== true &&
            cameraIntentRef.current === "follow" &&
            navStatusRef.current !== "paused"
          ) {
            navigationCameraRef.current?.applyFollow(
              {
                key: shot.stage,
                center: { lng, lat },
                heading: cameraBearingRef.current,
                pitch: cameraPitchRef.current,
                zoom: cameraZoomRef.current,
                riderAnchorY: shot.riderAnchorY,
                focus,
                corridor: cameraCorridor,
                requiredPoints: [
                  { id: "rider", lng, lat },
                  ...cameraCorridor.map((point, index) => ({
                    ...point,
                    id: `corridor-${index}`,
                  })),
                ],
                riderId: "rider",
                validationKey: [
                  shot.stage,
                  Math.round(cameraPitchRef.current / 4),
                  Math.round(cameraZoomRef.current * 5),
                  Math.round(navigationViewportRef.current.top),
                  Math.round(navigationViewportRef.current.bottom),
                  cameraCorridor.length > 0
                    ? cameraPointKey(cameraCorridor[0], 4)
                    : "no-corridor-start",
                  cameraCorridor.length > 1
                    ? cameraPointKey(cameraCorridor.at(-1), 4)
                    : "no-corridor-end",
                ].join(":"),
              },
              navigationViewportRef.current,
            );
          } else if (cameraIntentRef.current === "free") {
            navigationCameraRef.current?.setFree("user-gesture");
          }
        }
      }
      scheduleTick();
    };
    // Under a locked screen RN keeps firing rAF from a background NSTimer
    // (RCTTiming has no display link there), so this loop burned ~100% CPU on
    // invisible UI until iOS killed the app (build 5 cpu_resource_fatal).
    // Pause it whenever the app leaves the foreground; voice/haptics/session
    // logic are fix-driven and unaffected.
    function scheduleTick() {
      if (AppState.currentState === "active") {
        rafRef.current = requestAnimationFrame(tick);
      }
    }
    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") return;
      cancelAnimationFrame(rafRef.current);
      // Progress moved while the loop slept; snap the tweened values so the
      // puck and camera don't glide across everything ridden under lock.
      const resumeProgress = progressRef.current;
      smoothedMetersRef.current = resumeProgress?.progressMeters ?? smoothedMetersRef.current;
      smoothedBearingRef.current =
        resumeProgress?.bearingToNextDeg ??
        resumeProgress?.smoothedCourseDeg ??
        smoothedBearingRef.current;
      cameraBearingRef.current = smoothedBearingRef.current;
      puckGlideRef.current = null;
      lastTs = 0;
      scheduleTick();
    });
    scheduleTick();
    return () => {
      appStateSubscription.remove();
      cancelAnimationFrame(rafRef.current);
      navigationCameraRef.current?.reset("navigation-loop-stop");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNavigating]);

  const wasNavigatingRef = useRef(false);
  useEffect(() => {
    if (wasNavigatingRef.current && !isNavigating) {
      if (!rideIntroVisible && !rideSettingsVisible && !pickOnMapMode) {
        resetMapToOverhead();
      }
    }
    wasNavigatingRef.current = isNavigating;
  }, [
    isNavigating,
    pickOnMapMode,
    resetMapToOverhead,
    rideIntroVisible,
    rideSettingsVisible,
  ]);

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
    const zoom = Number(mapState?.properties?.zoom);
    if (Number.isFinite(zoom)) mapZoomRef.current = zoom;
    const pitch = Number(mapState?.properties?.pitch);
    if (Number.isFinite(pitch)) mapPitchRef.current = pitch;
    // Keep the session's idle clock aligned with the last active gesture. The
    // first signal disengages follow; throttled signals while already free stop
    // a long pan from auto-refollowing before the rider releases the map.
    if (isNavigatingRef.current && mapState?.gestures?.isGestureActive) {
      const now = Date.now();
      if (
        cameraIntentRef.current === "follow" ||
        now - lastPanSignalRef.current >= 1000
      ) {
        lastPanSignalRef.current = now;
        navUserPannedRef.current?.();
      }
    }
  }, []);

  const applyTooFarCameraFrame = useCallback((animationDuration = 0) => {
    const rider = nav.state?.latestFix;
    const start =
      nav.state?.approach?.target?.point || confirmedRidePlan?.selectedPoint;
    if (!validMapPoint(rider) || !validMapPoint(start)) return false;
    const bottomPadding = Math.max(
      RIDE_INTRO_FIT_BOTTOM_PADDING,
      Math.ceil(
        mapViewportSize.height -
          navigationOcclusion.bottomOverlayTop +
          RIDE_INTRO_RIDER_CARD_GAP,
      ),
    );
    const retained = introMarkerSlotCameraState(rider, start, {
      bottomPadding,
      heading: computeBearing(rider, start),
      pitch: RIDE_INTRO_FIT_PITCH,
      topInset: Math.max(screenInsets.top, navigationOcclusion.topOverlayBottom),
    });
    if (!retained) return false;
    retainedIntroCameraStateRef.current = retained;
    cameraPitchRef.current = retained.pitch;
    cameraZoomRef.current = retained.zoom;
    cameraBearingRef.current = retained.heading;
    setCameraToMarkerSlotState(cameraRef.current, retained, animationDuration);
    return true;
  }, [
    confirmedRidePlan?.selectedPoint,
    mapViewportSize.height,
    nav.state?.approach?.target?.point,
    nav.state?.latestFix,
    navigationOcclusion.bottomOverlayTop,
    navigationOcclusion.topOverlayBottom,
    screenInsets.top,
  ]);

  // A normal Start retains the Ride Intro shot. Restored sessions have no
  // intro frame to retain, so establish the same marker-slot frame once.
  useEffect(() => {
    if (
      !isNavigating ||
      navStatus !== "approaching" ||
      nav.state?.approach?.ownershipTier !== "too-far" ||
      retainedIntroCameraStateRef.current
    ) return;
    applyTooFarCameraFrame(0);
  }, [
    applyTooFarCameraFrame,
    isNavigating,
    nav.state?.approach?.ownershipTier,
    navStatus,
  ]);

  // Recenter re-engages camera ownership. Too-far rebuilds the same
  // rider/start marker-slot shot; other stages resume their normal policy.
  const handleRecenter = useCallback(() => {
    nav.recenter();
    if (nav.state?.approach?.ownershipTier === "too-far") {
      applyTooFarCameraFrame(450);
    }
  }, [applyTooFarCameraFrame, nav]);

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
          startProgressMeters:
            rideSetupSelectionParam.startProgressMeters !== null &&
            rideSetupSelectionParam.startProgressMeters !== undefined &&
            rideSetupSelectionParam.startProgressMeters !== "" &&
            Number.isFinite(Number(rideSetupSelectionParam.startProgressMeters)) &&
            Number(rideSetupSelectionParam.startProgressMeters) >= 0
              ? Number(rideSetupSelectionParam.startProgressMeters)
              : null,
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

  useEffect(() => {
    if (!resumeRideParam || resumeRideHandledRef.current) return;
    if (!sourceNavigationRoute?.canNavigate) return;
    const plan = createRidePlan(sourceNavigationRoute, resumeRideParam, null);
    if (!plan?.effectiveRoute?.canNavigate) {
      resumeRideHandledRef.current = true;
      resumeFailureShownRef.current = true;
      navigation.setParams({ resumeRide: undefined });
      void clearActiveNavigationSession();
      void stopNavigationBackgroundUpdates();
      Alert.alert(
        "לא הצלחנו להמשיך את הרכיבה",
        "הרכיבה השמורה הסתיימה כי המסלול כבר אינו זמין.",
      );
      return;
    }
    resumeRideHandledRef.current = true;
    confirmRidePlan(plan, { startSession: false });
  }, [confirmRidePlan, navigation, resumeRideParam, sourceNavigationRoute]);

  useEffect(() => {
    if (!resumeRideHandledRef.current) return;
    if (nav.restoreStatus === "restored") {
      navigation.setParams({ resumeRide: undefined });
      return;
    }
    if (nav.restoreStatus === "failed" && !resumeFailureShownRef.current) {
      resumeFailureShownRef.current = true;
      navigation.setParams({ resumeRide: undefined });
      Alert.alert(
        "לא הצלחנו להמשיך את הרכיבה",
        "הרכיבה השמורה הסתיימה כדי למנוע התחלה מחדש ממיקום שגוי.",
      );
    }
  }, [nav.restoreStatus, navigation]);

  // A featured-page Navigate action opens ride setup after its encoded route is
  // loaded. It never starts a continuous GPS navigation session implicitly.
  useEffect(() => {
    if (!pendingRideSetupToken || pendingRideSetupToken !== routeTokenParam) return;
    if (state.status !== "ready" || !sourceNavigationRoute?.canNavigate) return;
    setPendingRideSetupToken(null);
    openRideIntro({ preserveSelection: Boolean(rideSetupSelectionParam) });
  }, [
    openRideIntro,
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
    if (!rideIntroVisible) return;
    const start = ridePlan?.selectedPoint;
    if (!start) return;
    const fixPoint =
      rideSetupFix &&
      Number.isFinite(Number(rideSetupFix.lat)) &&
      Number.isFinite(Number(rideSetupFix.lng))
        ? { lat: Number(rideSetupFix.lat), lng: Number(rideSetupFix.lng) }
        : null;
    const shouldPitchToStart =
      fixPoint &&
      Number.isFinite(Number(ridePlan?.distanceToStartMeters)) &&
      Number(ridePlan.distanceToStartMeters) > RIDE_INTRO_PITCH_MIN_DISTANCE_M;
    const introFitOptions = shouldPitchToStart
      ? {
          heading: computeBearing(fixPoint, start),
          pitch: RIDE_INTRO_FIT_PITCH,
        }
      : {};
    const introBottomPadding =
      shouldPitchToStart && rideIntroCardHeight > 0
        ? Math.max(
            rideIntroFitBottomPadding,
            Math.ceil(rideIntroCardHeight + RIDE_INTRO_RIDER_CARD_GAP),
          )
        : rideIntroFitBottomPadding;
    const introSlotState = shouldPitchToStart
      ? introMarkerSlotCameraState(fixPoint, start, {
          bottomPadding: introBottomPadding,
          heading: introFitOptions.heading,
          pitch: RIDE_INTRO_FIT_PITCH,
          topInset: screenInsets.top,
        })
      : null;
    retainedIntroCameraStateRef.current = introSlotState;
    if (__DEV__) {
      const introHeading = Number.isFinite(introSlotState?.heading)
        ? introSlotState.heading
        : null;
      const nextDiagnostics = {
        stage: shouldPitchToStart ? "intro-start-facing" : "intro-overhead",
        mode: "fit",
        pitch: Number.isFinite(introSlotState?.pitch)
          ? introSlotState.pitch
          : Number.isFinite(introFitOptions.pitch)
            ? introFitOptions.pitch
            : 0,
        zoom: Number.isFinite(introSlotState?.zoom) ? introSlotState.zoom : null,
        fitKind: shouldPitchToStart ? "approach-start" : "route",
        focusKind: "",
        headingTarget: introHeading,
        heading: introHeading,
        approachTier: ridePlan?.approachTier || "",
        cameraIntent: "intro",
      };
      setDevCameraDiagnostics((current) =>
        !current ||
        current.stage !== nextDiagnostics.stage ||
        current.mode !== nextDiagnostics.mode ||
        current.pitch !== nextDiagnostics.pitch ||
        current.zoom !== nextDiagnostics.zoom ||
        current.fitKind !== nextDiagnostics.fitKind ||
        current.focusKind !== nextDiagnostics.focusKind ||
        current.headingTarget !== nextDiagnostics.headingTarget ||
        current.heading !== nextDiagnostics.heading ||
        current.approachTier !== nextDiagnostics.approachTier ||
        current.cameraIntent !== nextDiagnostics.cameraIntent
          ? { ...(current || {}), ...nextDiagnostics }
          : current,
      );
    }
    stopFollowingLocation();
    if (shouldPitchToStart) {
      setIntroCameraToMarkerSlots(cameraRef.current, fixPoint, start, {
        bottomPadding: introBottomPadding,
        heading: introFitOptions.heading,
        pitch: RIDE_INTRO_FIT_PITCH,
        topInset: screenInsets.top,
      });
      return;
    }
    const localRouteContext = cameraCorridorForProgress(
      ridePlan?.effectiveRoute?.geometry,
      0,
      { behindMeters: 0, lookaheadMeters: 250 },
    );
    fitCameraToPoints(
      cameraRef.current,
      localRouteContext.length >= 2
        ? [start, ...(fixPoint ? [fixPoint] : []), ...localRouteContext]
        : fixPoint
          ? [fixPoint, start]
          : [start],
      introBottomPadding,
      introFitOptions,
    );
  }, [
    rideIntroVisible,
    rideIntroCardHeight,
    rideIntroFitBottomPadding,
    ridePlan?.distanceToStartMeters,
    ridePlan?.approachTier,
    rideSetupFix?.lat,
    rideSetupFix?.lng,
    screenInsets.top,
    ridePlan?.effectiveRoute?.geometry,
    ridePlan?.selectedPoint,
    stopFollowingLocation,
  ]);

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

  const directRideSetupRequested = Boolean(routeTokenParam && openRideSetupParam);
  const directRideSetupPending = Boolean(
    directRideSetupRequested &&
      !rideIntroVisible &&
      !isNavigating &&
      (routeRestoreStatus === "waiting" ||
        routeRestoreStatus === "loading" ||
        pendingRideSetupToken === routeTokenParam),
  );
  const showRouteRestoreOverlay = Boolean(
    routeTokenParam &&
      (routeRestoreStatus === "waiting" ||
        routeRestoreStatus === "loading" ||
        directRideSetupPending),
  );
  const startMarkerPoint =
    navStatus === "approaching"
      ? confirmedRidePlan?.selectedPoint ?? null
      : rideIntroVisible || rideSettingsVisible || pickOnMapMode
        ? ridePlan?.selectedPoint ?? null
        : null;
  const setupRiderPoint =
    !isNavigating &&
    (rideIntroVisible || rideSettingsVisible || pickOnMapMode) &&
    validMapPoint(rideSetupFix)
      ? { lat: Number(rideSetupFix.lat), lng: Number(rideSetupFix.lng) }
      : null;
  const rawSetupRiderHeading = rideSetupFix?.heading;
  const setupRiderHeading =
    rawSetupRiderHeading === null || rawSetupRiderHeading === undefined
      ? null
      : Number(rawSetupRiderHeading);
  const setupRiderRotation =
    setupRiderPoint && Number.isFinite(setupRiderHeading)
      ? ((setupRiderHeading - mapHeadingRef.current) % 360 + 360) % 360
      : null;
  const devJourneyOwnsLocation = Boolean(
    __DEV__ && (devPlaybackState || devRideIntroRoute || pendingDevRideIntro),
  );

  return (
    <View
      style={styles.screen}
      onLayout={handleMapViewportLayout}
      {...routePointPanResponder.panHandlers}
    >
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
            over) but kept mounted so onUpdate feeds the latest raw fix while
            approaching / off-route. CAM/SIM unmounts it because the journey's
            deterministic source owns both the setup marker and navigation fix. */}
        {(locationState.enabled || isNavigating) && !devJourneyOwnsLocation ? (
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
        {(rideIntroVisible || rideSettingsVisible || pickOnMapMode) && ridePlan?.effectiveRoute ? (
          <ShapeSource id="ride-setup-preview" shape={setupPreviewGeometry}>
            <LineLayer
              id="ride-setup-preview-casing"
              style={SETUP_ROUTE_PREVIEW_STYLES.casing}
            />
            <LineLayer
              id="ride-setup-preview-line"
              style={SETUP_ROUTE_PREVIEW_STYLES.core}
            />
          </ShapeSource>
        ) : null}
        {rideIntroVisible && ridePlanNeedsDirectApproachPreview(ridePlan) ? (
          <ShapeSource id="ride-setup-direct" shape={setupDirectGeometry}>
            <LineLayer
              id="ride-setup-direct-line"
              style={APPROACH_DIRECT_LINE_STYLES.core}
            />
          </ShapeSource>
        ) : null}
        {rideIntroVisible &&
        ridePlanNeedsConnectorPreview(ridePlan) &&
        rideSetupConnector.status === "ready" ? (
          <ShapeSource id="ride-setup-connector" shape={setupConnectorGeometry}>
            <LineLayer
              id="ride-setup-connector-casing"
              style={SETUP_CONNECTOR_PREVIEW_STYLES.casing}
            />
            <LineLayer
              id="ride-setup-connector-line"
              style={SETUP_CONNECTOR_PREVIEW_STYLES.core}
            />
          </ShapeSource>
        ) : null}
        {startMarkerPoint ? (
          <MarkerView
            coordinate={[startMarkerPoint.lng, startMarkerPoint.lat]}
            anchor={{ x: 0.5, y: 1 }}
            allowOverlap
          >
            <View style={styles.setupStartMarker}>
              <Icon name="flag" size={18} color={palette.white} />
            </View>
          </MarkerView>
        ) : null}
        {setupRiderPoint ? (
          <MarkerView
            coordinate={[setupRiderPoint.lng, setupRiderPoint.lat]}
            anchor={{ x: 0.5, y: 0.5 }}
            allowOverlap
            allowOverlapWithPuck
          >
            <View
              pointerEvents="none"
              style={[
                styles.setupRiderPuck,
                Number.isFinite(setupRiderRotation)
                  ? { transform: [{ rotate: `${setupRiderRotation}deg` }] }
                  : null,
              ]}
            >
              {Number.isFinite(setupRiderRotation) ? (
                <View style={styles.setupRiderArrow} />
              ) : null}
              <View style={styles.setupRiderDot} />
            </View>
          </MarkerView>
        ) : null}
        {showDirectApproachLine ? (
          <ShapeSource id="approach-direct" shape={directLineGeometry}>
            <LineLayer
              id="approach-direct-line"
              style={APPROACH_DIRECT_LINE_STYLES.core}
            />
          </ShapeSource>
        ) : null}
        {showSuggestion ? (
          <ShapeSource id="approach-suggestion" shape={suggestionFeature}>
            {approachSuggestionLineStyles.casing ? (
              <LineLayer
                id="approach-suggestion-casing"
                style={approachSuggestionLineStyles.casing}
              />
            ) : null}
            <LineLayer
              id="approach-suggestion-line"
              style={approachSuggestionLineStyles.core}
            />
          </ShapeSource>
        ) : null}
        {isNavigating && navChip?.kind === "segment" && riderPuck ? (
          <MarkerView
            coordinate={[riderPuck.lng, riderPuck.lat]}
            anchor={{ x: 0.5, y: -0.9 }}
            allowOverlap
          >
            <View style={styles.navChip}>
              <Text style={styles.navChipText} numberOfLines={1}>
                {navChip.text}
              </Text>
            </View>
          </MarkerView>
        ) : null}
        {isNavigating &&
        (navChip?.kind === "approach" || navChip?.kind === "rejoin") &&
        suggestionMidpoint ? (
          <MarkerView
            coordinate={[suggestionMidpoint.lng, suggestionMidpoint.lat]}
            anchor={{ x: 0.5, y: 0.5 }}
            allowOverlap
          >
            <View
              style={[
                styles.navChip,
                navChip.kind === "rejoin"
                  ? styles.navChipRejoin
                  : styles.navChipApproach,
              ]}
            >
              <Text
                style={[
                  styles.navChipText,
                  navChip.kind === "rejoin"
                    ? styles.navChipRejoinText
                    : styles.navChipApproachText,
                ]}
                numberOfLines={1}
              >
                {navChip.text}
              </Text>
            </View>
          </MarkerView>
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
      {!isNavigating && !directRideSetupPending ? (
        <>
          <BackButton onPress={() => navigation?.goBack?.()} />
          <MapControls
            onLocate={handleLocatePress}
            following={locationState.following}
            legendOpen={legendOpen}
            onToggleLegend={() => setLegendOpen((open) => !open)}
          />
          <MapLegend open={legendOpen} sheetTop={sheetTop} />
        </>
      ) : null}
      <DataMarkerCard
        marker={mapUi.selectedDataMarker}
        onAddToRoute={handleAddDataMarkerToRoute}
        onClose={handleSelectedDataMarkerClear}
      />
      {showRouteRestoreOverlay ? (
        <View style={styles.routeRestoreOverlay} pointerEvents="auto">
          <View style={styles.routeRestoreCard}>
            <ActivityIndicator color={palette.forest} size="small" />
            <Text style={styles.routeRestoreText}>
              {directRideSetupRequested
                ? "מכין ניווט למסלול…"
                : "טוען מסלול לעריכה…"}
            </Text>
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
      {__DEV__ && !isNavigating && !rideIntroVisible && !rideSettingsVisible ? (
        <View pointerEvents="box-none" style={styles.devControls}>
          <Pressable
            accessibilityLabel="Dev: simulate ride"
            onPress={handleDevSimulate}
            style={styles.devButton}
          >
            <Text style={styles.devButtonText}>SIM</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Dev: camera storyboard"
            onPress={handleDevCameraStoryboard}
            style={styles.devButton}
          >
            <Text style={styles.devButtonText}>CAM</Text>
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
        <DevCameraOverlay diagnostics={devCameraDiagnostics} />
      ) : null}
      {__DEV__ ? (
        <DevJourneyControls
          playback={devPlaybackState}
          onReplay={handleDevPlaybackReplay}
          onPauseResume={handleDevPlaybackPauseResume}
          onStep={handleDevPlaybackStep}
        />
      ) : null}
      {__DEV__ ? (
        <DevScenarioPicker
          visible={devPickerVisible}
          title={
            devPickerMode === "cam"
              ? "Dev: camera storyboard"
              : "Dev: simulate scenario"
          }
          scenarios={devVisibleScenarios}
          speed={devSpeed}
          onSelectSpeed={setDevSpeed}
          onSelect={handleDevScenarioSelect}
          onClose={() => setDevPickerVisible(false)}
          mode={devPickerMode}
        />
      ) : null}
      {isNavigating ? (
        navStatus === "approaching" ? (
          <ApproachPanel
            sessionState={navPanelState}
            compassHeading={compassHeading}
            onOpenExternal={() => openExternalHandoff(confirmedRidePlan, "approach")}
            onOpenSettings={handleChangeRideSettings}
            onStop={handleStopNavigation}
            onRecenter={handleRecenter}
            onCameraLayout={handleNavigationOverlayLayout}
          />
        ) : (
          <NavPanel
            sessionState={navPanelState}
            onRecenter={handleRecenter}
            onPauseResume={() =>
              navStatus === "paused" ? nav.resume() : nav.pause()
            }
            onStop={handleStopNavigation}
            compassHeading={compassHeading}
            voiceEnabled={nav.voiceEnabled}
            onToggleVoice={handleToggleVoiceGuidance}
            onCameraLayout={handleNavigationOverlayLayout}
          />
        )
      ) : directRideSetupPending || rideIntroVisible ? null : (
        <PlannerSheet
          sheetRef={plannerSheetRef}
          animatedPosition={sheetTop}
          renderFooter={
            canDownload
              ? () => (
                  <BuildPanelFooter
                    canShare={
                      Boolean(shareUrl) && shareInfo.status !== "too_long"
                    }
                    onDownloadGpx={handleDownloadGpx}
                    onShare={shareRoute}
                    onStartNavigation={handleStartNavigation}
                  />
                )
              : undefined
          }
        >
          <BuildPanelContent
            canRedo={canRedo}
            canUndo={canUndo}
            catalogEntry={selectedCatalogEntry}
            locationState={locationState}
            onClear={handleClearRoute}
            onRedo={handleRedo}
            onSeekToFraction={seekToFraction}
            onUndo={handleUndo}
            playback={playback}
            presentation={routePresentation}
            routePoints={displayedRoutePoints}
            routeState={routeState}
            emptyState={
              <BuildEmptyActions
                searchQuery={mapUi.searchQuery}
                searchStatus={mapUi.searchStatus}
                searchError={mapUi.searchError}
                onSearchQueryChange={handleSearchQueryChange}
                onSearchSubmit={submitSearch}
                locateBusy={locationState.status === "locating"}
                onLocateMe={handleLocatePress}
                draft={
                  plannerDraft && !routeTokenParam ? plannerDraft : null
                }
                onRestoreDraft={handleRestoreDraft}
              />
            }
          />
        </PlannerSheet>
      )}
      <RideIntroCard
        visible={rideIntroVisible && !pickOnMapMode}
        plan={ridePlan}
        locationStatus={rideSetupLocationStatus}
        onConfirm={handleIntroConfirm}
        onOpenSettings={handleIntroOpenSettings}
        onRefreshLocation={refreshRideSetupLocation}
        onClose={handleIntroClose}
        onLayout={handleRideIntroCardLayout}
      />
      <RideSetupSheet
        visible={rideSettingsVisible}
        plan={ridePlan}
        selection={rideSetupSelection}
        locationStatus={rideSetupLocationStatus}
        reverseAllowed={rideSetupSourceRoute?.routeShape?.type !== "one_way"}
        hapticsEnabled={nav.hapticsEnabled}
        onToggleHaptics={() => nav.setHapticsEnabled(!nav.hapticsEnabled)}
        voiceEnabled={voiceGuidanceEnabled}
        onToggleVoice={handleToggleVoiceGuidance}
        lockScreenGuidanceEnabled={lockScreenGuidanceEnabled}
        onToggleLockScreenGuidance={handleToggleLockScreenGuidance}
        onTestVoice={handleTestVoiceGuidance}
        onDirectionChange={(direction) =>
          setRideSetupSelection((current) => ({
            ...current,
            direction,
            startProgressMeters: null,
          }))
        }
        onStartModeChange={(startMode) =>
          setRideSetupSelection((current) => ({
            ...current,
            startMode,
            startProgressMeters: null,
          }))
        }
        onPickCustom={() => {
          setRideSettingsVisible(false);
          setPickOnMapMode(true);
        }}
        onRefreshLocation={refreshRideSetupLocation}
        onConfirm={handleRideSettingsConfirm}
        onClose={handleRideSettingsClose}
      />
      <DestinationSheet
        visible={destSheetVisible}
        disclaimerText={navPresentation.disclaimerText}
        onOpenApp={handleOpenExternalApp}
        onClose={() => {
          setDestSheetVisible(false);
          if (pendingExternalPlan?.origin === "intro") setRideIntroVisible(true);
          setPendingExternalPlan(null);
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
                setRideSettingsVisible(true);
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
  canRedo,
  canUndo,
  catalogEntry,
  emptyState,
  locationState,
  onClear,
  onRedo,
  onSeekToFraction,
  onUndo,
  playback,
  presentation,
  routePoints,
  routeState,
}) {
  const buildModel = getPlannerBuildModel(routeState);
  const hasPoints = routePoints.length > 0;
  const isEmpty = routeState.points.length === 0;
  const hasElevationProfile = routeState.geometry.length >= 2;
  const locationText = locationStatusText(locationState);
  const routeMessage = routeState.error
    ? routeState.error.message || "לא הצלחנו לעדכן את המסלול"
    : presentation.message;

  return (
    <View style={styles.buildBody}>
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

      {isEmpty && emptyState ? (
        <>
          {routeState.error ? (
            <Text style={styles.errorText}>{routeMessage}</Text>
          ) : null}
          {emptyState}
        </>
      ) : (
        <>
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
        </>
      )}
    </View>
  );
}

// Primary route actions, pinned to the bottom of the planner sheet so they stay
// visible however far the body above is scrolled. Mirrors the featured route's
// embedded action strip: one row of three equal buttons, navigation rightmost
// and forest-green, the two secondaries iconed. Keep these in sync so the app
// reads as one design language across the planner and route-story pages.
function BuildPanelFooter({
  canShare,
  onDownloadGpx,
  onShare,
  onStartNavigation,
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.buildFooter,
        { paddingBottom: 12 + Math.max(insets.bottom - 6, 0) },
      ]}
    >
      <View style={styles.footerActions}>
        <ChromeButton
          icon="trail-sign-outline"
          label="ניווט"
          onPress={onStartNavigation}
          primary
          buttonStyle={[styles.footerAction, styles.footerActionPrimary]}
          accessibilityLabel="התחל ניווט מונחה במסלול"
          testID="action-start-navigation"
        />
        <ChromeButton
          icon="share-outline"
          label="שיתוף"
          onPress={onShare}
          disabled={!canShare}
          buttonStyle={styles.footerAction}
          accessibilityLabel="שיתוף המסלול"
        />
        <ChromeButton
          icon="download-outline"
          label="GPX"
          onPress={onDownloadGpx}
          buttonStyle={styles.footerAction}
          accessibilityLabel="הורדת קובץ GPX למסלול"
          testID="action-download-gpx"
        />
      </View>
    </View>
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

function validMapPoint(point) {
  return (
    point &&
    Number.isFinite(Number(point.lat)) &&
    Number.isFinite(Number(point.lng))
  );
}

function routeLookaheadPoint(arc, geometry, target) {
  const progressMeters = Number(target?.mainProgressMeters);
  if (
    !arc ||
    !Array.isArray(geometry) ||
    geometry.length < 2 ||
    !Number.isFinite(progressMeters)
  ) {
    return null;
  }
  const lookaheadMeters = Math.min(
    arc.totalDistMeters,
    Math.max(0, progressMeters) + APPROACH_ROUTE_LOOKAHEAD_M,
  );
  if (lookaheadMeters <= progressMeters + 1) return null;
  return pointAndBearingAtDistance(arc, geometry, lookaheadMeters).point;
}

function cameraKeyNumber(value) {
  return Number.isFinite(value) ? String(Math.round(value)) : "na";
}

function cameraPointKey(point, decimals = DEFAULT_CAMERA_FIT_KEY_DECIMALS) {
  return `${Number(point.lng).toFixed(decimals)},${Number(point.lat).toFixed(decimals)}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function interpolatePoint(a, b, t) {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  };
}

function introSlotZoom(distanceMeters, latitude, pixelSpan) {
  const meters = Number(distanceMeters);
  const px = Number(pixelSpan);
  if (!Number.isFinite(meters) || meters <= 0 || !Number.isFinite(px) || px <= 0) {
    return 13.5;
  }
  const latitudeScale = Math.max(
    0.05,
    Math.abs(Math.cos((Number(latitude) * Math.PI) / 180)),
  );
  const metersPerPixel = meters / px;
  const zoom = Math.log2((156543.03392 * latitudeScale) / metersPerPixel);
  return clamp(zoom, RIDE_INTRO_MIN_ZOOM, RIDE_INTRO_MAX_ZOOM);
}

function introMarkerSlotCameraState(rider, start, options = {}) {
  if (!validMapPoint(rider) || !validMapPoint(start)) return null;
  const screen = Dimensions.get("window");
  const width = Number(screen.width);
  const height = Number(screen.height);
  const topInset = Number(options.topInset);
  const topY = Math.max(
    RIDE_INTRO_START_TOP_PADDING,
    (Number.isFinite(topInset) ? topInset : 0) + RIDE_INTRO_START_SAFE_AREA_GAP,
  );
  const bottomPadding = Number(options.bottomPadding);
  const riderY = Number.isFinite(bottomPadding)
    ? height - bottomPadding
    : height - RIDE_INTRO_FIT_BOTTOM_PADDING;
  const spanPx = Math.max(RIDE_INTRO_MIN_MARKER_SPAN_PX, riderY - topY);
  const centerY = height / 2;
  const centerT = clamp((riderY - centerY) / spanPx, 0.12, 0.88);
  const center = interpolatePoint(rider, start, centerT);
  const distanceMeters = getDistance(rider, start);
  const zoom = introSlotZoom(distanceMeters, center.lat, spanPx);
  const heading = Number.isFinite(options.heading)
    ? options.heading
    : computeBearing(rider, start);
  const pitch = Number.isFinite(options.pitch) ? options.pitch : RIDE_INTRO_FIT_PITCH;

  return {
    center,
    heading,
    pitch,
    zoom,
    padding: {
      paddingTop: topY,
      paddingRight: Math.max(42, Math.round(width * 0.12)),
      paddingBottom: Number.isFinite(bottomPadding) ? bottomPadding : 84,
      paddingLeft: Math.max(42, Math.round(width * 0.12)),
    },
  };
}

function setIntroCameraToMarkerSlots(camera, rider, start, options = {}) {
  if (!camera) return;
  const state = introMarkerSlotCameraState(rider, start, options);
  if (!state) return;
  setCameraToMarkerSlotState(camera, state, 550);
}

function setCameraToMarkerSlotState(camera, state, animationDuration = 0) {
  if (!camera || !state) return;
  camera.setCamera?.({
    type: "CameraStop",
    centerCoordinate: [state.center.lng, state.center.lat],
    heading: state.heading,
    pitch: state.pitch,
    zoomLevel: state.zoom,
    padding: state.padding,
    animationDuration,
    animationMode: animationDuration > 0 ? "easeTo" : "none",
  });
}

function fitCameraToPoints(camera, points, bottomPadding = 84, options = {}) {
  const normalizedPoints = Array.isArray(points)
    ? points
        .map((point) => ({
          lng: Number(point?.lng),
          lat: Number(point?.lat),
        }))
        .filter((point) => Number.isFinite(point.lng) && Number.isFinite(point.lat))
    : [];

  if (!camera || normalizedPoints.length === 0) return;

  const cameraStopExtras = {};
  if (Number.isFinite(options.heading)) cameraStopExtras.heading = options.heading;
  if (Number.isFinite(options.pitch)) cameraStopExtras.pitch = options.pitch;
  const padding = options.padding || {
    paddingTop: 96,
    paddingRight: 42,
    paddingBottom: bottomPadding,
    paddingLeft: 42,
  };

  if (normalizedPoints.length === 1) {
    const [point] = normalizedPoints;
    camera.setCamera?.({
      type: "CameraStop",
      centerCoordinate: [point.lng, point.lat],
      zoomLevel: 13.5,
      ...cameraStopExtras,
      animationDuration: 450,
      animationMode: "easeTo",
    });
    return;
  }

  const west = Math.min(...normalizedPoints.map((point) => point.lng));
  const east = Math.max(...normalizedPoints.map((point) => point.lng));
  const south = Math.min(...normalizedPoints.map((point) => point.lat));
  const north = Math.max(...normalizedPoints.map((point) => point.lat));
  if (typeof camera.setCamera === "function") {
    camera.setCamera({
      type: "CameraStop",
      bounds: { ne: [east, north], sw: [west, south] },
      padding,
      ...cameraStopExtras,
      animationDuration: 550,
      animationMode: "easeTo",
    });
    return;
  }
  camera.fitBounds?.([east, north], [west, south], [96, 42, bottomPadding, 42], 550);
}

const styles = StyleSheet.create({
  screen: { flex: 1, position: "relative", backgroundColor: "#fff" },
  fill: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  hint: { ...text.body, textAlign: "center", color: "#333" },
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
    ...text.bodyStrong,
    color: "#fff",
    writingDirection: "rtl",
    textAlign: "right",
    flexShrink: 1,
  },
  pickHintCancel: {
    ...text.bodyStrong,
    color: "#9ec6a6",
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
  setupRiderPuck: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  setupRiderArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderBottomWidth: 12,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: RIDER_PUCK_COLOR,
    marginBottom: -4,
  },
  setupRiderDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: RIDER_PUCK_COLOR,
    borderWidth: 3,
    borderColor: palette.white,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 4,
  },
  navChip: {
    backgroundColor: "rgba(255,255,255,0.95)",
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
    maxWidth: 220,
  },
  navChipText: {
    ...text.captionStrong,
    color: "#1a2b1e",
    writingDirection: "rtl",
  },
  navChipApproach: {
    backgroundColor: "#eef4ff",
    borderWidth: 1,
    borderColor: "#b9ccf5",
  },
  navChipApproachText: { color: "#1c4fd6" },
  navChipRejoin: {
    backgroundColor: "#fff0ee",
    borderWidth: 1,
    borderColor: "#f2c4be",
  },
  navChipRejoinText: { color: "#c9372c" },
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
    ...text.subheading,
    color: palette.ink,
    textAlign: "center",
    writingDirection: "rtl",
  },
  routeRestoreText: {
    ...text.body,
    color: palette.muted,
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
    ...text.bodyStrong,
    color: palette.white,
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
    fontSize: fontSizes.xl,
  },
  markerCardTitle: {
    ...text.subheading,
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
    // Glyph box (×): size-only, lineHeight centers it in the 30px button.
    fontSize: fontSizes["2xl"],
    lineHeight: 24,
  },
  markerCardSegment: {
    ...text.captionStrong,
    color: "#52616f",
    textAlign: "right",
    writingDirection: "rtl",
  },
  markerCardInfo: {
    ...text.body,
    color: "#333333",
    textAlign: "right",
    writingDirection: "rtl",
  },
  markerCardActions: {
    flexDirection: "row",
    justifyContent: "flex-start",
    marginTop: 2,
  },
  routeMessage: {
    ...text.caption,
    color: "#333333",
    textAlign: "right",
    writingDirection: "rtl",
  },
  warningList: {
    gap: 3,
  },
  warningText: {
    ...text.captionStrong,
    color: "#92400e",
    textAlign: "right",
    writingDirection: "rtl",
  },
  locationText: {
    ...text.caption,
    color: "#52616f",
    textAlign: "right",
    writingDirection: "rtl",
  },
  errorText: {
    ...text.captionStrong,
    color: "#991b1b",
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
    ...text.subheading,
    flex: 1,
    color: "#172026",
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
    // Glyph box (×): size-only, lineHeight centers it in the 34px button.
    fontSize: fontSizes["2xl"],
    lineHeight: 26,
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
    // One step below summaryTitle (subheading) to keep hierarchy inside the modal.
    ...text.bodyStrong,
    color: "#172026",
    textAlign: "right",
    writingDirection: "rtl",
  },
  summaryText: {
    ...text.caption,
    color: "#333333",
    textAlign: "right",
    writingDirection: "rtl",
  },
  summaryMuted: {
    ...text.caption,
    color: "#666666",
    fontStyle: "italic",
    textAlign: "right",
    writingDirection: "rtl",
  },
  summarySegmentText: {
    ...text.caption,
    color: "#333333",
    textAlign: "right",
    writingDirection: "rtl",
  },
  summaryWarningText: {
    ...text.captionStrong,
    color: "#92400e",
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
    flexDirection: "row-reverse",
    gap: 7,
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
    // Compact toolbar chips, not full CTAs — captionStrong keeps them tight.
    ...text.captionStrong,
    color: "#333333",
    flexShrink: 1,
  },
  chromeButtonTextSymbol: {
    // Glyph symbols (undo/redo/etc.): size-only, lineHeight centers in the row.
    fontSize: fontSizes.xl,
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
    ...text.label,
    color: "#6b8f86",
    textAlign: "right",
    writingDirection: "rtl",
  },
  buildTitle: {
    ...text.subheading,
    color: "#172026",
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
    ...text.bodyStrong,
    color: "#172026",
    writingDirection: "rtl",
  },
  statLabel: {
    ...text.label,
    color: "#52616f",
    writingDirection: "rtl",
  },
  buildFooter: {
    paddingHorizontal: 12,
    paddingTop: 10,
    backgroundColor: palette.paper,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.line,
  },
  // One row of equal-width actions; row-reverse puts navigation (first child) at
  // the right, matching the featured route's embedded action strip.
  footerActions: {
    flexDirection: "row-reverse",
    gap: 8,
  },
  footerAction: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.paper,
    shadowColor: "#101820",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  footerActionPrimary: {
    borderColor: palette.forest,
    backgroundColor: palette.forest,
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
    ...text.label,
    color: "#ffe600",
    letterSpacing: 0.5,
  },
});
