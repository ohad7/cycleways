import { getDistance, distanceToLineSegmentPixels } from './utils/distance.js';
import { smoothElevations } from './utils/elevations.js';
import {
  decodeRoutePayload,
  encodeCompactRoute,
  encodeRoute,
  extractMiddlePoints,
} from './utils/route-encoding.js';
import { executeDownloadGPX, generateGPX } from './utils/gpx-generator.js';
import {
  distanceToRouteGeometry,
  getDataPointLocation,
  ROUTE_DATA_POINT_TRIGGER_DISTANCE_METERS,
} from './utils/route-data.js';
import { trackRoutePointEvent, trackUndoRedoEvent, trackSearchEvent, trackSocialShare, 
          trackSegmentFocus, trackWarningClick, trackRouteOperation,trackPageLoad,trackTutorial
} from './utils/analytics.js';

let map;
let selectedSegments = [];
let routePolylines = [];
let undoStack = [];
let redoStack = [];
let mapDataLoaded = false;
let segmentsData = null;
let segmentMetrics = {}; // Pre-calculated distance, elevation, and directionality data
let routePoints = []; // Array of points that define the route
let pointMarkers = []; // Array of map markers for the points
let isDraggingPoint = false;
let draggedPointIndex = -1;
let routeManager = null; // Instance of RouteManager
let operationsLog = []; // Log of user operations for export
let spatialIndex = null; // Spatial index for efficient segment lookup
let mapManifest = null;

const DEFAULT_MAP_ASSETS = {
  bikeRoads: "bike_roads_v18.geojson",
  segments: "segments.json",
};

const DEFAULT_FEATURE_FLAGS = {
  segmentQualityPublicDisplay: false,
  segmentQualityRouting: false,
};
const FEATURE_FLAGS = Object.fromEntries(
  Object.entries(DEFAULT_FEATURE_FLAGS).map(([key, defaultValue]) => [key, featureFlagValue(key, defaultValue)]),
);

const MAPBOX_TOKEN_STORAGE_KEY = "cycleways.mapboxToken";

function featureFlagValue(key, defaultValue) {
  const globalValue = window.CYCLEWAYS_FEATURE_FLAGS?.[key];
  if (typeof globalValue === "boolean") return globalValue;

  try {
    const storedValue = window.localStorage.getItem(`cycleways.flags.${key}`);
    if (storedValue === "true") return true;
    if (storedValue === "false") return false;
  } catch {
    // Feature flag persistence is optional.
  }

  return defaultValue;
}

function requireMapboxToken() {
  const globalToken = window.CYCLEWAYS_MAPBOX_TOKEN;
  if (typeof globalToken === "string" && globalToken.trim()) {
    return globalToken.trim();
  }

  const metaToken = document.querySelector('meta[name="mapbox-token"]')?.content;
  if (typeof metaToken === "string" && metaToken.trim()) {
    return metaToken.trim();
  }

  try {
    const storedToken = window.localStorage.getItem(MAPBOX_TOKEN_STORAGE_KEY);
    if (storedToken?.trim()) {
      return storedToken.trim();
    }
  } catch {
    // Local storage can be unavailable in some browser privacy modes.
  }

  throw new Error(
    "Mapbox token is not configured. Load mapbox-token.js or set cycleways.mapboxToken in localStorage.",
  );
}

const COLORS = {
  WARNING_ORANGE: "#882211",
  WARNING_RED: "#f44336",
  SEGMENT_SELECTED: "#006699", // Green for selected segments
  SEGMENT_HOVER: "#666633", // Orange for hovered segments
  SEGMENT_HOVER_SELECTED: "#003399", // Brighter green when hovering over a selected segment
  SEGMENT_SIDEBAR_HOVER: "#666633", // Brown when hovering a segment in the sidebar
  ELEVATION_MARKER: "#ff4444", // Red for the elevation marker
  HIGHLIGHT_WHITE: "#ffffff", // White for highlighting all segments
  ROUTE_LINE: "#006699",
};

const MIN_ZOOM_LEVEL = 13; // Minimum zoom level when focusing on segments
const ROUTE_POINT_SNAP_THRESHOLD_METERS = 100;
const ROUTE_URL_PARAM = "route";
const SHARE_URL_MAX_LENGTH = 1800;
const ROUTE_NETWORK_SOURCE_ID = "cycleways-network";
const ROUTE_NETWORK_LINE_LAYER_ID = "cycleways-network-line";
const ROUTE_NETWORK_HOVER_LAYER_ID = "cycleways-network-hover";
const ROUTE_NETWORK_FOCUS_LAYER_ID = "cycleways-network-focus";
let routePointMessageTimeout = null;

function getRouteNetworkLayerIds() {
  return [
    ROUTE_NETWORK_FOCUS_LAYER_ID,
    ROUTE_NETWORK_HOVER_LAYER_ID,
    ROUTE_NETWORK_LINE_LAYER_ID,
  ];
}

function clearRouteNetworkLayers() {
  if (!map) return;

  getRouteNetworkLayerIds().forEach((layerId) => {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
  });

  if (map.getSource(ROUTE_NETWORK_SOURCE_ID)) {
    map.removeSource(ROUTE_NETWORK_SOURCE_ID);
  }
}

function setRouteNetworkHover(segmentName) {
  if (!map?.getLayer(ROUTE_NETWORK_HOVER_LAYER_ID)) return;

  map.setFilter(
    ROUTE_NETWORK_HOVER_LAYER_ID,
    segmentName ? ["==", ["get", "name"], segmentName] : ["==", ["get", "name"], ""],
  );
}

function setRouteNetworkFocus(segmentName, visible = true) {
  if (!map?.getLayer(ROUTE_NETWORK_FOCUS_LAYER_ID)) return;

  map.setFilter(
    ROUTE_NETWORK_FOCUS_LAYER_ID,
    segmentName && visible
      ? ["==", ["get", "name"], segmentName]
      : ["==", ["get", "name"], ""],
  );
}

function getRouteFeatureColor(feature) {
  let originalColor =
    feature.properties.stroke ||
    feature.properties["stroke-color"] ||
    "#0288d1";

  if (originalColor === "#0288d1" || originalColor === "rgb(2, 136, 209)") {
    return "rgb(101, 170, 162)";
  }

  if (
    originalColor == "#e6ee9c" ||
    originalColor === "rgb(230, 238, 156)"
  ) {
    return "rgb(138, 147, 158)";
  }

  return "rgb(174, 144, 103)";
}

function addRouteNetworkLayers(features) {
  if (!map || features.length === 0) return;

  clearRouteNetworkLayers();

  map.addSource(ROUTE_NETWORK_SOURCE_ID, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features,
    },
  });

  map.addLayer({
    id: ROUTE_NETWORK_LINE_LAYER_ID,
    type: "line",
    source: ROUTE_NETWORK_SOURCE_ID,
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
    paint: {
      "line-color": ["get", "routeColor"],
      "line-width": ["get", "routeWidth"],
      "line-opacity": ["get", "routeOpacity"],
    },
  });

  map.addLayer({
    id: ROUTE_NETWORK_HOVER_LAYER_ID,
    type: "line",
    source: ROUTE_NETWORK_SOURCE_ID,
    filter: ["==", ["get", "name"], ""],
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
    paint: {
      "line-color": COLORS.SEGMENT_HOVER,
      "line-width": 5,
      "line-opacity": 1,
    },
  });

  map.addLayer({
    id: ROUTE_NETWORK_FOCUS_LAYER_ID,
    type: "line",
    source: ROUTE_NETWORK_SOURCE_ID,
    filter: ["==", ["get", "name"], ""],
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
    paint: {
      "line-color": COLORS.HIGHLIGHT_WHITE,
      "line-width": 7,
      "line-opacity": 1,
    },
  });
}

// Save state for undo/redo
function saveState() {
  undoStack.push({
    segments: [...selectedSegments],
    points: routePoints.map((p) => ({ ...p })), // Deep copy of points
  });
  redoStack = []; // Clear redo stack when new action is performed
  updateUndoRedoButtons();
  clearRouteFromUrl(); // Clear route parameter when making changes
}

function createRoutePointFeature(point, index) {
  return {
    type: "Feature",
    id: `route-point-${point.id}`,
    geometry: {
      type: "Point",
      coordinates: [point.lng, point.lat],
    },
    properties: {
      index: index,
      pointId: point.id,
      type: "route-point",
    },
  };
}

function updateRoutePointsSource() {
  const source = map?.getSource("route-points");
  if (!source) return;

  source.setData({
    type: "FeatureCollection",
    features: routePoints.map(createRoutePointFeature),
  });
}

function renderRoutePoints() {
  if (routePoints.length > 0 && !map.getSource("route-points")) {
    createPointMarker(routePoints[0], 0);
  }

  updateRoutePointsSource();
  pointMarkers = routePoints.map((point) => ({
    pointId: `route-point-${point.id}`,
  }));
}

function getRouteGeometryCoordinates() {
  if (!routeManager) return [];

  return routeManager.getRouteInfo().orderedCoordinates;
}

function getDataPointId(segmentName, index) {
  return `${segmentName}-${index}`;
}

function getRouteDataPoints() {
  const routeCoordinates = getOrderedCoordinates();
  const routeDataPoints = [];
  const seenDataPointIds = new Set();

  selectedSegments.forEach((segmentName) => {
    const segmentInfo = segmentsData?.[segmentName];
    const dataPoints = getSegmentDataPoints(segmentName);

    dataPoints.forEach((dataPoint) => {
      if (seenDataPointIds.has(dataPoint.id)) return;

      let routeDistanceMeters = null;
      if (dataPoint.location) {
        if (routeCoordinates.length < 2) return;

        routeDistanceMeters = distanceToRouteGeometry(
          dataPoint.location,
          routeCoordinates,
        );
        if (routeDistanceMeters > ROUTE_DATA_POINT_TRIGGER_DISTANCE_METERS) {
          return;
        }
      }

      seenDataPointIds.add(dataPoint.id);
      routeDataPoints.push({
        ...dataPoint,
        routeDistanceMeters,
      });
    });

    if (dataPoints.length === 0 && segmentInfo?.warning) {
      const legacyWarning = createLegacySegmentWarning(segmentName);
      if (legacyWarning && !seenDataPointIds.has(legacyWarning.id)) {
        seenDataPointIds.add(legacyWarning.id);
        routeDataPoints.push(legacyWarning);
      }
    }
  });

  return routeDataPoints;
}

function groupDataPointsBySegment(dataPoints) {
  const grouped = new Map();

  dataPoints.forEach((dataPoint) => {
    if (!grouped.has(dataPoint.segmentName)) {
      grouped.set(dataPoint.segmentName, []);
    }
    grouped.get(dataPoint.segmentName).push(dataPoint);
  });

  return grouped;
}

function ensureRouteGeometryLayer() {
  if (!map || map.getSource("route-geometry")) return;

  map.addSource("route-geometry", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: [],
    },
  });

  map.addLayer(
    {
      id: "route-geometry-line",
      type: "line",
      source: "route-geometry",
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": COLORS.ROUTE_LINE,
        "line-width": 5,
        "line-opacity": 0.9,
      },
    },
    map.getLayer("route-points-circle") ? "route-points-circle" : undefined,
  );
}

function updateRouteGeometry() {
  if (!map) return;

  ensureRouteGeometryLayer();
  const source = map.getSource("route-geometry");
  if (!source) return;

  const coordinates = getRouteGeometryCoordinates();
  const features =
    coordinates.length >= 2
      ? [
          {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: coordinates.map((coord) => [coord.lng, coord.lat]),
            },
            properties: {},
          },
        ]
      : [];

  source.setData({
    type: "FeatureCollection",
    features,
  });
}

function syncRoutePointsFromManager() {
  if (!routeManager) return;

  const managerPoints = routeManager.getRouteInfo().points;
  routePoints = managerPoints.map((point) => ({
    ...point,
    id: point.id || Date.now() + Math.random(),
  }));
  renderRoutePoints();
}

function showRoutePointMessage(message) {
  const panel = document.getElementById("route-description-panel");
  const description = document.getElementById("route-description");

  if (!panel || !description) {
    alert(message);
    return;
  }

  clearTimeout(routePointMessageTimeout);
  panel.style.display = "block";
  panel.classList.remove("empty");
  description.innerHTML = `<span class="route-inline-warning">${message}</span>`;
  routePointMessageTimeout = setTimeout(() => {
    updateRouteListAndDescription();
  }, 3500);
}

function snapRoutePointToNetwork(point) {
  if (!routeManager) return null;

  return routeManager.snapToNetwork(
    {
      lat: point.lat,
      lng: point.lng,
    },
    ROUTE_POINT_SNAP_THRESHOLD_METERS,
  );
}

function showPointOutsideNetworkMessage() {
  showRoutePointMessage(
    `הנקודה רחוקה מדי מרשת CycleWays. בחרו נקודה עד ${ROUTE_POINT_SNAP_THRESHOLD_METERS} מטר משביל מסומן.`,
  );
}

function recalculateRoutePreviewForDraggedPoint(index, rawPoint) {
  if (!routeManager) return false;

  const snappedPoint = snapRoutePointToNetwork(rawPoint);
  if (!snappedPoint) return false;

  const previewPoints = routePoints.map((point, pointIndex) =>
    pointIndex === index
      ? {
          ...point,
          lat: snappedPoint.lat,
          lng: snappedPoint.lng,
          segmentName: snappedPoint.segmentName,
        }
      : point,
  );

  const updatedSegments = routeManager.recalculateRoute(previewPoints);
  selectedSegments = updatedSegments;
  updateSegmentStyles();
  updateRouteListAndDescription();
  return true;
}

function finalizeDraggedRoutePoint(index) {
  if (!routeManager || index < 0 || !routePoints[index]) return false;

  const snappedPoint = snapRoutePointToNetwork(routePoints[index]);
  if (!snappedPoint) {
    removeRoutePoint(index, { save: false });
    showPointOutsideNetworkMessage();
    return false;
  }

  routePoints[index] = {
    ...routePoints[index],
    lat: snappedPoint.lat,
    lng: snappedPoint.lng,
    segmentName: snappedPoint.segmentName,
  };

  selectedSegments = routeManager.recalculateRoute(routePoints);
  syncRoutePointsFromManager();
  updateSegmentStyles();
  updateRouteListAndDescription();
  return true;
}


// Add a new route point
function addRoutePoint(lngLat) {
  const inputPoint = {
    lng: lngLat.lng,
    lat: lngLat.lat,
  };
  const snappedPoint = snapRoutePointToNetwork(inputPoint);

  if (routeManager && !snappedPoint) {
    showPointOutsideNetworkMessage();
    return false;
  }

  saveState();

  const point = snappedPoint
    ? {
        lng: snappedPoint.lng,
        lat: snappedPoint.lat,
        segmentName: snappedPoint.segmentName,
        id: Date.now() + Math.random(),
      }
    : {
        ...inputPoint,
        id: Date.now() + Math.random(),
      };

  // Log the operation before making changes
  logOperation("addPoint", {
    point: { lat: point.lat, lng: point.lng },
    fromClick: true,
  });

  // Track analytics event for route point addition
  trackRoutePointEvent([...routePoints, point], selectedSegments, "click");

  // Use RouteManager to add the point and get updated segments
  if (routeManager) {
    try {
      const updatedSegments = routeManager.addPoint({
        lat: inputPoint.lat,
        lng: inputPoint.lng,
      });
      selectedSegments = updatedSegments;
      syncRoutePointsFromManager();

      updateSegmentStyles();
      updateRouteListAndDescription();
    } catch (error) {
      console.error("Error adding route point:", error);
      // Fallback to old method
      routePoints.push(point);
      createPointMarker(point, routePoints.length - 1);
      recalculateRoute();
    }
  } else {
    // Fallback to old method if RouteManager not available
    routePoints.push(point);
    createPointMarker(point, routePoints.length - 1);
    recalculateRoute();
  }

  clearRouteFromUrl();
  return true;
}

