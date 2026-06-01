import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
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
import { dataMarkerFeatureCollection } from "@cycleways/core/data/dataMarkers.js";
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
import { prepareRouteNetworkFeatures } from "@cycleways/core/domain/routeNetwork.js";
import {
  ROUTE_SEARCH_PLACEHOLDER,
  getRoutePlannerPresentation,
  getRouteWarningPresentation,
} from "@cycleways/core/ui/routePlannerPresentation.js";

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
    handleRoutePointSelect,
    handleRoutePointDragStart,
    handleRoutePointDrag,
    handleRoutePointDragEnd,
    routePointDragPreview,
    handleDataMarkerClick,
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
  // RNMapbox draggable PointAnnotations need an iOS long-press; instead we run
  // a PanResponder over the map: a touch that lands on a committed route point
  // is dragged (converted screen->coord via the MapView), feeding the shared
  // handleRoutePointDrag* handlers; a touch that just taps selects the point.
  const mapViewRef = useRef(null);
  const pointScreenPositionsRef = useRef([]);
  const dragRef = useRef({ index: null, active: false, startX: 0, startY: 0 });
  const [pointGestureActive, setPointGestureActive] = useState(false);

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
    const HIT_RADIUS = 28;
    let best = null;
    for (const pos of pointScreenPositionsRef.current) {
      const distance = Math.hypot(pos.x - x, pos.y - y);
      if (distance <= HIT_RADIUS && (!best || distance < best.distance)) {
        best = { index: pos.index, distance };
      }
    }
    return best ? best.index : null;
  }, []);

  const routePointPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (evt) =>
          hitTestRoutePoint(
            evt.nativeEvent.locationX,
            evt.nativeEvent.locationY,
          ) !== null,
        // Only claim the gesture as a point drag if the touch STARTED on a
        // point (set in onPanResponderGrant). Never hijack an in-progress map
        // pan just because the finger later passes near a point.
        onMoveShouldSetPanResponder: () => dragRef.current.index !== null,
        onPanResponderGrant: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          const index = hitTestRoutePoint(locationX, locationY);
          dragRef.current = {
            index,
            active: false,
            startX: locationX,
            startY: locationY,
          };
          if (index !== null) {
            routePointPressGuardRef.current = Date.now();
            setPointGestureActive(true);
          }
        },
        onPanResponderMove: (evt) => {
          const drag = dragRef.current;
          if (drag.index === null) return;
          const { locationX, locationY } = evt.nativeEvent;
          if (!drag.active) {
            if (Math.hypot(locationX - drag.startX, locationY - drag.startY) < 6) {
              return;
            }
            drag.active = true;
            handleRoutePointDragStart(drag.index);
          }
          const map = mapViewRef.current;
          if (!map) return;
          map
            .getCoordinateFromView([locationX, locationY])
            .then((coord) => {
              if (
                dragRef.current.active &&
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
          if (drag.index !== null) {
            if (drag.active) {
              handleRoutePointDragEnd();
            } else {
              handleRoutePointSelect(drag.index);
            }
          }
          dragRef.current = { index: null, active: false, startX: 0, startY: 0 };
          setPointGestureActive(false);
        },
        onPanResponderTerminate: () => {
          if (dragRef.current.active) handleRoutePointDragEnd();
          dragRef.current = { index: null, active: false, startX: 0, startY: 0 };
          setPointGestureActive(false);
        },
      }),
    [
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
      if (Date.now() - routePointPressGuardRef.current < 350) return;
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

  const addSearchResultToRoute = useCallback(() => {
    const point = pointFromSearchHighlight(mapUi.searchHighlight);
    if (!point) return;
    handleMapClick(point);
  }, [handleMapClick, mapUi.searchHighlight]);

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
      />
      <RoutePlannerChrome
        animator={directionAnimatorRef.current}
        canDownload={canDownload}
        canRedo={canRedo}
        canUndo={canUndo}
        onOpenSummary={handleOpenDownload}
        onRedo={handleRedo}
        onSearchChange={handleSearchQueryChange}
        onSearchResultAdd={addSearchResultToRoute}
        onSearchSubmit={submitSearch}
        onUndo={handleUndo}
        locationState={locationState}
        mapUi={mapUi}
        presentation={routePresentation}
        routeState={routeState}
        routePoints={displayedRoutePoints}
        onClear={handleRouteClear}
        onScrub={setScrubPoint}
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
    </View>
  );
}

function MapLegendOverlay({ hasBrokenRoute, warningPresentation }) {
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
                <View
                  key={warningGroup.segmentName}
                  style={[
                    styles.warningDetailItem,
                    { backgroundColor: warningGroup.backgroundColor },
                  ]}
                >
                  <Text style={styles.warningDetailLabel}>
                    {warningGroup.label}
                  </Text>
                  <Text style={styles.warningDetailIcons}>
                    {warningGroup.icons.join(" ")}
                  </Text>
                </View>
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
  animator,
  canDownload,
  canRedo,
  canUndo,
  onClear,
  onOpenSummary,
  onRedo,
  onSearchChange,
  onSearchResultAdd,
  onSearchSubmit,
  onUndo,
  onScrub,
  locationState,
  mapUi,
  presentation,
  routeState,
  routePoints,
}) {
  const hasPoints = routePoints.length > 0;
  const hasElevationProfile = routeState.geometry.length >= 2;
  const searchBusy = mapUi.searchStatus === "searching";
  const hasSearchResult = Boolean(pointFromSearchHighlight(mapUi.searchHighlight));
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
            placeholder={ROUTE_SEARCH_PLACEHOLDER}
            placeholderTextColor="#52616f"
            returnKeyType="search"
            style={styles.searchInput}
            textAlign="right"
            value={mapUi.searchQuery}
          />
          {hasSearchResult ? (
            <ChromeButton compact label="הוסף" onPress={onSearchResultAdd} />
          ) : null}
        </View>
        {mapUi.searchError ? (
          <Text style={styles.searchError}>{mapUi.searchError}</Text>
        ) : null}
        <View style={styles.controlBar}>
          <View style={styles.controlGroup}>
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
            </View>
          </View>
          <Text style={routeState.error ? styles.errorText : styles.routeMessage}>
            {routeMessage}
          </Text>
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
        </View>
      </View>
    </>
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

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  hint: { fontSize: 15, textAlign: "center", color: "#333" },
  topChrome: {
    position: "absolute",
    top: 15,
    left: 15,
    right: 15,
    gap: 4,
  },
  searchPanel: {
    flexDirection: "row-reverse",
    alignItems: "stretch",
    alignSelf: "flex-end",
    width: 200,
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
    width: 50,
    minWidth: 50,
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