// Create a map-integrated point feature for a route point
function createPointMarker(point, index) {
  const pointId = `route-point-${point.id}`;

  // Create GeoJSON point feature
  const pointFeature = createRoutePointFeature(point, index);

  // Add or update the source for route points
  if (!map.getSource("route-points")) {
    map.addSource("route-points", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [],
      },
    });

    // Add circle layer for points
    map.addLayer({
      id: "route-points-circle",
      type: "circle",
      source: "route-points",
      paint: {
        "circle-radius": 4,
        "circle-color": "#ff4444",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    });

    // Add drag functionality
    let isDragging = false;
    let draggedFeature = null;

    map.on("mousedown", "route-points-circle", (e) => {
      if (e.features.length === 0) return;

      e.preventDefault();
      isDragging = true;
      isDraggingPoint = true;
      draggedFeature = { ...e.features[0] }; // Create a copy
      draggedPointIndex = draggedFeature.properties.index;

      saveState();
      map.dragPan.disable();
      document.body.style.userSelect = "none";
    });

    map.on("mousemove", (e) => {
      if (!isDragging || !draggedFeature || draggedPointIndex === -1) return;

      // Update route point data
      if (routePoints[draggedPointIndex]) {
        routePoints[draggedPointIndex].lng = e.lngLat.lng;
        routePoints[draggedPointIndex].lat = e.lngLat.lat;
      }

      updateRoutePointsSource();

      // Update dragging logic to use RouteManager's recalculateRoute method
      try {
        recalculateRoutePreviewForDraggedPoint(draggedPointIndex, {
          lng: e.lngLat.lng,
          lat: e.lngLat.lat,
        });
      } catch (error) {
        console.error("Error updating route during drag:", error);
        // Fallback to old method if RouteManager fails
        recalculateRoute();
      }
    });

    map.on("mouseup", () => {
      if (!isDragging) return;

      isDragging = false;
      isDraggingPoint = false;

      // Validate that the dragged point is still close enough to a segment
      if (draggedPointIndex !== -1 && routePoints[draggedPointIndex]) {
        finalizeDraggedRoutePoint(draggedPointIndex);
      }

      draggedPointIndex = -1;
      draggedFeature = null;

      map.dragPan.enable();
      document.body.style.userSelect = "";

      clearRouteFromUrl();
    });

    // Touch events for mobile
    map.on("touchstart", "route-points-circle", (e) => {
      if (e.points.length !== 1 || e.features.length === 0) return;

      e.preventDefault();
      isDragging = true;
      isDraggingPoint = true;
      draggedFeature = { ...e.features[0] }; // Create a copy
      draggedPointIndex = draggedFeature.properties.index;

      saveState();
      map.dragPan.disable();
    });

    map.on("touchmove", (e) => {
      if (!isDragging || !draggedFeature || draggedPointIndex === -1) return;
      e.preventDefault();

      // Update route point data
      if (routePoints[draggedPointIndex]) {
        routePoints[draggedPointIndex].lng = e.lngLat.lng;
        routePoints[draggedPointIndex].lat = e.lngLat.lat;
      }

      updateRoutePointsSource();

      // Update touch dragging logic to use RouteManager's recalculateRoute method
      if (routeManager) {
        try {
          recalculateRoutePreviewForDraggedPoint(draggedPointIndex, {
            lng: e.lngLat.lng,
            lat: e.lngLat.lat,
          });
        } catch (error) {
          console.error("Error updating route during drag:", error);
          // Fallback to old method if RouteManager fails
          recalculateRoute();
        }
      } else {
        recalculateRoute();
      }
    });

    map.on("touchend", () => {
      if (!isDragging) return;

      isDragging = false;
      isDraggingPoint = false;

      // Validate that the dragged point is still close enough to a segment
      if (draggedPointIndex !== -1 && routePoints[draggedPointIndex]) {
        finalizeDraggedRoutePoint(draggedPointIndex);
      }

      draggedPointIndex = -1;
      draggedFeature = null;

      map.dragPan.enable();

      clearRouteFromUrl();
    });

    // Right-click to remove point
    map.on("contextmenu", "route-points-circle", (e) => {
      e.preventDefault();
      const feature = e.features[0];
      if (feature) {
        removeRoutePoint(feature.properties.index);
      }
    });
  }

  // Update the source data with the new point
  const source = map.getSource("route-points");
  const currentData = source._data;

  // Remove any existing point with the same index
  currentData.features = currentData.features.filter(
    (f) => f.properties.index !== index,
  );

  // Add the new point
  currentData.features.push(pointFeature);

  // Update indices for all points
  currentData.features.forEach((feature, idx) => {
    feature.properties.index = idx;
  });

  source.setData(currentData);

  // Store reference for compatibility
  pointMarkers[index] = { pointId: pointId };
}

// Remove a route point
function removeRoutePoint(index, options = {}) {
  if (index < 0 || index >= routePoints.length) return;

  if (options.save !== false) {
    saveState();
  }

  // Log the operation before making changes
  logOperation("removePoint", {
    index: index,
    point: routePoints[index]
      ? { lat: routePoints[index].lat, lng: routePoints[index].lng }
      : null,
  });

  // Track analytics event for route point removal
  trackRoutePointEvent(
    routePoints.filter((_, pointIndex) => pointIndex !== index),
    selectedSegments,
    "right_click",
  );

  try {
    // Use RouteManager to remove point and get updated segments
    const updatedSegments = routeManager.removePoint(index);
    selectedSegments = updatedSegments;

    syncRoutePointsFromManager();

    // Update map-integrated points safely
    try {
      updateRoutePointsSource();
    } catch (domError) {
      console.warn("Error updating map points:", domError);
    }

    // Update UI
    updateSegmentStyles();
    updateRouteListAndDescription();
    clearRouteFromUrl();
  } catch (error) {
    console.error("Error removing route point:", error);

    // Fallback: remove point locally and recalculate route manually
    routePoints.splice(index, 1);
    pointMarkers.splice(index, 1);

    // Update map-integrated points safely
    try {
      updateRoutePointsSource();
    } catch (domError) {
      console.warn("Error updating map points in fallback:", domError);
    }

    // Manually recalculate route using existing logic
    recalculateRoute();
    clearRouteFromUrl();
  }
}

// Clear all route points
function clearRoutePoints() {
  // Clear map-integrated points
  if (map.getSource("route-points")) {
    map.getSource("route-points").setData({
      type: "FeatureCollection",
      features: [],
    });
  }

  pointMarkers = [];
  routePoints = [];
  updateRouteGeometry();
}

// Recalculate the route based on current points
function recalculateRoute() {
  if (routePoints.length === 0) {
    selectedSegments = [];
    updateSegmentStyles();
    updateRouteListAndDescription();
    return;
  }

  if (!routeManager) {
    console.warn("RouteManager not initialized, cannot recalculate route.");
    return;
  }

  try {
    // Use RouteManager to calculate route through points
    const routeInfo = routeManager.getRouteInfo();

    // Find path through all route points
    if (routePoints.length === 1) {
      selectedSegments = [];
    } else {
      // Multiple points - find optimal path
      const pathSegments = [];
      const usedSegments = new Set();

      for (let i = 0; i < routePoints.length - 1; i++) {
        const startPoint = routePoints[i];
        const endPoint = routePoints[i + 1];

        const segmentPath = routeManager.findPathBetweenPoints(
          startPoint,
          endPoint,
        );

        // Add segments to path, avoiding duplicates
        for (const segmentName of segmentPath) {
          if (
            pathSegments.length === 0 ||
            pathSegments[pathSegments.length - 1] !== segmentName
          ) {
            pathSegments.push(segmentName);
          }
        }
      }

      selectedSegments = pathSegments;
    }

    updateSegmentStyles();
    updateRouteListAndDescription();
  } catch (error) {
    console.error("Error recalculating route:", error);
  }
}

function clearRouteFromUrl() {
  const url = new URL(window.location);
  if (url.searchParams.has(ROUTE_URL_PARAM)) {
    url.searchParams.delete(ROUTE_URL_PARAM);
    window.history.replaceState({}, document.title, url.toString());
  }
}

function undo() {
  if (undoStack.length > 0) {
    // Track analytics event for undo
    trackUndoRedoEvent("undo", undoStack, redoStack, routePoints, selectedSegments);

    // Save current state to redo stack
    redoStack.push({
      segments: [...selectedSegments],
      points: routePoints.map((p) => ({ ...p })),
    });

    // Restore previous state
    const previousState = undoStack.pop();

    // Clear and restore points
    clearRoutePoints();
    routePoints = previousState.points.map((p) => ({ ...p }));
    routePoints.forEach((point, index) => {
      createPointMarker(point, index);
    });

    // Use RouteManager's public method to restore state
    if (routeManager) {
      try {
        const restoredSegments = routeManager.restoreFromPoints(routePoints);
        selectedSegments = restoredSegments;
        syncRoutePointsFromManager();

        // If restoration failed, fallback to the saved segments
        if (
          selectedSegments.length === 0 &&
          previousState.segments.length > 0
        ) {
          console.warn("RouteManager restoration failed, using saved segments");
          selectedSegments = [...previousState.segments];
          // Update RouteManager's internal state to match
          routeManager.updateInternalState(routePoints, selectedSegments);
          renderRoutePoints();
        }
      } catch (error) {
        console.error("Error during undo restoration:", error);
        // Fallback to saved segments
        selectedSegments = [...previousState.segments];
        if (routeManager) {
          routeManager.updateInternalState(routePoints, selectedSegments);
        }
      }
    } else {
      selectedSegments = [...previousState.segments];
    }

    updateSegmentStyles();
    updateRouteListAndDescription();
    updateUndoRedoButtons();
    clearRouteFromUrl(); // Clear route parameter on undo
  }
}

function redo() {
  if (redoStack.length > 0) {
    // Track analytics event for redo
    trackUndoRedoEvent("redo", undoStack, redoStack, routePoints, selectedSegments);

    // Save current state to undo stack
    undoStack.push({
      segments: [...selectedSegments],
      points: routePoints.map((p) => ({ ...p })),
    });

    // Restore next state
    const nextState = redoStack.pop();

    // Clear and restore points
    clearRoutePoints();
    routePoints = nextState.points.map((p) => ({ ...p }));
    routePoints.forEach((point, index) => {
      createPointMarker(point, index);
    });

    // Use RouteManager's public method to restore state
    if (routeManager) {
      selectedSegments = routeManager.restoreFromPoints(routePoints);
      syncRoutePointsFromManager();
    } else {
      selectedSegments = [...nextState.segments];
    }

    // Update RouteManager's internal state to match
    if (routeManager) {
      routeManager.updateInternalState(routePoints, selectedSegments);
    }

    updateSegmentStyles();
    updateRouteListAndDescription();
    updateUndoRedoButtons();
    clearRouteFromUrl(); // Clear route parameter on redo
  }
}

function updateUndoRedoButtons() {
  document.getElementById("undo-btn").disabled = undoStack.length === 0;
  document.getElementById("redo-btn").disabled = redoStack.length === 0;
  document.getElementById("reset-btn").disabled =
    selectedSegments.length === 0 && routePoints.length === 0;
}

// Function to log user operations for export
function logOperation(type, data) {
  // Get current route state before the operation
  const currentState = {
    pointsCount: routePoints.length,
    segmentsCount: selectedSegments.length,
    selectedSegments: [...selectedSegments],
    segmentIds: selectedSegments
      .map((name) => {
        const segmentInfo = segmentsData[name];
        return segmentInfo ? segmentInfo.id : 0;
      })
      .filter((id) => id > 0),
  };

  operationsLog.push({
    timestamp: Date.now(),
    type: type,
    data: data,
    routeState: currentState,
  });
}

// Function to export operations as JSON
function exportOperationsJSON() {
  // Get final route state
  const finalSegmentIds = selectedSegments
    .map((name) => {
      const segmentInfo = segmentsData[name];
      return segmentInfo ? segmentInfo.id : 0;
    })
    .filter((id) => id > 0);

  // Create export object
  const exportData = {
    name: `User Test Case - ${new Date()
      .toLocaleString("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
      .replace(/[/:]/g, "-")
      .replace(", ", " ")}`,
    description: `Test case generated from user operations (${operationsLog.length} operations)`,
    geoJsonFile: mapManifest?.bikeRoads || DEFAULT_MAP_ASSETS.bikeRoads,
    segmentsFile: mapManifest?.segments || DEFAULT_MAP_ASSETS.segments,
    operations: operationsLog.map((op) => ({
      type: op.type,
      data: op.data,
      expectedSegmentIds: op.routeState.segmentIds,
      expectedSegmentsCount: op.routeState.segmentsCount,
    })),
    summary: {
      totalOperations: operationsLog.length,
      operationTypes: [...new Set(operationsLog.map((op) => op.type))],
      finalSegmentIds: finalSegmentIds,
      finalSegmentsCount: selectedSegments.length,
    },
  };

  return exportData;
}

// Helper function to get route info for analytics
function getRouteInfo() {
  const totalDistance = calculateRouteGeometryStats().distance;

  return {
    distance: totalDistance,
    segments: selectedSegments.length,
    points: routePoints.length,
  };
}

// Function to show export modal
function showExportModal() {
  const exportData = exportOperationsJSON();
  const jsonString = JSON.stringify(exportData, null, 2);

  // Create modal elements
  const modal = document.createElement("div");
  modal.className = "export-modal";
  modal.innerHTML = `
    <div class="export-modal-content">
      <div class="export-modal-header">
        <h3>📋 Export Operations JSON</h3>
        <button class="export-modal-close">&times;</button>
      </div>
      <div class="export-modal-body">
        <p>Operations exported: <strong>${exportData.operations.length}</strong></p>
        <p>Final segments: <strong>${exportData.summary.finalSegmentsCount}</strong></p>
        <div class="json-container">
          <textarea class="json-textarea" readonly>${jsonString}</textarea>
        </div>
        <div class="export-modal-actions">
          <button id="copy-json-btn" class="copy-json-btn">📄 Copy JSON</button>
          <button id="clear-operations-btn" class="clear-operations-btn">🗑️ Clear Log</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Add event listeners
  const closeBtn = modal.querySelector(".export-modal-close");
  const copyBtn = modal.querySelector("#copy-json-btn");
  const clearBtn = modal.querySelector("#clear-operations-btn");
  const textarea = modal.querySelector(".json-textarea");

  closeBtn.addEventListener("click", () => {
    document.body.removeChild(modal);
  });

  copyBtn.addEventListener("click", () => {
    textarea.select();
    navigator.clipboard
      .writeText(jsonString)
      .then(() => {
        copyBtn.textContent = "✅ Copied!";
        copyBtn.style.background = "#4CAF50";
        setTimeout(() => {
          copyBtn.textContent = "📄 Copy JSON";
          copyBtn.style.background = "#4682B4";
        }, 2000);
      })
      .catch(() => {
        document.execCommand("copy");
        copyBtn.textContent = "✅ Copied!";
        copyBtn.style.background = "#4CAF50";
        setTimeout(() => {
          copyBtn.textContent = "📄 Copy JSON";
          copyBtn.style.background = "#4682B4";
        }, 2000);
      });
  });

  clearBtn.addEventListener("click", () => {
    operationsLog = [];
    document.body.removeChild(modal);
    alert("Operations log cleared!");
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });

  // Add escape key listener
  const handleEscape = (e) => {
    if (e.key === "Escape") {
      document.body.removeChild(modal);
      document.removeEventListener("keydown", handleEscape);
    }
  };
  document.addEventListener("keydown", handleEscape);
}

function resetRoute() {
  // Log the reset operation
  logOperation("reset", {
    clearedPointsCount: routePoints.length,
    clearedSegmentsCount: selectedSegments.length,
  });

  // Track analytics event for route reset
  trackRouteOperation("reset", routePoints, selectedSegments, {
    cleared_points: routePoints.length,
    cleared_segments: selectedSegments.length
  });

  // Save current state for potential undo
  if (selectedSegments.length > 0 || routePoints.length > 0) {
    saveState();
  }

  // Clear RouteManager state first
  if (routeManager) {
    routeManager.clearRoute();
  }

  // Clear selected segments and points
  selectedSegments = [];
  clearRoutePoints();

  // Clear undo/redo stacks
  undoStack = [];
  redoStack = [];

  setRouteNetworkHover(null);
  setRouteNetworkFocus(null);

  // Remove any existing markers
  if (window.hoverMarker) {
    window.hoverMarker.remove();
    window.hoverMarker = null;
  }

  if (window.elevationMarker) {
    window.elevationMarker.remove();
    window.elevationMarker = null;
  }

  if (window.hoverPreviewMarker) {
    window.hoverPreviewMarker.remove();
    window.hoverPreviewMarker = null;
  }

  // Hide segment name display
  const segmentDisplay = document.getElementById("segment-name-display");
  segmentDisplay.style.display = "none";

  // Update UI
  updateRouteListAndDescription();
  updateUndoRedoButtons();
  clearRouteFromUrl(); // Clear route parameter when resetting
}

function updateSegmentStyles() {
  setRouteNetworkHover(null);
  setRouteNetworkFocus(null);

  updateRouteGeometry();

  // Update data marker opacity based on route-triggered data points
  if (map.getLayer("data-markers-layer")) {
    const activeDataPointIds = getRouteDataPoints()
      .filter((dataPoint) => dataPoint.location)
      .map((dataPoint) => dataPoint.id);
    const opacityExpression = [
      "case",
      ["in", ["get", "dataPointId"], ["literal", activeDataPointIds]],
      1.0,
      0.45,
    ];

    map.setPaintProperty(
      "data-markers-layer",
      "icon-opacity",
      opacityExpression,
    );
  }
}

function initMap() {
  try {
    mapboxgl.accessToken = requireMapboxToken();

    map = new mapboxgl.Map({
      container: "map",
      style: "mapbox://styles/mapbox/outdoors-v12",
      center: [35.617497, 33.183536], // Centered on the bike routes area
      zoom: 11.5,
    });

    // Set Hebrew language after map loads
    map.on("load", () => {
      // Try to set Hebrew labels, but handle errors gracefully
      try {
        const layers = ["country-label", "state-label", "settlement-label"];
        layers.forEach((layerId) => {
          if (map.getLayer(layerId)) {
            map.setLayoutProperty(layerId, "text-field", [
              "coalesce",
              ["get", "name_he"],
              ["get", "name"],
            ]);
          }
        });
      } catch (error) {
        console.warn("Could not set Hebrew labels:", error);
      }
      loadKMLFile();
    });

    const isTouchDevice =
      "ontouchstart" in window || navigator.maxTouchPoints > 0;

    // Add global mouse move handler for proximity-based highlighting
    if (!isTouchDevice) {
      let lastCursorState = "default";

      map.on("mousemove", (e) => {
        if (isDraggingPoint || map.isMoving()) {
          return;
        }
        const mousePoint = e.lngLat;
        const mousePixel = map.project(mousePoint);
        const threshold = 15; // pixels
        let closestSegment = null;
        let closestPointOnSegment = null;

        // Use spatial index for efficient segment lookup
        if (spatialIndex) {
          // Convert pixel threshold to approximate degree threshold
          const degreeThreshold = threshold * 0.00005; // Rough conversion
          const candidateSegment = spatialIndex.findNearestSegment(
            mousePoint.lat,
            mousePoint.lng,
            degreeThreshold,
          );

          // Verify the candidate with precise pixel distance if found
          if (candidateSegment) {
            const coords = candidateSegment.coordinates;
            let minPixelDistance = Infinity;
            let bestSegmentStart = null;
            let bestSegmentEnd = null;

            for (let i = 0; i < coords.length - 1; i++) {
              const startPixel = map.project([coords[i].lng, coords[i].lat]);
              const endPixel = map.project([
                coords[i + 1].lng,
                coords[i + 1].lat,
              ]);

              const distance = distanceToLineSegmentPixels(
                mousePixel,
                startPixel,
                endPixel,
              );

              if (distance < minPixelDistance) {
                minPixelDistance = distance;
                bestSegmentStart = coords[i];
                bestSegmentEnd = coords[i + 1];
              }
            }

            if (
              minPixelDistance < threshold &&
              bestSegmentStart &&
              bestSegmentEnd
            ) {
              closestSegment = candidateSegment;
              closestPointOnSegment = getClosestPointOnLineSegment(
                { lat: mousePoint.lat, lng: mousePoint.lng },
                bestSegmentStart,
                bestSegmentEnd,
              );
            }
          }
        }

        // Update cursor only when state changes
        const newCursorState = closestSegment ? "pointer" : "default";
        if (newCursorState !== lastCursorState) {
          map.getCanvas().style.cursor = newCursorState;
          lastCursorState = newCursorState;
        }

        // Highlight closest segment if found
        if (closestSegment) {
          setRouteNetworkHover(closestSegment.segmentName);

          // Show hover preview dot at the closest point on segment
          if (closestPointOnSegment && !isDraggingPoint) {
            // Check if hover point is too close to any existing route points using pixel distance
            const minPixelDistanceFromPoints = 15; // 15 pixels threshold for route points
            const minPixelDistanceFromMarkers = 25; // 25 pixels threshold for data markers
            let tooCloseToExistingPoint = false;

            const hoverPointPixel = map.project([
              closestPointOnSegment.lng,
              closestPointOnSegment.lat,
            ]);

            // Check distance from existing route points
            for (const routePoint of routePoints) {
              const routePointPixel = map.project([
                routePoint.lng,
                routePoint.lat,
              ]);
              const pixelDistance = Math.sqrt(
                Math.pow(hoverPointPixel.x - routePointPixel.x, 2) +
                  Math.pow(hoverPointPixel.y - routePointPixel.y, 2),
              );

              if (pixelDistance < minPixelDistanceFromPoints) {
                tooCloseToExistingPoint = true;
                break;
              }
            }

            // Check distance from data markers if not already too close to route points
            if (!tooCloseToExistingPoint && map.getSource("data-markers")) {
              const markerFeatures = map.queryRenderedFeatures(
                hoverPointPixel,
                {
                  layers: ["data-markers-layer"],
                },
              );

              // If there are any data markers within the pixel threshold, don't show hover point
              if (markerFeatures.length > 0) {
                // Get the actual marker coordinates to check precise distance
                for (const feature of markerFeatures) {
                  const markerCoords = feature.geometry.coordinates;
                  const markerPixel = map.project(markerCoords);
                  const pixelDistance = Math.sqrt(
                    Math.pow(hoverPointPixel.x - markerPixel.x, 2) +
                      Math.pow(hoverPointPixel.y - markerPixel.y, 2),
                  );

                  if (pixelDistance < minPixelDistanceFromMarkers) {
                    tooCloseToExistingPoint = true;
                    break;
                  }
                }
              }
            }

            if (!tooCloseToExistingPoint) {
              // Remove existing hover preview marker
              if (window.hoverPreviewMarker) {
                window.hoverPreviewMarker.remove();
              }

              // Create red circle marker for hover preview
              const el = document.createElement("div");
              el.className = "hover-preview-marker";
              el.style.cssText = `
                width: 10px;
                height: 10px;
                background: ${COLORS.ELEVATION_MARKER};
                border: 2px solid white;
                border-radius: 50%;
                box-shadow: 0 2px 6px rgba(255, 68, 68, 0.4);
                pointer-events: none;
              `;

              window.hoverPreviewMarker = new mapboxgl.Marker(el)
                .setLngLat([
                  closestPointOnSegment.lng,
                  closestPointOnSegment.lat,
                ])
                .addTo(map);
            } else {
              // Remove hover preview marker if too close to existing point
              if (window.hoverPreviewMarker) {
                window.hoverPreviewMarker.remove();
                window.hoverPreviewMarker = null;
              }
            }
          }

          // Show segment info using pre-calculated data
          const name = closestSegment.segmentName;
          const metrics = segmentMetrics[name];
          const segmentDistanceKm = metrics ? metrics.distanceKm : "0.0";
          const segmentElevationGain = metrics
            ? metrics.forward.elevationGain
            : 0;
          const segmentElevationLoss = metrics
            ? metrics.forward.elevationLoss
            : 0;

          const segmentDisplay = document.getElementById(
            "segment-name-display",
          );
          segmentDisplay.innerHTML = `<strong>${name}</strong> <br> 📏 ${segmentDistanceKm} ק"מ • ⬆️ ${segmentElevationGain} מ' • ⬇️ ${segmentElevationLoss} מ'`;

          // Show data points instead of legacy warnings
          const dataPoints = getSegmentDataPoints(name);
          if (dataPoints.length > 0) {
            let segmentDataHTML =
              '<div style="margin-top: 5px; font-size: 12px; background-color: white; padding:5px;">';
            dataPoints.forEach((dataPoint) => {
              segmentDataHTML += `<div style="margin: 2px 0; color: ${COLORS.WARNING_ORANGE}; background-color: white; ">${dataPoint.emoji} ${dataPoint.information}</div>`;
            });
            segmentDataHTML += "</div>";
            segmentDisplay.innerHTML += segmentDataHTML;
          }

          // Check if this segment has been displayed before (track by segment name)
          if (!window.displayedSegmentNames) {
            window.displayedSegmentNames = new Set();
          }

          if (
            window.displayedSegmentNames.size < 10 &&
            !window.displayedSegmentNames.has(closestSegment.segmentName)
          ) {
            window.displayedSegmentNames.add(closestSegment.segmentName);
            segmentDisplay.classList.add("bounce-intro");
            // Remove the bounce class after animation completes
            setTimeout(() => {
              segmentDisplay.classList.remove("bounce-intro");
            }, 600);
          }

          segmentDisplay.style.display = "block";
        } else {
          setRouteNetworkHover(null);

          // No segment close enough - reset cursor and hide display
          const segmentDisplay = document.getElementById(
            "segment-name-display",
          );
          segmentDisplay.style.display = "none";

          // Remove hover preview marker
          if (window.hoverPreviewMarker) {
            window.hoverPreviewMarker.remove();
            window.hoverPreviewMarker = null;
          }
        }
      });
    }

    // 5) Drag handlers (sketch): only preventDefault when dragging is confirmed
    // Example tweak inside your touch drag code:
    let dragStartPx = null;
    let dragging = false;
    const DRAG_THRESHOLD = 6;

    function addPointFromLngLat(clickPoint) {
      // Remove hover preview marker since we're adding the actual point.
      if (window.hoverPreviewMarker) {
        window.hoverPreviewMarker.remove();
        window.hoverPreviewMarker = null;
      }

      addRoutePoint({
        lng: clickPoint.lng,
        lat: clickPoint.lat,
      });
    }

    map.on("touchstart", "route-points-circle", (e) => {
      dragStartPx = e.points && e.points[0];
      dragging = false;
    });

    let tapStartPx = null;

    map.on("touchstart", (e) => {
      if (e.points && e.points.length > 0) {
        tapStartPx = e.points[0];
      }
    });

    map.on("touchend", (e) => {
      if (!isTouchDevice) return;
      if (isDraggingPoint) return; // don't add while dragging
      if (!e.points || e.points.length !== 1) return;

      const endPx = e.points[0];
      const moved = tapStartPx
        ? Math.hypot(endPx.x - tapStartPx.x, endPx.y - tapStartPx.y)
        : 0;
      if (moved > 10) return; // treat as pan/zoom, not a tap

      tapStartPx = null;
      // Check if touch was on a data marker
      const features = map.queryRenderedFeatures(e.point, {
        layers: ["data-markers-layer"],
      });

      if (features.length > 0) {
        // Touch was on a data marker, don't add route point
        return;
      }

      addPointFromLngLat(e.lngLat);
    });

    map.on("touchmove", "route-points-circle", (e) => {
      if (!dragStartPx || !e.points || e.points.length !== 1) return;
      const p = e.points[0];
      if (!dragging) {
        const moved = Math.hypot(p.x - dragStartPx.x, p.y - dragStartPx.y);
        if (moved < DRAG_THRESHOLD) return; // not yet a drag
        dragging = true;
      }
      // Now that it's a real drag, it's safe to prevent default scrolling
      if (e.originalEvent && e.originalEvent.preventDefault)
        e.originalEvent.preventDefault();
    });

    map.on("touchend", "route-points-circle", () => {
      dragging = false;
      dragStartPx = null;
    });

    // Add global click handler for adding route points
    map.on("click", (e) => {
      // Don't add points if we're dragging a point
      if (isDraggingPoint || isTouchDevice) {
        return;
      }

      // Check if click was on a data marker
      const features = map.queryRenderedFeatures(e.point, {
        layers: ["data-markers-layer"],
      });

      if (features.length > 0) {
        // Click was on a data marker, don't add route point
        return;
      }

      addPointFromLngLat(e.lngLat);
    });

    // Map move handlers are no longer needed with custom drag implementation

    // Add context menu handler to prevent browser context menu on map
    map.on("contextmenu", (e) => {
      e.preventDefault();
    });
  } catch (error) {
    document.getElementById("error-message").style.display = "block";
    document.getElementById("error-message").textContent =
      "Error loading map: " + error.message;
  }
}



function shareRoute() {
  const segmentIds = getSegmentIds(selectedSegments);
  const compactRoutePoints = compactRoutePointsForSharing(
    routePoints,
    selectedSegments,
  );
  const shareParamValue =
    compactRoutePoints.length > 0
      ? encodeCompactRoute(compactRoutePoints, segmentIds)
      : encodeRoute(segmentIds);

  if (!shareParamValue) {
    alert("אין מסלול לשיתוף. הוסיפו נקודות על המפה כדי ליצור מסלול.");
    return;
  }

  // Track analytics event for route sharing
  trackRouteOperation("share", routePoints, selectedSegments, {
    route_mode:
      compactRoutePoints.length > 0 ? "compact_route_v3" : "legacy_segments",
    route_id: shareParamValue.substring(0, 10), // First 10 chars for privacy
    route_point_count: routePoints.length,
    compact_route_point_count: compactRoutePoints.length,
    segment_hint_count: segmentIds.length,
  });

  const url = new URL(window.location);
  url.searchParams.delete(ROUTE_URL_PARAM);
  url.searchParams.set(ROUTE_URL_PARAM, shareParamValue);
  const shareUrl = url.toString();

  if (shareUrl.length > SHARE_URL_MAX_LENGTH) {
    alert(
      "המסלול ארוך מדי לקישור שיתוף אמין. אפשר עדיין להוריד GPX, ושמירת מסלולים ארוכים תתווסף בשלב הבא.",
    );
    return;
  }

  // Show share modal
  showShareModal(shareUrl);
}

function compactRoutePointsForSharing(points, targetSegments) {
  if (!routeManager || !Array.isArray(points) || points.length <= 2) {
    return Array.isArray(points) ? points : [];
  }

  const targetCoordinates = getOrderedCoordinates();
  let compactPoints = points.map((point) => ({ ...point }));
  let removedPoint = true;

  while (removedPoint) {
    removedPoint = false;

    for (let index = 1; index < compactPoints.length - 1; index++) {
      const candidatePoints = [
        ...compactPoints.slice(0, index),
        ...compactPoints.slice(index + 1),
      ];

      if (
        routePreviewMatchesTarget(
          candidatePoints,
          targetSegments,
          targetCoordinates,
        )
      ) {
        compactPoints = candidatePoints;
        removedPoint = true;
        break;
      }
    }
  }

  return compactPoints;
}

function routePreviewMatchesTarget(candidatePoints, targetSegments, targetCoordinates) {
  if (!routeManager || typeof routeManager.previewRouteInfo !== "function") {
    return false;
  }

  const preview = routeManager.previewRouteInfo(candidatePoints);
  if (!arraysEqual(preview.segments, targetSegments)) {
    return false;
  }

  if (targetCoordinates.length >= 2 && preview.orderedCoordinates.length >= 2) {
    const targetDistance = calculateCoordinatesDistance(targetCoordinates);
    const previewDistance = calculateCoordinatesDistance(preview.orderedCoordinates);
    const distanceToleranceMeters = 5;

    if (Math.abs(targetDistance - previewDistance) > distanceToleranceMeters) {
      return false;
    }

    const targetStart = targetCoordinates[0];
    const targetEnd = targetCoordinates[targetCoordinates.length - 1];
    const previewStart = preview.orderedCoordinates[0];
    const previewEnd = preview.orderedCoordinates[preview.orderedCoordinates.length - 1];
    const endpointToleranceMeters = 2;

    if (
      getDistance(targetStart, previewStart) > endpointToleranceMeters ||
      getDistance(targetEnd, previewEnd) > endpointToleranceMeters
    ) {
      return false;
    }
  }

  return true;
}

function arraysEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;

  return left.every((value, index) => value === right[index]);
}

function calculateCoordinatesDistance(coordinates) {
  let distance = 0;
  for (let i = 0; i < coordinates.length - 1; i++) {
    distance += getDistance(coordinates[i], coordinates[i + 1]);
  }
  return distance;
}

function showResetModal() {
  // Create modal elements
  const modal = document.createElement("div");
  modal.className = "reset-modal";
  modal.innerHTML = `
    <div class="reset-modal-content">
      <div class="reset-modal-header">
        <h3>🗑️ איפוס מסלול</h3>
      </div>
      <div class="reset-modal-body">
        <p>האם אתה בטוח שברצונך לאפס את המסלול?</p>
        <p class="reset-warning">פעולה זו תמחק את המסלול הנוכחי (${routePoints.length} נקודות, ${selectedSegments.length} קטעי דרך)</p>
        <div class="reset-modal-buttons">
          <button class="reset-confirm-btn">כן, אפס מסלול</button>
          <button class="reset-cancel-btn">ביטול</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Add event listeners
  const confirmBtn = modal.querySelector(".reset-confirm-btn");
  const cancelBtn = modal.querySelector(".reset-cancel-btn");

  confirmBtn.addEventListener("click", () => {
    resetRoute();
    document.body.removeChild(modal);
  });

  cancelBtn.addEventListener("click", () => {
    document.body.removeChild(modal);
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });

  // Add escape key listener
  const handleEscape = (e) => {
    if (e.key === "Escape") {
      document.body.removeChild(modal);
      document.removeEventListener("keydown", handleEscape);
    }
  };
  document.addEventListener("keydown", handleEscape);
}

function showShareModal(shareUrl) {
  // Create modal elements
  const modal = document.createElement("div");
  modal.className = "share-modal";
  modal.innerHTML = `
    <div class="share-modal-content">
      <div class="share-modal-header">
        <h3>שיתוף המסלול</h3>
        <button class="share-modal-close">&times;</button>
      </div>
      <div class="share-modal-body">
        <div class="share-url-container">
          <input type="text" class="share-url-input" value="${shareUrl}" readonly>
          <button class="copy-url-btn">העתק קישור</button>
        </div>
        <div class="share-buttons">
          <button class="share-btn-social twitter" onclick="shareToTwitter('${encodeURIComponent(shareUrl)}')">
            🐦 Twitter
          </button>
          <button class="share-btn-social facebook" onclick="shareToFacebook('${encodeURIComponent(shareUrl)}')">
            📘 Facebook
          </button>
          <button class="share-btn-social whatsapp" onclick="shareToWhatsApp('${encodeURIComponent(shareUrl)}')">
            💬 WhatsApp
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Add event listeners
  const closeBtn = modal.querySelector(".share-modal-close");
  const copyBtn = modal.querySelector(".copy-url-btn");
  const urlInput = modal.querySelector(".share-url-input");

  closeBtn.addEventListener("click", () => {
    document.body.removeChild(modal);
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });

  copyBtn.addEventListener("click", () => {
    urlInput.select();

    // Check if clipboard API is available
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(shareUrl)
        .then(() => {
          copyBtn.textContent = "הועתק!";
          copyBtn.style.background = "#4CAF50";
          setTimeout(() => {
            copyBtn.textContent = "העתק קישור";
            copyBtn.style.background = "#4682B4";
          }, 2000);
        })
        .catch(() => {
          // Fallback to execCommand
          try {
            document.execCommand("copy");
            copyBtn.textContent = "הועתק!";
            copyBtn.style.background = "#4CAF50";
            setTimeout(() => {
              copyBtn.textContent = "העתק קישור";
              copyBtn.style.background = "#4682B4";
            }, 2000);
          } catch (err) {
            console.warn("Copy failed:", err);
            copyBtn.textContent = "העתקה נכשלה";
            copyBtn.style.background = "#f44336";
            setTimeout(() => {
              copyBtn.textContent = "העתק קישור";
              copyBtn.style.background = "#4682B4";
            }, 2000);
          }
        });
    } else {
      // Direct fallback to execCommand if clipboard API not available
      try {
        document.execCommand("copy");
        copyBtn.textContent = "הועתק!";
        copyBtn.style.background = "#4CAF50";
        setTimeout(() => {
          copyBtn.textContent = "העתק קישור";
          copyBtn.style.background = "#4682B4";
        }, 2000);
      } catch (err) {
        console.warn("Copy failed:", err);
        copyBtn.textContent = "העתקה נכשלה";
        copyBtn.style.background = "#f44336";
        setTimeout(() => {
          copyBtn.textContent = "העתק קישור";
          copyBtn.style.background = "#4682B4";
        }, 2000);
      }
    }
  });
}

function shareToTwitter(url) {
  trackSocialShare("twitter", routePoints, selectedSegments);
  const text =
    "בדקו את מסלול הרכיבה e�יצרתי במפת שבילי אופניים - גליל עליון וגולן!";
  window.open(
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${url}`,
    "_blank",
  );
}

function shareToFacebook(url) {
  trackSocialShare("facebook", routePoints, selectedSegments);
  window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, "_blank");
}

function shareToWhatsApp(url) {
  trackSocialShare("whatsapp", routePoints, selectedSegments);
  const text =
    "בדקו את מסלול הרכיבה שיצרתי במפת שבילי אופניים - גליל עליון וגולן!";
  window.open(
    `https://wa.me/?text=${encodeURIComponent(text + " " + decodeURIComponent(url))}`,
    "_blank",
  );
}

function getRouteParameter() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(ROUTE_URL_PARAM);
}

function hasRouteInUrl() {
  return Boolean(getRouteParameter());
}

function applyRoutePoints(points, options = {}) {
  if (!Array.isArray(points) || points.length === 0 || !routeManager) {
    return false;
  }

  clearRoutePoints();
  selectedSegments = [];
  selectedSegments = routeManager.recalculateRoute(points);
  syncRoutePointsFromManager();

  const updateRouteUi = () => {
    updateSegmentStyles();
    updateRouteListAndDescription();
    if (options.focus) {
      focusMapOnRoute();
    }
    hideRouteLoadingIndicator();
  };

  const loaded = routePoints.length > 0;
  const hasRouteGeometry = getOrderedCoordinates().length >= 2;

  if (options.delayMs && hasRouteGeometry) {
    setTimeout(updateRouteUi, options.delayMs);
  } else {
    updateRouteUi();
  }

  return loaded;
}

function loadRouteFromUrl() {
  const routeParam = getRouteParameter();

  if (routeParam && segmentsData) {
    const payload = decodeRoutePayload(routeParam);

    if (payload.type === "compact_route" && payload.routePoints.length > 0) {
      trackRouteOperation("load_route_from_url", [], [], {
        route_payload_version: payload.version,
        route_param_length: routeParam.length,
        points_count: payload.routePoints.length,
        segment_hint_count: payload.segmentIds.length,
      });

      const loaded = applyRoutePoints(payload.routePoints, {
        focus: true,
      });

      if (!loaded) {
        showRoutePointMessage(
          "לא הצלחנו לטעון את המסלול מהקישור. ייתכן שהנקודות רחוקות מדי מרשת CycleWays.",
        );
      }

      return loaded;
    }

    if (payload.type === "legacy_segments" && payload.segmentIds.length > 0) {
      const middlePoints = extractMiddlePoints(payload.segmentIds, segmentsData);

      if (middlePoints.length > 0) {
        trackRouteOperation("load_from_url", [], middlePoints.map(p => p.segmentName), {
          route_payload_version: payload.version,
          route_param_length: routeParam.length,
          points_count: middlePoints.length
        });

        return applyRoutePoints(middlePoints, {
          focus: true,
        });
      }
    }
    hideRouteLoadingIndicator();
  }

  return false;
}

function showRouteLoadingIndicator() {
  if (!hasRouteInUrl()) {
    return;
  }

  // Remove existing indicator if any
  const existing = document.getElementById("route-loading-indicator");
  if (existing) {
    existing.remove();
  }

  const indicator = document.createElement("div");
  indicator.id = "route-loading-indicator";
  indicator.className = "route-loading";
  indicator.innerHTML = "⏳ טוען מסלול...";

  const legendContainer = document.querySelector(".legend-container");
  legendContainer.appendChild(indicator);
}

function hideRouteLoadingIndicator() {
  const indicator = document.getElementById("route-loading-indicator");
  if (indicator) {
    indicator.remove();
  }
}

async function fetchJsonAsset(filePath) {
  const response = await fetch(`./${filePath}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

async function fetchSegmentsData(segmentsFile) {
  try {
    return await fetchJsonAsset(segmentsFile);
  } catch (error) {
    console.warn(`Could not load ${segmentsFile}:`, error);
    return {};
  }
}

async function loadMapAssets() {
  await loadMapManifest();
  const segmentsFile = mapManifest?.segments || DEFAULT_MAP_ASSETS.segments;
  const geoJsonFile = mapManifest?.bikeRoads || DEFAULT_MAP_ASSETS.bikeRoads;
  const [loadedSegmentsData, geoJsonData] = await Promise.all([
    fetchSegmentsData(segmentsFile),
    fetchJsonAsset(geoJsonFile),
  ]);

  segmentsData = loadedSegmentsData;
  return geoJsonData;
}

async function loadMapManifest() {
  if (mapManifest) return mapManifest;

  try {
    const response = await fetch(`./map-manifest.json?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const manifest = await response.json();
    if (!manifest.bikeRoads || !manifest.segments) {
      throw new Error("Manifest is missing map asset paths");
    }
    mapManifest = manifest;
  } catch (error) {
    console.warn("Could not load map-manifest.json, falling back to stable map files:", error);
    mapManifest = { ...DEFAULT_MAP_ASSETS };
  }

  return mapManifest;
}

async function loadKMLFile() {
  try {
    showRouteLoadingIndicator();
    const geoJsonData = await loadMapAssets();
    await parseGeoJSON(geoJsonData);

    await runPostMapDataStartup();
  } catch (error) {
    hideRouteLoadingIndicator();
    document.getElementById("error-message").style.display = "block";
    document.getElementById("error-message").textContent =
      "Error loading GeoJSON file: " + error.message;
  }
}

function waitForMapIdle() {
  return new Promise((resolve) => {
    if (!map || typeof map.once !== "function") {
      resolve();
      return;
    }

    if (typeof map.loaded === "function" && map.loaded()) {
      requestAnimationFrame(resolve);
      return;
    }

    const timeoutId = setTimeout(resolve, 1500);
    map.once("idle", () => {
      clearTimeout(timeoutId);
      resolve();
    });
  });
}

async function runPostMapDataStartup() {
  await waitForMapIdle();
  loadRouteFromUrl();
  showExamplePoint();

  if (typeof initTutorial === "function") {
    initTutorial();
  }
}

async function parseGeoJSON(geoJsonData) {
  try {
    mapDataLoaded = false;

    if (!geoJsonData.features || geoJsonData.features.length === 0) {
      document.getElementById("error-message").style.display = "block";
      document.getElementById("error-message").textContent =
        "No route segments found in the GeoJSON file.";
      return;
    }

    document.getElementById("error-message").style.display = "none";

    clearRouteNetworkLayers();
    routePolylines = [];

    let bounds = new mapboxgl.LngLatBounds();
    const routeNetworkFeatures = [];

    geoJsonData.features.forEach((feature) => {
      if (feature.geometry.type !== "LineString") return;

      const name = feature.properties.name || "Unnamed Route";
      const coordinates = feature.geometry.coordinates;

      // Convert coordinates from [lng, lat, elevation] to {lat, lng, elevation} objects
      const coordObjects = coordinates.map((coord) => ({
        lat: coord[1],
        lng: coord[0],
        elevation: coord[2], // Preserve elevation data if available
      }));

      const originalColor = getRouteFeatureColor(feature);

      // temporarily overriding weight and opacity:
      //let originalWeight = feature.properties['stroke-width'] || 3;
      //let originalOpacity = feature.properties['stroke-opacity'] || 0.8;
      let originalWeight = 3;
      let originalOpacity = 1.0;

      routeNetworkFeatures.push({
        ...feature,
        properties: {
          ...feature.properties,
          name,
          routeColor: originalColor,
          routeWidth: originalWeight,
          routeOpacity: originalOpacity,
        },
      });

      // Store polyline data
      const polylineData = {
        segmentName: name,
        layerId: ROUTE_NETWORK_LINE_LAYER_ID,
        coordinates: coordObjects,
        originalStyle: {
          color: originalColor,
          weight: originalWeight,
          opacity: originalOpacity,
        },
      };
      routePolylines.push(polylineData);

      // Add coordinates to bounds for auto-fitting
      coordinates.forEach((coord) => bounds.extend(coord));
    });

    addRouteNetworkLayers(routeNetworkFeatures);

    // Pre-calculate all segment metrics for fast access
    preCalculateSegmentMetrics();

    // Initialize spatial index and populate it with all segments
    spatialIndex = new SpatialIndex();
    routePolylines.forEach((polylineData) => {
      spatialIndex.addSegment(polylineData);
    });

    // Initialize RouteManager and load data
    routeManager = new RouteManager();
    await routeManager.load(geoJsonData, segmentsData);

    // Initialize data markers
    await initDataMarkers();
    mapDataLoaded = true;

    // Keep map at current position instead of auto-fitting to all segments
    // if (!bounds.isEmpty()) {
    //   map.fitBounds(bounds, { padding: 20 });
    // }
  } catch (error) {
    document.getElementById("error-message").style.display = "block";
    document.getElementById("error-message").textContent =
      "Error parsing GeoJSON file: " + error.message;
  }
}

// Pre-calculate all segment metrics for fast access
function preCalculateSegmentMetrics() {
  segmentMetrics = {};

  routePolylines.forEach((polylineData) => {
    const coords = polylineData.coordinates;
    const segmentName = polylineData.segmentName;

    // Calculate distance
    let distance = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      distance += getDistance(coords[i], coords[i + 1]);
    }

    // Apply elevation smoothing before calculating gains/losses
    const smoothedCoords = smoothElevations(coords, 100);

    // Calculate elevation gains and losses in both directions using smoothed data
    let elevationGainForward = 0;
    let elevationLossForward = 0;
    let elevationGainReverse = 0;
    let elevationLossReverse = 0;

    // Forward direction using smoothed elevations with minimum threshold
    const minElevationChange = 1.0; // Ignore elevation changes smaller than 1 meter

    for (let i = 0; i < smoothedCoords.length - 1; i++) {
      const currentElevation = smoothedCoords[i].elevation;
      const nextElevation = smoothedCoords[i + 1].elevation;

      const elevationChange = nextElevation - currentElevation;

      // Only count elevation changes that meet the minimum threshold
      if (Math.abs(elevationChange) >= minElevationChange) {
        if (elevationChange > 0) {
          elevationGainForward += elevationChange;
        } else {
          elevationLossForward += Math.abs(elevationChange);
        }
      }
    }

    // Reverse direction (just swap the gains and losses)
    elevationGainReverse = elevationLossForward;
    elevationLossReverse = elevationGainForward;

    // Store pre-calculated metrics
    segmentMetrics[segmentName] = {
      distance: distance,
      distanceKm: (distance / 1000).toFixed(1),
      forward: {
        elevationGain: Math.round(elevationGainForward),
        elevationLoss: Math.round(elevationLossForward),
      },
      reverse: {
        elevationGain: Math.round(elevationGainReverse),
        elevationLoss: Math.round(elevationLossReverse),
      },
      startPoint: coords[0],
      endPoint: coords[coords.length - 1],
      smoothedCoords: smoothedCoords, // Store smoothed coordinates for elevation profile
    };
  });
}

// Helper function to find closest point on line segment
function getClosestPointOnLineSegment(point, lineStart, lineEnd) {
  const A = point.lng - lineStart.lng;
  const B = point.lat - lineStart.lat;
  const C = lineEnd.lng - lineStart.lng;
  const D = lineEnd.lat - lineStart.lat;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;
  if (lenSq !== 0) {
    param = dot / lenSq;
  }

  let xx, yy;
  if (param < 0) {
    xx = lineStart.lng;
    yy = lineStart.lat;
  } else if (param > 1) {
    xx = lineEnd.lng;
    yy = lineEnd.lat;
  } else {
    xx = lineStart.lng + param * C;
    yy = lineStart.lat + param * D;
  }

  return { lat: yy, lng: xx };
}

// Function to check if route is continuous and find first broken segment
function checkRouteContinuity() {
  const tolerance = 100; // 100 meters tolerance
  const orderedCoords = getOrderedCoordinates();

  if (orderedCoords.length === 0) {
    return { isContinuous: true, brokenSegmentIndex: -1 };
  }

  if (routePoints.length >= 2) {
    for (let i = 0; i < orderedCoords.length - 1; i++) {
      const distance = getDistance(orderedCoords[i], orderedCoords[i + 1]);
      if (distance > tolerance) {
        return { isContinuous: false, brokenSegmentIndex: -1 };
      }
    }

    return { isContinuous: true, brokenSegmentIndex: -1 };
  }

  if (selectedSegments.length <= 1) {
    return { isContinuous: true, brokenSegmentIndex: -1 };
  }

  // Check gaps in the ordered coordinates by looking at distances between consecutive segments
  let coordIndex = 0;

  for (let i = 0; i < selectedSegments.length - 1; i++) {
    const currentSegmentName = selectedSegments[i];
    const nextSegmentName = selectedSegments[i + 1];

    const currentPolyline = routePolylines.find(
      (p) => p.segmentName === currentSegmentName,
    );
    const nextPolyline = routePolylines.find(
      (p) => p.segmentName === nextSegmentName,
    );

    if (!currentPolyline || !nextPolyline) {
      continue;
    }

    // Find where current segment ends in ordered coordinates
    const currentSegmentLength = currentPolyline.coordinates.length;
    const currentSegmentEndIndex = coordIndex + currentSegmentLength - 1;

    // Check if we have enough coordinates
    if (currentSegmentEndIndex >= orderedCoords.length - 1) {
      return { isContinuous: false, brokenSegmentIndex: i };
    }

    const currentEnd = orderedCoords[currentSegmentEndIndex];
    const nextStart = orderedCoords[currentSegmentEndIndex + 1];

    const distance = getDistance(currentEnd, nextStart);

    // If distance is greater than tolerance, route is broken
    if (distance > tolerance) {
      return { isContinuous: false, brokenSegmentIndex: i };
    }

    // Move to next segment in ordered coordinates
    // Skip first coordinate of next segment if segments are well connected to avoid duplication
    coordIndex += currentSegmentLength;
    if (distance <= 50) {
      // Well connected segments
      coordIndex -= 1; // Account for coordinate that was skipped in getOrderedCoordinates
    }
  }

  return { isContinuous: true, brokenSegmentIndex: -1 };
}

// Function to check if the visible route passes through warning/data points
function hasSegmentWarnings() {
  const warningDataPoints = getRouteDataPoints();
  const warningSegments = [
    ...new Set(warningDataPoints.map((dataPoint) => dataPoint.segmentName)),
  ];

  return {
    hasWarnings: warningDataPoints.length > 0,
    warningSegments: warningSegments,
    warningDataPoints: warningDataPoints,
    count: warningDataPoints.length,
  };
}

// Function to update route warning visibility
function updateRouteWarning() {
  const routeWarning = document.getElementById("route-warning");
  const segmentWarning = document.getElementById("segment-warning");

  const continuityResult = checkRouteContinuity();
  const warningsResult = hasSegmentWarnings();

  // Show broken route warning
  if (selectedSegments.length > 1 && !continuityResult.isContinuous) {
    routeWarning.style.display = "block";
  } else {
    routeWarning.style.display = "none";
  }

  // Show segment warnings indicator with count
  if (warningsResult.hasWarnings) {
    const countText =
      warningsResult.count > 1 ? ` (${warningsResult.count})` : "";
    segmentWarning.innerHTML = `⚠️ מידע חשוב ${countText}`;
    segmentWarning.style.display = "block";
    
    // If individual warnings are currently visible, refresh them
    const individualWarningsContainer = document.getElementById("individual-warnings-container");
    if (individualWarningsContainer && individualWarningsContainer.style.display === "block") {
      createIndividualWarnings(warningsResult.warningDataPoints);
    }
  } else {
    segmentWarning.style.display = "none";
    // Hide individual warnings container when there are no warnings
    const individualWarningsContainer = document.getElementById("individual-warnings-container");
    if (individualWarningsContainer) {
      individualWarningsContainer.style.display = "none";
    }
  }
}

// Function to toggle individual warnings display
async function toggleIndividualWarnings(warningDataPoints) {
  const individualWarningsContainer = document.getElementById("individual-warnings-container");
  
  if (individualWarningsContainer.style.display === "none" || individualWarningsContainer.style.display === "") {
    // Show individual warnings
    await createIndividualWarnings(warningDataPoints);
    individualWarningsContainer.style.display = "block";
  } else {
    // Hide individual warnings
    individualWarningsContainer.style.display = "none";
    individualWarningsContainer.innerHTML = "";
  }
}

// Function to create individual warning divs
async function createIndividualWarnings(warningDataPoints) {
  const individualWarningsContainer = document.getElementById("individual-warnings-container");
  
  // Clear existing warnings
  individualWarningsContainer.innerHTML = "";
  
  const dataPointsBySegment = groupDataPointsBySegment(warningDataPoints);
  
  // Create one div for each segment with warnings
  for (const [segmentName, dataPoints] of dataPointsBySegment) {
    const warningDiv = document.createElement("div");
    warningDiv.className = "individual-warning-item";
    
    // Collect all warning types for this segment
    const segmentWarningTypes = [...new Set(dataPoints.map(dp => dp.type))];
    
    // Create text element (will be centered)
    const textSpan = document.createElement("span");
    textSpan.className = "warning-text";
    
    // Display warning type names or "אזהרות" for multiple types
    if (segmentWarningTypes.length === 1) {
      // Single warning type - show its Hebrew name
      textSpan.textContent = WARNING_TRANSLATIONS[segmentWarningTypes[0]] || segmentWarningTypes[0];
    } else {
      // Multiple warning types - show "אזהרות"
      textSpan.textContent = "אזהרות";
    }
    
    // Create SVG icon container (will be positioned on the right)
    const iconContainer = document.createElement("span");
    iconContainer.className = "warning-icons";
    
    // Load and add SVG icons for each warning type
    for (const type of segmentWarningTypes) {
      const svgPath = WARNING_SVG_ICONS[type];
      if (svgPath) {
        const svgContent = await loadSVGIcon(svgPath);
        if (svgContent) {
          const iconWrapper = document.createElement("span");
          iconWrapper.className = "warning-icon";
          iconWrapper.innerHTML = svgContent;
          iconContainer.appendChild(iconWrapper);
        }
      }
    }
    
    // If no SVG icons could be loaded, fallback to default caution icon
    if (iconContainer.children.length === 0) {
      const fallbackSvg = await loadSVGIcon("icons/caution.svg");
      if (fallbackSvg) {
        const iconWrapper = document.createElement("span");
        iconWrapper.className = "warning-icon";
        iconWrapper.innerHTML = fallbackSvg;
        iconContainer.appendChild(iconWrapper);
      }
    }
    
    warningDiv.appendChild(textSpan);
    warningDiv.appendChild(iconContainer);
    
    // Determine background color based on warning types with priority system
    let backgroundColor;
    if (segmentWarningTypes.length === 1) {
      // Single warning type - use its color
      backgroundColor = WARNING_COLORS[segmentWarningTypes[0]] || "#f44336";
    } else {
      // Multiple warning types - use priority system: severe > narrow > gate > slope > mud > payment > warning
      const priorityOrder = ["severe", "narrow", "gate", "slope", "mud", "payment", "warning"];
      const highestPriority = priorityOrder.find(type => segmentWarningTypes.includes(type));
      backgroundColor = WARNING_COLORS[highestPriority] || "#f44336";
    }
    
    warningDiv.style.backgroundColor = backgroundColor;
    
    // Add click handler to focus on the segment
    warningDiv.addEventListener("click", function() {
      focusOnSegment(segmentName);
    });
    
    individualWarningsContainer.appendChild(warningDiv);
  }
}

// Function to focus on a specific segment
function focusOnSegment(segmentName) {
  const polyline = routePolylines.find((p) => p.segmentName === segmentName);
  if (!polyline) return;

  // Track analytics event for segment focus
  trackSegmentFocus(segmentName, "recommendation_click");

  const coords = polyline.coordinates;
  if (coords.length === 0) return;

  returnToStartingPosition();

  // Show segment details in display
  const metrics = segmentMetrics[segmentName];
  const segmentDistanceKm = metrics ? metrics.distanceKm : "0.0";
  const segmentElevationGain = metrics ? metrics.forward.elevationGain : 0;
  const segmentElevationLoss = metrics ? metrics.forward.elevationLoss : 0;

  const segmentDisplay = document.getElementById("segment-name-display");
  segmentDisplay.innerHTML = `<strong>${segmentName}</strong> ${getSegmentQualityBadge(segmentName)} <br> 📏 ${segmentDistanceKm} ק"מ • ⬆️ ${segmentElevationGain} מ' • ⬇️ ${segmentElevationLoss} מ'`;

  // Show data points instead of legacy warnings
  const dataPoints = getSegmentDataPoints(segmentName);
  if (dataPoints.length > 0) {
    segmentDisplay.innerHTML +=
      '<div style="margin-top: 5px; font-size: 12px;">';
    dataPoints.forEach((dataPoint) => {
      segmentDisplay.innerHTML += `<div style="margin: 2px 0; color: ${COLORS.WARNING_ORANGE};">${dataPoint.emoji} ${dataPoint.information}</div>`;
    });
    segmentDisplay.innerHTML += "</div>";
  }

  // Keep legacy warnings as fallback
  const segmentInfo = segmentsData[segmentName];
  if (segmentInfo && dataPoints.length === 0) {
    if (segmentInfo.warning) {
      segmentDisplay.innerHTML += `<div style="color: ${COLORS.WARNING_RED}; font-size: 12px; margin-top: 5px;">⚠️ ${segmentInfo.warning}</div>`;
    }
  }

  segmentDisplay.style.display = "block";

  // Calculate bounds for the segment
  let minLat = coords[0].lat,
    maxLat = coords[0].lat;
  let minLng = coords[0].lng,
    maxLng = coords[0].lng;

  coords.forEach((coord) => {
    minLat = Math.min(minLat, coord.lat);
    maxLat = Math.max(maxLat, coord.lat);
    minLng = Math.min(minLng, coord.lng);
    maxLng = Math.max(maxLng, coord.lng);
  });

  // Add some padding around the segment
  const latPadding = (maxLat - minLat) * 0.3 || 0.005;
  const lngPadding = (maxLng - minLng) * 0.3 || 0.005;

  const bounds = new mapboxgl.LngLatBounds(
    [minLng - lngPadding, minLat - latPadding],
    [maxLng + lngPadding, maxLat + latPadding],
  );

  // Zoom to fit the segment bounds with minimum zoom limit
  map.fitBounds(bounds, {
    padding: 50,
    duration: 1000,
    maxZoom: MIN_ZOOM_LEVEL,
  });

  // Highlight the segment after a short delay to allow map to zoom
  setTimeout(() => {
    let blinkCount = 0;
    const maxBlinks = 4; // 2 complete blinks (on-off-on-off)

    const blinkInterval = setInterval(() => {
      setRouteNetworkFocus(segmentName, blinkCount % 2 === 0);

      blinkCount++;

      // Stop blinking after maxBlinks and ensure final state is correct
      if (blinkCount >= maxBlinks) {
        clearInterval(blinkInterval);
        setRouteNetworkFocus(null);
        updateRouteGeometry();
      }
    }, 250); // 250ms intervals = 4 blinks in 1 second
  }, 200);
}

// Function to focus map on the entire selected route
function focusMapOnRoute() {
  const orderedCoords = getOrderedCoordinates();
  if (orderedCoords.length === 0) {
    return;
  }

  let bounds = new mapboxgl.LngLatBounds();
  orderedCoords.forEach((coord) => {
    bounds.extend([coord.lng, coord.lat]);
  });

  if (!bounds.isEmpty()) {
    // Zoom to fit the route bounds with padding
    map.fitBounds(bounds, {
      padding: 80,
      duration: 1500,
      maxZoom: 14, // Don't zoom in too much for long routes
    });
  }
}

// Function to load route from encoding and select segments (with undo stack management)
function loadRouteFromEncoding(routeEncoding) {
  if (!routeEncoding || !segmentsData) {
    console.warn("Invalid route encoding or segments data not loaded");
    return false;
  }

  try {
    const payload = decodeRoutePayload(routeEncoding);
    if (payload.type === "compact_route" && payload.routePoints.length > 0) {
      if (selectedSegments.length > 0 || routePoints.length > 0) {
        saveState();
      }

      return applyRoutePoints(payload.routePoints, {
        focus: true,
        delayMs: 200,
      });
    }

    const segmentIds = payload.segmentIds;
    if (segmentIds.length === 0) {
      console.warn("No segment IDs decoded from route encoding");
      return false;
    }

    // Extract middle points from segments
    const middlePoints = extractMiddlePoints(segmentIds, segmentsData);
    
    if (middlePoints.length === 0) {
      console.warn("No middle points found for segments");
      return false;
    }

    // Save current state for undo if there are currently selected segments or points
    if (selectedSegments.length > 0 || routePoints.length > 0) {
      saveState();
    }

    // Clear existing selections and route points
    selectedSegments = [];
    routePoints = [];

    setRouteNetworkHover(null);
    setRouteNetworkFocus(null);

    if (!applyRoutePoints(middlePoints)) {
      return false;
    }

    updateUndoRedoButtons();

    // Focus map on the loaded route
    setTimeout(() => {
      focusMapOnRoute();
    }, 200);

    return true;
  } catch (error) {
    console.error("Error loading route from encoding:", error);
    return false;
  }
}

// Function to order coordinates based on route connectivity
function getOrderedCoordinates() {
  if (routeManager) {
    return getRouteGeometryCoordinates();
  }

  if (selectedSegments.length === 0) {
    return [];
  }

  let orderedCoords = [];

  for (let i = 0; i < selectedSegments.length; i++) {
    const segmentName = selectedSegments[i];
    const polyline = routePolylines.find((p) => p.segmentName === segmentName);

    if (!polyline) {
      continue;
    }

    let coords = [...polyline.coordinates];

    // For the first segment, check if we need to orient it correctly
    if (i === 0) {
      // If there's a second segment, orient the first segment to connect better
      if (selectedSegments.length > 1) {
        const nextSegmentName = selectedSegments[1];
        const nextPolyline = routePolylines.find(
          (p) => p.segmentName === nextSegmentName,
        );

        if (nextPolyline) {
          const nextCoords = nextPolyline.coordinates;
          const firstStart = coords[0];
          const firstEnd = coords[coords.length - 1];
          const nextStart = nextCoords[0];
          const nextEnd = nextCoords[nextCoords.length - 1];

          // Calculate all possible connection distances
          const distances = [
            getDistance(firstEnd, nextStart), // first end to next start
            getDistance(firstEnd, nextEnd), // first end to next end
            getDistance(firstStart, nextStart), // first start to next start
            getDistance(firstStart, nextEnd), // first start to next end
          ];

          const minDistance = Math.min(...distances);
          const minIndex = distances.indexOf(minDistance);

          // If the best connection is from first start, reverse the first segment
          if (minIndex === 2 || minIndex === 3) {
            coords.reverse();
          }
        }
      }
      orderedCoords = [...coords];
    } else {
      // For subsequent segments, determine which end connects better
      const lastPoint = orderedCoords[orderedCoords.length - 1];
      const segmentStart = coords[0];
      const segmentEnd = coords[coords.length - 1];

      const distanceToStart = getDistance(lastPoint, segmentStart);
      const distanceToEnd = getDistance(lastPoint, segmentEnd);

      // If the end is closer, reverse the coordinates
      if (distanceToEnd < distanceToStart) {
        coords.reverse();
      }

      // Add coordinates with better duplication handling
      const firstPoint = coords[0];
      const connectionDistance = getDistance(lastPoint, firstPoint);

      // If segments are well connected (within 50 meters), skip first point to avoid duplication
      // If segments are far apart (gap > 50 meters), include all points to show the gap
      if (connectionDistance <= 50) {
        orderedCoords.push(...coords.slice(1));
      } else {
        orderedCoords.push(...coords);
      }
    }
  }

  return orderedCoords;
}

// Function to generate elevation profile
// TODO: Move generate elevation profile to use data in elevations.js
function generateElevationProfile() {
  const orderedCoords = getOrderedCoordinates();
  if (orderedCoords.length === 0) return "";

  let elevationHtml = '<div class="elevation-profile">';
  elevationHtml += "<h4>גרף גובה (Elevation Profile)</h4>";
  elevationHtml +=
    '<div class="elevation-chart" id="elevation-chart" style="position: relative;">';

  const totalDistance = orderedCoords.reduce((total, coord, index) => {
    if (index === 0) return 0;
    return total + getDistance(orderedCoords[index - 1], coord);
  }, 0);

  if (totalDistance === 0) {
    elevationHtml += "</div></div>";
    return elevationHtml;
  }

  // Create continuous elevation profile with interpolation
  const profileWidth = 300; // pixels
  const elevationData = [];

  // First, apply smoothing to the entire route coordinates and calculate elevation for all coordinates
  const routeWithElevation = orderedCoords.map((coord) => {
    let elevation;
    if (coord.elevation !== undefined) {
      elevation = coord.elevation;
    } else {
      // Fallback: calculate elevation based on position (simulated)
      elevation =
        200 + Math.sin(coord.lat * 10) * 100 + Math.cos(coord.lng * 8) * 50;
    }
    return { ...coord, elevation };
  });

  // Apply smoothing to the entire route
  const smoothedRouteCoords = smoothElevations(routeWithElevation, 100); // Slightly larger window for route-level smoothing

  const coordsWithElevation = smoothedRouteCoords.map((coord, index) => {
    const distance =
      index === 0
        ? 0
        : smoothedRouteCoords.slice(0, index + 1).reduce((total, c, idx) => {
            if (idx === 0) return 0;
            return total + getDistance(smoothedRouteCoords[idx - 1], c);
          }, 0);
    return { ...coord, distance };
  });

  // Find min/max elevation
  let minElevation = Math.min(...coordsWithElevation.map((c) => c.elevation));
  let maxElevation = Math.max(...coordsWithElevation.map((c) => c.elevation));
  const elevationRange = maxElevation - minElevation || 100;

  // Create continuous profile by interpolating between points
  for (let x = 0; x <= profileWidth; x++) {
    const distanceAtX = (x / profileWidth) * totalDistance;

    // Find the two closest points to interpolate between
    let beforePoint = null;
    let afterPoint = null;

    for (let i = 0; i < coordsWithElevation.length - 1; i++) {
      if (
        coordsWithElevation[i].distance <= distanceAtX &&
        coordsWithElevation[i + 1].distance >= distanceAtX
      ) {
        beforePoint = coordsWithElevation[i];
        afterPoint = coordsWithElevation[i + 1];
        break;
      }
    }

    let elevation, coord;
    if (beforePoint && afterPoint && beforePoint !== afterPoint) {
      // Interpolate elevation and coordinates
      const ratio =
        (distanceAtX - beforePoint.distance) /
        (afterPoint.distance - beforePoint.distance);
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
      ((elevation - minElevation) / elevationRange) * 80 + 10,
    );
    const distancePercent = (x / profileWidth) * 100;

    elevationData.push({
      elevation,
      distance: distanceAtX,
      coord,
      heightPercent,
      distancePercent,
      pixelX: x,
    });
  }

  // Create continuous elevation profile using SVG path
  let pathData = "";
  elevationData.forEach((point, index) => {
    const x = point.distancePercent;
    const y = 100 - point.heightPercent; // Flip Y coordinate for SVG

    if (index === 0) {
      pathData += `M ${x} ${y}`;
    } else {
      pathData += ` L ${x} ${y}`;
    }
  });

  // Close the path to create a filled area
  pathData += ` L 100 100 L 0 100 Z`;

  // Add SVG for continuous elevation profile with proper viewBox
  elevationHtml += `
    <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style="position: absolute; top: 0; left: 0;">
      <defs>
        <linearGradient id="elevationGradient" x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" style="stop-color:#748873;stop-opacity:1" />
          <stop offset="33%" style="stop-color:#D1A980;stop-opacity:1" />
          <stop offset="66%" style="stop-color:#E5E0D8;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#F8F8F8;stop-opacity:1" />
        </linearGradient>
      </defs>
      <path d="${pathData}" fill="url(#elevationGradient)" stroke="#748873" stroke-width="0.5"/>
    </svg>
  `;

  // Add invisible hover overlay that covers the entire height
  elevationHtml +=
    '<div class="elevation-hover-overlay" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; cursor: pointer;"></div>';

  elevationHtml += "</div>";
  elevationHtml += '<div class="elevation-labels">';
  elevationHtml += `<span class="distance-label">${(totalDistance / 1000).toFixed(1)} ק"מ</span>`;
  elevationHtml += '<span class="distance-label">0 ק"מ</span>';
  elevationHtml += "</div>";
  elevationHtml += "</div>";

  // Store elevation data globally for hover functionality
  window.currentElevationData = elevationData;
  window.currentTotalDistance = totalDistance;

  return elevationHtml;
}

function calculateRouteGeometryStats() {
  const orderedCoords = getOrderedCoordinates();
  let distance = 0;
  let elevationGain = 0;
  let elevationLoss = 0;

  for (let i = 0; i < orderedCoords.length - 1; i++) {
    const current = orderedCoords[i];
    const next = orderedCoords[i + 1];
    distance += getDistance(current, next);

    const currentElevation = Number(current.elevation);
    const nextElevation = Number(next.elevation);
    if (Number.isFinite(currentElevation) && Number.isFinite(nextElevation)) {
      const diff = nextElevation - currentElevation;
      if (diff > 0) {
        elevationGain += diff;
      } else {
        elevationLoss += Math.abs(diff);
      }
    }
  }

  return {
    distance,
    elevationGain: Math.round(elevationGain),
    elevationLoss: Math.round(elevationLoss),
  };
}

function updateRouteListAndDescription() {
  const routeDescription = document.getElementById("route-description");
  const downloadButton = document.getElementById("download-gpx");
  const descriptionPanel = document.getElementById("route-description-panel");

  if (selectedSegments.length === 0 && routePoints.length === 0) {
    routeDescription.innerHTML =
      "לחץ על נקודות במפה ליד שבילי CycleWays כדי לבנות מסלול.";
    downloadButton.disabled = true;
    updateRouteWarning();
    updateUndoRedoButtons(); // Update reset button state
    descriptionPanel.style.display = "none"; // Hide description panel
    return;
  } else {
    descriptionPanel.style.display = "block"; // Ensure description panel is visible when segments are selected
  }

  if (routePoints.length === 1) {
    routeDescription.innerHTML =
      "נקודת התחלה נוספה. הוסף נקודה נוספת כדי ליצור מסלול.";
    downloadButton.disabled = true;
    updateRouteWarning();
    updateUndoRedoButtons();
    return;
  }

  const routeStats = calculateRouteGeometryStats();
  const totalDistance = routeStats.distance;
  const totalElevationGain = routeStats.elevationGain;
  const totalElevationLoss = routeStats.elevationLoss;
  if (getOrderedCoordinates().length < 2) {
    routeDescription.innerHTML =
      "לא הצלחנו ליצור מסלול בין הנקודות האלה על רשת CycleWays.";
    downloadButton.disabled = true;
    updateRouteWarning();
    updateUndoRedoButtons();
    return;
  }

  const totalDistanceKm = (totalDistance / 1000).toFixed(1);

  const elevationProfile = generateElevationProfile();

  routeDescription.innerHTML = `
    <strong>מרחק:</strong> ${totalDistanceKm} ק"מ • <strong>⬆️</strong> ${totalElevationGain} מ' • <strong>⬇️</strong> ${totalElevationLoss} מ'
    ${elevationProfile}
  `;

  downloadButton.disabled = false;
  updateRouteWarning();
  updateUndoRedoButtons(); // Update reset button state

  // Add elevation profile hover functionality after DOM is updated
  setTimeout(() => {
    const elevationOverlay = document.querySelector(".elevation-hover-overlay");
    if (elevationOverlay && window.currentElevationData) {
      // Common function to handle both mouse and touch events
      const handleElevationInteraction = (clientX) => {
        const rect = elevationOverlay.getBoundingClientRect();
        const x = clientX - rect.left;
        const xPercent = (x / rect.width) * 100;

        // Find closest elevation data point
        let closestPoint = null;
        let minDistance = Infinity;

        window.currentElevationData.forEach((point) => {
          const distance = Math.abs(point.distancePercent - xPercent);
          if (distance < minDistance) {
            minDistance = distance;
            closestPoint = point;
          }
        });

        if (closestPoint) {
          // Remove existing elevation marker if any
          if (window.elevationMarker) {
            window.elevationMarker.remove();
          }

          // Create red circle marker
          const el = document.createElement("div");
          el.className = "elevation-marker";
          el.style.cssText = `
            width: 16px;
            height: 16px;
            background: ${COLORS.ELEVATION_MARKER};
            border: 3px solid white;
            border-radius: 50%;
            box-shadow: 0 2px 8px rgba(255, 0, 0, 0.6);
            cursor: pointer;
          `;

          window.elevationMarker = new mapboxgl.Marker(el)
            .setLngLat([closestPoint.coord.lng, closestPoint.coord.lat])
            .addTo(map);

          // Update segment display with elevation info
          const segmentDisplay = document.getElementById(
            "segment-name-display",
          );
          segmentDisplay.innerHTML = `📍 מרחק: ${(closestPoint.distance / 1000).toFixed(1)} km • גובה: ${Math.round(closestPoint.elevation)} m`;
          segmentDisplay.style.display = "block";
        }
      };

      const handleElevationLeave = () => {
        // Remove elevation marker
        if (window.elevationMarker) {
          window.elevationMarker.remove();
          window.elevationMarker = null;
        }

        // Hide segment display
        const segmentDisplay = document.getElementById("segment-name-display");
        segmentDisplay.style.display = "none";
      };

      // Mouse events for desktop
      elevationOverlay.addEventListener("mousemove", (e) => {
        handleElevationInteraction(e.clientX);
      });

      elevationOverlay.addEventListener("mouseleave", handleElevationLeave);

      // Touch events for mobile
      elevationOverlay.addEventListener("touchstart", (e) => {
        e.preventDefault(); // Prevent scrolling
        const touch = e.touches[0];
        handleElevationInteraction(touch.clientX);
      });

      elevationOverlay.addEventListener("touchmove", (e) => {
        e.preventDefault(); // Prevent scrolling
        const touch = e.touches[0];
        handleElevationInteraction(touch.clientX);
      });

      elevationOverlay.addEventListener("touchend", (e) => {
        e.preventDefault();
        // Don't hide immediately on touch end to allow viewing
        // Instead, hide after a delay
        setTimeout(handleElevationLeave, 2000);
      });

      elevationOverlay.addEventListener("touchcancel", (e) => {
        e.preventDefault();
        handleElevationLeave();
      });
    }
  }, 100);
}

function removeSegment(segmentName) {
  const index = selectedSegments.indexOf(segmentName);
  if (index > -1) {
    saveState();
    selectedSegments.splice(index, 1);

    setRouteNetworkHover(null);
    setRouteNetworkFocus(null);

    updateSegmentStyles();
    updateRouteListAndDescription();
    updateRouteWarning(); // Ensure warnings are updated after removal
    clearRouteFromUrl(); // Clear route parameter when removing segments
  }
}

// Function to calculate bounding box of all segments
function getSegmentsBoundingBox() {
  if (!routePolylines || routePolylines.length === 0) {
    return null;
  }

  let minLat = Infinity,
    maxLat = -Infinity;
  let minLng = Infinity,
    maxLng = -Infinity;

  routePolylines.forEach((polylineData) => {
    polylineData.coordinates.forEach((coord) => {
      minLat = Math.min(minLat, coord.lat);
      maxLat = Math.max(maxLat, coord.lat);
      minLng = Math.min(minLng, coord.lng);
      maxLng = Math.max(maxLng, coord.lng);
    });
  });

  // Extend by approximately 5km (roughly 0.045 degrees)
  const extension = 0.045;

  return {
    minLat: minLat - extension,
    maxLat: maxLat + extension,
    minLng: minLng - extension,
    maxLng: maxLng + extension,
  };
}

// Function to check if point is within bounding box
function isPointWithinBounds(lat, lng, bounds) {
  return (
    lat >= bounds.minLat &&
    lat <= bounds.maxLat &&
    lng >= bounds.minLng &&
    lng <= bounds.maxLng
  );
}

// Function to zoom out and show all segments
function zoomToShowAllSegments() {
  if (!routePolylines || routePolylines.length === 0) {
    return;
  }

  let bounds = new mapboxgl.LngLatBounds();

  // Add all segment coordinates to bounds
  routePolylines.forEach((polylineData) => {
    polylineData.coordinates.forEach((coord) => {
      bounds.extend([coord.lng, coord.lat]);
    });
  });

  if (!bounds.isEmpty()) {
    map.fitBounds(bounds, {
      padding: 50,
      duration: 1000,
    });
  }
}

// Function to show location warning modal
function showLocationWarningModal() {
  const modal = document.createElement("div");
  modal.className = "location-warning-modal";
  modal.innerHTML = `
    <div class="location-warning-modal-content">
      <div class="location-warning-modal-header">
        <h3>⚠️ מיקום מחוץ לאזור המפה</h3>
        <button class="location-warning-modal-close">&times;</button>
      </div>
      <div class="location-warning-modal-body">
        <p>אין לנו עדיין שבילים במפה במקום זה</p>
        <p>המפה מכסה כרגע את אזור הגליל העליון והגולן בלבד</p>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Add event listeners
  const closeBtn = modal.querySelector(".location-warning-modal-close");

  closeBtn.addEventListener("click", () => {
    document.body.removeChild(modal);
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });

  // Add escape key listener
  const handleEscape = (e) => {
    if (e.key === "Escape") {
      document.body.removeChild(modal);
      document.removeEventListener("keydown", handleEscape);
    }
  };
  document.addEventListener("keydown", handleEscape);
}

// Search functionality
function searchLocation() {
  const searchInput = document.getElementById("location-search");
  const searchError = document.getElementById("search-error");
  const query = searchInput.value.trim();

  if (!query) {
    searchError.textContent = "נא להכניס מיקום לחיפוש";
    searchError.style.display = "block";
    return;
  }

  // Track analytics event for search
  trackSearchEvent(query, routePoints, selectedSegments);

  searchError.style.display = "none";

  // Use Nominatim (OpenStreetMap) geocoding service
  const geocodeUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;

  fetch(geocodeUrl)
    .then((response) => response.json())
    .then((data) => {
      if (data && data.length > 0) {
        const result = data[0];
        const lat = parseFloat(result.lat);
        const lon = parseFloat(result.lon);

        // Check if the location is within our segments bounding box
        const bounds = getSegmentsBoundingBox();
        if (bounds && !isPointWithinBounds(lat, lon, bounds)) {
          // Zoom out to show all segments before showing warning
          zoomToShowAllSegments();

          // Show warning after a brief delay to allow zoom animation
          setTimeout(() => {
            showLocationWarningModal();
          }, 500);

          searchInput.value = "";
          return;
        }

        // Add a temporary marker and circle to highlight the searched location
        const highlightSearchedLocation = () => {
          // Remove any existing search highlight
          if (window.searchHighlightMarker) {
            window.searchHighlightMarker.remove();
          }
          if (map.getSource("search-highlight-circle")) {
            map.removeLayer("search-highlight-circle");
            map.removeSource("search-highlight-circle");
          }

          // Create a pulsing marker element
          const markerElement = document.createElement("div");
          markerElement.className = "search-location-marker";
          markerElement.style.cssText = `
            width: 20px;
            height: 20px;
            background: #ff4444;
            border: 3px solid white;
            border-radius: 50%;
            box-shadow: 0 2px 8px rgba(255, 68, 68, 0.6);
            animation: searchPulse 2s infinite;
            z-index: 1000;
          `;

          // Add the marker to the map
          window.searchHighlightMarker = new mapboxgl.Marker(markerElement)
            .setLngLat([lon, lat])
            .addTo(map);

          // Add a circle around the location
          map.addSource("search-highlight-circle", {
            type: "geojson",
            data: {
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [lon, lat],
              },
            },
          });

          map.addLayer({
            id: "search-highlight-circle",
            type: "circle",
            source: "search-highlight-circle",
            paint: {
              "circle-radius": {
                base: 1.75,
                stops: [
                  [12, 30],
                  [22, 180],
                ],
              },
              "circle-color": "#ff4444",
              "circle-opacity": 0.2,
              "circle-stroke-width": 2,
              "circle-stroke-color": "#ff4444",
              "circle-stroke-opacity": 0.8,
            },
          });

          // Remove the highlight after 4 seconds
          setTimeout(() => {
            if (window.searchHighlightMarker) {
              window.searchHighlightMarker.remove();
              window.searchHighlightMarker = null;
            }
            if (map.getSource("search-highlight-circle")) {
              map.removeLayer("search-highlight-circle");
              map.removeSource("search-highlight-circle");
            }
          }, 1500);
        };

        // Pan to the location and then add highlight
        map.flyTo({
          center: [lon, lat],
          zoom: 11.5,
          duration: 1000,
        });

        // Add highlight after the animation completes
        setTimeout(highlightSearchedLocation, 1200);

        // Track successful search
        trackSearchEvent(query, routePoints, selectedSegments, true, {
          lat: lat,
          lng: lon,
          within_bounds: bounds && isPointWithinBounds(lat, lon, bounds)
        });

        searchInput.value = "";
      } else {
        searchError.textContent = "מיקום לא נמצא. נא לנסות מונח חיפוש אחר.";
        searchError.style.display = "block";
      }
    })
    .catch((error) => {
      console.error("Search error:", error);
      searchError.textContent = "שגיאה בחיפוש מיקום. נא לנסות שוב.";
      searchError.style.display = "block";
    });
}

// Function to show example point with tooltip
function showExamplePoint() {
  // Don't show if user already has segments selected or if tutorial is active
  if (
    selectedSegments.length > 0 ||
    routePoints.length > 0 ||
    hasRouteInUrl() ||
    (window.tutorial && window.tutorial.isActive)
  ) {
    return;
  }

  const exampleLat = 33.185714;
  const exampleLng = 35.614232;

  // Create example point marker
  const exampleElement = document.createElement("div");
  exampleElement.className = "example-point";
  exampleElement.style.cssText = `
    width: 12px;
    height: 12px;
    background: #ff4444;
    border: 3px solid white;
    border-radius: 50%;
    box-shadow: 0 2px 8px rgba(255, 68, 68, 0.6);
    cursor: pointer;
    animation: pulse 1.5s infinite;
    display:none;
  `;

  const exampleMarker = new mapboxgl.Marker(exampleElement)
    .setLngLat([exampleLng, exampleLat])
    .addTo(map);

  // Create tooltip
  const tooltip = document.createElement("div");
  tooltip.className = "example-tooltip";
  tooltip.innerHTML = "לחץ להוספה <br>למסלול";
  tooltip.style.cssText = `
    position: absolute;
    background: white;
    color: black;
    font-weight: bold;
    padding: 4px 6px;
    border: 2px solid red;
    border-radius: 4px;
    font-size: 12px;
    white-space: nowrap;
    pointer-events: none;
    z-index: 1000;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    animation: tooltipBounce 1s ease-in-out infinite alternate;
    display: none;
  `;

  // Create arrow pointing down to the example point using inline SVG
  const arrow = document.createElement("div");
  arrow.className = "example-arrow";

  arrow.style.cssText = `
    position: absolute;
    width: 32px;
    height: 32px;
    z-index: 999;
    pointer-events: none;
    filter: drop-shadow(0 0 2px white);
    transform: rotate(-20deg);
    animation: tooltipBounce 1s ease-in-out infinite alternate;
    display: none;
  `;

  document.body.appendChild(arrow);
  document.body.appendChild(tooltip);

  // Position tooltip and arrow relative to the marker
  const updateTooltipPosition = () => {
    const rect = exampleElement.getBoundingClientRect();

    // Position tooltip above and to the left of the point (lowered to make room for arrow)
    tooltip.style.left = rect.left - 90 + "px";
    tooltip.style.top = rect.top - 18 + "px";

    // Position arrow above the tooltip pointing down to marker
    arrow.style.left = rect.left - 24 + "px";
    arrow.style.top = rect.top - 50 + "px";
  };

  // Function to show both tooltip and arrow together
  const showTooltipAndArrow = () => {
    if (selectedSegments.length > 0 || routePoints.length > 0 || hasRouteInUrl()) {
      removeExample();
      return;
    }

    exampleElement.style.display = "";
    updateTooltipPosition();
    arrow.style.display = "";
    tooltip.style.display = "";
  };

  // Wait for SVG to load before showing anything
  fetch("icons/arrow.svg")
    .then((response) => response.text())
    .then((svgContent) => {
      arrow.innerHTML = svgContent;
      // Show both elements together after SVG is loaded
      showTooltipAndArrow();
    })
    .catch((error) => {
      console.warn("Could not load arrow SVG:", error);
      // Fallback to a simple arrow if SVG fails to load
      arrow.innerHTML = "↓";
      arrow.style.fontSize = "24px";
      arrow.style.color = "#ff4444";
      // Show both elements together even with fallback
      showTooltipAndArrow();
    });

  // Update position when map moves
  const updatePositionHandler = () => {
    if (tooltip.style.display !== "none" && arrow.style.display !== "none") {
      updateTooltipPosition();
    }
  };
  map.on("move", updatePositionHandler);

  // Remove example after 2 seconds or on mouse move
  const removeExample = () => {
    if (exampleMarker) {
      exampleMarker.remove();
    }
    if (tooltip && tooltip.parentNode) {
      tooltip.parentNode.removeChild(tooltip);
    }
    if (arrow && arrow.parentNode) {
      arrow.parentNode.removeChild(arrow);
    }
    map.off("move", updatePositionHandler);
  };

  // Remove after 2 seconds
  setTimeout(removeExample, 4000);
}

// Function to scroll to top of page
function returnToStartingPosition() {
  // Clear URL hash
  if (window.location.hash) {
    history.pushState(
      null,
      null,
      window.location.pathname + window.location.search,
    );
  }

  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
}

function showDownloadModal() {
  // Create modal elements
  const modal = document.createElement("div");
  const routeDataPoints = getRouteDataPoints();
  const routeDataPointsBySegment = groupDataPointsBySegment(routeDataPoints);

  modal.className = "download-modal";
  modal.innerHTML = `
    <div class="download-modal-content">
      <div class="download-modal-header">
        <h3>הורדת מסלול GPX</h3>
        <button class="download-modal-close">&times;</button>
      </div>
      <div class="download-modal-body">
        <h4>נקודות המסלול</h4>
        <div id="route-points-summary"></div>

        <h4>דרך המסלול</h4>
        <div id="route-segments-list"></div>

        <h4>מידע חשוב על המסלול</h4>
        <div id="route-data-summary"></div>

        <h4>תיאור המסלול</h4>
        <div id="download-route-description"></div>

        <div class="download-modal-actions">
          <button id="download-gpx-final" class="download-confirm-btn">📥 הורדת GPX</button>
          <button id="share-route-modal" class="share-final-btn" title="שיתוף מסלול">🔗 שיתוף מסלול</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Populate route points summary
  const routePointsSummary = modal.querySelector("#route-points-summary");
  routePointsSummary.innerHTML = `
    <p style="color: #333; margin: 0 0 12px;">${routePoints.length} נקודות במסלול</p>
  `;

  // Populate route segments list
  const routeSegmentsList = modal.querySelector("#route-segments-list");
  if (selectedSegments.length === 0) {
    routeSegmentsList.innerHTML =
      '<p style="color: #666; font-style: italic;">עדיין אין דרך במסלול</p>';
  } else {
    let segmentsHtml = '<div class="modal-route-list">';
    selectedSegments.forEach((segmentName, index) => {
      segmentsHtml += `
        <div class="modal-segment-item">
          <span><strong>${index + 1}.</strong> ${segmentName} ${getSegmentQualityBadge(segmentName)}</span>
      `;

      // Add data points for each segment
      const dataPoints = routeDataPointsBySegment.get(segmentName) || [];
      if (dataPoints.length > 0) {
        dataPoints.forEach((dataPoint) => {
          segmentsHtml += `
            <div style="color: #ff9800; font-size: 12px; margin-top: 5px; margin-right: 20px;">
              ${dataPoint.emoji} ${dataPoint.information}
            </div>
          `;
        });
      }

      segmentsHtml += "</div>";
    });
    segmentsHtml += "</div>";
    routeSegmentsList.innerHTML = segmentsHtml;
  }

  // Populate route data summary
  const routeDataSummary = modal.querySelector("#route-data-summary");
  const allDataPoints = [];
  routeDataPoints.forEach((dataPoint) => {
    if (!allDataPoints.some((existing) => existing.id === dataPoint.id)) {
      allDataPoints.push(dataPoint);
    }
  });

  if (allDataPoints.length > 0) {
    let dataSummaryHtml =
      '<div style="background: #f5f5f5; padding: 10px; border-radius: 8px; margin-bottom: 15px;">';
    allDataPoints.forEach((dataPoint) => {
      dataSummaryHtml += `<div style="margin: 5px 0;">${dataPoint.emoji} ${dataPoint.information}</div>`;
    });
    dataSummaryHtml += "</div>";
    routeDataSummary.innerHTML = dataSummaryHtml;
  } else {
    routeDataSummary.innerHTML =
      '<p style="color: #666; font-style: italic;">אין מידע מיוחד למסלול זה</p>';
  }

  // Populate route description
  const downloadRouteDescription = modal.querySelector(
    "#download-route-description",
  );
  downloadRouteDescription.innerHTML =
    document.getElementById("route-description").innerHTML;

  // Add event listeners
  const closeBtn = modal.querySelector(".download-modal-close");
  const downloadBtn = modal.querySelector("#download-gpx-final");
  const shareBtn = modal.querySelector("#share-route-modal");

  closeBtn.addEventListener("click", () => {
    document.body.removeChild(modal);
  });

  downloadBtn.addEventListener("click", () => {
    downloadGPX();
    document.body.removeChild(modal);
  });

  shareBtn.addEventListener("click", () => {
    shareRoute();
    document.body.removeChild(modal);
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });

  // Add escape key listener
  const handleEscape = (e) => {
    if (e.key === "Escape") {
      document.body.removeChild(modal);
      document.removeEventListener("keydown", handleEscape);
    }
  };
  document.addEventListener("keydown", handleEscape);
}

function getSegmentIds(segmentNames) {
  return segmentNames
    .map((name) => {
      const segmentInfo = segmentsData[name];
      return segmentInfo ? segmentInfo.id : 0;
    })
    .filter((id) => id > 0);      
}

function downloadGPX() {
  if (!mapDataLoaded) return;

  // Track analytics event for GPX download
  trackRouteOperation("download", routePoints, selectedSegments, {
    distance: getRouteInfo().distance
  });

  const orderedCoords = getOrderedCoordinates();
  let gpx = generateGPX(orderedCoords);

  // Generate filename using encoded route (first 32 characters)
  const routeEncoding = encodeRoute(getSegmentIds(selectedSegments));
  const filename = routeEncoding
    ? `route_${routeEncoding.substring(0, 32)}.gpx`
    : "bike_route.gpx";

  executeDownloadGPX(gpx, filename);
}

// Hash navigation functionality
function handleHashNavigation() {
  const hash = window.location.hash.substring(1); // Remove the # symbol
  if (hash) {
    const section = document.getElementById(hash);
    if (section) {
      section.scrollIntoView({ behavior: "smooth" });
    }
  }
}

// Function to scroll to section and update URL hash
function scrollToSection(sectionId) {
  const section = document.getElementById(sectionId);
  if (section) {
    // Update URL hash without triggering page reload
    history.pushState(null, null, `#${sectionId}`);
    section.scrollIntoView({ behavior: "smooth" });
  }
}

// Event listeners
document.addEventListener("DOMContentLoaded", function () {
  // Track page load
  trackPageLoad(hasRouteInUrl(), navigator.userAgent);

  // Initialize the map when page loads
  initMap();

  // Handle initial hash navigation on page load
  handleHashNavigation();

  // Handle hash changes (back/forward browser navigation)
  window.addEventListener("hashchange", handleHashNavigation);

  // Download GPX functionality
  document.getElementById("download-gpx").addEventListener("click", () => {
    showDownloadModal();
  });

  // Search functionality
  document
    .getElementById("search-btn")
    .addEventListener("click", searchLocation);
  document
    .getElementById("location-search")
    .addEventListener("keypress", function (e) {
      if (e.key === "Enter") {
        searchLocation();
      }
    });

  // Undo/redo buttons
  document.getElementById("undo-btn").addEventListener("click", undo);
  document.getElementById("redo-btn").addEventListener("click", redo);

  // Reset button
  document.getElementById("reset-btn").addEventListener("click", () => {
    if (selectedSegments.length > 0) {
      showResetModal();
    } else {
      resetRoute();
    }
  });

  // Warning box click handlers
  document
    .getElementById("route-warning")
    .addEventListener("click", function () {
      // Track analytics event for warning interaction
      trackWarningClick("route_continuity", routePoints, selectedSegments);

      const continuityResult = checkRouteContinuity();
      if (
        !continuityResult.isContinuous &&
        continuityResult.brokenSegmentIndex >= 0
      ) {
        // Focus on the segment that caused the break (the one after the broken connection)
        const breakingSegmentIndex = continuityResult.brokenSegmentIndex + 1;
        if (breakingSegmentIndex < selectedSegments.length) {
          const segmentName = selectedSegments[breakingSegmentIndex];
          focusOnSegment(segmentName);
        }
      }
    });

  document
    .getElementById("segment-warning")
    .addEventListener("click", function () {
      const warningsResult = hasSegmentWarnings();

      // Track analytics event for segment warning interaction
      trackWarningClick("segment_warning", routePoints, selectedSegments, {
        warning_data_points_count: warningsResult.count,
        warning_segments_count: warningsResult.warningSegments.length,
      });

      if (
        warningsResult.hasWarnings &&
        warningsResult.warningDataPoints.length > 0
      ) {
        // Toggle individual warnings display
        toggleIndividualWarnings(warningsResult.warningDataPoints);
      }
    });

  // Help tutorial button
  const helpBtn = document.getElementById("help-tutorial-btn");
  if (helpBtn) {
    helpBtn.addEventListener("click", () => {
      // Track analytics event for tutorial start
      trackTutorial("started", selectedSegments.length > 0, "help_button");

      if (
        typeof tutorial !== "undefined" &&
        tutorial !== null &&
        typeof tutorial.startManually === "function"
      ) {
        tutorial.startManually();
      } else {
        console.warn("Tutorial not available");
      }
    });
  }

  // Mobile menu toggle
  const mobileMenuBtn = document.getElementById("mobile-menu-btn");
  const navLinks = document.getElementById("nav-links");

  if (mobileMenuBtn && navLinks) {
    // Function to manage z-index when menu opens/closes
    const manageZIndex = (isMenuOpen) => {
      const searchContainer = document.querySelector(".search-container");
      const legendContainer = document.querySelector(".legend-container");

      if (isMenuOpen) {
        // Store original z-index values and set to lower values
        if (searchContainer) {
          searchContainer.dataset.originalZIndex =
            getComputedStyle(searchContainer).zIndex;
          searchContainer.style.zIndex = "100";
        }
        if (legendContainer) {
          legendContainer.dataset.originalZIndex =
            getComputedStyle(legendContainer).zIndex;
          legendContainer.style.zIndex = "100";
        }
      } else {
        // Restore original z-index values
        if (searchContainer && searchContainer.dataset.originalZIndex) {
          if (searchContainer.dataset.originalZIndex === "auto") {
            searchContainer.style.zIndex = "";
          } else {
            searchContainer.style.zIndex =
              searchContainer.dataset.originalZIndex;
          }
          delete searchContainer.dataset.originalZIndex;
        }
        if (legendContainer && legendContainer.dataset.originalZIndex) {
          if (legendContainer.dataset.originalZIndex === "auto") {
            legendContainer.style.zIndex = "";
          } else {
            legendContainer.style.zIndex =
              legendContainer.dataset.originalZIndex;
          }
          delete legendContainer.dataset.originalZIndex;
        }
      }
    };

    mobileMenuBtn.addEventListener("click", () => {
      const isMenuOpen = !navLinks.classList.contains("active");
      navLinks.classList.toggle("active");
      manageZIndex(isMenuOpen);
    });

    // Close menu when clicking on a nav link
    const navLinkItems = navLinks.querySelectorAll(".nav-link");
    navLinkItems.forEach((link) => {
      link.addEventListener("click", () => {
        navLinks.classList.remove("active");
        manageZIndex(false);
      });
    });

    // Close menu when clicking outside
    document.addEventListener("click", (e) => {
      if (!mobileMenuBtn.contains(e.target) && !navLinks.contains(e.target)) {
        if (navLinks.classList.contains("active")) {
          navLinks.classList.remove("active");
          manageZIndex(false);
        }
      }
    });
  }

  // Keyboard shortcuts for undo/redo and export
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "Z") {
      e.preventDefault();
      redo();
    } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "D") {
      e.preventDefault();
      showExportModal();
    }
  });
});



// Data markers management
let dataMarkersSource = null;
let dataMarkersLayer = null;

// Emoji mapping for marker types
const MARKER_EMOJIS = {
  payment: "💵",
  gate: "🚧",
  mud: "⚠️",
  warning: "⚠️",
  slope: "⛰️",
  narrow: "⛍",
  severe: "‼️",
};

// SVG icon mapping for warning types (same as used on map)
const WARNING_SVG_ICONS = {
  payment: "icons/bank.svg",
  gate: "icons/barrier.svg",
  mud: "icons/wetland.svg",
  warning: "icons/caution.svg",
  slope: "icons/mountain.svg",
  narrow: "icons/car.svg",
  severe: "icons/roadblock.svg",
};

// Function to load SVG content for warnings
async function loadSVGIcon(svgPath) {
  try {
    const response = await fetch(svgPath);
    const svgText = await response.text();
    return svgText;
  } catch (error) {
    console.warn(`Failed to load SVG icon ${svgPath}:`, error);
    return null;
  }
}

// Hebrew translations for warning types
const WARNING_TRANSLATIONS = {
  payment: "תשלום",
  gate: "שער",
  mud: "בוץ",
  warning: "אזהרה",
  slope: "שיפוע",
  narrow: "שוליים צרים",
  severe: "סכנה",
};

// Color scheme for warning types
// Palette brought from here: https://mycolor.space/?hex=%23FF9800&sub=1
const WARNING_COLORS = {
  payment: "#4a5783",
  mud: "#9d744d", 
  warning: "#FF9800", 
  slope: "#8e5b9a", 
  narrow: "#d6568b",
  severe: "#ff675b",
  gate: "#FF5722"
};

// Maki icon mapping for marker types
const MARKER_ICONS = {
  payment: "bank-11",
  gate: "barrier-11",
  mud: "wetland-11",
  warning: "caution-11",
  slope: "mountain-11",
  narrow: "car-11",
  severe: "roadblock-11",
};

// Load custom SVG icons as map images
async function loadCustomIcons() {
  const iconMappings = {
    "bank-11": "icons/bank.svg",
    "barrier-11": "icons/barrier.svg",
    "wetland-11": "icons/wetland.svg",
    "caution-11": "icons/caution.svg",
    "mountain-11": "icons/mountain.svg",
    "car-11": "icons/car.svg",
    "roadblock-11": "icons/roadblock.svg",
  };

  for (const [iconName, svgFile] of Object.entries(iconMappings)) {
    try {
      const response = await fetch(svgFile);
      const svgText = await response.text();

      // Convert SVG to image
      const img = new Image();
      const svgBlob = new Blob([svgText], { type: "image/svg+xml" });
      const url = URL.createObjectURL(svgBlob);

      await new Promise((resolve, reject) => {
        img.onload = () => {
          if (!map.hasImage(iconName)) {
            map.addImage(iconName, img);
          }
          URL.revokeObjectURL(url);
          resolve();
        };
        img.onerror = reject;
        img.src = url;
      });
    } catch (error) {
      console.warn(`Failed to load custom icon ${iconName}:`, error);
    }
  }
}

// Initialize data markers system
async function initDataMarkers() {
  if (!map || !segmentsData) return;

  // Load custom icons first
  await loadCustomIcons();

  // Collect all data points from segments
  const dataFeatures = [];

  Object.entries(segmentsData).forEach(([segmentName, segmentInfo]) => {
    if (segmentInfo.data && Array.isArray(segmentInfo.data)) {
      segmentInfo.data.forEach((dataPoint, index) => {
        if (
          dataPoint.location &&
          Array.isArray(dataPoint.location) &&
          dataPoint.location.length >= 2
        ) {
          const [lat, lng] = dataPoint.location;
          const dataPointId = getDataPointId(segmentName, index);

          dataFeatures.push({
            type: "Feature",
            id: dataPointId,
            geometry: {
              type: "Point",
              coordinates: [lng, lat], // Convert [lat, lng] to [lng, lat] for Mapbox
            },
            properties: {
              dataPointId: dataPointId,
              type: dataPoint.type,
              information: dataPoint.information || "",
              segmentName: segmentName,
              emoji: MARKER_EMOJIS[dataPoint.type] || "📍",
              icon: MARKER_ICONS[dataPoint.type] || "marker-11",
            },
          });
        }
      });
    }
  });

  if (dataFeatures.length === 0) return;

  // Add source for data markers
  if (map.getSource("data-markers")) {
    map.getSource("data-markers").setData({
      type: "FeatureCollection",
      features: dataFeatures,
    });
  } else {
    map.addSource("data-markers", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: dataFeatures,
      },
    });

    // Add symbol layer for data markers
    map.addLayer({
      id: "data-markers-layer",
      type: "symbol",
      source: "data-markers",
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": 1,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: {
        "icon-opacity": 0.45,
      },
    });

    // Add click event for data markers
    map.on("click", "data-markers-layer", (e) => {
      if (e.features.length > 0) {
        if (e.preventDefault) e.preventDefault();
        if (e.originalEvent && e.originalEvent.stopPropagation) {
          e.originalEvent.stopPropagation();
        }
        const feature = e.features[0];
        showDataMarkerTooltip(e, feature);
      }
    });

    // Add touchend event for mobile to prevent bubbling
    map.on("touchend", "data-markers-layer", (e) => {
      if (e.features.length > 0) {
        if (e.preventDefault) e.preventDefault();
        if (e.originalEvent && e.originalEvent.stopPropagation) {
          e.originalEvent.stopPropagation();
        }
      }
    });

    // Change cursor on hover - cursor is managed by global handler
    map.on("mouseenter", "data-markers-layer", () => {
      // Cursor is managed by global mousemove handler
    });

    map.on("mouseleave", "data-markers-layer", () => {
      // Cursor is managed by global mousemove handler
      hideDataMarkerTooltip();
    });
  }
}

// Show tooltip for data marker
function showDataMarkerTooltip(e, feature) {
  const properties = feature.properties;

  // Remove existing tooltip
  hideDataMarkerTooltip();

  // Create tooltip element
  const tooltip = document.createElement("div");
  tooltip.className = "data-marker-tooltip";
  tooltip.innerHTML = `
    <div class="tooltip-content">
      <span class="tooltip-emoji">${properties.emoji}</span>
      <span class="tooltip-text">${properties.information}</span>
    </div>
  `;

  tooltip.style.cssText = `
    position: absolute;
    background: rgba(0, 0, 0, 0.9);
    color: white;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 12px;
    white-space: nowrap;
    pointer-events: none;
    z-index: 1000;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    max-width: 250px;
    white-space: normal;
    line-height: 1.3;
  `;

  // Position tooltip
  const point = map.project(e.lngLat);
  tooltip.style.left = point.x + 15 + "px";
  tooltip.style.top = point.y - 15 + "px";

  document.body.appendChild(tooltip);
  window.currentDataTooltip = tooltip;

  // Auto-hide on mobile after delay
  if ("ontouchstart" in window) {
    setTimeout(() => {
      hideDataMarkerTooltip();
    }, 3000);
  }
}

// Hide data marker tooltip
function hideDataMarkerTooltip() {
  if (window.currentDataTooltip) {
    window.currentDataTooltip.remove();
    window.currentDataTooltip = null;
  }
}

// Get segment data points for display
function getSegmentDataPoints(segmentName) {
  const segmentInfo = segmentsData?.[segmentName];
  if (!segmentInfo || !segmentInfo.data || !Array.isArray(segmentInfo.data)) {
    return [];
  }

  return segmentInfo.data.map((dataPoint, index) => ({
    id: getDataPointId(segmentName, index),
    segmentName: segmentName,
    index: index,
    type: dataPoint.type,
    information: dataPoint.information || "",
    emoji: MARKER_EMOJIS[dataPoint.type] || "📍",
    location: getDataPointLocation(dataPoint),
    raw: dataPoint,
  }));
}

function createLegacySegmentWarning(segmentName) {
  const segmentInfo = segmentsData?.[segmentName];
  if (!segmentInfo?.warning) return null;

  return {
    id: `${segmentName}-legacy-warning`,
    segmentName: segmentName,
    index: -1,
    type: "warning",
    information: segmentInfo.warning,
    emoji: MARKER_EMOJIS.warning || "⚠️",
    location: null,
    raw: segmentInfo.warning,
    isLegacySegmentWarning: true,
  };
}

function getSegmentQualityOverall(segmentName) {
  const quality = segmentsData?.[segmentName]?.quality;
  const overall = quality && typeof quality === "object" ? Number(quality.overall) : NaN;
  return Number.isInteger(overall) && overall >= 1 && overall <= 5 ? overall : 3;
}

function getSegmentQualityBadge(segmentName) {
  if (!FEATURE_FLAGS.segmentQualityPublicDisplay) return "";

  const overall = getSegmentQualityOverall(segmentName);
  if (overall >= 5) {
    return '<span class="segment-quality-badge excellent">★★★★★ מומלץ</span>';
  }
  if (overall <= 2) {
    return '<span class="segment-quality-badge caution">דירוג נמוך</span>';
  }
  return "";
}

// RouteManager is imported from route-manager.js
