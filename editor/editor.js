import {
  stitchCoordsFromEdgeRefs,
  validateEdgePickMapping,
  conflictingSegmentForEdge,
  orientAppendedEdgeRef,
} from "./lib/edge-pick.mjs";
import {
  POI_TYPE_OPTIONS,
  poiColor,
  poiEmoji,
  poiIcon,
} from "../packages/core/src/data/poiTypes.js";

const MAPBOX_TOKEN_STORAGE_KEY = "cycleways.mapboxToken";

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

const MAPBOX_TOKEN = requireMapboxToken();

const MAP_STYLE_STORAGE_KEY = "isravelo.mapEditor.mapStyle";
const MAP_STYLES = [
  {
    value: "outdoors",
    label: "Outdoors",
    style: "mapbox://styles/mapbox/outdoors-v12",
  },
  {
    value: "satellite",
    label: "Satellite",
    style: "mapbox://styles/mapbox/satellite-streets-v12",
  },
  {
    value: "streets",
    label: "Streets",
    style: "mapbox://styles/mapbox/streets-v12",
  },
  {
    value: "light",
    label: "Light",
    style: "mapbox://styles/mapbox/light-v11",
  },
];

const BASE_GRAPH_LINE_COLOR = "#2563eb";
const BASE_GRAPH_FALLBACK_LINE_COLOR = "#607076";
const BASE_GRAPH_LINE_WIDTH = ["interpolate", ["linear"], ["zoom"], 10, 1.8, 13, 2.8, 16, 4.2];
const BASE_GRAPH_LINE_OPACITY = 0.52;

const DATA_TYPES = POI_TYPE_OPTIONS;
const DATA_TYPE_COLORS = Object.fromEntries(
  DATA_TYPES.map(({ value }) => [value, poiColor(value)]),
);
const DATA_TYPE_ICONS = Object.fromEntries(
  DATA_TYPES.map(({ value }) => [value, poiIcon(value)]),
);

const DATA_ICON_PATHS = {
  "bank-11": "/icons/bank.svg",
  "barrier-11": "/icons/barrier.svg",
  "wetland-11": "/icons/wetland.svg",
  "caution-11": "/icons/caution.svg",
  "mountain-11": "/icons/mountain.svg",
  "car-11": "/icons/car.svg",
  "roadblock-11": "/icons/roadblock.svg",
};

const DEFAULT_FEATURE_FLAGS = {
  segmentQualityEditor: true,
  segmentQualityPublicDisplay: false,
  segmentQualityRouting: false,
};
const FEATURE_FLAGS = Object.fromEntries(
  Object.entries(DEFAULT_FEATURE_FLAGS).map(([key, defaultValue]) => [key, featureFlagValue(key, defaultValue)]),
);
const QUALITY_FIELDS = [
  { key: "overall", label: "Overall" },
  { key: "safety", label: "Safety" },
  { key: "comfort", label: "Comfort" },
  { key: "scenery", label: "Scenery" },
];
const DEFAULT_QUALITY = Object.fromEntries(QUALITY_FIELDS.map(({ key }) => [key, 3]));
const ROUTE_ANCHOR_SPACING_M = 1000;
const EXTEND_ENDPOINT_THRESHOLD_PX = 44;
const SPACE_SNAP_EDIT_THRESHOLD_PX = 34;
const MAX_BOUNDARY_SNAP_DISTANCE_M = 180;
const MAX_EDGE_CONNECTION_GAP_M = 12;
const ACCEPTED_LENGTH_WARNING_MIN_RATIO = 0.9;
const ACCEPTED_LENGTH_WARNING_MAX_RATIO = 1.35;
const ACCEPTED_LENGTH_BLOCK_MIN_RATIO = 0.8;
const ACCEPTED_LENGTH_BLOCK_MAX_RATIO = 2.0;
const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };

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

const state = {
  source: null,
  activeFeatures: [],
  workspaceMode: "segments",
  selectedIndex: -1,
  selectedVertexIndex: -1,
  selectedDataIndex: -1,
  mode: "select",
  dirty: false,
  segmentsOpen: false,
  draggingVertex: false,
  draggingManualBaseVertex: false,
  draggingDataMarker: null,
  suppressNextSegmentClick: false,
  showUnresolvedSegments: false,
  unresolvedSegmentIds: [],
  unresolvedSegmentFilterKey: null,
  changedSegmentIds: new Set(),
  processingChangedQueue: false,
  lastMapPointer: null,
  mapSourceDataCache: new Map(),
  lastBuildReport: null,
  mapStyle: getInitialMapStyle(),
  draw: emptyDrawState(),
  editingEdgePickEdges: false,
  splittingEdgePickAt: null,
  baseOverlay: {
    enabled: false,
    loading: false,
    loaded: false,
    recalculating: false,
    selectedGraphEdgeId: null,
    selectedManualEdgeIndex: -1,
    selectedManualVertexIndex: -1,
    hoveredOverlayEdgeId: null,
    graphEdges: null,
    matchSummary: null,
    matchPreview: null,
    manualBaseEdges: emptyManualBaseEdges(),
    overlay: emptyBaseOverlay(),
    cache: {},
  },
};

const els = {
  mapToolbar: document.querySelector(".map-toolbar"),
  workspaceSegments: document.getElementById("workspace-segments"),
  workspaceBase: document.getElementById("workspace-base"),
  workspaceOverlay: document.getElementById("workspace-overlay"),
  workspaceVideoSync: document.getElementById("workspace-video-sync"),
  workspaceRouteCatalog: document.getElementById("workspace-route-catalog"),
  baseGraphPanel: document.getElementById("base-graph-panel"),
  cwOverlayPanel: document.getElementById("cw-overlay-panel"),
  videoSyncPanel: document.getElementById("video-sync-panel"),
  routeCatalogPanel: document.getElementById("route-catalog-panel"),
  segmentDrawer: document.getElementById("segment-drawer"),
  toggleSegments: document.getElementById("toggle-segments"),
  closeSegments: document.getElementById("close-segments"),
  sourceSummary: document.getElementById("source-summary"),
  dirtyIndicator: document.getElementById("dirty-indicator"),
  segmentSearch: document.getElementById("segment-search"),
  addSegment: document.getElementById("add-segment"),
  segmentList: document.getElementById("segment-list"),
  selectedCount: document.getElementById("selected-count"),
  segmentId: document.getElementById("segment-id"),
  segmentName: document.getElementById("segment-name"),
  nameRelease: document.getElementById("name-release"),
  nameReleaseMessage: document.getElementById("name-release-message"),
  releaseName: document.getElementById("release-name"),
  segmentStatus: document.getElementById("segment-status"),
  segmentRoadType: document.getElementById("segment-road-type"),
  segmentQuality: document.getElementById("segment-quality"),
  segmentTodo: document.getElementById("segment-todo"),
  segmentNotes: document.getElementById("segment-notes"),
  addData: document.getElementById("add-data"),
  dataList: document.getElementById("data-list"),
  modeSelect: document.getElementById("mode-select"),
  modeInsert: document.getElementById("mode-insert"),
  extendSegment: document.getElementById("extend-segment"),
  deleteVertex: document.getElementById("delete-vertex"),
  splitSegment: document.getElementById("split-segment"),
  toggleUnresolvedSegments: document.getElementById("toggle-unresolved-segments"),
  processChangedQueue: document.getElementById("process-changed-queue"),
  clearChangedQueue: document.getElementById("clear-changed-queue"),
  toggleBaseOverlay: document.getElementById("toggle-base-overlay"),
  drawDone: document.getElementById("draw-done"),
  drawCancel: document.getElementById("draw-cancel"),
  drawUndoLast: document.getElementById("draw-undo-last"),
  drawFreehand: document.getElementById("draw-freehand"),
  composeEdgeStatus: document.getElementById("compose-edge-status"),
  edgePickEditControls: document.getElementById("edge-pick-edit-controls"),
  editSegmentEdges: document.getElementById("edit-segment-edges"),
  splitSegmentEdge: document.getElementById("split-segment-edge"),
  mapStyle: document.getElementById("map-style"),
  saveSource: document.getElementById("save-source"),
  runBuild: document.getElementById("run-build"),
  promoteBuild: document.getElementById("promote-build"),
  skipElevation: document.getElementById("skip-elevation"),
  editorAlert: document.getElementById("editor-alert"),
  editorAlertTitle: document.getElementById("editor-alert-title"),
  editorAlertMessage: document.getElementById("editor-alert-message"),
  buildOutputSummary: document.getElementById("build-output-summary"),
  buildReport: document.getElementById("build-report"),
  baseGraphStatus: document.getElementById("base-graph-status"),
  baseGraphSummary: document.getElementById("base-graph-summary"),
  newManualBaseEdge: document.getElementById("new-manual-base-edge"),
  cloneBaseGraphEdge: document.getElementById("clone-base-graph-edge"),
  deleteManualBaseEdge: document.getElementById("delete-manual-base-edge"),
  splitManualBaseEdge: document.getElementById("split-manual-base-edge"),
  recalculateOsmGraph: document.getElementById("recalculate-osm-graph"),
  baseGraphHelp: document.getElementById("base-graph-help"),
  baseOverlayStatus: document.getElementById("base-overlay-status"),
  baseOverlaySummary: document.getElementById("base-overlay-summary"),
  acceptBaseOverlay: document.getElementById("accept-base-overlay"),
  recalculateSelectedOverlay: document.getElementById("recalculate-selected-overlay"),
  snapBoundaryOverlay: document.getElementById("snap-boundary-overlay"),
  markManualBaseOverlay: document.getElementById("mark-manual-base-overlay"),
  clearBaseOverlay: document.getElementById("clear-base-overlay"),
  bulkAcceptBaseOverlay: document.getElementById("bulk-accept-base-overlay"),
  baseOverlayBulkSummary: document.getElementById("base-overlay-bulk-summary"),
  baseOverlayValidation: document.getElementById("base-overlay-validation"),
  baseOverlayReviewStats: document.getElementById("base-overlay-review-stats"),
  baseOverlayReviewList: document.getElementById("base-overlay-review-list"),
  baseOverlayEdges: document.getElementById("base-overlay-edges"),
  statusBar: document.getElementById("status-bar"),
};

mapboxgl.accessToken = MAPBOX_TOKEN;

const map = new mapboxgl.Map({
  container: "map",
  style: mapStyleDefinition(state.mapStyle).style,
  center: [35.617497, 33.183536],
  zoom: 11.5,
});

map.addControl(new mapboxgl.NavigationControl(), "bottom-left");

els.mapStyle.value = state.mapStyle;

function getInitialMapStyle() {
  try {
    const saved = window.localStorage.getItem(MAP_STYLE_STORAGE_KEY);
    if (MAP_STYLES.some((style) => style.value === saved)) {
      return saved;
    }
  } catch {
    // Local storage can be unavailable in some browser privacy modes.
  }
  return "outdoors";
}

function mapStyleDefinition(value) {
  return MAP_STYLES.find((style) => style.value === value) || MAP_STYLES[0];
}

function saveMapStyle(value) {
  try {
    window.localStorage.setItem(MAP_STYLE_STORAGE_KEY, value);
  } catch {
    // Preference persistence is optional.
  }
}

function emptyDrawState() {
  return {
    active: false,
    type: null,
    sourceIndex: -1,
    endpoint: null,
    hoverEndpoint: null,
    coords: [],
    hoverCoord: null,
    edgeRefs: [],
    hoverEdgeId: null,
  };
}

function emptyBaseOverlay() {
  return {
    schemaVersion: 1,
    description: "CycleWays segment mappings onto the OSM/manual base graph.",
    updatedAt: null,
    segments: {},
  };
}

function emptyManualBaseEdges() {
  return {
    type: "FeatureCollection",
    features: [],
  };
}

function isDrawing() {
  return state.mode === "draw" && state.draw.active;
}

function isComposingNewSegmentEdges() {
  return isDrawing() && state.draw.type === "newSegmentEdges";
}

async function loadDataMarkerIcons() {
  for (const [iconName, iconPath] of Object.entries(DATA_ICON_PATHS)) {
    if (map.hasImage(iconName)) continue;

    try {
      const response = await fetch(iconPath);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const svgText = await response.text();
      const image = new Image();
      const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));

      await new Promise((resolve, reject) => {
        image.onload = () => {
          URL.revokeObjectURL(url);
          if (!map.hasImage(iconName)) map.addImage(iconName, image);
          resolve();
        };
        image.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error(`Failed to load ${iconPath}`));
        };
        image.src = url;
      });
    } catch (error) {
      console.warn(error);
    }
  }
}

function setStatus(message, type = "info") {
  els.statusBar.textContent = message;
  els.statusBar.classList.toggle("error", type === "error");
}

function showAlert(title, message) {
  els.editorAlertTitle.textContent = title;
  els.editorAlertMessage.textContent = message;
  els.editorAlert.hidden = false;
}

function clearAlert() {
  els.editorAlert.hidden = true;
  els.editorAlertTitle.textContent = "";
  els.editorAlertMessage.textContent = "";
}

function markAlertShown(error) {
  if (error && typeof error === "object") {
    error.editorAlertShown = true;
  }
  return error;
}

function setSegmentDrawer(open) {
  state.segmentsOpen = open;
  els.segmentDrawer.setAttribute("aria-hidden", open ? "false" : "true");
  els.toggleSegments.setAttribute("aria-expanded", open ? "true" : "false");
  els.toggleSegments.classList.toggle("active", open);
  if (open) {
    els.segmentSearch.focus();
  }
}

function canPromoteReport(report) {
  return Boolean(report && reportIssueDetails(report).length === 0);
}

function promoteBlockerMessage(report) {
  if (!report) return "Run a successful full build before promoting";
  const issues = reportIssueDetails(report);
  if (issues.length === 0) return "Copy the latest build into the site files";
  return `Fix ${issues.length} build issue${issues.length === 1 ? "" : "s"} before promoting`;
}

function updatePromoteButton() {
  const promoteIssues = reportIssueDetails(state.lastBuildReport);
  els.promoteBuild.disabled = isDrawing() || state.dirty || !canPromoteReport(state.lastBuildReport);
  els.promoteBuild.title = isDrawing()
    ? "Finish or cancel drawing before promoting"
    : state.dirty
    ? "Save and run a fresh full build before promoting"
    : canPromoteReport(state.lastBuildReport)
      ? "Copy the latest build into the site files"
      : promoteIssues.length > 0
        ? promoteIssues.join("\n")
        : promoteBlockerMessage(state.lastBuildReport);
}

function markDirty(isDirty = true) {
  state.dirty = isDirty;
  if (isDirty) {
    state.lastBuildReport = null;
  }
  els.saveSource.disabled = !isDirty || isDrawing();
  els.dirtyIndicator.textContent = isDirty ? "Unsaved" : "Saved";
  els.dirtyIndicator.classList.toggle("dirty", isDirty);
  updatePromoteButton();
}

function markDirtyForLiveEdit() {
  if (!state.dirty) {
    markDirty();
  } else {
    state.lastBuildReport = null;
  }
}

function featureName(feature) {
  return feature?.properties?.name || "Unnamed segment";
}

function featureId(feature) {
  return feature?.properties?.id ?? "";
}

function normalizedQuality(quality) {
  const source = quality && typeof quality === "object" && !Array.isArray(quality) ? quality : {};
  return Object.fromEntries(
    QUALITY_FIELDS.map(({ key }) => {
      const value = Number(source[key]);
      return [key, Number.isInteger(value) && value >= 1 && value <= 5 ? value : DEFAULT_QUALITY[key]];
    }),
  );
}

function qualityForFeature(feature) {
  return normalizedQuality(feature?.properties?.quality);
}

function defaultQuality() {
  return { ...DEFAULT_QUALITY };
}

function isActiveLineFeature(feature) {
  const status = feature?.properties?.status || "active";
  return feature?.geometry?.type === "LineString" && !["deprecated", "legacy", "draft"].includes(status);
}

function refreshActiveFeatures() {
  state.activeFeatures = state.source.features
    .map((feature, sourceIndex) => ({ feature, sourceIndex }))
    .filter(({ feature }) => isActiveLineFeature(feature));
}

function activeSegmentIdSet() {
  return new Set(
    state.activeFeatures
      .map(({ feature }) => Number(feature.properties?.id))
      .filter((id) => Number.isInteger(id)),
  );
}

function isActiveSegmentId(segmentId) {
  return activeSegmentIdSet().has(Number(segmentId));
}

function mapFeatureCollection() {
  if (state.workspaceMode === "base") {
    return EMPTY_FEATURE_COLLECTION;
  }

  return {
    type: "FeatureCollection",
    features: state.activeFeatures.map(({ feature, sourceIndex }) => ({
      ...feature,
      properties: {
        ...feature.properties,
        sourceIndex,
      },
    })),
  };
}

function selectedRecord() {
  if (state.selectedIndex < 0) return null;
  return state.activeFeatures[state.selectedIndex] || null;
}

function selectedFeature() {
  return selectedRecord()?.feature || null;
}

function selectedSourceIndex() {
  return selectedRecord()?.sourceIndex ?? -1;
}

function selectedName() {
  return featureName(selectedFeature());
}

function selectedFilter() {
  if (state.workspaceMode === "base") {
    return ["==", ["get", "sourceIndex"], -1];
  }
  const sourceIndex = selectedSourceIndex();
  return sourceIndex >= 0 ? ["==", ["get", "sourceIndex"], sourceIndex] : ["==", ["get", "sourceIndex"], -1];
}

function unselectedFilter() {
  if (state.workspaceMode === "base") {
    return ["==", ["get", "sourceIndex"], -1];
  }
  const sourceIndex = selectedSourceIndex();
  return sourceIndex >= 0 ? ["!=", ["get", "sourceIndex"], sourceIndex] : null;
}

function selectedFeatureCollection() {
  const feature = selectedFeature();
  const sourceIndex = selectedSourceIndex();
  if (!feature || sourceIndex < 0 || state.workspaceMode === "base") {
    return EMPTY_FEATURE_COLLECTION;
  }
  return {
    type: "FeatureCollection",
    features: [
      {
        ...feature,
        properties: {
          ...feature.properties,
          sourceIndex,
        },
      },
    ],
  };
}

function collectUnresolvedSegmentIds() {
  if (!state.baseOverlay.loaded) return new Set();
  return new Set(baseOverlayReviewRows().filter((row) => !row.status.resolved).map((row) => Number(row.match.segmentId)));
}

function collectIssueSegmentIds() {
  return collectUnresolvedSegmentIds();
}

function refreshUnresolvedSegmentHighlights() {
  if (!state.showUnresolvedSegments) return;
  state.unresolvedSegmentIds = [...collectIssueSegmentIds()].sort((a, b) => a - b);
  state.unresolvedSegmentFilterKey = null;
  updateUnresolvedSegmentLayerFilter();
}

function queueChangedSegment(segmentId) {
  const id = Number(segmentId);
  if (!Number.isInteger(id)) return;
  state.changedSegmentIds.add(id);
}

function queueChangedFeature(feature) {
  queueChangedSegment(feature?.properties?.id);
}

function clearChangedSegmentQueue() {
  state.changedSegmentIds.clear();
  renderDrawControls();
  setStatus("Changed segment queue cleared.");
}

function manualBaseEdgeFeatures() {
  return state.baseOverlay.manualBaseEdges?.features || [];
}

function invalidateBaseOverlayDerivedCache() {
  state.baseOverlay.cache = {};
}

function manualBaseEdgeFeatureId(feature) {
  return feature?.properties?.manualEdgeId || feature?.properties?.id || feature?.id || null;
}

function selectedManualBaseEdge() {
  const features = manualBaseEdgeFeatures();
  const index = state.baseOverlay.selectedManualEdgeIndex;
  return index >= 0 && index < features.length ? features[index] : null;
}

function selectedManualBaseEdgeId() {
  return manualBaseEdgeFeatureId(selectedManualBaseEdge());
}

function selectedManualBaseEdgeFilter() {
  const manualEdgeId = selectedManualBaseEdgeId();
  return manualEdgeId
    ? ["==", ["get", "manualEdgeId"], manualEdgeId]
    : ["==", ["get", "manualEdgeId"], "__none__"];
}

function vertexCollection() {
  if (state.workspaceMode === "base") {
    const feature = selectedManualBaseEdge();
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords)) {
      return EMPTY_FEATURE_COLLECTION;
    }
    return {
      type: "FeatureCollection",
      features: coords.map((coord, index) => ({
        type: "Feature",
        properties: {
          index,
          manualBaseEdge: true,
          selected: index === state.baseOverlay.selectedManualVertexIndex,
        },
        geometry: {
          type: "Point",
          coordinates: [coord[0], coord[1]],
        },
      })),
    };
  }

  const feature = selectedFeature();
  if (!feature) {
    return { type: "FeatureCollection", features: [] };
  }
  return {
    type: "FeatureCollection",
    features: feature.geometry.coordinates.map((coord, index) => ({
      type: "Feature",
      properties: {
        index,
        selected: index === state.selectedVertexIndex,
      },
      geometry: {
        type: "Point",
        coordinates: [coord[0], coord[1]],
      },
    })),
  };
}

function selectedData() {
  const feature = selectedFeature();
  const data = feature?.properties?.data;
  return Array.isArray(data) ? data : [];
}

function dataForFeature(feature) {
  const data = feature?.properties?.data;
  return Array.isArray(data) ? data : [];
}

function dataMarkerCollection() {
  if (state.workspaceMode === "base") {
    return EMPTY_FEATURE_COLLECTION;
  }

  const features = [];
  const selectedSource = selectedSourceIndex();

  for (const { feature, sourceIndex } of state.activeFeatures) {
    const data = dataForFeature(feature);
    for (const [index, marker] of data.entries()) {
      const location = marker.location;
      if (
        !Array.isArray(location) ||
        location.length < 2 ||
        typeof location[0] !== "number" ||
        typeof location[1] !== "number"
      ) {
        continue;
      }

      const type = marker.type || "warning";
      features.push({
        type: "Feature",
        properties: {
          sourceIndex,
          index,
          type,
          id: marker.id || "",
          icon: DATA_TYPE_ICONS[type] || poiIcon(type) || "caution-11",
          emoji: marker.emoji || poiEmoji(type) || "",
          name: marker.name || "",
          information: marker.information || "",
          description: marker.description || "",
          photo: marker.photo || "",
          thumbnail: marker.thumbnail || "",
          gallery: marker.gallery,
          segmentName: featureName(feature),
          selected: sourceIndex === selectedSource && index === state.selectedDataIndex,
        },
        geometry: {
          type: "Point",
          coordinates: [location[1], location[0]],
        },
      });
    }
  }

  return { type: "FeatureCollection", features };
}

function coordForGeoJson(coord) {
  return [coord[0], coord[1]];
}

function selectedEndpointCoordsForDraw() {
  if (!isDrawing() || !["extend", "manualBaseEdgeExtend"].includes(state.draw.type)) return null;
  const feature =
    state.draw.type === "manualBaseEdgeExtend"
      ? manualBaseEdgeFeatures()[state.draw.manualEdgeIndex]
      : state.source?.features[state.draw.sourceIndex];
  const coords = feature?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  return {
    start: coords[0],
    end: coords[coords.length - 1],
  };
}

function drawLineCollection() {
  if (!isDrawing()) {
    return { type: "FeatureCollection", features: [] };
  }

  let coords = [];
  if (state.draw.type === "new" || state.draw.type === "manualBaseEdge") {
    coords = cloneCoords(state.draw.coords);
  } else if ((state.draw.type === "extend" || state.draw.type === "manualBaseEdgeExtend") && state.draw.endpoint) {
    const endpoints = selectedEndpointCoordsForDraw();
    if (endpoints) {
      coords = [endpoints[state.draw.endpoint], ...cloneCoords(state.draw.coords)];
    }
  }

  if (state.draw.hoverCoord && coords.length > 0) {
    coords.push(state.draw.hoverCoord);
  }

  if (coords.length < 2) {
    return { type: "FeatureCollection", features: [] };
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: coords.map(coordForGeoJson),
        },
      },
    ],
  };
}

function drawPointCollection() {
  if (!isDrawing()) {
    return { type: "FeatureCollection", features: [] };
  }

  const features = [];
  if (state.draw.type === "extend" || state.draw.type === "manualBaseEdgeExtend") {
    const endpoints = selectedEndpointCoordsForDraw();
    if (endpoints) {
      for (const endpoint of ["start", "end"]) {
        features.push({
          type: "Feature",
          properties: {
            kind: "endpoint",
            endpoint,
            active: state.draw.endpoint === endpoint || state.draw.hoverEndpoint === endpoint,
          },
          geometry: {
            type: "Point",
            coordinates: coordForGeoJson(endpoints[endpoint]),
          },
        });
      }
    }
  }

  for (const [index, coord] of state.draw.coords.entries()) {
    features.push({
      type: "Feature",
      properties: {
        kind: "draft",
        index,
        active: index === state.draw.coords.length - 1,
      },
      geometry: {
        type: "Point",
        coordinates: coordForGeoJson(coord),
      },
    });
  }

  return { type: "FeatureCollection", features };
}

function baseGraphCollection() {
  if (!state.baseOverlay.graphEdges) {
    return EMPTY_FEATURE_COLLECTION;
  }
  const cache = state.baseOverlay.cache || (state.baseOverlay.cache = {});
  if (
    cache.baseGraphCollection &&
    cache.baseGraphCollectionGraphEdges === state.baseOverlay.graphEdges &&
    cache.baseGraphCollectionManualEdges === state.baseOverlay.manualBaseEdges
  ) {
    return cache.baseGraphCollection;
  }
  const overriddenEdgeIds = overriddenBaseGraphEdgeIds();
  if (overriddenEdgeIds.size === 0) {
    cache.baseGraphCollection = state.baseOverlay.graphEdges;
    cache.baseGraphCollectionGraphEdges = state.baseOverlay.graphEdges;
    cache.baseGraphCollectionManualEdges = state.baseOverlay.manualBaseEdges;
    return cache.baseGraphCollection;
  }
  cache.baseGraphCollection = {
    ...state.baseOverlay.graphEdges,
    features: (state.baseOverlay.graphEdges.features || []).filter(
      (feature) => !overriddenEdgeIds.has(String(graphEdgeFeatureId(feature))),
    ),
  };
  cache.baseGraphCollectionGraphEdges = state.baseOverlay.graphEdges;
  cache.baseGraphCollectionManualEdges = state.baseOverlay.manualBaseEdges;
  return cache.baseGraphCollection;
}

function graphEdgeFeatureId(feature) {
  return feature?.properties?.edgeId || feature?.properties?.id || feature?.id || null;
}

function overriddenBaseGraphEdgeIds() {
  const cache = state.baseOverlay.cache || (state.baseOverlay.cache = {});
  if (
    cache.overriddenEdgeIds &&
    cache.overriddenEdgeIdsManualEdges === state.baseOverlay.manualBaseEdges
  ) {
    return cache.overriddenEdgeIds;
  }
  cache.overriddenEdgeIds = new Set(
    manualBaseEdgeFeatures()
      .map((feature) => feature.properties?.copiedFromEdgeId)
      .filter((edgeId) => typeof edgeId === "string" && edgeId.length > 0)
      .map(String),
  );
  cache.overriddenEdgeIdsManualEdges = state.baseOverlay.manualBaseEdges;
  return cache.overriddenEdgeIds;
}

function selectedBaseGraphEdge() {
  const selectedId = state.baseOverlay.selectedGraphEdgeId;
  if (!selectedId) return null;
  if (overriddenBaseGraphEdgeIds().has(selectedId)) return null;
  return (
    (state.baseOverlay.graphEdges?.features || []).find((feature) => String(graphEdgeFeatureId(feature)) === selectedId) ||
    null
  );
}

function selectedBaseGraphEdgeCollection() {
  if (!state.baseOverlay.enabled || state.workspaceMode !== "base") return EMPTY_FEATURE_COLLECTION;
  const feature = selectedBaseGraphEdge();
  return feature
    ? {
        type: "FeatureCollection",
        features: [feature],
      }
    : EMPTY_FEATURE_COLLECTION;
}

function selectedSegmentId() {
  const id = selectedFeature()?.properties?.id;
  return Number.isInteger(id) ? id : null;
}

function matchSummaryForSegment(segmentId) {
  if (segmentId === null || !state.baseOverlay.matchSummary) return null;
  return (
    state.baseOverlay.matchSummary.segments?.find((summary) => Number(summary.segmentId) === segmentId) || null
  );
}

function matchPreviewFeaturesForSegment(segmentId) {
  if (segmentId === null || !state.baseOverlay.matchPreview) return [];
  const cache = state.baseOverlay.cache || (state.baseOverlay.cache = {});
  if (
    !cache.matchPreviewFeaturesBySegment ||
    cache.matchPreviewFeaturesSource !== state.baseOverlay.matchPreview
  ) {
    cache.matchPreviewFeaturesBySegment = new Map();
    for (const feature of state.baseOverlay.matchPreview.features || []) {
      const key = String(Number(feature.properties?.segmentId));
      if (!cache.matchPreviewFeaturesBySegment.has(key)) {
        cache.matchPreviewFeaturesBySegment.set(key, []);
      }
      cache.matchPreviewFeaturesBySegment.get(key).push(feature);
    }
    cache.matchPreviewFeaturesSource = state.baseOverlay.matchPreview;
  }
  return cache.matchPreviewFeaturesBySegment.get(String(Number(segmentId))) || [];
}

function selectedMatchCollection() {
  if (!state.baseOverlay.enabled || state.workspaceMode !== "overlay") return EMPTY_FEATURE_COLLECTION;
  const segmentId = selectedSegmentId();
  return {
    type: "FeatureCollection",
    features: matchPreviewFeaturesForSegment(segmentId),
  };
}

function manualBaseEdgeCollection() {
  const cache = state.baseOverlay.cache || (state.baseOverlay.cache = {});
  if (
    cache.manualBaseEdgeCollection &&
    cache.manualBaseEdgeCollectionManualEdges === state.baseOverlay.manualBaseEdges &&
    cache.manualBaseEdgeCollectionSelectedIndex === state.baseOverlay.selectedManualEdgeIndex
  ) {
    return cache.manualBaseEdgeCollection;
  }
  cache.manualBaseEdgeCollection = {
    type: "FeatureCollection",
    features: manualBaseEdgeFeatures().map((feature, manualIndex) => ({
      ...feature,
      properties: {
        ...(feature.properties || {}),
        manualIndex,
        manualEdgeId: feature.properties?.manualEdgeId || feature.properties?.id || feature.id,
        selected: manualIndex === state.baseOverlay.selectedManualEdgeIndex,
      },
    })),
  };
  cache.manualBaseEdgeCollectionManualEdges = state.baseOverlay.manualBaseEdges;
  cache.manualBaseEdgeCollectionSelectedIndex = state.baseOverlay.selectedManualEdgeIndex;
  return cache.manualBaseEdgeCollection;
}

function composeEdgePickCollection() {
  if (!isComposingNewSegmentEdges()) {
    return { type: "FeatureCollection", features: [] };
  }
  const graphLookup = new Map();
  for (const feature of state.baseOverlay.graphEdges?.features || []) {
    graphLookup.set(String(graphEdgeFeatureId(feature)), feature);
  }
  for (const feature of manualBaseEdgeFeatures()) {
    graphLookup.set(String(manualBaseEdgeFeatureId(feature)), feature);
  }
  const features = [];
  state.draw.edgeRefs.forEach((ref, index) => {
    const source = graphLookup.get(String(ref.edgeId));
    const coords = source?.geometry?.coordinates;
    if (!coords?.length) return;
    const oriented = ref.direction === "reverse" ? [...coords].reverse() : coords;
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: oriented },
      properties: { edgeId: String(ref.edgeId), sequenceNumber: index + 1 },
    });
  });
  return { type: "FeatureCollection", features };
}

function selectedOverlayEdgeCollection() {
  if (!state.baseOverlay.enabled || state.workspaceMode !== "overlay") return EMPTY_FEATURE_COLLECTION;
  const edgeIds = new Set(displayedOverlayEdgeRefs().map((ref) => String(ref.edgeId)));
  if (edgeIds.size === 0) return EMPTY_FEATURE_COLLECTION;

  const graphFeatures = state.baseOverlay.graphEdges?.features || [];
  const manualFeatures = manualBaseEdgeFeatures();
  const overriddenEdgeIds = overriddenBaseGraphEdgeIds();
  const hoveredId = state.baseOverlay.hoveredOverlayEdgeId;
  const features = [];
  const seen = new Set();
  const overlayFeature = (feature, edgeId, extraProperties = {}) => ({
    ...feature,
    properties: {
      ...(feature.properties || {}),
      ...extraProperties,
      edgeId,
      overlayHovered: hoveredId !== null && String(edgeId) === String(hoveredId),
    },
  });
  for (const feature of graphFeatures) {
    const edgeId = feature.properties?.edgeId || feature.properties?.id || feature.id;
    if (overriddenEdgeIds.has(String(edgeId))) continue;
    if (edgeIds.has(String(edgeId)) && !seen.has(String(edgeId))) {
      features.push(overlayFeature(feature, edgeId));
      seen.add(String(edgeId));
    }
  }
  for (const feature of manualFeatures) {
    const edgeId = feature.properties?.manualEdgeId || feature.properties?.id || feature.id;
    if (edgeIds.has(String(edgeId)) && !seen.has(String(edgeId))) {
      features.push(overlayFeature(feature, edgeId, { source: "manual" }));
      seen.add(String(edgeId));
    }
  }
  return {
    type: "FeatureCollection",
    features,
  };
}

function cwOverlayNetworkCollection() {
  if (!state.baseOverlay.loaded) return EMPTY_FEATURE_COLLECTION;
  const cache = state.baseOverlay.cache || (state.baseOverlay.cache = {});
  if (
    cache.cwOverlayNetworkCollection &&
    cache.cwOverlayNetworkOverlay === state.baseOverlay.overlay &&
    cache.cwOverlayNetworkGraphEdges === state.baseOverlay.graphEdges &&
    cache.cwOverlayNetworkManualEdges === state.baseOverlay.manualBaseEdges &&
    cache.cwOverlayNetworkActiveFeatures === state.activeFeatures
  ) {
    return cache.cwOverlayNetworkCollection;
  }

  const features = [];
  const activeById = new Map(
    state.activeFeatures
      .map(({ feature }) => [Number(feature.properties?.id), feature])
      .filter(([segmentId]) => Number.isInteger(segmentId)),
  );
  for (const mapping of Object.values(state.baseOverlay.overlay?.segments || {})) {
    const segmentId = Number(mapping?.segmentId);
    const segment = activeById.get(segmentId);
    if (mapping?.status !== "accepted_auto_match" || !segment || !Array.isArray(mapping.edgeRefs)) {
      continue;
    }

    const segmentName = mapping.segmentName || featureName(segment);
    for (const [edgeIndex, edgeRef] of normalizeOverlayEdgeRefs(mapping.edgeRefs).entries()) {
      const edgeId = String(edgeRef?.edgeId || "");
      const edgeFeature = graphFeatureForEdgeId(edgeId);
      if (!edgeId || edgeFeature?.geometry?.type !== "LineString") continue;
      features.push({
        ...edgeFeature,
        id: `cw-overlay-${segmentId}-${edgeIndex}-${edgeId}`,
        properties: {
          ...(edgeFeature.properties || {}),
          id: `cw-overlay-${segmentId}-${edgeIndex}-${edgeId}`,
          edgeId,
          overlaySegmentId: segmentId,
          overlaySegmentName: segmentName,
          overlaySequenceIndex: edgeRef.sequenceIndex ?? edgeIndex,
          roadType: segment.properties?.roadType || edgeFeature.properties?.roadType || "paved",
        },
      });
    }
  }

  cache.cwOverlayNetworkCollection = {
    type: "FeatureCollection",
    features,
  };
  cache.cwOverlayNetworkOverlay = state.baseOverlay.overlay;
  cache.cwOverlayNetworkGraphEdges = state.baseOverlay.graphEdges;
  cache.cwOverlayNetworkManualEdges = state.baseOverlay.manualBaseEdges;
  cache.cwOverlayNetworkActiveFeatures = state.activeFeatures;
  return cache.cwOverlayNetworkCollection;
}

function displayedOverlayEdgeRefs() {
  const segmentId = selectedSegmentId();
  const mapping = overlayMappingForSegment(segmentId);
  return Array.isArray(mapping?.edgeRefs) ? mapping.edgeRefs : edgeRefsForAutoMatch(segmentId);
}

function normalizeOverlayEdgeRefs(edgeRefs) {
  return [...(edgeRefs || [])]
    .sort((a, b) => Number(a.sequenceIndex ?? 0) - Number(b.sequenceIndex ?? 0))
    .map((edgeRef, sequenceIndex) => ({
      ...edgeRef,
      sequenceIndex,
    }));
}

function updateMapSources() {
  if (!map.getSource("segments")) return;
  setSourceData("segments", mapFeatureCollection());
  setSourceData("selected-segment-source", selectedFeatureCollection());
  setSourceData("vertices", vertexCollection());
  setSourceData("data-markers", dataMarkerCollection());
  setSourceData("draw-line", drawLineCollection());
  setSourceData("draw-points", drawPointCollection());
  setSourceData("base-graph-edges", baseGraphCollection());
  setSourceData("selected-base-graph-edge", selectedBaseGraphEdgeCollection());
  setSourceData("selected-match-preview", selectedMatchCollection());
  setSourceData("selected-overlay-edges", selectedOverlayEdgeCollection());
  setSourceData("cw-overlay-network", cwOverlayNetworkCollection());
  setSourceData("manual-base-edges", manualBaseEdgeCollection());
  setSourceData("compose-edge-pick", composeEdgePickCollection());
  if (map.getLayer("segments-layer")) {
    map.setFilter("segments-layer", unselectedFilter());
  }
  updateUnresolvedSegmentLayerFilter();
  if (map.getLayer("selected-manual-base-edge")) {
    map.setFilter("selected-manual-base-edge", selectedManualBaseEdgeFilter());
  }
  updateWorkspaceLayerVisibility();
}

function setSourceData(sourceId, data) {
  const source = map.getSource(sourceId);
  if (!source) return;
  const cached = state.mapSourceDataCache.get(sourceId);
  if (cached?.source === source && cached.data === data) {
    return;
  }
  source.setData(data);
  state.mapSourceDataCache.set(sourceId, { source, data });
}

function setLayerVisibility(layerId, visible) {
  if (!map.getLayer(layerId)) return;
  const visibility = visible ? "visible" : "none";
  if (map.getLayoutProperty(layerId, "visibility") === visibility) return;
  map.setLayoutProperty(layerId, "visibility", visibility);
}

function cwOverlayNetworkFeaturesAtPoint(point) {
  if (state.workspaceMode !== "overlay" || !map.getLayer("cw-overlay-network-hit-layer")) {
    return [];
  }
  return map.queryRenderedFeatures(point, { layers: ["cw-overlay-network-hit-layer"] });
}

function updateWorkspaceLayerVisibility() {
  const composing = isComposingNewSegmentEdges();
  const editingEdges = (state.editingEdgePickEdges || state.splittingEdgePickAt !== null) && isEdgePickedSelected();
  const showSegments = state.workspaceMode === "segments";
  const showSelectedSegment = state.workspaceMode !== "base";
  const showUnresolvedSegments =
    state.workspaceMode === "segments" && state.showUnresolvedSegments && state.baseOverlay.loaded;
  const showBaseWorkspaceGraph =
    state.baseOverlay.loaded && state.baseOverlay.enabled && state.workspaceMode !== "segments";
  const showBaseGraphVisual = showBaseWorkspaceGraph || showUnresolvedSegments || composing || editingEdges;
  const showBaseGraphHit = showBaseWorkspaceGraph || composing || editingEdges;
  const showBaseEdit = showBaseWorkspaceGraph && state.workspaceMode === "base";
  const showOverlay = showBaseWorkspaceGraph && state.workspaceMode === "overlay";

  setLayerVisibility("segments-layer", showSegments);
  setLayerVisibility("selected-segment", showSelectedSegment);
  setLayerVisibility("unresolved-segments-layer", showUnresolvedSegments);
  for (const layerId of ["base-graph-edges-layer", "manual-base-edges-layer"]) {
    setLayerVisibility(layerId, showBaseGraphVisual);
  }
  for (const layerId of ["base-graph-edges-hit-layer", "manual-base-edges-hit-layer"]) {
    setLayerVisibility(layerId, showBaseGraphHit);
  }
  for (const layerId of ["selected-base-graph-edge-layer", "selected-manual-base-edge"]) {
    setLayerVisibility(layerId, showBaseEdit);
  }
  for (const layerId of [
    "cw-overlay-network-layer",
    "cw-overlay-network-hit-layer",
    "selected-overlay-edges-layer",
    "selected-overlay-hovered-edge-layer",
    "selected-match-edges-layer",
    "selected-match-gaps-layer",
    "selected-match-continuity-gaps-layer",
    "selected-match-unmatched-samples-layer",
    "selected-match-distant-samples-layer",
  ]) {
    setLayerVisibility(layerId, showOverlay);
  }
  setLayerVisibility("compose-edge-pick-layer", composing);
  setLayerVisibility("compose-edge-pick-labels", composing);
}

function updateUnresolvedSegmentLayerFilter() {
  if (!map.getLayer("unresolved-segments-layer")) return;
  const unresolvedIds = state.showUnresolvedSegments ? state.unresolvedSegmentIds : [];
  const filterKey = unresolvedIds.join(",");
  if (state.unresolvedSegmentFilterKey === filterKey) return;
  state.unresolvedSegmentFilterKey = filterKey;
  map.setFilter(
    "unresolved-segments-layer",
    unresolvedIds.length > 0 ? ["in", ["get", "id"], ["literal", unresolvedIds]] : ["==", ["get", "id"], "__none__"],
  );
}

function updateSelectedSegmentEditSources() {
  if (!map.getSource("selected-segment-source")) return;
  map.getSource("selected-segment-source").setData(selectedFeatureCollection());
  map.getSource("vertices").setData(vertexCollection());
}

function updateDataMarkerSources() {
  if (!map.getSource("data-markers")) return;
  map.getSource("data-markers").setData(dataMarkerCollection());
}

function updateManualBaseEditSources() {
  if (!map.getSource("manual-base-edges")) return;
  map.getSource("manual-base-edges").setData(manualBaseEdgeCollection());
  map.getSource("vertices").setData(vertexCollection());
  if (map.getLayer("selected-manual-base-edge")) {
    map.setFilter("selected-manual-base-edge", selectedManualBaseEdgeFilter());
  }
}

function updateSelectedOverlayEdgeSources() {
  if (!map.getSource("selected-overlay-edges")) return;
  map.getSource("selected-overlay-edges").setData(selectedOverlayEdgeCollection());
}

function renderVertexSelectionState() {
  renderForm();
  if (state.workspaceMode === "base") {
    renderBaseGraphPanel();
    updateManualBaseEditSources();
  } else {
    renderDataList();
    updateSelectedSegmentEditSources();
    updateDataMarkerSources();
  }
}

function renderList() {
  const query = els.segmentSearch.value.trim().toLowerCase();
  els.segmentList.innerHTML = "";

  const rows = state.activeFeatures
    .map(({ feature }, index) => ({ feature, index }))
    .filter(({ feature }) => {
      if (!query) return true;
      return `${featureName(feature)} ${featureId(feature)}`.toLowerCase().includes(query);
    })
    .sort((a, b) => Number(featureId(a.feature)) - Number(featureId(b.feature)));

  for (const { feature, index } of rows) {
    const dataCount = dataForFeature(feature).length;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `segment-item${index === state.selectedIndex ? " active" : ""}${dataCount > 0 ? " has-data" : ""}`;
    button.innerHTML = `<strong>${escapeHtml(featureName(feature))}</strong><span>ID ${featureId(feature)} · ${feature.properties.roadType || "paved"}${dataCount > 0 ? ` · ${dataCount} data` : ""}</span>`;
    button.addEventListener("click", () => {
      selectFeatureByActiveIndex(index, true);
      setSegmentDrawer(false);
    });
    els.segmentList.appendChild(button);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function updateSelectedQuality(key, value) {
  const feature = selectedFeature();
  if (!feature || !QUALITY_FIELDS.some((field) => field.key === key)) return;

  feature.properties.quality = {
    ...qualityForFeature(feature),
    [key]: value,
  };
  markDirty();
  renderAll();
  setStatus(`Updated ${key} quality to ${value}/5.`);
}

function renderQualityControls(feature, disabled) {
  if (!els.segmentQuality) return;

  els.segmentQuality.hidden = !FEATURE_FLAGS.segmentQualityEditor;
  els.segmentQuality.innerHTML = "";
  if (!FEATURE_FLAGS.segmentQualityEditor) return;

  const quality = qualityForFeature(feature);

  const header = document.createElement("div");
  header.className = "quality-header";

  const title = document.createElement("span");
  title.className = "field-label";
  title.textContent = "Quality";
  header.appendChild(title);

  const summary = document.createElement("span");
  summary.className = "quality-summary";
  summary.textContent = `${quality.overall}/5`;
  header.appendChild(summary);
  els.segmentQuality.appendChild(header);

  const list = document.createElement("div");
  list.className = "quality-list";

  for (const field of QUALITY_FIELDS) {
    const row = document.createElement("div");
    row.className = "quality-row";

    const label = document.createElement("span");
    label.className = "quality-name";
    label.textContent = field.label;
    row.appendChild(label);

    const stars = document.createElement("div");
    stars.className = "quality-stars";
    const fieldValue = quality[field.key];
    for (let value = 1; value <= 5; value++) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `quality-star${value <= fieldValue ? " filled" : ""}`;
      button.textContent = "★";
      button.disabled = disabled;
      button.setAttribute("aria-label", `${field.label} ${value} out of 5`);
      button.setAttribute("aria-pressed", String(value === fieldValue));
      button.addEventListener("click", () => updateSelectedQuality(field.key, value));
      stars.appendChild(button);
    }
    row.appendChild(stars);

    const valueLabel = document.createElement("span");
    valueLabel.className = "quality-value";
    valueLabel.textContent = `${fieldValue}/5`;
    row.appendChild(valueLabel);

    list.appendChild(row);
  }

  els.segmentQuality.appendChild(list);
}

function renderNameRelease(feature, disabled) {
  if (!els.nameRelease) return;

  const name = feature?.properties?.name || "";
  const sourceIndex = selectedSourceIndex();
  const inactiveConflicts = feature ? inactiveNameConflicts(name, sourceIndex) : [];
  const activeConflicts = feature ? activeNameConflicts(name, sourceIndex) : [];
  const show = Boolean(feature && (inactiveConflicts.length > 0 || activeConflicts.length > 0));

  els.nameRelease.hidden = !show;
  els.releaseName.disabled = disabled || inactiveConflicts.length === 0 || activeConflicts.length > 0;

  if (!show) {
    els.nameReleaseMessage.textContent = "";
    return;
  }

  if (activeConflicts.length > 0) {
    els.nameReleaseMessage.textContent = "Name is used by another active segment.";
    return;
  }

  const recordText = inactiveConflicts.length === 1 ? "archived record" : "archived records";
  els.nameReleaseMessage.textContent = `Name held by ${inactiveConflicts.length} ${recordText}.`;
}

function renderBaseModeForm() {
  const feature = selectedManualBaseEdge();
  const coords = feature?.geometry?.coordinates || [];
  const vertexIndex = state.baseOverlay.selectedManualVertexIndex;
  const drawing = isDrawing();
  const canDeleteVertex = feature && !drawing && vertexIndex >= 0 && coords.length > 2;
  const canSplit = feature && !drawing && vertexIndex > 0 && vertexIndex < coords.length - 1;

  for (const input of [
    els.segmentName,
    els.segmentStatus,
    els.segmentRoadType,
    els.segmentTodo,
    els.segmentNotes,
  ]) {
    input.disabled = true;
  }

  renderQualityControls(null, true);
  renderNameRelease(null, true);
  els.deleteVertex.disabled = !canDeleteVertex;
  els.splitSegment.disabled = !canSplit;
  els.extendSegment.disabled = drawing || !feature;
  els.addData.disabled = true;

  if (!feature) {
    els.selectedCount.textContent = "No base edge selected";
    els.segmentId.value = "";
    els.segmentName.value = "";
    els.segmentStatus.value = "active";
    els.segmentRoadType.value = "paved";
    els.segmentTodo.value = "";
    els.segmentNotes.value = "";
    return;
  }

  els.selectedCount.textContent = `${selectedManualBaseEdgeId()} · ${coords.length} vertices`;
  els.segmentId.value = selectedManualBaseEdgeId() || "";
  els.segmentName.value = feature.properties?.linkedSegmentName || feature.properties?.name || "";
  els.segmentStatus.value = feature.properties?.status || "active";
  els.segmentRoadType.value = feature.properties?.roadType || "dirt";
  els.segmentTodo.value = "";
  els.segmentNotes.value = "";
}

function renderForm() {
  if (state.workspaceMode === "base") {
    renderBaseModeForm();
    return;
  }

  const feature = selectedFeature();
  const drawing = isDrawing();
  const canEditSegmentGeometry = state.workspaceMode === "segments" || state.workspaceMode === "overlay";
  const canEditSegmentFields = state.workspaceMode === "segments";
  const disabled = !feature || drawing || !canEditSegmentFields;
  const canSplit =
    feature &&
    !drawing &&
    canEditSegmentGeometry &&
    state.selectedVertexIndex > 0 &&
    state.selectedVertexIndex < feature.geometry.coordinates.length - 1;

  for (const input of [
    els.segmentName,
    els.segmentStatus,
    els.segmentRoadType,
    els.segmentTodo,
    els.segmentNotes,
  ]) {
    input.disabled = disabled;
  }
  renderQualityControls(feature, disabled);
  renderNameRelease(feature, disabled);

  els.deleteVertex.disabled = drawing || !feature || !canEditSegmentGeometry || state.selectedVertexIndex < 0;
  els.splitSegment.disabled = !canSplit;
  els.extendSegment.disabled = drawing || !feature || !canEditSegmentGeometry;
  els.addData.disabled = drawing || !feature || !canEditSegmentFields;

  if (!feature) {
    els.selectedCount.textContent = "None selected";
    els.segmentId.value = "";
    els.segmentName.value = "";
    els.segmentStatus.value = "active";
    els.segmentRoadType.value = "paved";
    els.segmentTodo.value = "";
    els.segmentNotes.value = "";
    renderNameRelease(null, true);
    return;
  }

  els.selectedCount.textContent = `ID ${feature.properties.id ?? "—"} · ${feature.geometry.coordinates.length} vertices`;
  els.segmentId.value = feature.properties.id ?? "";
  els.segmentName.value = feature.properties.name || "";
  els.segmentStatus.value = feature.properties.status || "active";
  els.segmentRoadType.value = feature.properties.roadType || "paved";
  els.segmentTodo.value = feature.properties.todo || "";
  els.segmentNotes.value = feature.properties.notes || "";
  renderNameRelease(feature, disabled);
}

function canFinishDraw() {
  if (!isDrawing()) return false;
  if (state.draw.type === "newSegmentEdges") {
    return Array.isArray(state.draw.edgeRefs) && state.draw.edgeRefs.length >= 1;
  }
  if (state.draw.type === "new" || state.draw.type === "manualBaseEdge") {
    return state.draw.coords.length >= 2;
  }
  return (
    (state.draw.type === "extend" || state.draw.type === "manualBaseEdgeExtend") &&
    Boolean(state.draw.endpoint) &&
    state.draw.coords.length >= 1
  );
}

function renderDrawControls() {
  const drawing = isDrawing();
  const segmentsMode = state.workspaceMode === "segments";
  const baseMode = state.workspaceMode === "base";
  const overlayMode = state.workspaceMode === "overlay";
  const editButtons = [
    els.addSegment,
    els.modeSelect,
    els.modeInsert,
    els.extendSegment,
    els.deleteVertex,
    els.splitSegment,
    els.toggleUnresolvedSegments,
    els.processChangedQueue,
    els.clearChangedQueue,
  ];

  for (const button of editButtons) {
    button.hidden = drawing;
  }

  if (!drawing) {
    const edgePicked = isEdgePickedSelected();
    els.addSegment.hidden = !segmentsMode;
    els.modeInsert.hidden = overlayMode || edgePicked;
    els.extendSegment.hidden = overlayMode || edgePicked;
    els.deleteVertex.hidden = overlayMode || edgePicked;
    els.splitSegment.hidden = overlayMode || edgePicked;
    els.toggleUnresolvedSegments.hidden = !segmentsMode;
    els.processChangedQueue.hidden = !segmentsMode;
    els.clearChangedQueue.hidden = !segmentsMode;
    els.toggleBaseOverlay.hidden = true;
    els.edgePickEditControls.hidden = !edgePicked;
    els.editSegmentEdges.classList.toggle("active", state.editingEdgePickEdges && edgePicked);
    els.splitSegmentEdge.classList.toggle("active", state.splittingEdgePickAt !== null && edgePicked);
  }

  els.drawDone.hidden = !drawing;
  els.drawCancel.hidden = !drawing;
  els.drawDone.disabled = !canFinishDraw();
  els.drawCancel.disabled = !drawing;
  const composing = drawing && state.draw.type === "newSegmentEdges";
  els.drawUndoLast.hidden = !composing;
  els.drawUndoLast.disabled = !composing || state.draw.edgeRefs.length === 0;
  els.drawFreehand.hidden = !composing;
  els.drawFreehand.disabled = !composing;
  els.mapToolbar.classList.toggle("drawing", drawing);
  els.addSegment.disabled = !state.source || drawing || !segmentsMode;
  els.toggleUnresolvedSegments.disabled = drawing || !segmentsMode || state.baseOverlay.loading;
  els.toggleUnresolvedSegments.classList.toggle("active", state.showUnresolvedSegments);
  els.toggleUnresolvedSegments.textContent =
    state.showUnresolvedSegments
      ? `Issues (${state.unresolvedSegmentIds.length})`
      : "Issues";
  els.processChangedQueue.disabled =
    drawing ||
    !segmentsMode ||
    state.processingChangedQueue ||
    state.baseOverlay.loading ||
    state.baseOverlay.recalculating ||
    state.changedSegmentIds.size === 0;
  els.processChangedQueue.textContent = state.processingChangedQueue
    ? "Running..."
    : `Run Queue (${state.changedSegmentIds.size})`;
  els.clearChangedQueue.disabled =
    drawing || !segmentsMode || state.processingChangedQueue || state.changedSegmentIds.size === 0;
  els.modeSelect.disabled = drawing;
  els.modeInsert.disabled =
    drawing ||
    overlayMode ||
    (baseMode
      ? !selectedManualBaseEdge()
      : !selectedFeature());
  els.saveSource.disabled = !state.dirty || drawing;
  els.runBuild.disabled = drawing;
  for (const group of document.querySelectorAll(".toolbar-group")) {
    group.hidden = [...group.children].every((child) => child.hidden);
  }
  updatePromoteButton();
}

function overlayMappingForSegment(segmentId) {
  if (segmentId === null) return null;
  return state.baseOverlay.overlay?.segments?.[String(segmentId)] || null;
}

function isEdgePickedSelected() {
  const segmentId = selectedSegmentId();
  if (segmentId === null) return false;
  const mapping = overlayMappingForSegment(segmentId);
  return mapping?.source === "edge_pick";
}

function isBaseOverlayMappingLocked(mapping) {
  return mapping?.status === "accepted_auto_match" || mapping?.status === "manual_base_edge_needed";
}

function isBaseGraphStale() {
  return Boolean(state.baseOverlay.graphEdges?.metadata?.graphStaleBecauseManualBaseEdgesChanged);
}

function baseGraphStaleReason() {
  const metadata = state.baseOverlay.graphEdges?.metadata || {};
  if (!metadata.graphStaleBecauseManualBaseEdgesChanged) return "";
  const graphTime = metadata.graphEdgesModifiedAt ? new Date(metadata.graphEdgesModifiedAt).toLocaleString() : "unknown";
  const manualTime = metadata.manualBaseEdgesModifiedAt
    ? new Date(metadata.manualBaseEdgesModifiedAt).toLocaleString()
    : "unknown";
  return `Manual base edges changed after graph build (${manualTime} > ${graphTime})`;
}

function markBaseGraphStaleBecauseManualEdgesChanged() {
  if (!state.baseOverlay.graphEdges) return;
  state.baseOverlay.graphEdges = {
    ...state.baseOverlay.graphEdges,
    metadata: {
      ...(state.baseOverlay.graphEdges.metadata || {}),
      manualBaseEdgesModifiedAt: new Date().toISOString(),
      graphStaleBecauseManualBaseEdgesChanged: true,
    },
  };
  invalidateBaseOverlayDerivedCache();
}

function graphEdgeIdSet() {
  return new Set(
    (state.baseOverlay.graphEdges?.features || [])
      .map((feature) => String(graphEdgeFeatureId(feature)))
      .filter(Boolean),
  );
}

function missingManualGraphEdgeIdsForSegment(segmentId) {
  if (segmentId === null || !state.baseOverlay.loaded) return [];
  const graphEdgeIds = graphEdgeIdSet();
  const requiredManualIds = new Set();

  for (const ref of edgeRefsForAutoMatch(segmentId)) {
    if (ref?.source !== "manual") continue;
    const edgeId = String(ref.edgeId || ref.manualEdgeId || "");
    if (edgeId) requiredManualIds.add(edgeId);
  }

  const linkedManualIds = manualBaseEdgeFeatures()
    .filter((feature) => Number(feature.properties?.linkedSegmentId) === Number(segmentId))
    .map((feature) => String(manualBaseEdgeFeatureId(feature)))
    .filter(Boolean);
  for (const edgeId of linkedManualIds) {
    requiredManualIds.add(edgeId);
  }

  return [...requiredManualIds].filter((edgeId) => !graphEdgeIds.has(edgeId));
}

function parseSequenceIndexes(value) {
  if (Array.isArray(value)) {
    return value.filter(Number.isInteger);
  }
  if (typeof value !== "string" || value.trim() === "") {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Number.isInteger) : [];
  } catch {
    return [];
  }
}

function edgeRefsForAutoMatch(segmentId) {
  const cache = state.baseOverlay.cache || (state.baseOverlay.cache = {});
  if (
    !cache.autoEdgeRefsBySegment ||
    cache.autoEdgeRefsMatchSummary !== state.baseOverlay.matchSummary ||
    cache.autoEdgeRefsMatchPreview !== state.baseOverlay.matchPreview ||
    cache.autoEdgeRefsManualEdges !== state.baseOverlay.manualBaseEdges
  ) {
    cache.autoEdgeRefsBySegment = new Map();
    cache.autoEdgeRefsMatchSummary = state.baseOverlay.matchSummary;
    cache.autoEdgeRefsMatchPreview = state.baseOverlay.matchPreview;
    cache.autoEdgeRefsManualEdges = state.baseOverlay.manualBaseEdges;
  }

  const cacheKey = String(segmentId);
  if (cache.autoEdgeRefsBySegment.has(cacheKey)) {
    return cache.autoEdgeRefsBySegment.get(cacheKey);
  }

  const match = matchSummaryForSegment(segmentId);
  if (!match) {
    cache.autoEdgeRefsBySegment.set(cacheKey, []);
    return [];
  }

  const previewByEdge = new Map();
  for (const feature of matchPreviewFeaturesForSegment(segmentId)) {
    const properties = feature.properties || {};
    if (properties.kind !== "matchedEdge" || !properties.edgeId) continue;
    previewByEdge.set(String(properties.edgeId), properties);
  }

  const refs = [];
  for (const [fallbackIndex, edgeId] of (match.edgeSequence || []).entries()) {
    const edgeIdString = String(edgeId);
    const properties = previewByEdge.get(String(edgeId));
    const sequenceIndexes = parseSequenceIndexes(properties?.sequenceIndexes);
    const sequenceIndex = sequenceIndexes.includes(fallbackIndex)
      ? fallbackIndex
      : sequenceIndexes.length === 1
        ? sequenceIndexes[0]
        : fallbackIndex;
    const manualFeature = manualBaseEdgeFeatures().find(
      (feature) => String(manualBaseEdgeFeatureId(feature)) === edgeIdString,
    );
    if (manualFeature) {
      const manualRef = edgeRefFromBaseFeature(manualFeature, sequenceIndex);
      if (manualRef) {
        refs.push({
          ...manualRef,
          direction: properties?.direction || manualRef.direction,
        });
        continue;
      }
    }
    refs.push({
      edgeId: edgeIdString,
      source: "osm",
      direction: properties?.direction || "unknown",
      sequenceIndex,
      fromFraction: 0,
      toFraction: 1,
      osmWayId: Number.isFinite(Number(properties?.osmWayId)) ? Number(properties.osmWayId) : undefined,
    });
  }

  const resolvedRefs = resolveOverriddenAutoEdgeRefs(refs.sort((a, b) => a.sequenceIndex - b.sequenceIndex));
  cache.autoEdgeRefsBySegment.set(cacheKey, resolvedRefs);
  return resolvedRefs;
}

function isFullAutoAcceptCandidate(match) {
  return (
    match?.failureClass === "accepted" &&
    match?.reviewStatus === "auto_accept_candidate" &&
    match?.confidence === "high" &&
    Number(match?.coverageRatio) >= 0.999 &&
    Number(match?.gapCount) === 0 &&
    !isOvermatchedMatch(match)
  );
}

function fullAutoAcceptCandidates() {
  const cache = state.baseOverlay.cache || (state.baseOverlay.cache = {});
  if (
    cache.fullAutoAcceptCandidates &&
    cache.fullAutoAcceptCandidatesMatchSummary === state.baseOverlay.matchSummary &&
    cache.fullAutoAcceptCandidatesGraphEdges === state.baseOverlay.graphEdges &&
    cache.fullAutoAcceptCandidatesManualEdges === state.baseOverlay.manualBaseEdges &&
    cache.fullAutoAcceptCandidatesActiveFeatures === state.activeFeatures
  ) {
    return cache.fullAutoAcceptCandidates;
  }
  cache.fullAutoAcceptCandidates = (state.baseOverlay.matchSummary?.segments || []).filter(
    (match) =>
      isActiveSegmentId(match.segmentId) &&
      isFullAutoAcceptCandidate(match) &&
      !isBaseGraphStale() &&
      missingManualGraphEdgeIdsForSegment(match.segmentId).length === 0,
  );
  cache.fullAutoAcceptCandidatesMatchSummary = state.baseOverlay.matchSummary;
  cache.fullAutoAcceptCandidatesGraphEdges = state.baseOverlay.graphEdges;
  cache.fullAutoAcceptCandidatesManualEdges = state.baseOverlay.manualBaseEdges;
  cache.fullAutoAcceptCandidatesActiveFeatures = state.activeFeatures;
  return cache.fullAutoAcceptCandidates;
}

function isOvermatchedMatch(match) {
  return (
    Boolean(match) &&
    (match.failureClass === "overmatched_edge" ||
      match.reviewStatus === "inspect_edge_sequence" ||
      Number(match.overmatchedEdgeCount || 0) > 0)
  );
}

function overmatchedEdgeLabel(match) {
  const count = Number(match?.overmatchedEdgeCount || match?.overmatchedEdges?.length || 0);
  const ratio = Number(match?.edgeLengthRatio);
  const edgeText =
    count > 0
      ? `${count} full base edge${count === 1 ? "" : "s"} have too little support`
      : "The matched base edge sequence is longer than the CW segment";
  return Number.isFinite(ratio) ? `${edgeText} · ${formatPercent(ratio)} edge/segment length` : edgeText;
}

function boundarySliverEdges(match) {
  const sequence = Array.isArray(match?.edgeSequence) ? match.edgeSequence.map(String) : [];
  const firstEdgeId = sequence[0];
  const lastEdgeId = sequence[sequence.length - 1];
  return (Array.isArray(match?.overmatchedEdges) ? match.overmatchedEdges : [])
    .filter((edge) => (edge.suspiciousReasons || []).includes("boundary_sliver_low_support"))
    .map((edge) => {
      const edgeId = String(edge.edgeId || "");
      return {
        ...edge,
        edgeId,
        side: edgeId === firstEdgeId ? "start" : edgeId === lastEdgeId ? "end" : null,
      };
    })
    .filter((edge) => edge.side);
}

function graphFeatureForEdgeId(edgeId) {
  const id = String(edgeId || "");
  if (!id) return null;
  const cache = state.baseOverlay.cache || (state.baseOverlay.cache = {});
  if (
    !cache.baseFeaturesByEdgeId ||
    cache.baseFeaturesByEdgeIdGraphEdges !== state.baseOverlay.graphEdges ||
    cache.baseFeaturesByEdgeIdManualEdges !== state.baseOverlay.manualBaseEdges
  ) {
    cache.baseFeaturesByEdgeId = new Map();
    for (const feature of state.baseOverlay.graphEdges?.features || []) {
      const featureId = graphEdgeFeatureId(feature);
      if (featureId) cache.baseFeaturesByEdgeId.set(String(featureId), feature);
    }
    for (const feature of manualBaseEdgeFeatures()) {
      const featureId = manualBaseEdgeFeatureId(feature);
      if (featureId && !cache.baseFeaturesByEdgeId.has(String(featureId))) {
        cache.baseFeaturesByEdgeId.set(String(featureId), feature);
      }
    }
    cache.baseFeaturesByEdgeIdGraphEdges = state.baseOverlay.graphEdges;
    cache.baseFeaturesByEdgeIdManualEdges = state.baseOverlay.manualBaseEdges;
  }
  return cache.baseFeaturesByEdgeId.get(id) || null;
}

function coordDistanceMeters(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return Infinity;
  return haversineMeters(a, b);
}

function closestEndpointPair(featureA, featureB) {
  const coordsA = featureA?.geometry?.coordinates || [];
  const coordsB = featureB?.geometry?.coordinates || [];
  if (coordsA.length === 0 || coordsB.length === 0) return null;
  const endpointsA = [coordsA[0], coordsA[coordsA.length - 1]];
  const endpointsB = [coordsB[0], coordsB[coordsB.length - 1]];
  let best = null;
  for (const endpointA of endpointsA) {
    for (const endpointB of endpointsB) {
      const distanceMeters = coordDistanceMeters(endpointA, endpointB);
      if (!best || distanceMeters < best.distanceMeters) {
        best = {
          sliverEndpoint: endpointA,
          adjacentEndpoint: endpointB,
          distanceMeters,
        };
      }
    }
  }
  return best;
}

function closestPointOnCoordsMeters(pointCoord, coords) {
  if (!Array.isArray(pointCoord) || !Array.isArray(coords) || coords.length < 2) return null;
  const originLat = pointCoord[1];
  const point = projectMeters(pointCoord[0], pointCoord[1], originLat);
  let travelledMeters = 0;
  let best = null;

  for (let index = 0; index < coords.length - 1; index++) {
    const startCoord = coords[index];
    const endCoord = coords[index + 1];
    const start = projectMeters(startCoord[0], startCoord[1], originLat);
    const end = projectMeters(endCoord[0], endCoord[1], originLat);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lenSq));
    const projected = {
      x: start.x + dx * t,
      y: start.y + dy * t,
    };
    const distanceMeters = Math.hypot(point.x - projected.x, point.y - projected.y);
    const segmentMeters = haversineMeters(startCoord, endCoord);
    if (!best || distanceMeters < best.distanceMeters) {
      best = {
        index,
        t,
        distanceMeters,
        alongMeters: travelledMeters + segmentMeters * t,
        coord: [
          startCoord[0] + (endCoord[0] - startCoord[0]) * t,
          startCoord[1] + (endCoord[1] - startCoord[1]) * t,
          interpolateElevation(startCoord, endCoord, t),
        ],
      };
    }
    travelledMeters += segmentMeters;
  }

  return best;
}

function interpolateElevation(startCoord, endCoord, t) {
  const startElevation = Number(startCoord?.[2]);
  const endElevation = Number(endCoord?.[2]);
  if (Number.isFinite(startElevation) && Number.isFinite(endElevation)) {
    return startElevation + (endElevation - startElevation) * t;
  }
  if (Number.isFinite(startElevation)) return startElevation;
  if (Number.isFinite(endElevation)) return endElevation;
  return undefined;
}

function normalizedCoord(coord) {
  const result = [roundCoord(coord[0]), roundCoord(coord[1])];
  if (Number.isFinite(Number(coord[2]))) {
    result.push(Number(Number(coord[2]).toFixed(1)));
  }
  return result;
}

function coordsNearlyEqual(a, b, toleranceMeters = 1) {
  return coordDistanceMeters(a, b) <= toleranceMeters;
}

function trimmedCoordsFromStart(coords, projection) {
  const snap = normalizedCoord(projection.coord);
  let remainder = coords.slice(projection.index + 1).map((coord) => coord.slice());
  if (remainder.length > 0 && coordsNearlyEqual(snap, remainder[0])) {
    remainder = remainder.slice(1);
  }
  return [snap, ...remainder];
}

function trimmedCoordsToEnd(coords, projection) {
  const snap = normalizedCoord(projection.coord);
  let prefix = coords.slice(0, projection.index + 1).map((coord) => coord.slice());
  if (prefix.length > 0 && coordsNearlyEqual(prefix[prefix.length - 1], snap)) {
    prefix = prefix.slice(0, -1);
  }
  return [...prefix, snap];
}

function boundarySnapTargets(match) {
  const sequence = Array.isArray(match?.edgeSequence) ? match.edgeSequence.map(String) : [];
  const slivers = boundarySliverEdges(match);
  const targets = [];

  for (const sliver of slivers) {
    const sequenceIndex = sliver.side === "start" ? 0 : sequence.length - 1;
    const adjacentEdgeId = sliver.side === "start" ? sequence[sequenceIndex + 1] : sequence[sequenceIndex - 1];
    const sliverFeature = graphFeatureForEdgeId(sliver.edgeId);
    const adjacentFeature = graphFeatureForEdgeId(adjacentEdgeId);
    const endpointPair = closestEndpointPair(sliverFeature, adjacentFeature);
    if (!adjacentEdgeId || !endpointPair) continue;
    targets.push({
      side: sliver.side,
      sliverEdgeId: sliver.edgeId,
      adjacentEdgeId,
      targetCoord: endpointPair.adjacentEndpoint,
      edgeEndpointDistanceMeters: endpointPair.distanceMeters,
    });
  }

  return targets;
}

function boundarySnapPlan(match, feature) {
  const coords = feature?.geometry?.coordinates || [];
  const targets = boundarySnapTargets(match);
  const actions = [];
  const skipped = [];
  if (coords.length < 2 || targets.length === 0) {
    return { actions, skipped };
  }

  const routeLength = routeLengthMeters(coords);
  for (const target of targets) {
    const projection = closestPointOnCoordsMeters(target.targetCoord, coords);
    if (!projection) {
      skipped.push({ ...target, reason: "No projection on selected CW segment." });
      continue;
    }
    const endpointCoord = target.side === "start" ? coords[0] : coords[coords.length - 1];
    const trimMeters = target.side === "start" ? projection.alongMeters : routeLength - projection.alongMeters;
    const moveMeters = coordDistanceMeters(endpointCoord, target.targetCoord);
    if (projection.distanceMeters > 35) {
      skipped.push({ ...target, reason: `Target is ${Math.round(projection.distanceMeters)}m from the CW line.` });
      continue;
    }
    if (trimMeters > MAX_BOUNDARY_SNAP_DISTANCE_M) {
      skipped.push({ ...target, reason: `Boundary trim is ${Math.round(trimMeters)}m.` });
      continue;
    }
    actions.push({
      ...target,
      projection,
      moveMeters,
      trimMeters,
    });
  }

  return { actions, skipped };
}

function boundarySnapSummary(plan) {
  if (!plan?.actions?.length) return "";
  return plan.actions
    .map((action) => `${action.side} ${Math.round(action.trimMeters)}m to ${action.adjacentEdgeId}`)
    .join(", ");
}

function orientedEdgeRefCoords(edgeRef) {
  const feature = graphFeatureForEdgeId(edgeRef?.edgeId);
  const coords = feature?.geometry?.coordinates || [];
  if (coords.length < 2) return [];
  const normalized = coords.map((coord) => coord.slice());
  return edgeRef?.direction === "reverse" ? normalized.reverse() : normalized;
}

function orientedEdgeRefNodes(edgeRef) {
  const feature = graphFeatureForEdgeId(edgeRef?.edgeId);
  const fromNodeId = feature?.properties?.fromNodeId;
  const toNodeId = feature?.properties?.toNodeId;
  if (!fromNodeId || !toNodeId) return null;
  return edgeRef?.direction === "reverse"
    ? { start: String(toNodeId), end: String(fromNodeId) }
    : { start: String(fromNodeId), end: String(toNodeId) };
}

function edgeRefContinuityGaps(edgeRefs) {
  const sortedRefs = [...(edgeRefs || [])].sort(
    (a, b) => Number(a.sequenceIndex ?? 0) - Number(b.sequenceIndex ?? 0),
  );
  const gaps = [];
  for (let index = 0; index < sortedRefs.length - 1; index++) {
    const fromRef = sortedRefs[index];
    const toRef = sortedRefs[index + 1];
    const fromCoords = orientedEdgeRefCoords(fromRef);
    const toCoords = orientedEdgeRefCoords(toRef);
    if (fromCoords.length === 0 || toCoords.length === 0) continue;
    const distanceMeters = coordDistanceMeters(fromCoords[fromCoords.length - 1], toCoords[0]);
    const fromNodes = orientedEdgeRefNodes(fromRef);
    const toNodes = orientedEdgeRefNodes(toRef);
    const topologyMismatch = Boolean(
      fromNodes?.end &&
      toNodes?.start &&
      fromNodes.end !== toNodes.start,
    );
    if (topologyMismatch || distanceMeters > MAX_EDGE_CONNECTION_GAP_M) {
      gaps.push({
        fromEdgeId: String(fromRef.edgeId || ""),
        toEdgeId: String(toRef.edgeId || ""),
        sequenceIndex: index,
        distanceMeters,
        issue: topologyMismatch
          ? "edge topology nodes do not connect"
          : "edge endpoints are spatially disconnected",
        fromNodeId: topologyMismatch ? fromNodes.end : undefined,
        toNodeId: topologyMismatch ? toNodes.start : undefined,
      });
    }
  }
  return gaps;
}

function emptyOverlayValidationReport() {
  return {
    accepted: 0,
    stale: 0,
    disconnected: 0,
    lengthMismatch: 0,
    duplicateEdges: 0,
    duplicateSegments: 0,
    autoDisconnected: 0,
    bySegment: new Map(),
  };
}

function overlayValidationForSegment(report, segmentId) {
  const key = String(segmentId);
  if (!report.bySegment.has(key)) {
    report.bySegment.set(key, {
      staleIssues: [],
      continuityGaps: [],
      lengthIssue: null,
      duplicateEdges: [],
      autoContinuityGaps: [],
    });
  }
  return report.bySegment.get(key);
}

function sourceFeatureForSegmentId(segmentId) {
  const id = Number(segmentId);
  if (!Number.isInteger(id)) return null;
  return state.activeFeatures.find(({ feature }) => Number(feature.properties?.id) === id)?.feature || null;
}

function acceptedMappingLengthIssue(mapping) {
  if (!mapping?.edgeRefs?.length) return null;
  const sourceFeature = sourceFeatureForSegmentId(mapping.segmentId);
  const sourceCoords = sourceFeature?.geometry?.coordinates || [];
  if (sourceCoords.length < 2) return null;

  const acceptedLengthMeters = mapping.edgeRefs.reduce((total, edgeRef) => {
    const coords = orientedEdgeRefCoords(edgeRef);
    return total + (coords.length >= 2 ? routeLengthMeters(coords) : 0);
  }, 0);
  const sourceLengthMeters = routeLengthMeters(sourceCoords);
  if (acceptedLengthMeters <= 0 || sourceLengthMeters <= 0) return null;

  const ratio = acceptedLengthMeters / sourceLengthMeters;
  const issue = {
    acceptedLengthMeters,
    sourceLengthMeters,
    ratio,
    reason: `${Math.round(acceptedLengthMeters)}m accepted vs ${Math.round(sourceLengthMeters)}m source`,
  };
  if (ratio < ACCEPTED_LENGTH_BLOCK_MIN_RATIO || ratio > ACCEPTED_LENGTH_BLOCK_MAX_RATIO) {
    return { ...issue, severity: "blocker" };
  }
  if (ratio < ACCEPTED_LENGTH_WARNING_MIN_RATIO || ratio > ACCEPTED_LENGTH_WARNING_MAX_RATIO) {
    return { ...issue, severity: "warning" };
  }
  return null;
}

function baseOverlayValidationReport() {
  if (!state.baseOverlay.loaded) return emptyOverlayValidationReport();
  const cache = state.baseOverlay.cache || (state.baseOverlay.cache = {});
  if (
    cache.validationReport &&
    cache.validationReportOverlay === state.baseOverlay.overlay &&
    cache.validationReportGraphEdges === state.baseOverlay.graphEdges &&
    cache.validationReportManualEdges === state.baseOverlay.manualBaseEdges &&
    cache.validationReportMatchSummary === state.baseOverlay.matchSummary &&
    cache.validationReportActiveFeatures === state.activeFeatures
  ) {
    return cache.validationReport;
  }

  const report = emptyOverlayValidationReport();
  const edgeOwners = new Map();
  const activeIds = activeSegmentIdSet();
  const mappings = Object.values(state.baseOverlay.overlay?.segments || {}).filter(
    (mapping) =>
      mapping?.status === "accepted_auto_match" &&
      Array.isArray(mapping.edgeRefs) &&
      activeIds.has(Number(mapping.segmentId)),
  );
  report.accepted = mappings.length;

  for (const mapping of mappings) {
    const segmentValidation = overlayValidationForSegment(report, mapping.segmentId);
    segmentValidation.staleIssues = overlayMappingEdgeRefIssues(mapping);
    if (segmentValidation.staleIssues.length > 0) {
      report.stale += 1;
    }

    segmentValidation.continuityGaps = edgeRefContinuityGaps(mapping.edgeRefs);
    if (segmentValidation.continuityGaps.length > 0) {
      report.disconnected += 1;
    }

    segmentValidation.lengthIssue = acceptedMappingLengthIssue(mapping);
    if (segmentValidation.lengthIssue) {
      report.lengthMismatch += 1;
    }

    for (const ref of mapping.edgeRefs) {
      const edgeId = String(ref.edgeId || "");
      if (!edgeId) continue;
      if (!edgeOwners.has(edgeId)) {
        edgeOwners.set(edgeId, []);
      }
      edgeOwners.get(edgeId).push({
        segmentId: Number(mapping.segmentId),
        segmentName: mapping.segmentName || `Segment ${mapping.segmentId}`,
      });
    }
  }

  for (const [edgeId, owners] of edgeOwners.entries()) {
    const uniqueOwners = owners.filter(
      (owner, index) => owners.findIndex((other) => other.segmentId === owner.segmentId) === index,
    );
    if (uniqueOwners.length <= 1) continue;
    report.duplicateEdges += 1;
    for (const owner of uniqueOwners) {
      const segmentValidation = overlayValidationForSegment(report, owner.segmentId);
      segmentValidation.duplicateEdges.push({
        edgeId,
        owners: uniqueOwners,
      });
    }
  }
  report.duplicateSegments = [...report.bySegment.values()].filter(
    (segmentValidation) => segmentValidation.duplicateEdges.length > 0,
  ).length;

  for (const match of state.baseOverlay.matchSummary?.segments || []) {
    if (!activeIds.has(Number(match.segmentId))) continue;
    if (Number(match.continuityGapCount || 0) <= 0) continue;
    const segmentValidation = overlayValidationForSegment(report, match.segmentId);
    segmentValidation.autoContinuityGaps = match.continuityGaps || [];
    report.autoDisconnected += 1;
  }

  cache.validationReport = report;
  cache.validationReportOverlay = state.baseOverlay.overlay;
  cache.validationReportGraphEdges = state.baseOverlay.graphEdges;
  cache.validationReportManualEdges = state.baseOverlay.manualBaseEdges;
  cache.validationReportMatchSummary = state.baseOverlay.matchSummary;
  cache.validationReportActiveFeatures = state.activeFeatures;
  return report;
}

function validationForSegment(segmentId) {
  return baseOverlayValidationReport().bySegment.get(String(segmentId)) || {
    staleIssues: [],
    continuityGaps: [],
    lengthIssue: null,
    duplicateEdges: [],
    autoContinuityGaps: [],
  };
}

function reviewedEdgeSetValidation(segmentId, edgeRefs) {
  const activeIds = activeSegmentIdSet();
  const duplicateEdges = [];
  const acceptedMappings = Object.values(state.baseOverlay.overlay?.segments || {}).filter(
    (mapping) =>
      mapping?.status === "accepted_auto_match" &&
      Array.isArray(mapping.edgeRefs) &&
      activeIds.has(Number(mapping.segmentId)) &&
      Number(mapping.segmentId) !== Number(segmentId),
  );
  const ownersByEdge = new Map();
  for (const mapping of acceptedMappings) {
    for (const ref of mapping.edgeRefs) {
      const edgeId = String(ref.edgeId || "");
      if (!edgeId) continue;
      if (!ownersByEdge.has(edgeId)) ownersByEdge.set(edgeId, []);
      ownersByEdge.get(edgeId).push({
        segmentId: Number(mapping.segmentId),
        segmentName: mapping.segmentName || `Segment ${mapping.segmentId}`,
      });
    }
  }

  for (const ref of edgeRefs || []) {
    const edgeId = String(ref.edgeId || "");
    const owners = ownersByEdge.get(edgeId);
    if (!edgeId || !owners?.length) continue;
    duplicateEdges.push({
      edgeId,
      owners: [{ segmentId: Number(segmentId), segmentName: selectedName() }, ...owners],
    });
  }

  return {
    staleIssues: [],
    continuityGaps: edgeRefContinuityGaps(edgeRefs),
    duplicateEdges,
    autoContinuityGaps: [],
  };
}

function autoMatchMapping(match, edgeRefs, source = "auto_match") {
  return {
    segmentId: Number(match.segmentId),
    segmentName: match.segmentName || "",
    status: "accepted_auto_match",
    source,
    confidence: match.confidence,
    coverageRatio: match.coverageRatio,
    avgDistanceMeters: match.avgDistanceMeters,
    gapCount: match.gapCount,
    failureClass: match.failureClass,
    edgeRefs,
    updatedAt: new Date().toISOString(),
  };
}

function reviewedOverlayMapping(segmentId, feature, match, edgeRefs, source = "reviewed_edge_set") {
  return {
    segmentId: Number(segmentId),
    segmentName: featureName(feature),
    status: "accepted_auto_match",
    source,
    confidence: match?.confidence || "reviewed",
    coverageRatio: match?.coverageRatio ?? 0,
    avgDistanceMeters: match?.avgDistanceMeters ?? null,
    gapCount: match?.gapCount ?? 0,
    failureClass: match?.failureClass || "reviewed",
    edgeRefs: normalizeOverlayEdgeRefs(edgeRefs),
    updatedAt: new Date().toISOString(),
  };
}

function edgeRefFromBaseFeature(feature, sequenceIndex) {
  const properties = feature?.properties || {};
  const edgeId = properties.edgeId || properties.manualEdgeId || properties.id || feature?.id;
  if (!edgeId) return null;
  const source = properties.source === "manual" ? "manual" : "osm";
  const edgeRef = {
    edgeId: String(edgeId),
    source,
    direction: "forward",
    sequenceIndex,
    fromFraction: 0,
    toFraction: 1,
  };
  if (source === "manual") {
    edgeRef.manualEdgeId = String(properties.manualEdgeId || edgeId);
  } else if (Number.isFinite(Number(properties.osmWayId))) {
    edgeRef.osmWayId = Number(properties.osmWayId);
  }
  return edgeRef;
}

function replacementRefsForOverriddenEdge(edgeRef) {
  const edgeId = String(edgeRef?.edgeId || "");
  if (!edgeId) return [];

  let replacements = manualBaseEdgeFeatures().filter((feature) => {
    const properties = feature.properties || {};
    return String(properties.copiedFromEdgeId || "") === edgeId;
  });
  if (edgeRef.direction === "reverse") {
    replacements = [...replacements].reverse();
  }

  return replacements
    .map((feature, replacementIndex) => {
      const ref = edgeRefFromBaseFeature(feature, Number(edgeRef.sequenceIndex) + replacementIndex / 1000);
      if (!ref) return null;
      return {
        ...ref,
        direction: edgeRef.direction || ref.direction,
        fromFraction: edgeRef.fromFraction ?? 0,
        toFraction: edgeRef.toFraction ?? 1,
        replacedEdgeId: edgeId,
        replacedOsmWayId: edgeRef.osmWayId,
      };
    })
    .filter(Boolean);
}

function resolveOverriddenAutoEdgeRefs(edgeRefs) {
  return edgeRefs
    .flatMap((edgeRef) => {
      const replacements = replacementRefsForOverriddenEdge(edgeRef);
      return replacements.length > 0 ? replacements : [edgeRef];
    })
    .map((edgeRef, sequenceIndex) => ({
      ...edgeRef,
      sequenceIndex,
    }));
}

function visibleBaseGraphEdgeIds() {
  const cache = state.baseOverlay.cache || (state.baseOverlay.cache = {});
  if (
    cache.visibleEdgeIds &&
    cache.visibleEdgeIdsGraphEdges === state.baseOverlay.graphEdges &&
    cache.visibleEdgeIdsManualEdges === state.baseOverlay.manualBaseEdges &&
    cache.visibleEdgeIdsEnabled === state.baseOverlay.enabled
  ) {
    return cache.visibleEdgeIds;
  }
  cache.visibleEdgeIds = new Set([
    ...(baseGraphCollection().features || []).map((feature) => String(graphEdgeFeatureId(feature))).filter(Boolean),
    ...manualBaseEdgeFeatures().map((feature) => String(manualBaseEdgeFeatureId(feature))).filter(Boolean),
  ]);
  cache.visibleEdgeIdsGraphEdges = state.baseOverlay.graphEdges;
  cache.visibleEdgeIdsManualEdges = state.baseOverlay.manualBaseEdges;
  cache.visibleEdgeIdsEnabled = state.baseOverlay.enabled;
  return cache.visibleEdgeIds;
}

function overlayMappingEdgeRefIssues(mapping) {
  if (!mapping?.edgeRefs?.length || !state.baseOverlay.loaded) {
    return [];
  }

  const visibleEdgeIds = visibleBaseGraphEdgeIds();
  const overriddenEdgeIds = overriddenBaseGraphEdgeIds();
  const issues = [];
  for (const ref of mapping.edgeRefs) {
    const edgeId = String(ref.edgeId || "");
    if (!edgeId) continue;
    if (overriddenEdgeIds.has(edgeId)) {
      issues.push({
        edgeId,
        kind: "overridden",
        reason: "The referenced OSM edge has an editable manual override.",
      });
    } else if (!visibleEdgeIds.has(edgeId)) {
      issues.push({
        edgeId,
        kind: "missing",
        reason: "The referenced base edge is not present in the current graph.",
      });
    }
  }
  return issues;
}

function conflictingSegmentForEdgeFromOverlay(edgeId, excludeSegmentId) {
  return conflictingSegmentForEdge(
    edgeId,
    excludeSegmentId,
    state.baseOverlay.overlay?.segments || {},
  );
}

function baseEdgeGeometryLookup() {
  const lookup = new Map();
  for (const feature of state.baseOverlay.graphEdges?.features || []) {
    lookup.set(String(graphEdgeFeatureId(feature)), feature.geometry);
  }
  for (const feature of manualBaseEdgeFeatures()) {
    lookup.set(String(manualBaseEdgeFeatureId(feature)), feature.geometry);
  }
  return lookup;
}

function renderComposeStatus() {
  const composing = isComposingNewSegmentEdges();
  if (!composing) {
    els.composeEdgeStatus.hidden = true;
    els.composeEdgeStatus.innerHTML = "";
    return;
  }
  const edgeCount = state.draw.edgeRefs.length;
  if (edgeCount === 0) {
    els.composeEdgeStatus.hidden = false;
    els.composeEdgeStatus.textContent = "Click base edges to compose the new segment.";
    return;
  }
  const normalized = normalizeOverlayEdgeRefs(state.draw.edgeRefs);
  const gaps = edgeRefContinuityGaps(normalized);
  const conflicts = state.draw.edgeRefs
    .map((ref) => {
      const owner = conflictingSegmentForEdgeFromOverlay(ref.edgeId, -1);
      return owner ? { ...owner, edgeId: ref.edgeId } : null;
    })
    .filter(Boolean);
  const continuityLine = gaps.length === 0
    ? `<div class="compose-ok">✓ continuous (${edgeCount} edges)</div>`
    : `<div class="compose-bad">Gap between edge ${gaps[0].sequenceIndex + 1} and ${gaps[0].sequenceIndex + 2} (${Math.round(gaps[0].distanceMeters)}m)</div>`;
  const conflictLine = conflicts.length === 0
    ? `<div class="compose-ok">✓ exclusive</div>`
    : `<div class="compose-bad">Edge ${conflicts[0].edgeId || ""} already owned by ${conflicts[0].segmentName || `segment ${conflicts[0].segmentId}`}</div>`;
  els.composeEdgeStatus.hidden = false;
  els.composeEdgeStatus.innerHTML = continuityLine + conflictLine;
}

async function saveEdgePickedMapping(segmentId, feature, edgeRefs) {
  const continuityGaps = edgeRefContinuityGaps(edgeRefs);
  const acceptedMappings = new Map();
  for (const mapping of Object.values(state.baseOverlay.overlay?.segments || {})) {
    if (!mapping || (mapping.status !== "accepted_edge_set" && mapping.status !== "accepted_auto_match")) continue;
    if (Number(mapping.segmentId) === Number(segmentId)) continue;
    for (const ref of mapping.edgeRefs || []) {
      acceptedMappings.set(String(ref.edgeId), { segmentId: mapping.segmentId, segmentName: mapping.segmentName });
    }
  }
  const validation = validateEdgePickMapping({ segmentId, edgeRefs, acceptedMappings, continuityGaps });

  const coords = stitchCoordsFromEdgeRefs(edgeRefs, baseEdgeGeometryLookup());
  if (coords.length >= 2) {
    feature.geometry.coordinates = coords;
  }

  const existing = state.baseOverlay.overlay?.segments?.[String(segmentId)] || {};
  const mapping = {
    ...existing,
    segmentId,
    segmentName: featureName(feature),
    source: "edge_pick",
    status: validation.ok ? "accepted_edge_set" : "needs_edit",
    edgeRefs,
    confidence: "manual",
    coverageRatio: 1,
    avgDistanceMeters: null,
    gapCount: continuityGaps.length,
    failureClass: validation.ok ? null : validation.failureClass,
    failureMessage: validation.ok ? null : validation.message,
    updatedAt: new Date().toISOString(),
  };
  await saveSelectedBaseOverlayMapping(mapping);
  queueChangedFeature(feature);
  markDirty();
  renderAll();
  setStatus(
    validation.ok
      ? `Updated ${featureName(feature)} (${edgeRefs.length} edges).`
      : `Updated ${featureName(feature)} but mapping needs edit: ${validation.message}`,
  );
}

async function splitEdgePickedAtClickedEdge(feature) {
  const segmentId = selectedSegmentId();
  const selected = selectedFeature();
  if (segmentId === null || !selected) return;
  const mapping = state.baseOverlay.overlay?.segments?.[String(segmentId)] || {};
  const refs = normalizeOverlayEdgeRefs(mapping.edgeRefs || []);
  const ref = edgeRefFromBaseFeature(feature, 0);
  if (!ref) return;
  const boundaryIndex = refs.findIndex((r) => String(r.edgeId) === String(ref.edgeId));
  if (boundaryIndex <= 0 || boundaryIndex >= refs.length) {
    setStatus("Pick an internal edge to split here (not the first or last).", "error");
    return;
  }
  const firstHalf = refs.slice(0, boundaryIndex).map((r, i) => ({ ...r, sequenceIndex: i }));
  const secondHalf = refs.slice(boundaryIndex).map((r, i) => ({ ...r, sequenceIndex: i }));

  const edgeLookup = baseEdgeGeometryLookup();
  const firstCoords = stitchCoordsFromEdgeRefs(firstHalf, edgeLookup);
  const secondCoords = stitchCoordsFromEdgeRefs(secondHalf, edgeLookup);
  if (firstCoords.length < 2 || secondCoords.length < 2) {
    setStatus("Split would leave an empty half. Cancelled.", "error");
    return;
  }

  const childAId = nextSegmentId();
  const childAName = uniqueSegmentName(`${featureName(selected)} A`);
  const childA = {
    type: "Feature",
    properties: {
      id: childAId,
      name: childAName,
      status: "active",
      roadType: selected.properties.roadType || "paved",
      quality: selected.properties.quality || defaultQuality(),
    },
    geometry: { type: "LineString", coordinates: firstCoords },
  };
  state.source.features.push(childA);

  const childBId = nextSegmentId();
  const childBName = uniqueSegmentName(`${featureName(selected)} B`);
  const childB = {
    type: "Feature",
    properties: {
      id: childBId,
      name: childBName,
      status: "active",
      roadType: selected.properties.roadType || "paved",
      quality: selected.properties.quality || defaultQuality(),
    },
    geometry: { type: "LineString", coordinates: secondCoords },
  };
  state.source.features.push(childB);

  selected.properties = {
    ...selected.properties,
    status: "deprecated",
    deprecated: true,
    routeAnchors: selected.geometry.coordinates.map((c) => [c[0], c[1]]),
  };
  selected.geometry = null;

  const overlaySegments = { ...(state.baseOverlay.overlay?.segments || {}) };
  delete overlaySegments[String(segmentId)];
  state.baseOverlay.overlay = {
    ...emptyBaseOverlay(),
    ...state.baseOverlay.overlay,
    segments: overlaySegments,
  };
  await saveBaseOverlay();
  await saveEdgePickedMapping(childAId, childA, firstHalf);
  await saveEdgePickedMapping(childBId, childB, secondHalf);

  state.splittingEdgePickAt = null;
  refreshActiveFeatures();
  state.selectedIndex = state.activeFeatures.findIndex((r) => r.sourceIndex === state.source.features.length - 1);
  markDirty();
  renderAll();
  setStatus(`Split ${featureName(selected)} into ${childAName} and ${childBName}.`);
}

async function toggleEdgeInEdgePickedSegment(feature) {
  const segmentId = selectedSegmentId();
  const selected = selectedFeature();
  if (segmentId === null || !selected) return;
  const existing = state.baseOverlay.overlay?.segments?.[String(segmentId)] || {};
  const currentRefs = normalizeOverlayEdgeRefs(existing.edgeRefs || []);
  const ref = edgeRefFromBaseFeature(feature, currentRefs.length);
  if (!ref) return;
  const existingIdx = currentRefs.findIndex(
    (r) => String(r.edgeId) === String(ref.edgeId),
  );
  let nextRefs;
  if (existingIdx >= 0) {
    nextRefs = currentRefs.filter((_, i) => i !== existingIdx);
  } else {
    nextRefs = orientAppendedEdgeRef(currentRefs, ref, baseEdgeGeometryLookup());
  }
  nextRefs = normalizeOverlayEdgeRefs(nextRefs);
  await saveEdgePickedMapping(segmentId, selected, nextRefs);
}

function toggleEdgeInCompose(feature) {
  if (!isComposingNewSegmentEdges()) return;
  const ref = edgeRefFromBaseFeature(feature, state.draw.edgeRefs.length);
  if (!ref) return;
  const currentIdx = state.draw.edgeRefs.findIndex(
    (existing) => String(existing.edgeId) === String(ref.edgeId),
  );
  if (currentIdx >= 0) {
    state.draw.edgeRefs = state.draw.edgeRefs
      .filter((_, i) => i !== currentIdx)
      .map((existing, i) => ({ ...existing, sequenceIndex: i }));
    setStatus(`Removed base edge ${ref.edgeId} from draft.`);
  } else {
    state.draw.edgeRefs = orientAppendedEdgeRef(
      state.draw.edgeRefs,
      ref,
      baseEdgeGeometryLookup(),
    );
    setStatus(`Added base edge ${ref.edgeId} to draft (${state.draw.edgeRefs.length} edges).`);
  }
  updateMapSources();
  renderDrawControls();
  renderComposeStatus();
}

async function toggleSelectedOverlayBaseEdge(feature) {
  if (state.workspaceMode !== "overlay") return;
  if (!state.baseOverlay.loaded) {
    await loadBaseOverlayData();
  }

  const segmentId = selectedSegmentId();
  const selected = selectedFeature();
  if (!selected || segmentId === null) {
    setStatus("Select a CW segment before choosing base graph edges.", "error");
    return;
  }

  const existing = overlayMappingForSegment(segmentId);
  if (isBaseOverlayMappingLocked(existing)) {
    setStatus("Clear the saved base overlay mapping before changing its base edges.", "error");
    return;
  }
  const edgeRefs = normalizeOverlayEdgeRefs(existing?.edgeRefs?.length ? existing.edgeRefs : edgeRefsForAutoMatch(segmentId));
  const ref = edgeRefFromBaseFeature(feature, edgeRefs.length);
  if (!ref) return;

  const existingIndex = edgeRefs.findIndex((edgeRef) => String(edgeRef.edgeId) === ref.edgeId);
  let nextRefs;
  if (existingIndex >= 0) {
    nextRefs = edgeRefs.filter((_edgeRef, index) => index !== existingIndex);
  } else {
    nextRefs = [...edgeRefs, ref];
  }
  nextRefs = normalizeOverlayEdgeRefs(nextRefs);

  const match = matchSummaryForSegment(segmentId);
  await saveSelectedBaseOverlayMapping({
    ...(existing || {}),
    segmentId,
    segmentName: featureName(selected),
    status: "needs_edit",
    source: "edge_review",
    confidence: match?.confidence || existing?.confidence || "manual",
    coverageRatio: match?.coverageRatio ?? existing?.coverageRatio ?? 0,
    avgDistanceMeters: match?.avgDistanceMeters ?? existing?.avgDistanceMeters ?? null,
    gapCount: match?.gapCount ?? existing?.gapCount ?? 0,
    failureClass: match?.failureClass || existing?.failureClass || "edge_review",
    edgeRefs: nextRefs,
    updatedAt: new Date().toISOString(),
  });
  setStatus(
    existingIndex >= 0
      ? `Removed base edge ${ref.edgeId} from ${featureName(selected)}.`
      : `Added base edge ${ref.edgeId} to ${featureName(selected)}.`,
  );
}

async function removeSelectedOverlayEdgeRef(edgeIndex) {
  if (state.workspaceMode !== "overlay") return;
  if (!state.baseOverlay.loaded) {
    await loadBaseOverlayData();
  }

  const segmentId = selectedSegmentId();
  const selected = selectedFeature();
  if (!selected || segmentId === null) {
    setStatus("Select a CW segment before removing base graph edges.", "error");
    return;
  }
  if (isBaseOverlayMappingLocked(overlayMappingForSegment(segmentId))) {
    setStatus("Clear the accepted base overlay mapping before changing its base edges.", "error");
    return;
  }

  const currentRefs = normalizeOverlayEdgeRefs(displayedOverlayEdgeRefs());
  if (edgeIndex < 0 || edgeIndex >= currentRefs.length) {
    setStatus("That base edge is no longer in the reviewed mapping.", "error");
    return;
  }

  const removed = currentRefs[edgeIndex];
  const nextRefs = normalizeOverlayEdgeRefs(currentRefs.filter((_edgeRef, index) => index !== edgeIndex));
  const match = matchSummaryForSegment(segmentId);
  await saveSelectedBaseOverlayMapping({
    segmentId,
    segmentName: featureName(selected),
    status: "needs_edit",
    source: "edge_review",
    confidence: match?.confidence || "manual",
    coverageRatio: match?.coverageRatio ?? 0,
    avgDistanceMeters: match?.avgDistanceMeters ?? null,
    gapCount: match?.gapCount ?? 0,
    failureClass: match?.failureClass || "edge_review",
    edgeRefs: nextRefs,
    updatedAt: new Date().toISOString(),
  });
  setStatus(`Removed base edge ${removed.edgeId} from ${featureName(selected)}. Accept when the reviewed edge set is ready.`);
}

function overlayNetworkStatus(match) {
  const segmentId = Number(match?.segmentId);
  const mapping = overlayMappingForSegment(segmentId);
  const validation = validationForSegment(segmentId);
  const missingManualGraphEdges = missingManualGraphEdgeIdsForSegment(segmentId);
  if (missingManualGraphEdges.length > 0) {
    return {
      key: "base_graph_stale",
      label: "Graph stale",
      reason: `${missingManualGraphEdges.length} manual override edge${
        missingManualGraphEdges.length === 1 ? "" : "s"
      } not folded into the base graph`,
      resolved: false,
    };
  }
  if (mapping?.status === "accepted_auto_match") {
    const edgeRefIssues = overlayMappingEdgeRefIssues(mapping);
    if (edgeRefIssues.length > 0) {
      return {
        key: "stale_mapping",
        label: "Stale mapping",
        reason: `${edgeRefIssues.length} saved base edge ref${
          edgeRefIssues.length === 1 ? "" : "s"
        } no longer match the editable base graph`,
        resolved: false,
      };
    }
    if (validation.duplicateEdges.length > 0) {
      return {
        key: "duplicate_edge",
        label: "Duplicate edge",
        reason: `${validation.duplicateEdges.length} base edge${
          validation.duplicateEdges.length === 1 ? "" : "s"
        } also belong to another CW segment`,
        resolved: false,
      };
    }
    if (validation.continuityGaps.length > 0) {
      return {
        key: "disconnected_edges",
        label: "Disconnected",
        reason: `${validation.continuityGaps.length} gap${
          validation.continuityGaps.length === 1 ? "" : "s"
        } between saved base edge refs`,
        resolved: false,
      };
    }
    if (validation.lengthIssue) {
      return {
        key: validation.lengthIssue.severity === "blocker" ? "length_mismatch" : "length_warning",
        label: validation.lengthIssue.severity === "blocker" ? "Length mismatch" : "Length warning",
        reason: `${validation.lengthIssue.reason} (${formatPercent(validation.lengthIssue.ratio)})`,
        resolved: false,
      };
    }
    if (mapping.source !== "reviewed_edge_set" && isOvermatchedMatch(match)) {
      return {
        key: "overmatched_edge",
        label: "Overmatched edge",
        reason: `Saved mapping needs review. ${overmatchedEdgeLabel(match)}`,
        resolved: false,
      };
    }
    return {
      key: "accepted",
      label: "Accepted",
      reason: `${mapping.edgeRefs?.length || 0} saved base edge refs`,
      resolved: true,
    };
  }
  if (mapping?.status === "manual_base_edge_needed") {
    return {
      key: "manual_base_edge_needed",
      label: "Manual base edge",
      reason: "Saved as needing a manually drawn base edge",
      resolved: false,
    };
  }
  if (mapping?.status === "needs_edit") {
    return {
      key: "needs_edit",
      label: "Review draft",
      reason: `${mapping.edgeRefs?.length || 0} reviewed base edge refs waiting for accept`,
      resolved: false,
    };
  }
  if (!match) {
    return {
      key: "missing_match",
      label: "No match data",
      reason: "No matcher output exists for this segment",
      resolved: false,
    };
  }
  if (isFullAutoAcceptCandidate(match)) {
    return {
      key: "full_auto_pending",
      label: "Auto pending",
      reason: "Full high-confidence auto match is not saved yet",
      resolved: false,
    };
  }
  if (match.failureClass === "disconnected_edges" || match.reviewStatus === "inspect_continuity") {
    return {
      key: "disconnected_edges",
      label: "Disconnected",
      reason: `${Number(match.continuityGapCount || 0)} continuity ${
        Number(match.continuityGapCount || 0) === 1 ? "gap" : "gaps"
      } in the matched base edge sequence`,
      resolved: false,
    };
  }
  if (isOvermatchedMatch(match)) {
    return {
      key: "overmatched_edge",
      label: "Overmatched edge",
      reason: overmatchedEdgeLabel(match),
      resolved: false,
    };
  }
  if (match.failureClass === "osm_missing" || match.reviewStatus === "needs_manual_edge_candidate") {
    return {
      key: "missing_base_edge",
      label: "Missing base edge",
      reason: "The CW route mostly has no nearby OSM/base edge",
      resolved: false,
    };
  }
  if (Number(match.gapCount) > 0) {
    return {
      key: "partial_gap",
      label: "Partial gap",
      reason: `${match.gapCount} unmatched ${match.gapCount === 1 ? "gap" : "gaps"} in the CW line`,
      resolved: false,
    };
  }
  if (match.reviewStatus === "manual_review" || match.failureClass === "manual_review") {
    return {
      key: "manual_review",
      label: "Manual review",
      reason: "Matcher signals are mixed",
      resolved: false,
    };
  }
  return {
    key: "not_saved",
    label: "Not saved",
    reason: "No accepted overlay mapping is saved",
    resolved: false,
  };
}

function baseOverlayReviewRows() {
  const cache = state.baseOverlay.cache || (state.baseOverlay.cache = {});
  if (
    cache.reviewRows &&
    cache.reviewRowsOverlay === state.baseOverlay.overlay &&
    cache.reviewRowsGraphEdges === state.baseOverlay.graphEdges &&
    cache.reviewRowsManualEdges === state.baseOverlay.manualBaseEdges &&
    cache.reviewRowsMatchSummary === state.baseOverlay.matchSummary &&
    cache.reviewRowsActiveFeatures === state.activeFeatures
  ) {
    return cache.reviewRows;
  }
  cache.reviewRows = (state.baseOverlay.matchSummary?.segments || [])
    .filter((match) => isActiveSegmentId(match.segmentId))
    .map((match) => ({
      match,
      status: overlayNetworkStatus(match),
    }))
    .sort((a, b) => {
      if (a.status.resolved !== b.status.resolved) return a.status.resolved ? 1 : -1;
      const statusOrder = {
        base_graph_stale: 0,
        missing_base_edge: 1,
        manual_base_edge_needed: 2,
        partial_gap: 3,
        disconnected_edges: 4,
        duplicate_edge: 5,
        length_mismatch: 6,
        length_warning: 7,
        overmatched_edge: 8,
        stale_mapping: 9,
        manual_review: 10,
        needs_edit: 11,
        full_auto_pending: 12,
        not_saved: 13,
        accepted: 14,
      };
      const orderA = statusOrder[a.status.key] ?? 50;
      const orderB = statusOrder[b.status.key] ?? 50;
      if (orderA !== orderB) return orderA - orderB;
      return Number(a.match.segmentId) - Number(b.match.segmentId);
    });
  cache.reviewRowsOverlay = state.baseOverlay.overlay;
  cache.reviewRowsGraphEdges = state.baseOverlay.graphEdges;
  cache.reviewRowsManualEdges = state.baseOverlay.manualBaseEdges;
  cache.reviewRowsMatchSummary = state.baseOverlay.matchSummary;
  cache.reviewRowsActiveFeatures = state.activeFeatures;
  return cache.reviewRows;
}

function baseOverlayReviewCounts(rows = baseOverlayReviewRows()) {
  const counts = {
    total: rows.length,
    accepted: 0,
    issues: 0,
    unresolved: 0,
    missingBaseEdge: 0,
    partialGap: 0,
    disconnected: 0,
    duplicateEdge: 0,
    lengthMismatch: 0,
    overmatchedEdge: 0,
    manualReview: 0,
    autoPending: 0,
  };

  for (const row of rows) {
    if (row.status.resolved) {
      counts.accepted += 1;
      continue;
    }
    counts.issues += 1;
    counts.unresolved += 1;
    if (
      row.status.key === "missing_base_edge" ||
      row.status.key === "manual_base_edge_needed" ||
      row.status.key === "base_graph_stale"
    ) {
      counts.missingBaseEdge += 1;
    } else if (row.status.key === "partial_gap") {
      counts.partialGap += 1;
    } else if (row.status.key === "disconnected_edges") {
      counts.disconnected += 1;
    } else if (row.status.key === "duplicate_edge") {
      counts.duplicateEdge += 1;
    } else if (row.status.key === "length_mismatch" || row.status.key === "length_warning") {
      counts.lengthMismatch += 1;
    } else if (row.status.key === "overmatched_edge") {
      counts.overmatchedEdge += 1;
    } else if (row.status.key === "manual_review" || row.status.key === "needs_edit" || row.status.key === "stale_mapping") {
      counts.manualReview += 1;
    } else if (row.status.key === "full_auto_pending") {
      counts.autoPending += 1;
    }
  }

  return counts;
}

function bulkAcceptSummaryText() {
  if (!state.baseOverlay.loaded) return "Load Base Graph to see bulk candidates.";
  const candidates = fullAutoAcceptCandidates();
  const segments = state.baseOverlay.overlay?.segments || {};
  const saved = candidates.filter((match) => segments[String(match.segmentId)]?.status === "accepted_auto_match").length;
  const preserved = Object.values(segments).filter(
    (mapping) => mapping?.status,
  ).length;
  const remaining = Math.max(0, candidates.length - saved);
  const preservedText = preserved > 0 ? ` · ${preserved} saved mappings preserved` : "";
  return `${candidates.length} full auto-match candidates · ${saved} saved · ${remaining} remaining${preservedText}`;
}

function selectSegmentById(segmentId, fit = true) {
  const activeIndex = state.activeFeatures.findIndex(
    ({ feature }) => Number(feature.properties?.id) === Number(segmentId),
  );
  if (activeIndex < 0) {
    setStatus(`Segment ${segmentId} is not active in the editor source.`, "error");
    return false;
  }
  selectFeatureByActiveIndex(activeIndex, fit);
  return true;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

function renderBaseOverlayReviewQueue() {
  els.baseOverlayReviewStats.innerHTML = "";
  els.baseOverlayReviewList.innerHTML = "";
  els.baseOverlayValidation.innerHTML = "";

  if (!state.baseOverlay.loaded) {
    els.baseOverlayReviewStats.innerHTML = "";
    els.baseOverlayValidation.innerHTML = "";
    els.baseOverlayReviewList.innerHTML = `<div class="empty-state">Load Base Graph to see CycleWays overlay issues.</div>`;
    return;
  }

  const rows = baseOverlayReviewRows();
  const counts = baseOverlayReviewCounts(rows);
  const validation = baseOverlayValidationReport();
  const stats = [
    ["Accepted", counts.accepted],
    ["Issues", counts.issues],
    ["Missing", counts.missingBaseEdge],
    ["Gaps", counts.partialGap],
    ["Continuity", counts.disconnected],
    ["Duplicate", counts.duplicateEdge],
    ["Length", counts.lengthMismatch],
    ["Overmatch", counts.overmatchedEdge],
    ["Review", counts.manualReview],
  ];
  if (counts.autoPending > 0) {
    stats.push(["Auto pending", counts.autoPending]);
  }

  const validationIssues = [
    isBaseGraphStale() ? "base graph needs recalculation" : null,
    validation.stale > 0 ? `${validation.stale} stale` : null,
    validation.disconnected > 0 ? `${validation.disconnected} disconnected saved` : null,
    validation.lengthMismatch > 0 ? `${validation.lengthMismatch} length mismatch${validation.lengthMismatch === 1 ? "" : "es"}` : null,
    validation.duplicateEdges > 0 ? `${validation.duplicateEdges} duplicate edge${validation.duplicateEdges === 1 ? "" : "s"}` : null,
    validation.autoDisconnected > 0 ? `${validation.autoDisconnected} calculated continuity issue${
      validation.autoDisconnected === 1 ? "" : "s"
    }` : null,
  ].filter(Boolean);
  els.baseOverlayValidation.innerHTML =
    validationIssues.length > 0
      ? `<strong>Validation</strong><span>${escapeHtml(validationIssues.join(" · "))}</span>`
      : `<strong>Validation</strong><span>No saved overlay validation issues.</span>`;

  for (const [label, value] of stats) {
    const item = document.createElement("div");
    item.className = `base-overlay-stat${label === "Issues" && value > 0 ? " unresolved" : ""}`;
    item.innerHTML = `<strong>${value}</strong><span>${escapeHtml(label)}</span>`;
    els.baseOverlayReviewStats.appendChild(item);
  }

  const issueRows = rows.filter((row) => !row.status.resolved);
  if (issueRows.length === 0) {
    els.baseOverlayReviewList.innerHTML = `<div class="empty-state">All active CW segments have accepted base overlay mappings.</div>`;
    return;
  }

  const header = document.createElement("div");
  header.className = "base-overlay-review-heading";
  header.textContent = "Issue segments";
  els.baseOverlayReviewList.appendChild(header);

  const selectedId = selectedSegmentId();
  for (const row of issueRows) {
    const match = row.match;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `base-overlay-review-item status-${row.status.key}${
      Number(match.segmentId) === selectedId ? " active" : ""
    }`;
    button.innerHTML = `
      <strong>${escapeHtml(match.segmentName || `Segment ${match.segmentId}`)}</strong>
      <span>${escapeHtml(row.status.label)} · ${formatPercent(match.coverageRatio)} · ${
        Number(match.gapCount) || 0
      } gaps</span>
      <small>${escapeHtml(row.status.reason)}</small>
    `;
    button.addEventListener("click", () => {
      selectSegmentById(match.segmentId, true);
      setStatus(`Reviewing ${match.segmentName || `segment ${match.segmentId}`}: ${row.status.label}.`);
    });
    els.baseOverlayReviewList.appendChild(button);
  }
}

function renderWorkspaceChrome() {
  els.workspaceSegments.classList.toggle("active", state.workspaceMode === "segments");
  els.workspaceBase.classList.toggle("active", state.workspaceMode === "base");
  els.workspaceOverlay.classList.toggle("active", state.workspaceMode === "overlay");
  els.workspaceVideoSync.classList.toggle("active", state.workspaceMode === "video-sync");
  els.workspaceRouteCatalog.classList.toggle("active", state.workspaceMode === "route-catalog");
  els.baseGraphPanel.hidden = state.workspaceMode !== "base";
  els.cwOverlayPanel.hidden = state.workspaceMode !== "overlay";
  els.videoSyncPanel.hidden = state.workspaceMode !== "video-sync";
  els.routeCatalogPanel.hidden = state.workspaceMode !== "route-catalog";
  els.toggleBaseOverlay.classList.toggle("active", state.baseOverlay.enabled);
  els.toggleBaseOverlay.disabled = state.baseOverlay.loading || state.baseOverlay.recalculating;
}

function renderBaseGraphPanel() {
  if (state.workspaceMode !== "base") return;

  const loaded = state.baseOverlay.loaded;
  const loading = state.baseOverlay.loading;
  const recalculating = state.baseOverlay.recalculating;
  const manualCount = manualBaseEdgeFeatures().length;
  const graphCount = state.baseOverlay.graphEdges?.features?.length || 0;
  const graphManualCount = (state.baseOverlay.graphEdges?.features || []).filter(
    (feature) => feature.properties?.source === "manual",
  ).length;
  const selected = selectedManualBaseEdge();
  const selectedId = selectedManualBaseEdgeId();
  const selectedGraphEdge = selectedBaseGraphEdge();
  const selectedGraphProperties = selectedGraphEdge?.properties || {};
  const selectedGraphId = graphEdgeFeatureId(selectedGraphEdge);
  const selectedVertex = state.baseOverlay.selectedManualVertexIndex;
  const coords = selected?.geometry?.coordinates || [];

  els.baseGraphStatus.textContent = recalculating ? "Recalculating" : loading ? "Loading" : loaded ? "Loaded" : "Not loaded";
  els.newManualBaseEdge.disabled = loading || recalculating || isDrawing() || !loaded;
  els.cloneBaseGraphEdge.disabled =
    loading ||
    recalculating ||
    isDrawing() ||
    !loaded ||
    !selectedGraphEdge ||
    selectedGraphProperties.source === "manual";
  els.deleteManualBaseEdge.disabled = loading || recalculating || isDrawing() || !selected;
  els.splitManualBaseEdge.disabled =
    loading || recalculating || isDrawing() || !selected || selectedVertex <= 0 || selectedVertex >= coords.length - 1;
  els.recalculateOsmGraph.disabled = loading || recalculating || isDrawing() || !loaded;
  els.recalculateOsmGraph.textContent = recalculating ? "Recalculating..." : "Recalculate Graph + Matches";

  if (loading) {
    els.baseGraphSummary.innerHTML = `<div class="empty-state">Loading OSM graph artifacts...</div>`;
    els.baseGraphHelp.textContent = "Manual edges are stored separately until recalculation folds them into the graph.";
    return;
  }

  if (!loaded) {
    els.baseGraphSummary.innerHTML = `<div class="empty-state">Switch to Base Graph mode to load the graph artifacts.</div>`;
    els.baseGraphHelp.textContent = "Manual edges are stored separately from OSM.";
    return;
  }

  const selectedLine = selected
    ? `Manual ${selectedId} · ${coords.length} vertices${selectedVertex >= 0 ? ` · vertex ${selectedVertex + 1}` : ""}`
    : selectedGraphEdge
      ? `OSM ${selectedGraphId} · ${Math.round(Number(selectedGraphProperties.distanceMeters) || 0)}m · ${
          selectedGraphProperties.highway || selectedGraphProperties.osmRouteClass || "edge"
        }`
      : "No edge selected";
  els.baseGraphSummary.innerHTML = `
    <dl class="base-overlay-metrics">
      <div><dt>Graph edges</dt><dd>${graphCount}</dd></div>
      <div><dt>Manual edges</dt><dd>${manualCount} staged · ${graphManualCount} in graph</dd></div>
      <div><dt>Selected</dt><dd>${escapeHtml(selectedLine)}</dd></div>
    </dl>
  `;
  els.baseGraphHelp.textContent = selected
    ? "Drag vertices to reshape. Use Insert near the selected line to add a vertex, or Split on an internal vertex."
    : selectedGraphEdge
      ? "OSM edges are generated and read-only. Use Copy Selected to create an editable manual edge from this geometry."
      : "Click any base graph edge to inspect it. Create a new manual edge, or copy a selected OSM edge to edit it.";
}

function renderBaseOverlayPanel() {
  if (state.workspaceMode !== "overlay") return;

  const segmentId = selectedSegmentId();
  const selected = selectedFeature();
  const match = matchSummaryForSegment(segmentId);
  const mapping = overlayMappingForSegment(segmentId);
  const loaded = state.baseOverlay.loaded;
  const enabled = state.baseOverlay.enabled;
  const reviewedEdgeRefs = normalizeOverlayEdgeRefs(displayedOverlayEdgeRefs());

  els.toggleBaseOverlay.classList.toggle("active", enabled);
  els.toggleBaseOverlay.disabled = state.baseOverlay.loading || state.baseOverlay.recalculating;
  els.bulkAcceptBaseOverlay.disabled =
    state.baseOverlay.loading || state.baseOverlay.recalculating || (loaded && fullAutoAcceptCandidates().length === 0);
  els.bulkAcceptBaseOverlay.textContent = loaded
    ? `Bulk Accept Full Auto Matches (${fullAutoAcceptCandidates().length})`
    : "Bulk Accept Full Auto Matches";
  els.baseOverlayBulkSummary.textContent = bulkAcceptSummaryText();
  renderBaseOverlayReviewQueue();

  if (!selected) {
    els.baseOverlayStatus.textContent = loaded ? "No segment" : "Not loaded";
    els.baseOverlaySummary.innerHTML = `<div class="empty-state">Select a segment to review its base graph mapping.</div>`;
    els.acceptBaseOverlay.disabled = true;
    els.recalculateSelectedOverlay.disabled = true;
    els.recalculateSelectedOverlay.textContent = "Recalculate Selected";
    els.snapBoundaryOverlay.disabled = true;
    els.markManualBaseOverlay.disabled = true;
    els.clearBaseOverlay.disabled = true;
    els.baseOverlayEdges.innerHTML = "";
    return;
  }

  if (state.baseOverlay.loading) {
    els.baseOverlayStatus.textContent = "Loading";
    els.baseOverlaySummary.innerHTML = `<div class="empty-state">Loading OSM graph artifacts...</div>`;
    els.acceptBaseOverlay.disabled = true;
    els.recalculateSelectedOverlay.disabled = true;
    els.recalculateSelectedOverlay.textContent = "Recalculate Selected";
    els.snapBoundaryOverlay.disabled = true;
    els.markManualBaseOverlay.disabled = true;
    els.clearBaseOverlay.disabled = true;
    els.baseOverlayEdges.innerHTML = "";
    return;
  }

  if (!loaded) {
    els.baseOverlayStatus.textContent = "Not loaded";
    els.baseOverlaySummary.innerHTML = `<div class="empty-state">Turn on Base Graph to load OSM match data.</div>`;
    els.acceptBaseOverlay.disabled = true;
    els.recalculateSelectedOverlay.disabled = true;
    els.recalculateSelectedOverlay.textContent = "Recalculate Selected";
    els.snapBoundaryOverlay.disabled = true;
    els.markManualBaseOverlay.disabled = true;
    els.clearBaseOverlay.disabled = !mapping;
    els.baseOverlayEdges.innerHTML = "";
    return;
  }

  const mappingStatus = mapping?.status || "not_saved";
  const mappingLocked = isBaseOverlayMappingLocked(mapping);
  const edgeRefIssues = overlayMappingEdgeRefIssues(mapping);
  const validation = validationForSegment(segmentId);
  const reviewedValidation =
    mapping?.status === "accepted_auto_match" ? validation : reviewedEdgeSetValidation(segmentId, reviewedEdgeRefs);
  const missingManualGraphEdges = missingManualGraphEdgeIdsForSegment(segmentId);
  const baseGraphStaleForSegment = isBaseGraphStale() || missingManualGraphEdges.length > 0;
  const snapPlan = boundarySnapPlan(match, selected);
  els.baseOverlayStatus.textContent =
    baseGraphStaleForSegment
      ? "base graph stale"
      : edgeRefIssues.length > 0
        ? "stale mapping"
        : mappingStatus.replaceAll("_", " ");
  const matchLine = match
    ? `${formatPercent(match.coverageRatio)} coverage · ${match.confidence} · ${match.gapCount} gaps`
    : "No auto match";
  const savedLine = mapping
    ? mapping.manualEdgeIds?.length
      ? `${mapping.manualEdgeIds.length} manual base edge${mapping.manualEdgeIds.length === 1 ? "" : "s"} drawn · ${new Date(mapping.updatedAt || state.baseOverlay.overlay.updatedAt || Date.now()).toLocaleString()}`
      : `${mapping.edgeRefs.length} saved edge refs · ${new Date(mapping.updatedAt || state.baseOverlay.overlay.updatedAt || Date.now()).toLocaleString()}`
    : "No saved mapping";
  const issueLine =
    edgeRefIssues.length > 0
      ? `<div><dt>Issue</dt><dd>${escapeHtml(edgeRefIssues.map((issue) => issue.edgeId).join(", "))}</dd></div>`
      : "";
  const graphStaleLine =
    baseGraphStaleForSegment
      ? `<div><dt>Graph</dt><dd>${escapeHtml(
          isBaseGraphStale()
            ? `Run Recalculate Graph + Matches. ${baseGraphStaleReason()}`
            : `Run Recalculate Graph + Matches. Missing ${missingManualGraphEdges.join(", ")}`,
        )}</dd></div>`
      : "";
  const diagnostics = matchPreviewFeaturesForSegment(segmentId).filter(
    (feature) => feature.properties?.kind === "unmatchedSample" || feature.properties?.kind === "distantSample",
  );
  const diagnosticLine =
    diagnostics.length > 0
      ? `<div><dt>Samples</dt><dd>${diagnostics.filter((feature) => feature.properties?.kind === "unmatchedSample").length} unmatched · ${diagnostics.filter((feature) => feature.properties?.kind === "distantSample").length} distant</dd></div>`
      : "";
  const overmatchedEdges = Array.isArray(match?.overmatchedEdges) ? match.overmatchedEdges : [];
  const overmatchLine =
    overmatchedEdges.length > 0
      ? `<div><dt>Overmatch</dt><dd>${escapeHtml(
          overmatchedEdges
            .slice(0, 3)
            .map(
              (edge) =>
                `${edge.edgeId} ${Math.round(Number(edge.edgeLengthMeters) || 0)}m/${Number(edge.sampleCount) || 0} samples`,
            )
            .join(", "),
        )}${overmatchedEdges.length > 3 ? ` +${overmatchedEdges.length - 3}` : ""}</dd></div>`
      : "";
  const edgeLengthLine =
    Number.isFinite(Number(match?.edgeLengthRatio)) && Number(match.edgeLengthRatio) > 1
      ? `<div><dt>Edge length</dt><dd>${formatPercent(Number(match.edgeLengthRatio))} of segment length</dd></div>`
      : "";
  const continuityLine =
    reviewedValidation.continuityGaps.length > 0 || Number(match?.continuityGapCount || 0) > 0
      ? `<div><dt>Continuity</dt><dd>${escapeHtml(
          reviewedValidation.continuityGaps.length > 0
            ? `${reviewedValidation.continuityGaps
                .slice(0, 2)
                .map((gap) => `${gap.fromEdgeId} -> ${gap.toEdgeId} ${Math.round(gap.distanceMeters)}m`)
                .join(", ")}${
                reviewedValidation.continuityGaps.length > 2
                  ? ` +${reviewedValidation.continuityGaps.length - 2}`
                  : ""
              }`
            : `${match.continuityGapCount} calculated gap${match.continuityGapCount === 1 ? "" : "s"}`,
        )}</dd></div>`
      : "";
  const duplicateLine =
    reviewedValidation.duplicateEdges.length > 0
      ? `<div><dt>Duplicate</dt><dd>${escapeHtml(
          reviewedValidation.duplicateEdges
            .slice(0, 2)
            .map((issue) => `${issue.edgeId} with ${issue.owners.map((owner) => owner.segmentId).join(", ")}`)
            .join("; "),
        )}${
          reviewedValidation.duplicateEdges.length > 2 ? ` +${reviewedValidation.duplicateEdges.length - 2}` : ""
        }</dd></div>`
      : "";
  const snapLine =
    snapPlan.actions.length > 0
      ? `<div><dt>Snap</dt><dd>${escapeHtml(boundarySnapSummary(snapPlan))}</dd></div>`
      : "";

  els.baseOverlaySummary.innerHTML = `
    <dl class="base-overlay-metrics">
      <div><dt>Auto match</dt><dd>${escapeHtml(matchLine)}</dd></div>
      <div><dt>Classification</dt><dd>${escapeHtml(match?.failureClass || "—")}</dd></div>
      <div><dt>Saved</dt><dd>${escapeHtml(savedLine)}</dd></div>
      ${issueLine}
      ${graphStaleLine}
      ${diagnosticLine}
      ${overmatchLine}
      ${edgeLengthLine}
      ${continuityLine}
      ${duplicateLine}
      ${snapLine}
    </dl>
  `;

  els.acceptBaseOverlay.disabled =
    baseGraphStaleForSegment ||
    mappingLocked ||
    state.baseOverlay.recalculating ||
    reviewedEdgeRefs.length === 0;
  els.recalculateSelectedOverlay.disabled =
    mappingLocked ||
    state.baseOverlay.loading ||
    state.baseOverlay.recalculating ||
    !selected ||
    !loaded;
  els.recalculateSelectedOverlay.textContent = state.baseOverlay.recalculating
    ? "Recalculating..."
    : baseGraphStaleForSegment
      ? "Recalculate Graph + Matches"
      : "Recalculate Selected";
  els.snapBoundaryOverlay.disabled =
    baseGraphStaleForSegment ||
    mappingLocked ||
    state.baseOverlay.loading ||
    state.baseOverlay.recalculating ||
    snapPlan.actions.length === 0;
  els.markManualBaseOverlay.disabled = true;
  els.clearBaseOverlay.disabled = !mapping;

  const edgeRefs = reviewedEdgeRefs;
  els.baseOverlayEdges.innerHTML = "";
  if (edgeRefs.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No base edges are attached to this segment.";
    els.baseOverlayEdges.appendChild(empty);
    return;
  }

  const list = document.createElement("ol");
  list.className = "base-overlay-edge-list";
  const canEditReviewedEdges = !baseGraphStaleForSegment && !mappingLocked && !state.baseOverlay.recalculating;
  for (const [edgeIndex, ref] of edgeRefs.slice(0, 80).entries()) {
    const item = document.createElement("li");
    const edgeId = String(ref.edgeId);
    const direction = ref.direction && ref.direction !== "unknown" ? ref.direction : "";
    item.title = direction ? `${edgeId} · ${direction}` : edgeId;
    item.dataset.edgeId = edgeId;
    item.classList.toggle("hovered", state.baseOverlay.hoveredOverlayEdgeId === edgeId);
    const label = document.createElement("span");
    label.className = "base-overlay-edge-label";
    label.textContent = `${ref.sequenceIndex ?? edgeIndex}: ${edgeId}`;
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "base-overlay-edge-remove";
    removeButton.textContent = "X";
    removeButton.title = `Remove ${edgeId} from this segment`;
    removeButton.disabled = !canEditReviewedEdges;
    removeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      removeSelectedOverlayEdgeRef(edgeIndex).catch(showError);
    });
    item.append(label, removeButton);
    item.addEventListener("mouseenter", () => {
      state.baseOverlay.hoveredOverlayEdgeId = edgeId;
      updateSelectedOverlayEdgeSources();
      item.classList.add("hovered");
    });
    item.addEventListener("mouseleave", () => {
      if (state.baseOverlay.hoveredOverlayEdgeId === edgeId) {
        state.baseOverlay.hoveredOverlayEdgeId = null;
        updateSelectedOverlayEdgeSources();
      }
      item.classList.remove("hovered");
    });
    list.appendChild(item);
  }
  list.addEventListener("mouseleave", () => {
    if (state.baseOverlay.hoveredOverlayEdgeId !== null) {
      state.baseOverlay.hoveredOverlayEdgeId = null;
      updateSelectedOverlayEdgeSources();
    }
    for (const item of list.querySelectorAll(".hovered")) {
      item.classList.remove("hovered");
    }
  });
  els.baseOverlayEdges.appendChild(list);
  if (edgeRefs.length > 80) {
    const more = document.createElement("div");
    more.className = "base-overlay-more";
    more.textContent = `${edgeRefs.length - 80} more edge refs`;
    els.baseOverlayEdges.appendChild(more);
  }
}

function renderAll() {
  els.sourceSummary.textContent = `${state.activeFeatures.length} active · ${state.source.features.length} records`;
  renderWorkspaceChrome();
  renderDrawControls();
  renderList();
  renderForm();
  renderDataList();
  renderBaseGraphPanel();
  renderBaseOverlayPanel();
  renderComposeStatus();
  updateMapSources();
}

function selectFeatureByActiveIndex(index, fit = false) {
  if (isDrawing()) {
    setStatus("Finish or cancel drawing before selecting another segment.");
    return;
  }
  state.selectedIndex = index;
  state.selectedVertexIndex = -1;
  state.selectedDataIndex = -1;
  renderAll();
  const feature = selectedFeature();
  if (feature) {
    setStatus(`Selected ${featureName(feature)}`);
    if (fit) fitFeature(feature);
  }
}

function fitFeature(feature) {
  fitCoordinates(feature.geometry.coordinates);
}

function fitCoordinates(coords) {
  const bounds = new mapboxgl.LngLatBounds();
  for (const coord of coords) {
    bounds.extend([coord[0], coord[1]]);
  }
  map.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 500 });
}

function setMode(mode) {
  if (mode !== "draw" && isDrawing()) {
    clearDrawState();
  }
  state.mode = mode;
  els.modeSelect.classList.toggle("active", mode === "select");
  els.modeInsert.classList.toggle("active", mode === "insert");
  map.getCanvas().style.cursor = mode === "insert" || mode === "draw" ? "crosshair" : "";
  renderDrawControls();
  if (mode === "insert") {
    setStatus(
      state.workspaceMode === "base"
        ? "Click near the selected manual base edge to insert a vertex."
        : "Click near the selected segment to insert a vertex.",
    );
  } else if (mode === "draw") {
    setStatus("Click the map to draw.");
  } else {
    setStatus("Select or drag vertices.");
  }
}

async function setWorkspaceMode(mode) {
  if (!["segments", "base", "overlay", "video-sync", "route-catalog"].includes(mode)) return;
  if (state.workspaceMode === mode) {
    if ((mode === "base" || mode === "overlay") && !state.baseOverlay.loaded) {
      state.baseOverlay.enabled = true;
      renderAll();
      await loadBaseOverlayData();
    }
    return;
  }

  if (isDrawing()) {
    clearDrawState();
    state.mode = "select";
  }

  state.workspaceMode = mode;
  if (mode === "overlay" && state.mode === "insert") {
    state.mode = "select";
  }
  state.selectedVertexIndex = -1;
  state.selectedDataIndex = -1;
  state.draggingVertex = false;
  state.draggingManualBaseVertex = false;
  state.draggingDataMarker = null;
  state.baseOverlay.hoveredOverlayEdgeId = null;

  if (mode !== "base") {
    state.baseOverlay.selectedGraphEdgeId = null;
    state.baseOverlay.selectedManualEdgeIndex = -1;
    state.baseOverlay.selectedManualVertexIndex = -1;
  }

  if (mode === "base" || mode === "overlay") {
    state.baseOverlay.enabled = true;
    if (!state.baseOverlay.loaded) {
      renderAll();
      await loadBaseOverlayData();
    }
    setStatus(mode === "base" ? "Base Graph mode: edit manual base edges." : "CW Overlay mode: select a segment, then choose graph edges.");
  } else if (mode === "video-sync") {
    state.baseOverlay.enabled = false;
    setStatus("Video Sync mode: pick a route, paste a YouTube URL, click on the map to add keyframes.");
    if (typeof activateVideoSyncMode === "function") {
      try { await activateVideoSyncMode(); } catch (err) { showError(err); }
    }
  } else if (mode === "route-catalog") {
    state.baseOverlay.enabled = false;
    setStatus("Route Catalog mode: manage findable + featured routes.");
    if (typeof activateRouteCatalogMode === "function") {
      try { await activateRouteCatalogMode(); } catch (err) { showError(err); }
    }
  } else {
    state.baseOverlay.enabled = false;
    setStatus("Segment mode: edit the CycleWays source network.");
  }

  renderAll();
}

function clearDrawState() {
  state.draw = emptyDrawState();
  map.doubleClickZoom.enable();
  map.getCanvas().style.cursor = "";
  updateMapSources();
}

function switchMapStyle(value) {
  const definition = mapStyleDefinition(value);
  state.mapStyle = definition.value;
  els.mapStyle.value = definition.value;
  saveMapStyle(definition.value);
  setStatus(`Switching to ${definition.label} map...`);
  map.setStyle(definition.style);
}

async function restoreEditorLayersAfterStyleChange() {
  await addMapLayers();
  updateMapSources();
  setStatus(`Map view: ${mapStyleDefinition(state.mapStyle).label}`);
}

function updateSelectedProperties() {
  const feature = selectedFeature();
  if (!feature) return;

  const sourceIndex = selectedSourceIndex();
  feature.properties.name = els.segmentName.value.trim() || feature.properties.name;
  feature.properties.status = els.segmentStatus.value;
  feature.properties.roadType = els.segmentRoadType.value;
  setOptionalProperty(feature.properties, "todo", els.segmentTodo.value.trim());
  setOptionalProperty(feature.properties, "notes", els.segmentNotes.value.trim());
  markDirty();
  refreshActiveFeatures();
  const newIndex = state.activeFeatures.findIndex((record) => record.sourceIndex === sourceIndex);
  state.selectedIndex = newIndex;
  renderAll();
}

function releaseSelectedName() {
  const feature = selectedFeature();
  const sourceIndex = selectedSourceIndex();
  if (!feature || sourceIndex < 0) return;

  const name = feature.properties.name || "";
  const activeConflicts = activeNameConflicts(name, sourceIndex);
  if (activeConflicts.length > 0) {
    setStatus("Name is used by another active segment.", "error");
    return;
  }

  const conflicts = inactiveNameConflicts(name, sourceIndex);
  if (conflicts.length === 0) {
    setStatus("No archived records hold this name.");
    return;
  }

  const renamed = conflicts.map((record) => releaseInactiveRecordName(record));
  markDirty();
  renderAll();
  setStatus(
    `Released ${renamed.length} archived ${renamed.length === 1 ? "record" : "records"} for ${name}.`,
  );
}

function setOptionalProperty(properties, key, value) {
  if (value) {
    properties[key] = value;
  } else {
    delete properties[key];
  }
}

function pointToSegmentDistance(point, a, b) {
  const px = point.x;
  const py = point.y;
  const ax = a.x;
  const ay = a.y;
  const bx = b.x;
  const by = b.y;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { distance: Math.hypot(px - ax, py - ay), t: 0 };
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return { distance: Math.hypot(px - x, py - y), t };
}

function snapPointToFeature(point, feature) {
  if (!feature?.geometry?.coordinates || feature.geometry.coordinates.length < 2) {
    return null;
  }

  const coords = feature.geometry.coordinates;
  let best = { index: -1, distance: Infinity, t: 0 };
  for (let index = 0; index < coords.length - 1; index++) {
    const start = map.project([coords[index][0], coords[index][1]]);
    const end = map.project([coords[index + 1][0], coords[index + 1][1]]);
    const candidate = pointToSegmentDistance(point, start, end);
    if (candidate.distance < best.distance) {
      best = { index, ...candidate };
    }
  }

  if (best.index < 0) return null;
  const before = coords[best.index];
  const after = coords[best.index + 1];
  return {
    lng: before[0] + (after[0] - before[0]) * best.t,
    lat: before[1] + (after[1] - before[1]) * best.t,
  };
}

function snapLngLatToFeature(lngLat, feature) {
  return snapPointToFeature(map.project([lngLat.lng, lngLat.lat]), feature);
}

function insertVertexAtClick(lngLat, point) {
  const feature = selectedFeature();
  if (!feature) return;

  const coords = feature.geometry.coordinates;
  let best = { index: -1, distance: Infinity, t: 0 };
  for (let i = 0; i < coords.length - 1; i++) {
    const start = map.project([coords[i][0], coords[i][1]]);
    const end = map.project([coords[i + 1][0], coords[i + 1][1]]);
    const candidate = pointToSegmentDistance(point, start, end);
    if (candidate.distance < best.distance) {
      best = { index: i, ...candidate };
    }
  }

  if (best.index < 0 || best.distance > 28) {
    setStatus("Click closer to the selected line to insert a vertex.");
    return;
  }

  const before = coords[best.index];
  const after = coords[best.index + 1];
  const elevation = before[2] ?? after[2] ?? 0;
  coords.splice(best.index + 1, 0, [lngLat.lng, lngLat.lat, elevation]);
  state.selectedVertexIndex = best.index + 1;
  clearSelectedSegmentMatchResult();
  queueChangedFeature(feature);
  markDirty();
  renderAll();
  setStatus(`Inserted vertex ${state.selectedVertexIndex + 1}.`);
}

function closestSegmentMoveTarget(feature, point) {
  const coords = feature?.geometry?.coordinates || [];
  if (coords.length < 2) return null;

  let bestSegment = { index: -1, distance: Infinity, t: 0 };
  for (let index = 0; index < coords.length - 1; index++) {
    const start = map.project([coords[index][0], coords[index][1]]);
    const end = map.project([coords[index + 1][0], coords[index + 1][1]]);
    const candidate = pointToSegmentDistance(point, start, end);
    if (candidate.distance < bestSegment.distance) {
      bestSegment = { index, ...candidate };
    }
  }

  let bestVertex = { index: -1, distance: Infinity };
  for (let index = 0; index < coords.length; index++) {
    const vertex = map.project([coords[index][0], coords[index][1]]);
    const distance = Math.hypot(point.x - vertex.x, point.y - vertex.y);
    if (distance < bestVertex.distance) {
      bestVertex = { index, distance };
    }
  }

  if (bestSegment.index < 0 || bestSegment.distance > SPACE_SNAP_EDIT_THRESHOLD_PX) {
    return null;
  }

  return {
    vertexIndex: bestVertex.index,
    vertexDistance: bestVertex.distance,
    segmentDistance: bestSegment.distance,
  };
}

function quickSnapEditSelectedSegment() {
  if (state.mode !== "select" || isDrawing() || state.workspaceMode !== "segments") return false;
  if (state.draggingVertex || state.draggingManualBaseVertex || state.draggingDataMarker) return false;

  const feature = selectedFeature();
  const pointer = state.lastMapPointer;
  const coords = feature?.geometry?.coordinates;
  if (!feature || !Array.isArray(coords) || coords.length < 2 || !pointer) {
    setStatus("Select a segment and place the mouse near it before pressing Space.", "error");
    return true;
  }

  const target = closestSegmentMoveTarget(feature, pointer.point);
  if (!target) {
    setStatus("Move the mouse closer to the selected segment before pressing Space.", "error");
    return true;
  }

  const existing = coords[target.vertexIndex];
  existing[0] = pointer.lngLat.lng;
  existing[1] = pointer.lngLat.lat;
  state.selectedVertexIndex = target.vertexIndex;
  state.selectedDataIndex = -1;
  clearSelectedSegmentMatchResult();
  queueChangedFeature(feature);
  markDirtyForLiveEdit();
  updateSelectedSegmentEditSources();
  renderForm();
  renderDrawControls();
  setStatus(`Moved vertex ${target.vertexIndex + 1} to the mouse position.`);
  return true;
}

async function insertManualBaseVertexAtClick(lngLat, point) {
  const feature = selectedManualBaseEdge();
  const coords = feature?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return;

  let best = { index: -1, distance: Infinity, t: 0 };
  for (let i = 0; i < coords.length - 1; i++) {
    const start = map.project([coords[i][0], coords[i][1]]);
    const end = map.project([coords[i + 1][0], coords[i + 1][1]]);
    const candidate = pointToSegmentDistance(point, start, end);
    if (candidate.distance < best.distance) {
      best = { index: i, ...candidate };
    }
  }

  if (best.index < 0 || best.distance > 28) {
    setStatus("Click closer to the selected manual base edge to insert a vertex.");
    return;
  }

  coords.splice(best.index + 1, 0, [roundCoord(lngLat.lng), roundCoord(lngLat.lat)]);
  feature.properties = {
    ...(feature.properties || {}),
    updatedAt: new Date().toISOString(),
  };
  state.baseOverlay.selectedManualVertexIndex = best.index + 1;
  await saveManualBaseEdges();
  renderAll();
  setStatus(`Inserted manual base vertex ${state.baseOverlay.selectedManualVertexIndex + 1}.`);
}

function deleteSelectedVertex() {
  if (state.workspaceMode === "base") {
    deleteSelectedManualBaseVertex().catch(showError);
    return;
  }

  const feature = selectedFeature();
  if (!feature || state.selectedVertexIndex < 0) return;
  const coords = feature.geometry.coordinates;
  if (coords.length <= 2) {
    setStatus("A segment must keep at least two vertices.");
    return;
  }
  coords.splice(state.selectedVertexIndex, 1);
  state.selectedVertexIndex = -1;
  clearSelectedSegmentMatchResult();
  queueChangedFeature(feature);
  markDirty();
  renderAll();
  setStatus("Vertex deleted.");
}

async function deleteSelectedManualBaseVertex() {
  const feature = selectedManualBaseEdge();
  const coords = feature?.geometry?.coordinates;
  const vertexIndex = state.baseOverlay.selectedManualVertexIndex;
  if (!Array.isArray(coords) || vertexIndex < 0) return;
  if (coords.length <= 2) {
    setStatus("A manual base edge must keep at least two vertices.");
    return;
  }
  coords.splice(vertexIndex, 1);
  feature.properties = {
    ...(feature.properties || {}),
    updatedAt: new Date().toISOString(),
  };
  state.baseOverlay.selectedManualVertexIndex = -1;
  await saveManualBaseEdges();
  renderAll();
  setStatus("Manual base vertex deleted.");
}

function dataColorExpression() {
  const expression = ["match", ["get", "type"]];
  for (const [type, color] of Object.entries(DATA_TYPE_COLORS)) {
    expression.push(type, color);
  }
  expression.push("#607076");
  return expression;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function cloneCoords(coords) {
  return coords.map((coord) => coord.slice());
}

function nextSegmentId() {
  return (
    Math.max(
      0,
      ...state.source.features
        .map((feature) => feature.properties?.id)
        .filter((id) => Number.isInteger(id)),
    ) + 1
  );
}

function uniqueSegmentName(preferredName, reservedNames = new Set(), excludedSourceIndexes = new Set()) {
  const names = new Set(
    state.source.features
      .filter((_feature, sourceIndex) => !excludedSourceIndexes.has(sourceIndex))
      .map((feature) => feature.properties?.name)
      .filter((name) => typeof name === "string" && name.length > 0),
  );
  for (const reservedName of reservedNames) {
    names.add(reservedName);
  }

  if (!names.has(preferredName)) {
    return preferredName;
  }

  let suffix = 2;
  let candidate = `${preferredName} - ${suffix}`;
  while (names.has(candidate)) {
    suffix += 1;
    candidate = `${preferredName} - ${suffix}`;
  }
  return candidate;
}

function segmentNameAvailable(name, excludedSourceIndexes = new Set()) {
  return !state.source.features.some(
    (feature, sourceIndex) => !excludedSourceIndexes.has(sourceIndex) && feature.properties?.name === name,
  );
}

function inactiveFeature(feature) {
  const status = feature?.properties?.status || "active";
  return feature?.properties?.deprecated || ["deprecated", "legacy", "draft"].includes(status) || feature?.geometry === null;
}

function archiveName(baseName, id, reason, excludedSourceIndexes = new Set()) {
  const suffix = Number.isInteger(id) ? `${reason} ${id}` : `${reason} ${Date.now().toString(36)}`;
  return uniqueSegmentName(`${baseName} [${suffix}]`, new Set(), excludedSourceIndexes);
}

function inactiveNameConflicts(name, selectedSourceIndex) {
  if (!name) return [];
  return state.source.features
    .map((feature, sourceIndex) => ({ feature, sourceIndex }))
    .filter(
      ({ feature, sourceIndex }) =>
        sourceIndex !== selectedSourceIndex && feature.properties?.name === name && inactiveFeature(feature),
    );
}

function activeNameConflicts(name, selectedSourceIndex) {
  if (!name) return [];
  return state.source.features
    .map((feature, sourceIndex) => ({ feature, sourceIndex }))
    .filter(
      ({ feature, sourceIndex }) =>
        sourceIndex !== selectedSourceIndex && feature.properties?.name === name && !inactiveFeature(feature),
    );
}

function releaseInactiveRecordName(record, reason = "archive") {
  const properties = record.feature.properties || (record.feature.properties = {});
  const oldName = properties.name || "Unnamed segment";
  if (!properties.originalName) {
    properties.originalName = oldName;
  }
  properties.name = archiveName(oldName, properties.id, reason, new Set([record.sourceIndex]));
  return { oldName, newName: properties.name };
}

function uniqueSplitNames(baseName, parentSourceIndex) {
  const excluded = new Set([parentSourceIndex]);
  const firstPreferred = segmentNameAvailable(baseName, excluded) ? baseName : `${baseName} - 1`;
  const firstName = uniqueSegmentName(firstPreferred, new Set(), excluded);
  const secondName = uniqueSegmentName(`${baseName} - 2`, new Set([firstName]), excluded);
  return [firstName, secondName];
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineMeters(a, b) {
  const radiusM = 6371000;
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const dLat = toRadians(b[1] - a[1]);
  const dLng = toRadians(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radiusM * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function roundCoord(value) {
  return Number(value.toFixed(6));
}

function coordAtDistance(coords, targetDistanceM) {
  if (coords.length === 0) return null;
  if (coords.length === 1 || targetDistanceM <= 0) return coords[0];

  let travelled = 0;
  for (let index = 0; index < coords.length - 1; index++) {
    const start = coords[index];
    const end = coords[index + 1];
    const segmentDistance = haversineMeters(start, end);
    if (segmentDistance === 0) continue;

    if (travelled + segmentDistance >= targetDistanceM) {
      const t = (targetDistanceM - travelled) / segmentDistance;
      return [
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
      ];
    }

    travelled += segmentDistance;
  }

  return coords[coords.length - 1];
}

function routeLengthMeters(coords) {
  let total = 0;
  for (let index = 0; index < coords.length - 1; index++) {
    total += haversineMeters(coords[index], coords[index + 1]);
  }
  return total;
}

function buildRouteAnchors(coords) {
  const lengthM = routeLengthMeters(coords);
  if (lengthM === 0) return [];

  const anchorCount = Math.max(1, Math.ceil(lengthM / ROUTE_ANCHOR_SPACING_M));
  const anchors = [];
  for (let index = 0; index < anchorCount; index++) {
    const distanceM = ((index + 0.5) / anchorCount) * lengthM;
    const coord = coordAtDistance(coords, distanceM);
    if (coord) anchors.push([roundCoord(coord[0]), roundCoord(coord[1])]);
  }
  return anchors;
}

function buildSplitRouteAnchors(firstCoords, secondCoords) {
  return [...buildRouteAnchors(firstCoords), ...buildRouteAnchors(secondCoords)];
}

function coordFromLngLat(lngLat) {
  return [roundCoord(lngLat.lng), roundCoord(lngLat.lat), 0];
}

function startNewSegmentDraw() {
  if (!state.source) return;

  state.selectedIndex = -1;
  state.selectedVertexIndex = -1;
  state.selectedDataIndex = -1;
  state.draw = {
    ...emptyDrawState(),
    active: true,
    type: "new",
  };
  setMode("draw");
  renderAll();
  setStatus("Click points on the map to draw the new segment. Press Done when it has at least two vertices.");
  map.doubleClickZoom.disable();
}

function startExtendDraw() {
  if (state.workspaceMode === "base") {
    startManualBaseEdgeExtendDraw();
    return;
  }

  const feature = selectedFeature();
  const sourceIndex = selectedSourceIndex();
  if (!feature || sourceIndex < 0) return;

  state.selectedVertexIndex = -1;
  state.selectedDataIndex = -1;
  state.draw = {
    ...emptyDrawState(),
    active: true,
    type: "extend",
    sourceIndex,
  };
  setMode("draw");
  renderAll();
  setStatus("Click near the start or end of the selected segment, then click points to extend it.");
  map.doubleClickZoom.disable();
}

function startManualBaseEdgeExtendDraw() {
  const feature = selectedManualBaseEdge();
  const manualEdgeIndex = state.baseOverlay.selectedManualEdgeIndex;
  if (!feature || manualEdgeIndex < 0) return;

  state.baseOverlay.selectedManualVertexIndex = -1;
  state.draw = {
    ...emptyDrawState(),
    active: true,
    type: "manualBaseEdgeExtend",
    manualEdgeIndex,
  };
  setMode("draw");
  renderAll();
  setStatus("Click near a manual base edge endpoint, then click points to extend it.");
  map.doubleClickZoom.disable();
}

function startManualBaseEdgeDraw() {
  if (state.workspaceMode !== "base") {
    setStatus("Switch to Base Graph mode to create manual base edges.", "error");
    return;
  }

  state.selectedVertexIndex = -1;
  state.selectedDataIndex = -1;
  state.baseOverlay.selectedManualEdgeIndex = -1;
  state.baseOverlay.selectedManualVertexIndex = -1;
  state.draw = {
    ...emptyDrawState(),
    active: true,
    type: "manualBaseEdge",
    sourceIndex: selectedSourceIndex(),
  };
  setMode("draw");
  renderAll();
  setStatus("Click points to draw the manual base edge. Press Done when it has at least two points.");
  map.doubleClickZoom.disable();
}

function addSegment() {
  startNewSegmentEdgesDraw();
}

function startNewSegmentEdgesDraw() {
  if (!state.source) return;
  if (state.workspaceMode !== "segments") {
    setStatus("Switch to Segments mode to add a segment.", "error");
    return;
  }
  if (isBaseGraphStale()) {
    setStatus("Run Recalculate Graph + Matches before adding a segment.", "error");
    return;
  }
  if (!state.baseOverlay.loaded) {
    state.baseOverlay.enabled = true;
    loadBaseOverlayData().then(() => {
      if (!isBaseGraphStale()) startNewSegmentEdgesDraw();
    }).catch(showError);
    return;
  }

  state.selectedIndex = -1;
  state.selectedVertexIndex = -1;
  state.selectedDataIndex = -1;
  state.draw = {
    ...emptyDrawState(),
    active: true,
    type: "newSegmentEdges",
    edgeRefs: [],
  };
  setMode("draw");
  renderAll();
  setStatus("Click base edges to compose the new segment. Press Done when ready.");
  map.doubleClickZoom.disable();
}

function closestExtendEndpoint(point) {
  const endpoints = selectedEndpointCoordsForDraw();
  if (!endpoints) return null;

  const startPoint = map.project(coordForGeoJson(endpoints.start));
  const endPoint = map.project(coordForGeoJson(endpoints.end));
  const startDistance = Math.hypot(point.x - startPoint.x, point.y - startPoint.y);
  const endDistance = Math.hypot(point.x - endPoint.x, point.y - endPoint.y);
  const endpoint = startDistance <= endDistance ? "start" : "end";
  const distance = Math.min(startDistance, endDistance);
  return distance <= EXTEND_ENDPOINT_THRESHOLD_PX ? { endpoint, distance } : null;
}

async function commitNewSegmentEdgesDrawn() {
  if (isBaseGraphStale()) {
    throw new Error("Run Recalculate Graph + Matches before saving the segment.");
  }
  const edgeRefs = normalizeOverlayEdgeRefs(state.draw.edgeRefs);
  if (edgeRefs.length === 0) {
    throw new Error("Pick at least one base edge before saving.");
  }

  const segmentId = nextSegmentId();
  const continuityGaps = edgeRefContinuityGaps(edgeRefs);

  const acceptedMappings = new Map();
  for (const mapping of Object.values(state.baseOverlay.overlay?.segments || {})) {
    if (!mapping || (mapping.status !== "accepted_edge_set" && mapping.status !== "accepted_auto_match")) {
      continue;
    }
    for (const ref of mapping.edgeRefs || []) {
      acceptedMappings.set(String(ref.edgeId), { segmentId: mapping.segmentId, segmentName: mapping.segmentName });
    }
  }

  const validation = validateEdgePickMapping({
    segmentId,
    edgeRefs,
    acceptedMappings,
    continuityGaps,
  });

  const coordinates = stitchCoordsFromEdgeRefs(edgeRefs, baseEdgeGeometryLookup());
  if (coordinates.length < 2) {
    throw new Error("Could not build segment geometry from the picked edges.");
  }

  const name = uniqueSegmentName("New segment");
  const newFeature = {
    type: "Feature",
    properties: {
      id: segmentId,
      name,
      status: "active",
      roadType: "paved",
      quality: defaultQuality(),
    },
    geometry: {
      type: "LineString",
      coordinates,
    },
  };

  state.source.features.push(newFeature);
  const sourceIndex = state.source.features.length - 1;
  refreshActiveFeatures();
  state.selectedIndex = state.activeFeatures.findIndex((record) => record.sourceIndex === sourceIndex);

  const mapping = {
    segmentId,
    segmentName: name,
    source: "edge_pick",
    status: validation.ok ? "accepted_edge_set" : "needs_edit",
    edgeRefs,
    confidence: "manual",
    coverageRatio: 1,
    avgDistanceMeters: null,
    gapCount: continuityGaps.length,
    failureClass: validation.ok ? null : validation.failureClass,
    failureMessage: validation.ok ? null : validation.message,
    updatedAt: new Date().toISOString(),
  };
  await saveSelectedBaseOverlayMapping(mapping);
  queueChangedFeature(newFeature);

  const detail = validation.ok
    ? `Accepted ${name} with ${edgeRefs.length} base edges.`
    : `Created ${name} but mapping needs edit: ${validation.message}`;
  return { feature: newFeature, message: detail };
}

function commitNewDrawnSegment() {
  const newFeature = {
    type: "Feature",
    properties: {
      id: nextSegmentId(),
      name: uniqueSegmentName("New segment"),
      status: "active",
      roadType: "paved",
      quality: defaultQuality(),
    },
    geometry: {
      type: "LineString",
      coordinates: cloneCoords(state.draw.coords),
    },
  };

  state.source.features.push(newFeature);
  const sourceIndex = state.source.features.length - 1;
  refreshActiveFeatures();
  state.selectedIndex = state.activeFeatures.findIndex((record) => record.sourceIndex === sourceIndex);
  state.selectedVertexIndex = -1;
  state.selectedDataIndex = -1;
  els.segmentSearch.value = "";
  queueChangedFeature(newFeature);
  return { feature: newFeature, message: `Added ${newFeature.properties.name}.` };
}

function commitExtendDrawnSegment() {
  const feature = state.source.features[state.draw.sourceIndex];
  if (!feature?.geometry?.coordinates) {
    throw new Error("Selected segment is no longer available.");
  }

  const draftCoords = cloneCoords(state.draw.coords);
  if (state.draw.endpoint === "start") {
    feature.geometry.coordinates.unshift(...draftCoords.reverse());
    state.selectedVertexIndex = 0;
  } else {
    feature.geometry.coordinates.push(...draftCoords);
    state.selectedVertexIndex = feature.geometry.coordinates.length - 1;
  }

  refreshActiveFeatures();
  state.selectedIndex = state.activeFeatures.findIndex((record) => record.sourceIndex === state.draw.sourceIndex);
  state.selectedDataIndex = -1;
  clearSegmentMatchResult(featureId(feature));
  queueChangedFeature(feature);
  return {
    feature,
    message: `Extended ${featureName(feature)} from the ${state.draw.endpoint}.`,
  };
}

async function commitManualBaseEdgeExtendDrawn() {
  const feature = manualBaseEdgeFeatures()[state.draw.manualEdgeIndex];
  if (!feature?.geometry?.coordinates) {
    throw new Error("Selected manual base edge is no longer available.");
  }

  const draftCoords = drawCoords2d();
  if (state.draw.endpoint === "start") {
    feature.geometry.coordinates.unshift(...draftCoords.reverse());
    state.baseOverlay.selectedManualVertexIndex = 0;
  } else {
    feature.geometry.coordinates.push(...draftCoords);
    state.baseOverlay.selectedManualVertexIndex = feature.geometry.coordinates.length - 1;
  }
  feature.properties = {
    ...(feature.properties || {}),
    updatedAt: new Date().toISOString(),
  };
  state.baseOverlay.selectedManualEdgeIndex = state.draw.manualEdgeIndex;
  await saveManualBaseEdges();
  return {
    feature,
    message: `Extended manual base edge ${manualBaseEdgeFeatureId(feature)} from the ${state.draw.endpoint}.`,
  };
}

function manualBaseEdgeIds() {
  return new Set(
    (state.baseOverlay.manualBaseEdges?.features || [])
      .map((feature) => feature.properties?.manualEdgeId || feature.properties?.id || feature.id)
      .filter((id) => typeof id === "string" && id.length > 0),
  );
}

function nextManualBaseEdgeId(preferredPrefix = "edge") {
  const ids = manualBaseEdgeIds();
  const safePrefix = String(preferredPrefix || "edge")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const base = `manual-${safePrefix || "edge"}-${Date.now().toString(36)}`;
  if (!ids.has(base)) return base;
  let suffix = 2;
  while (ids.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function selectManualBaseEdgeByIndex(index, fit = false) {
  if (isDrawing()) {
    setStatus("Finish or cancel drawing before selecting another manual base edge.");
    return;
  }
  const features = manualBaseEdgeFeatures();
  if (!Number.isInteger(index) || index < 0 || index >= features.length) return;
  state.baseOverlay.selectedGraphEdgeId = null;
  state.baseOverlay.selectedManualEdgeIndex = index;
  state.baseOverlay.selectedManualVertexIndex = -1;
  state.selectedVertexIndex = -1;
  state.selectedDataIndex = -1;
  renderAll();
  const feature = features[index];
  if (fit) fitCoordinates(feature.geometry.coordinates);
  setStatus(`Selected manual base edge ${manualBaseEdgeFeatureId(feature)}.`);
}

function selectBaseGraphEdge(feature, fit = false) {
  if (isDrawing() || !feature) {
    return;
  }

  const properties = feature.properties || {};
  const graphEdgeId = graphEdgeFeatureId(feature);
  const manualEdgeId = properties.manualEdgeId;
  if (properties.source === "manual" && manualEdgeId) {
    const manualIndex = manualBaseEdgeFeatures().findIndex(
      (manualFeature) => String(manualBaseEdgeFeatureId(manualFeature)) === String(manualEdgeId),
    );
    if (manualIndex >= 0) {
      selectManualBaseEdgeByIndex(manualIndex, fit);
      return;
    }
  }

  if (!graphEdgeId) return;
  state.baseOverlay.selectedGraphEdgeId = String(graphEdgeId);
  state.baseOverlay.selectedManualEdgeIndex = -1;
  state.baseOverlay.selectedManualVertexIndex = -1;
  state.selectedVertexIndex = -1;
  state.selectedDataIndex = -1;
  renderAll();
  if (fit && feature.geometry?.coordinates?.length >= 2) {
    fitCoordinates(feature.geometry.coordinates);
  }
  setStatus(`Selected OSM base edge ${graphEdgeId}. Use Copy Selected to make it editable.`);
}

function roadTypeForGraphFeature(feature) {
  const properties = feature?.properties || {};
  if (properties.roadType) return properties.roadType;
  if (properties.osmRouteClass === "road") return "road";
  const highway = String(properties.highway || "");
  if (["primary", "secondary", "tertiary", "trunk", "motorway"].includes(highway)) return "road";
  if (["cycleway", "path", "footway", "pedestrian"].includes(highway)) return "paved";
  return "dirt";
}

async function cloneSelectedBaseGraphEdgeAsManual() {
  const feature = selectedBaseGraphEdge();
  if (!feature) return;
  const properties = feature.properties || {};
  if (properties.source === "manual") {
    setStatus("This is already a manual edge.", "error");
    return;
  }

  const coords = feature.geometry?.coordinates || [];
  if (coords.length < 2) {
    setStatus("Selected graph edge has no editable geometry.", "error");
    return;
  }

  const graphEdgeId = graphEdgeFeatureId(feature);
  const manualEdgeId = nextManualBaseEdgeId(`osm-${properties.osmWayId || graphEdgeId || "edge"}`);
  const now = new Date().toISOString();
  const manualFeature = {
    type: "Feature",
    id: manualEdgeId,
    properties: {
      id: manualEdgeId,
      manualEdgeId,
      source: "manual",
      status: "active",
      roadType: roadTypeForGraphFeature(feature),
      copiedFromEdgeId: graphEdgeId ? String(graphEdgeId) : undefined,
      copiedFromOsmWayId: Number.isFinite(Number(properties.osmWayId)) ? Number(properties.osmWayId) : undefined,
      highway: properties.highway,
      osmRouteClass: properties.osmRouteClass,
      accessStatus: properties.accessStatus,
      createdAt: now,
      updatedAt: now,
    },
    geometry: {
      type: "LineString",
      coordinates: coords.map((coord) => [roundCoord(coord[0]), roundCoord(coord[1])]),
    },
  };

  state.baseOverlay.manualBaseEdges = {
    type: "FeatureCollection",
    features: [...manualBaseEdgeFeatures(), manualFeature],
  };
  state.baseOverlay.selectedGraphEdgeId = null;
  state.baseOverlay.selectedManualEdgeIndex = state.baseOverlay.manualBaseEdges.features.length - 1;
  state.baseOverlay.selectedManualVertexIndex = -1;
  await saveManualBaseEdges();
  renderAll();
  setStatus(`Copied ${graphEdgeId} to editable manual base edge ${manualEdgeId}. Recalculate the graph when ready.`);
}

async function deleteSelectedManualBaseEdge() {
  const index = state.baseOverlay.selectedManualEdgeIndex;
  const feature = selectedManualBaseEdge();
  if (!feature || index < 0) return;
  const manualEdgeId = manualBaseEdgeFeatureId(feature);
  const features = [...manualBaseEdgeFeatures()];
  features.splice(index, 1);
  state.baseOverlay.manualBaseEdges = {
    type: "FeatureCollection",
    features,
  };
  state.baseOverlay.selectedManualEdgeIndex = -1;
  state.baseOverlay.selectedManualVertexIndex = -1;
  await saveManualBaseEdges();
  renderAll();
  setStatus(`Deleted manual base edge ${manualEdgeId}. Recalculate the graph when ready.`);
}

function drawCoords2d() {
  return state.draw.coords.map((coord) => [roundCoord(coord[0]), roundCoord(coord[1])]);
}

async function commitManualBaseEdgeDrawn() {
  const coordinates = drawCoords2d();
  const linkedFeature = state.source.features[state.draw.sourceIndex] || null;
  const linkedSegmentId = Number(linkedFeature?.properties?.id);
  const hasLinkedSegment = Boolean(linkedFeature && Number.isInteger(linkedSegmentId));
  const manualEdgeId = nextManualBaseEdgeId(hasLinkedSegment ? linkedSegmentId : "edge");
  const now = new Date().toISOString();
  const properties = {
    id: manualEdgeId,
    manualEdgeId,
    source: "manual",
    status: "active",
    roadType: linkedFeature?.properties?.roadType || "dirt",
    createdAt: now,
    updatedAt: now,
  };
  if (hasLinkedSegment) {
    properties.linkedSegmentId = linkedSegmentId;
    properties.linkedSegmentName = featureName(linkedFeature);
  }

  const manualFeature = {
    type: "Feature",
    id: manualEdgeId,
    properties,
    geometry: {
      type: "LineString",
      coordinates,
    },
  };

  state.baseOverlay.manualBaseEdges = {
    type: "FeatureCollection",
    features: [...(state.baseOverlay.manualBaseEdges?.features || []), manualFeature],
  };
  state.baseOverlay.selectedManualEdgeIndex = state.baseOverlay.manualBaseEdges.features.length - 1;
  state.baseOverlay.selectedManualVertexIndex = -1;
  await saveManualBaseEdges();

  return {
    feature: manualFeature,
    message: `Saved manual base edge ${manualEdgeId}.`,
  };
}

async function finishDraw() {
  if (!isDrawing()) return;
  if (!canFinishDraw()) {
    setStatus(
      (state.draw.type === "extend" || state.draw.type === "manualBaseEdgeExtend") && !state.draw.endpoint
        ? "Click near the start or end of the selected line first."
        : "Add more points before finishing.",
    );
    return;
  }

  const drawType = state.draw.type;
  const result =
    drawType === "newSegmentEdges"
      ? await commitNewSegmentEdgesDrawn()
      : drawType === "new"
        ? commitNewDrawnSegment()
        : drawType === "manualBaseEdge"
          ? await commitManualBaseEdgeDrawn()
          : drawType === "manualBaseEdgeExtend"
            ? await commitManualBaseEdgeExtendDrawn()
            : commitExtendDrawnSegment();
  clearDrawState();
  state.mode = "select";
  els.modeSelect.classList.add("active");
  els.modeInsert.classList.remove("active");
  if (drawType !== "manualBaseEdge" && drawType !== "manualBaseEdgeExtend") {
    markDirty();
  }
  renderAll();
  fitCoordinates(result.feature.geometry.coordinates);
  setStatus(
    drawType === "manualBaseEdge" || drawType === "manualBaseEdgeExtend"
      ? `${result.message} Rebuild the OSM graph when ready.`
      : drawType === "newSegmentEdges"
        ? `${result.message} Save the source when ready.`
        : `${result.message} Save the source when ready.`,
  );
}

function cancelDraw() {
  if (!isDrawing()) return;
  clearDrawState();
  state.mode = "select";
  els.modeSelect.classList.add("active");
  els.modeInsert.classList.remove("active");
  renderAll();
  setStatus("Drawing cancelled.");
}

function removeLastDrawStep() {
  if (!isDrawing()) return;
  if (state.draw.type === "newSegmentEdges") {
    if (state.draw.edgeRefs.length === 0) return;
    const removed = state.draw.edgeRefs[state.draw.edgeRefs.length - 1];
    state.draw.edgeRefs = state.draw.edgeRefs
      .slice(0, -1)
      .map((ref, i) => ({ ...ref, sequenceIndex: i }));
    updateMapSources();
    renderDrawControls();
    renderComposeStatus();
    setStatus(`Removed last edge ${removed.edgeId} from draft.`);
    return;
  }
  if (state.draw.coords.length === 0) return;
  state.draw.coords.pop();
  updateMapSources();
  renderDrawControls();
  setStatus("Removed last drawn point.");
}

function switchComposeToFreehand() {
  if (state.draw.type !== "newSegmentEdges") return;
  const hadEdges = state.draw.edgeRefs.length > 0;
  if (hadEdges && !window.confirm("Switch to freehand drawing? Picked edges will be discarded.")) {
    return;
  }
  state.draw = {
    ...emptyDrawState(),
    active: true,
    type: "new",
  };
  updateMapSources();
  renderDrawControls();
  renderComposeStatus();
  setStatus("Switched to freehand drawing. Click points to draw the segment.");
}

function handleDrawClick(event) {
  if (!isDrawing()) return;

  if ((state.draw.type === "extend" || state.draw.type === "manualBaseEdgeExtend") && !state.draw.endpoint) {
    const closest = closestExtendEndpoint(event.point);
    if (!closest) {
      setStatus("Click closer to the start or end of the selected line.");
      return;
    }
    state.draw.endpoint = closest.endpoint;
    state.draw.hoverEndpoint = closest.endpoint;
    state.draw.hoverCoord = null;
    updateMapSources();
    renderDrawControls();
    setStatus(
      `Extending ${state.draw.type === "manualBaseEdgeExtend" ? "manual base edge" : "segment"} from the ${
        closest.endpoint
      }. Click points to add new route geometry.`,
    );
    return;
  }

  state.draw.coords.push(coordFromLngLat(event.lngLat));
  state.draw.hoverCoord = null;
  updateMapSources();
  renderDrawControls();
  setStatus(
    state.draw.type === "new"
      ? `${state.draw.coords.length} point${state.draw.coords.length === 1 ? "" : "s"} drawn.`
      : state.draw.type === "manualBaseEdge"
        ? `${state.draw.coords.length} manual base edge point${state.draw.coords.length === 1 ? "" : "s"} drawn.`
        : state.draw.type === "manualBaseEdgeExtend"
          ? `${state.draw.coords.length} manual base edge extension point${
              state.draw.coords.length === 1 ? "" : "s"
            } drawn.`
        : `${state.draw.coords.length} extension point${state.draw.coords.length === 1 ? "" : "s"} drawn.`,
  );
}

function updateDrawHover(event) {
  if (!isDrawing()) return;

  state.draw.hoverCoord = coordFromLngLat(event.lngLat);
  state.draw.hoverEndpoint =
    (state.draw.type === "extend" || state.draw.type === "manualBaseEdgeExtend") && !state.draw.endpoint
      ? closestExtendEndpoint(event.point)?.endpoint || null
      : state.draw.hoverEndpoint;
  map.getCanvas().style.cursor =
    (state.draw.type === "extend" || state.draw.type === "manualBaseEdgeExtend") &&
    !state.draw.endpoint &&
    !state.draw.hoverEndpoint
      ? ""
      : "crosshair";
  updateMapSources();
}

function projectMeters(lng, lat, originLat) {
  const radiusM = 6371000;
  return {
    x: radiusM * toRadians(lng) * Math.cos(toRadians(originLat)),
    y: radiusM * toRadians(lat),
  };
}

function distancePointToSegmentMeters(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lenSq));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function markerDistanceToCoords(marker, coords) {
  const location = marker?.location;
  if (
    !Array.isArray(location) ||
    location.length < 2 ||
    typeof location[0] !== "number" ||
    typeof location[1] !== "number" ||
    coords.length < 2
  ) {
    return Infinity;
  }

  const lat = location[0];
  const lng = location[1];
  const point = projectMeters(lng, lat, lat);
  let best = Infinity;

  for (let index = 0; index < coords.length - 1; index++) {
    const start = projectMeters(coords[index][0], coords[index][1], lat);
    const end = projectMeters(coords[index + 1][0], coords[index + 1][1], lat);
    best = Math.min(best, distancePointToSegmentMeters(point, start, end));
  }

  return best;
}

function setDataMarkers(properties, markers) {
  if (markers.length > 0) {
    properties.data = markers;
  } else {
    delete properties.data;
  }
}

function ensureDataMarkers(feature) {
  if (!Array.isArray(feature.properties.data)) {
    feature.properties.data = [];
  }
  return feature.properties.data;
}

function defaultDataLocation(feature) {
  const coords = feature.geometry.coordinates;
  const selectedCoord =
    state.selectedVertexIndex >= 0 && state.selectedVertexIndex < coords.length
      ? coords[state.selectedVertexIndex]
      : coords[Math.floor((coords.length - 1) / 2)];
  return [selectedCoord[1], selectedCoord[0]];
}

function formatCoordValue(value) {
  return Number.isFinite(value) ? String(Number(value.toFixed(6))) : "";
}

function cleanOptionalText(value) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function appendDataTextField(item, { label, value = "", rows = 0, onCommit }) {
  const fieldLabel = document.createElement("label");
  fieldLabel.className = "field-label";
  fieldLabel.textContent = label;
  item.appendChild(fieldLabel);

  const input =
    rows > 0 ? document.createElement("textarea") : document.createElement("input");
  input.className = rows > 0 ? "text-input textarea" : "text-input";
  if (rows > 0) {
    input.rows = rows;
  } else {
    input.type = "text";
  }
  input.value = value || "";
  input.addEventListener("change", () => onCommit(cleanOptionalText(input.value)));
  item.appendChild(input);
  return input;
}

function appendDataCheckboxField(item, { label, checked, onCommit }) {
  const wrapper = document.createElement("label");
  wrapper.className = "data-checkbox-row";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(checked);
  input.addEventListener("change", () => onCommit(input.checked));
  wrapper.appendChild(input);

  const text = document.createElement("span");
  text.textContent = label;
  wrapper.appendChild(text);
  item.appendChild(wrapper);
  return input;
}

function dataImageSrc(src) {
  if (!src) return "";
  if (/^(https?:)?\/\//.test(src) || src.startsWith("/")) return src;
  return `/${src}`;
}

function appendDataPhotoPreview(item, marker) {
  const src = marker.thumbnail || marker.photo;
  if (!src) return;

  const preview = document.createElement("img");
  preview.className = "data-photo-preview";
  preview.src = dataImageSrc(src);
  preview.alt = marker.name || marker.information || "Data marker photo";
  preview.loading = "lazy";
  item.appendChild(preview);
}

function markerImageList(marker) {
  if (Array.isArray(marker?.images)) {
    return marker.images.filter((e) => e && typeof e === "object" && e.photo);
  }
  if (marker?.photo) {
    return [{ photo: marker.photo, thumbnail: marker.thumbnail || marker.photo }];
  }
  return [];
}

function setMarkerImages(index, images) {
  // Writing images[] supersedes the legacy single-image fields.
  updateDataMarker(index, { images, photo: undefined, thumbnail: undefined });
  renderDataList();
}

// Read-only thumbnail strip of a POI's images with Make-primary / Remove.
function appendDataImageManager(item, index, marker) {
  const images = markerImageList(marker);
  if (images.length === 0) return;

  const fieldLabel = document.createElement("span");
  fieldLabel.className = "field-label";
  fieldLabel.textContent = `Images (${images.length})`;
  item.appendChild(fieldLabel);

  const strip = document.createElement("div");
  strip.className = "data-image-strip";

  images.forEach((image, imageIndex) => {
    const cell = document.createElement("div");
    cell.className = imageIndex === 0 ? "data-image-cell primary" : "data-image-cell";

    const thumb = document.createElement("img");
    thumb.className = "data-image-thumb";
    thumb.src = dataImageSrc(image.thumbnail || image.photo);
    thumb.alt = marker.name || "POI image";
    thumb.loading = "lazy";
    cell.appendChild(thumb);

    if (imageIndex === 0) {
      const badge = document.createElement("span");
      badge.className = "data-image-badge";
      badge.textContent = "Primary";
      cell.appendChild(badge);
    } else {
      const makePrimary = document.createElement("button");
      makePrimary.type = "button";
      makePrimary.className = "mini-button";
      makePrimary.textContent = "Make primary";
      makePrimary.addEventListener("click", () => {
        const next = images.slice();
        const [picked] = next.splice(imageIndex, 1);
        next.unshift(picked);
        setMarkerImages(index, next);
      });
      cell.appendChild(makePrimary);
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "mini-button danger";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      const next = images.slice();
      next.splice(imageIndex, 1);
      setMarkerImages(index, next);
    });
    cell.appendChild(remove);

    strip.appendChild(cell);
  });

  item.appendChild(strip);
}

function readFileAsDataUrl(file) {
  return new Promise((resolveData, rejectData) => {
    const reader = new FileReader();
    reader.onload = () => resolveData(reader.result);
    reader.onerror = () => rejectData(reader.error || new Error("file read failed"));
    reader.readAsDataURL(file);
  });
}

// Upload a full-resolution photo; the editor server resizes, converts to WebP,
// and stores derivatives under public-data/poi-images, then we record the
// canonical photo/thumbnail paths on the marker.
function appendDataImageUpload(item, index) {
  const wrapper = document.createElement("div");
  wrapper.className = "data-image-upload";

  const fieldLabel = document.createElement("span");
  fieldLabel.className = "field-label";
  fieldLabel.textContent = "Upload image (resized + WebP on the server)";
  wrapper.appendChild(fieldLabel);

  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = true;
  input.className = "data-image-input";

  const statusEl = document.createElement("span");
  statusEl.className = "data-image-status";

  input.addEventListener("change", async () => {
    const files = Array.from(input.files || []);
    if (files.length === 0) return;
    const marker = selectedData()[index];
    const id = marker && typeof marker.id === "string" ? marker.id.trim() : "";
    if (!id) {
      statusEl.textContent = "Set a stable ID before uploading an image.";
      input.value = "";
      return;
    }
    statusEl.textContent = `Uploading ${files.length} image(s)…`;
    try {
      for (const file of files) {
        const dataUrl = await readFileAsDataUrl(file);
        const res = await fetch("/api/poi-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, data: dataUrl }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.ok) throw new Error(body.error || `upload failed (${res.status})`);
        const current = markerImageList(selectedData()[index]);
        setMarkerImages(index, [...current, { photo: body.photo, thumbnail: body.thumbnail }]);
      }
      setStatus(`Stored ${files.length} image(s).`);
    } catch (error) {
      statusEl.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      input.value = "";
    }
  });

  wrapper.appendChild(input);
  wrapper.appendChild(statusEl);
  item.appendChild(wrapper);
}

function addDataMarker() {
  const feature = selectedFeature();
  if (!feature) return;

  const data = ensureDataMarkers(feature);
  data.push({
    type: "warning",
    information: "",
    location: defaultDataLocation(feature),
  });
  state.selectedDataIndex = data.length - 1;
  markDirty();
  renderAll();
  setStatus(`Added data marker ${state.selectedDataIndex + 1}.`);
}

function removeDataMarker(index) {
  const feature = selectedFeature();
  const data = selectedData();
  if (!feature || index < 0 || index >= data.length) return;

  data.splice(index, 1);
  if (data.length === 0) {
    delete feature.properties.data;
  }
  state.selectedDataIndex = Math.min(index, data.length - 1);
  markDirty();
  renderAll();
  setStatus("Data marker removed.");
}

function updateDataMarker(index, patch) {
  const data = selectedData();
  if (index < 0 || index >= data.length) return;

  data[index] = {
    ...data[index],
    ...patch,
  };
  state.selectedDataIndex = index;
  markDirty();
  updateMapSources();
}

function updateDataMarkerAtSource(sourceIndex, index, patch) {
  const feature = state.source.features[sourceIndex];
  const data = dataForFeature(feature);
  if (index < 0 || index >= data.length) return false;

  data[index] = {
    ...data[index],
    ...patch,
  };
  markDirtyForLiveEdit();
  updateDataMarkerSources();
  return true;
}

function updateDataMarkerLocationFromLngLat(index, lngLat) {
  const feature = selectedFeature();
  if (!feature) return;
  const snapped = snapLngLatToFeature(lngLat, feature);
  if (!snapped) return;
  updateDataMarker(index, {
    location: [roundCoord(snapped.lat), roundCoord(snapped.lng)],
  });
}

function updateDataMarkerLocation(index, latValue, lngValue) {
  const lat = Number.parseFloat(latValue);
  const lng = Number.parseFloat(lngValue);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    setStatus("Invalid data marker location.");
    renderDataList();
    return;
  }
  updateDataMarkerLocationFromLngLat(index, { lat, lng });
  renderDataList();
  setStatus(`Updated data marker ${index + 1}.`);
}

function selectDataMarker(sourceIndex, dataIndex, fit = false) {
  const activeIndex = state.activeFeatures.findIndex((record) => record.sourceIndex === sourceIndex);
  if (activeIndex < 0) return;

  state.selectedIndex = activeIndex;
  state.selectedVertexIndex = -1;
  state.selectedDataIndex = dataIndex;
  renderAll();

  const feature = selectedFeature();
  if (feature && fit) fitFeature(feature);
  setStatus(`Selected ${featureName(feature)} data ${dataIndex + 1}.`);
}

function renderDataList() {
  const feature = selectedFeature();
  els.dataList.innerHTML = "";

  if (state.workspaceMode === "base" || !feature) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = state.workspaceMode === "base" ? "Data markers are edited in Segments mode." : "No segment selected";
    els.dataList.appendChild(empty);
    return;
  }

  const data = selectedData();
  if (state.selectedDataIndex >= data.length) {
    state.selectedDataIndex = -1;
  }

  if (data.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No data markers";
    els.dataList.appendChild(empty);
    return;
  }

  for (const [index, marker] of data.entries()) {
    const item = document.createElement("div");
    item.className = `data-item${index === state.selectedDataIndex ? " active" : ""}`;
    item.addEventListener("click", (event) => {
      if (event.target.closest("input, textarea, select, button")) return;
      state.selectedDataIndex = index;
      renderAll();
    });

    const header = document.createElement("div");
    header.className = "data-item-header";

    const title = document.createElement("strong");
    title.textContent = `Data ${index + 1}`;
    header.appendChild(title);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "mini-button danger";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => removeDataMarker(index));
    header.appendChild(removeButton);
    item.appendChild(header);

    const typeLabel = document.createElement("label");
    typeLabel.className = "field-label";
    typeLabel.textContent = "Type";
    item.appendChild(typeLabel);

    const typeSelect = document.createElement("select");
    typeSelect.className = "text-input";
    for (const type of DATA_TYPES) {
      const option = document.createElement("option");
      option.value = type.value;
      option.textContent = type.label;
      typeSelect.appendChild(option);
    }
    typeSelect.value = marker.type || "warning";
    typeSelect.addEventListener("change", () => {
      updateDataMarker(index, { type: typeSelect.value });
      renderDataList();
    });
    item.appendChild(typeSelect);

    appendDataTextField(item, {
      label: "Stable ID",
      value: marker.id,
      onCommit: (id) => {
        updateDataMarker(index, { id });
        renderDataList();
      },
    });

    appendDataTextField(item, {
      label: "Name",
      value: marker.name,
      onCommit: (name) => {
        updateDataMarker(index, { name });
        renderDataList();
      },
    });

    appendDataTextField(item, {
      label: "Short description",
      value: marker.information,
      rows: 2,
      onCommit: (information) => {
        updateDataMarker(index, { information });
        renderDataList();
      },
    });

    appendDataTextField(item, {
      label: "Long description",
      value: marker.description,
      rows: 3,
      onCommit: (description) => {
        updateDataMarker(index, { description });
        renderDataList();
      },
    });

    appendDataImageManager(item, index, marker);
    appendDataImageUpload(item, index);

    appendDataCheckboxField(item, {
      label: "Show in route galleries when this segment is on the route",
      checked:
        marker.gallery === true ||
        (marker.gallery !== false && Boolean(marker.photo || marker.thumbnail)),
      onCommit: (gallery) => {
        updateDataMarker(index, { gallery });
        renderDataList();
      },
    });

    appendDataTextField(item, {
      label: "Website",
      value: marker.website,
      onCommit: (website) => {
        updateDataMarker(index, { website });
        renderDataList();
      },
    });

    appendDataTextField(item, {
      label: "Phone",
      value: marker.phone,
      onCommit: (phone) => {
        updateDataMarker(index, { phone });
        renderDataList();
      },
    });

    appendDataTextField(item, {
      label: "Hours",
      value: marker.hours,
      onCommit: (hours) => {
        updateDataMarker(index, { hours });
        renderDataList();
      },
    });

    appendDataPhotoPreview(item, marker);

    const location = Array.isArray(marker.location) ? marker.location : [NaN, NaN];
    const locationGrid = document.createElement("div");
    locationGrid.className = "data-location-grid";

    const latWrapper = document.createElement("label");
    latWrapper.className = "compact-field";
    latWrapper.textContent = "Lat";
    const latInput = document.createElement("input");
    latInput.className = "text-input";
    latInput.type = "number";
    latInput.step = "any";
    latInput.value = formatCoordValue(location[0]);
    latWrapper.appendChild(latInput);
    locationGrid.appendChild(latWrapper);

    const lngWrapper = document.createElement("label");
    lngWrapper.className = "compact-field";
    lngWrapper.textContent = "Lng";
    const lngInput = document.createElement("input");
    lngInput.className = "text-input";
    lngInput.type = "number";
    lngInput.step = "any";
    lngInput.value = formatCoordValue(location[1]);
    lngWrapper.appendChild(lngInput);
    locationGrid.appendChild(lngWrapper);

    const commitLocation = () => updateDataMarkerLocation(index, latInput.value, lngInput.value);
    latInput.addEventListener("change", commitLocation);
    lngInput.addEventListener("change", commitLocation);
    item.appendChild(locationGrid);
    els.dataList.appendChild(item);
  }
}

function partitionDataMarkers(markers, firstCoords, secondCoords) {
  const firstData = [];
  const secondData = [];

  for (const marker of markers) {
    const firstDistance = markerDistanceToCoords(marker, firstCoords);
    const secondDistance = markerDistanceToCoords(marker, secondCoords);
    if (secondDistance < firstDistance) {
      secondData.push(cloneJson(marker));
    } else {
      firstData.push(cloneJson(marker));
    }
  }

  return { firstData, secondData };
}

function splitSelectedSegment() {
  if (state.workspaceMode === "base") {
    splitSelectedManualBaseEdge().catch(showError);
    return;
  }

  const feature = selectedFeature();
  const sourceIndex = selectedSourceIndex();
  const vertexIndex = state.selectedVertexIndex;

  if (!feature || sourceIndex < 0) return;
  if (vertexIndex <= 0 || vertexIndex >= feature.geometry.coordinates.length - 1) {
    setStatus("Select an internal vertex to split the segment.");
    return;
  }

  const coords = feature.geometry.coordinates;
  const firstCoords = cloneCoords(coords.slice(0, vertexIndex + 1));
  const secondCoords = cloneCoords(coords.slice(vertexIndex));
  const originalProperties = {
    ...cloneJson(feature.properties),
    quality: qualityForFeature(feature),
  };
  const originalId = originalProperties.id;
  const originalName = featureName(feature);
  const nextId = nextSegmentId();
  const [firstName, secondName] = uniqueSplitNames(originalName, sourceIndex);
  const archivedParentName = archiveName(originalName, originalId, "split archive", new Set([sourceIndex]));

  const firstProperties = {
    ...cloneJson(originalProperties),
    id: nextId,
    name: firstName,
    status: "active",
    splitFrom: originalId,
    splitFromName: originalName,
  };
  const secondProperties = {
    ...cloneJson(originalProperties),
    id: nextId + 1,
    name: secondName,
    status: "active",
    splitFrom: originalId,
    splitFromName: originalName,
  };
  for (const properties of [firstProperties, secondProperties]) {
    delete properties.deprecated;
    delete properties.replacedBy;
    delete properties.replacedByNames;
  }

  if (Array.isArray(feature.properties.data)) {
    const { firstData, secondData } = partitionDataMarkers(feature.properties.data, firstCoords, secondCoords);
    setDataMarkers(firstProperties, firstData);
    setDataMarkers(secondProperties, secondData);
  }

  feature.properties = {
    ...originalProperties,
    name: archivedParentName,
    originalName: originalProperties.originalName || originalName,
    status: "deprecated",
    deprecated: true,
    routeAnchors: buildSplitRouteAnchors(firstCoords, secondCoords),
  };
  delete feature.properties.data;
  delete feature.properties.replacedBy;
  delete feature.properties.replacedByNames;
  feature.geometry = null;

  const firstFeature = {
    type: "Feature",
    properties: firstProperties,
    geometry: {
      type: "LineString",
      coordinates: firstCoords,
    },
  };
  const secondFeature = {
    type: "Feature",
    properties: secondProperties,
    geometry: {
      type: "LineString",
      coordinates: secondCoords,
    },
  };

  state.source.features.splice(sourceIndex + 1, 0, firstFeature, secondFeature);
  refreshActiveFeatures();
  state.selectedIndex = state.activeFeatures.findIndex((record) => record.sourceIndex === sourceIndex + 1);
  state.selectedVertexIndex = -1;
  state.selectedDataIndex = -1;
  clearSegmentMatchResult(originalId);
  queueChangedSegment(firstProperties.id);
  queueChangedSegment(secondProperties.id);
  markDirty();
  renderAll();
  setStatus(`Split ${originalName} into ${firstProperties.name} and ${secondProperties.name}.`);
}

async function splitSelectedManualBaseEdge() {
  const edgeIndex = state.baseOverlay.selectedManualEdgeIndex;
  const feature = selectedManualBaseEdge();
  const coords = feature?.geometry?.coordinates;
  const vertexIndex = state.baseOverlay.selectedManualVertexIndex;

  if (!feature || edgeIndex < 0 || !Array.isArray(coords)) return;
  if (vertexIndex <= 0 || vertexIndex >= coords.length - 1) {
    setStatus("Select an internal manual base edge vertex to split.");
    return;
  }

  const now = new Date().toISOString();
  const originalId = manualBaseEdgeFeatureId(feature) || `manual-${Date.now().toString(36)}`;
  const firstId = nextManualBaseEdgeId(`${originalId}-a`);
  const secondId = nextManualBaseEdgeId(`${originalId}-b`);
  const baseProperties = {
    ...cloneJson(feature.properties || {}),
    splitFrom: originalId,
    updatedAt: now,
  };
  const firstFeature = {
    ...cloneJson(feature),
    id: firstId,
    properties: {
      ...baseProperties,
      id: firstId,
      manualEdgeId: firstId,
    },
    geometry: {
      type: "LineString",
      coordinates: coords.slice(0, vertexIndex + 1).map((coord) => [roundCoord(coord[0]), roundCoord(coord[1])]),
    },
  };
  const secondFeature = {
    ...cloneJson(feature),
    id: secondId,
    properties: {
      ...baseProperties,
      id: secondId,
      manualEdgeId: secondId,
    },
    geometry: {
      type: "LineString",
      coordinates: coords.slice(vertexIndex).map((coord) => [roundCoord(coord[0]), roundCoord(coord[1])]),
    },
  };

  const features = [...manualBaseEdgeFeatures()];
  features.splice(edgeIndex, 1, firstFeature, secondFeature);
  state.baseOverlay.manualBaseEdges = {
    type: "FeatureCollection",
    features,
  };
  state.baseOverlay.selectedManualEdgeIndex = edgeIndex;
  state.baseOverlay.selectedManualVertexIndex = -1;
  await saveManualBaseEdges();
  renderAll();
  setStatus(`Split manual base edge ${originalId}. Recalculate the graph when ready.`);
}

async function loadSource() {
  const response = await fetch("/api/source");
  if (!response.ok) throw new Error(`Failed to load source: ${response.status}`);
  state.source = await response.json();
  state.draw = emptyDrawState();
  state.mode = "select";
  refreshActiveFeatures();
  renderAll();
  markDirty(false);
  clearAlert();
  setStatus("Source loaded.");
}

async function loadBaseOverlayData() {
  if (state.baseOverlay.loading || state.baseOverlay.loaded) return;

  state.baseOverlay.loading = true;
  renderAll();
  setStatus("Loading OSM base graph artifacts...");
  try {
    const [
      graphEdgesResponse,
      matchSummaryResponse,
      matchPreviewResponse,
      overlayResponse,
      manualBaseEdgesResponse,
    ] = await Promise.all([
      fetch("/api/osm/graph-edges"),
      fetch("/api/osm/match-summary"),
      fetch("/api/osm/match-preview"),
      fetch("/api/cw-base-overlay"),
      fetch("/api/manual-base-edges"),
    ]);
    for (const response of [
      graphEdgesResponse,
      matchSummaryResponse,
      matchPreviewResponse,
      overlayResponse,
      manualBaseEdgesResponse,
    ]) {
      if (!response.ok) {
        throw new Error(`Failed to load ${response.url}: ${response.status}`);
      }
    }
    const [graphEdges, matchSummary, matchPreview, overlay, manualBaseEdges] = await Promise.all([
      graphEdgesResponse.json(),
      matchSummaryResponse.json(),
      matchPreviewResponse.json(),
      overlayResponse.json(),
      manualBaseEdgesResponse.json(),
    ]);
    state.baseOverlay.graphEdges = graphEdges;
    state.baseOverlay.matchSummary = matchSummary;
    state.baseOverlay.matchPreview = matchPreview;
    state.baseOverlay.manualBaseEdges = manualBaseEdges || emptyManualBaseEdges();
    state.baseOverlay.overlay = overlay || emptyBaseOverlay();
    state.baseOverlay.loaded = true;
    setStatus(
      `Loaded ${graphEdges.features?.length || 0} base graph edges and ${matchSummary.sourceSegments || 0} segment matches.`,
    );
  } catch (error) {
    state.baseOverlay.enabled = false;
    throw error;
  } finally {
    state.baseOverlay.loading = false;
    renderAll();
  }
}

async function toggleBaseOverlay() {
  if (state.baseOverlay.loading) return;
  if (state.workspaceMode !== "segments") {
    state.baseOverlay.enabled = true;
    await loadBaseOverlayData();
    setStatus("The base graph stays visible in Base Graph and CW Overlay modes.");
    renderAll();
    return;
  }
  state.baseOverlay.enabled = !state.baseOverlay.enabled;
  if (state.baseOverlay.enabled) {
    await loadBaseOverlayData();
    setStatus("Base graph overlay enabled.");
  } else {
    setStatus("Base graph overlay hidden.");
  }
  renderAll();
}

async function toggleUnresolvedSegments() {
  if (state.workspaceMode !== "segments" || state.baseOverlay.loading) return;
  state.showUnresolvedSegments = !state.showUnresolvedSegments;
  if (!state.showUnresolvedSegments) {
    state.unresolvedSegmentIds = [];
    state.unresolvedSegmentFilterKey = null;
    updateUnresolvedSegmentLayerFilter();
    updateWorkspaceLayerVisibility();
    renderDrawControls();
    setStatus("Issue segment highlights hidden.");
    return;
  }

  state.unresolvedSegmentIds = [];
  state.unresolvedSegmentFilterKey = null;
  renderDrawControls();

  if (!state.baseOverlay.loaded) {
    setStatus("Loading overlay review data for issue segment highlights...");
    await loadBaseOverlayData();
  }

  refreshUnresolvedSegmentHighlights();
  updateWorkspaceLayerVisibility();
  renderDrawControls();
  setStatus(`Highlighting ${state.unresolvedSegmentIds.length} issue segments.`);
}

async function processChangedSegmentQueue() {
  if (state.processingChangedQueue || state.changedSegmentIds.size === 0) return;

  state.processingChangedQueue = true;
  renderDrawControls();
  const queuedIds = [...state.changedSegmentIds].sort((a, b) => a - b);
  const accepted = [];
  const unresolved = [];
  const failed = [];

  try {
    if (state.dirty) {
      await saveSource();
    }
    if (!state.baseOverlay.loaded) {
      state.baseOverlay.enabled = true;
      await loadBaseOverlayData();
    }
    if (isBaseGraphStale()) {
      setStatus("Base graph is stale. Recalculating graph and matches before processing the queue...");
      await recalculateOsmGraph();
    }

    for (const segmentId of queuedIds) {
      const activeRecord = state.activeFeatures.find(
        ({ feature }) => Number(feature.properties?.id) === Number(segmentId),
      );
      if (!activeRecord?.feature) {
        state.changedSegmentIds.delete(segmentId);
        continue;
      }

      const feature = activeRecord.feature;
      try {
        clearBaseOverlayMappingForSegment(segmentId);
        const summary = isBaseGraphStale() ? matchSummaryForSegment(segmentId) : await recalculateSegmentMatch(feature);
        const edgeRefs = edgeRefsForAutoMatch(segmentId);
        if (
          summary &&
          isFullAutoAcceptCandidate(summary) &&
          edgeRefs.length > 0 &&
          !isBaseGraphStale() &&
          missingManualGraphEdgeIdsForSegment(segmentId).length === 0
        ) {
          await persistSelectedOverlayMatch(segmentId);
          state.baseOverlay.overlay = {
            ...emptyBaseOverlay(),
            ...state.baseOverlay.overlay,
            segments: {
              ...(state.baseOverlay.overlay?.segments || {}),
              [String(segmentId)]: autoMatchMapping(
                { ...summary, segmentName: featureName(feature) },
                edgeRefs,
                "changed_queue_auto_match",
              ),
            },
          };
          state.changedSegmentIds.delete(segmentId);
          accepted.push(segmentId);
        } else {
          unresolved.push(segmentId);
        }
      } catch (error) {
        failed.push({
          segmentId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await saveBaseOverlay();
    refreshUnresolvedSegmentHighlights();
    renderAll();
    const details = [
      `${accepted.length} accepted`,
      unresolved.length > 0 ? `${unresolved.length} still unresolved` : null,
      failed.length > 0 ? `${failed.length} failed` : null,
      `${state.changedSegmentIds.size} left in queue`,
    ].filter(Boolean);
    setStatus(`Processed changed segment queue: ${details.join(" · ")}.`, failed.length > 0 ? "error" : "info");
  } finally {
    state.processingChangedQueue = false;
    renderDrawControls();
  }
}

async function recalculateOsmGraph() {
  if (state.baseOverlay.loading || state.baseOverlay.recalculating) return;
  state.baseOverlay.recalculating = true;
  renderAll();
  setStatus("Recalculating OSM graph and CW matches...");
  try {
    const response = await fetch("/api/osm/recalculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `OSM graph recalculation failed: ${response.status}`);
    }

    state.baseOverlay.loaded = false;
    state.baseOverlay.graphEdges = null;
    state.baseOverlay.matchSummary = null;
    state.baseOverlay.matchPreview = null;
    invalidateBaseOverlayDerivedCache();
    await loadBaseOverlayData();
    const graphEdges = state.baseOverlay.graphEdges?.features?.length || 0;
    const sourceSegments = state.baseOverlay.matchSummary?.sourceSegments || 0;
    setStatus(`Recalculated ${graphEdges} graph edges and ${sourceSegments} CW matches.`);
  } finally {
    state.baseOverlay.recalculating = false;
    renderAll();
  }
}

function replaceSelectedSegmentMatchResult(segmentId, summary, preview) {
  const segmentKey = Number(segmentId);
  const existingSummary = state.baseOverlay.matchSummary || {
    generatedAt: null,
    sourceSegments: 0,
    graphEdges: state.baseOverlay.graphEdges?.features?.length || 0,
    segments: [],
  };
  const otherSummaries = (existingSummary.segments || []).filter(
    (match) => Number(match.segmentId) !== segmentKey,
  );
  state.baseOverlay.matchSummary = {
    ...existingSummary,
    generatedAt: new Date().toISOString(),
    segments: [...otherSummaries, summary].sort(
      (a, b) => Number(a.segmentId ?? 0) - Number(b.segmentId ?? 0),
    ),
  };

  const existingPreview = state.baseOverlay.matchPreview || EMPTY_FEATURE_COLLECTION;
  state.baseOverlay.matchPreview = {
    type: "FeatureCollection",
    features: [
      ...(existingPreview.features || []).filter(
        (feature) => Number(feature.properties?.segmentId) !== segmentKey,
      ),
      ...((preview && preview.features) || []),
    ],
  };
}

function clearSegmentMatchResult(segmentId) {
  const segmentKey = Number(segmentId);
  if (!Number.isInteger(segmentKey)) return;
  if (state.baseOverlay.matchSummary?.segments) {
    state.baseOverlay.matchSummary = {
      ...state.baseOverlay.matchSummary,
      generatedAt: new Date().toISOString(),
      segments: state.baseOverlay.matchSummary.segments.filter(
        (match) => Number(match.segmentId) !== segmentKey,
      ),
    };
  }
  if (state.baseOverlay.matchPreview?.features) {
    state.baseOverlay.matchPreview = {
      type: "FeatureCollection",
      features: state.baseOverlay.matchPreview.features.filter(
        (feature) => Number(feature.properties?.segmentId) !== segmentKey,
      ),
    };
  }
}

function clearSelectedSegmentMatchResult() {
  clearSegmentMatchResult(selectedSegmentId());
}

function applyBoundarySnapAction(coords, action) {
  const projection = closestPointOnCoordsMeters(action.targetCoord, coords);
  if (!projection) return { coords, applied: false, reason: "No projection on selected CW segment." };
  const routeLength = routeLengthMeters(coords);
  const trimMeters = action.side === "start" ? projection.alongMeters : routeLength - projection.alongMeters;
  if (projection.distanceMeters > 35) {
    return {
      coords,
      applied: false,
      reason: `Target for ${action.side} is ${Math.round(projection.distanceMeters)}m from the CW line.`,
    };
  }
  if (trimMeters > MAX_BOUNDARY_SNAP_DISTANCE_M) {
    return {
      coords,
      applied: false,
      reason: `${action.side} boundary trim is ${Math.round(trimMeters)}m.`,
    };
  }

  const nextCoords =
    action.side === "start"
      ? trimmedCoordsFromStart(coords, {
          ...projection,
          coord: [action.targetCoord[0], action.targetCoord[1], projection.coord[2]],
        })
      : trimmedCoordsToEnd(coords, {
          ...projection,
          coord: [action.targetCoord[0], action.targetCoord[1], projection.coord[2]],
        });
  if (nextCoords.length < 2) {
    return { coords, applied: false, reason: "Snap would leave the segment with fewer than two vertices." };
  }
  return {
    coords: nextCoords,
    applied: true,
    trimMeters,
    edgeId: action.adjacentEdgeId,
    side: action.side,
  };
}

async function snapSelectedBoundaryOverlay() {
  if (!state.baseOverlay.loaded) {
    state.baseOverlay.enabled = true;
    await loadBaseOverlayData();
  }

  const feature = selectedFeature();
  const segmentId = selectedSegmentId();
  const match = matchSummaryForSegment(segmentId);
  if (!feature || segmentId === null || !match) {
    setStatus("Select a segment with boundary sliver diagnostics before snapping.", "error");
    return;
  }
  if (isBaseOverlayMappingLocked(overlayMappingForSegment(segmentId))) {
    setStatus("Clear the saved base overlay mapping before snapping this segment.", "error");
    return;
  }

  const plan = boundarySnapPlan(match, feature);
  if (plan.actions.length === 0) {
    const reason = plan.skipped[0]?.reason || "No safe boundary snap is available for this segment.";
    setStatus(reason, "error");
    return;
  }

  let coords = cloneCoords(feature.geometry.coordinates);
  const applied = [];
  for (const action of plan.actions.sort((a, b) => (a.side === "start" ? -1 : 1) - (b.side === "start" ? -1 : 1))) {
    const result = applyBoundarySnapAction(coords, action);
    if (!result.applied) {
      setStatus(result.reason, "error");
      return;
    }
    coords = result.coords;
    applied.push(result);
  }

  feature.geometry.coordinates = coords;
  state.selectedVertexIndex = -1;
  state.selectedDataIndex = -1;
  clearSelectedSegmentMatchResult();
  queueChangedFeature(feature);
  markDirty();
  renderAll();
  setStatus(
    `Snapped ${applied
      .map((action) => `${action.side} ${Math.round(action.trimMeters)}m to ${action.edgeId}`)
      .join(", ")}. Recalculate Selected to verify.`,
  );
}

async function recalculateSegmentMatch(feature) {
  const segmentId = Number(feature?.properties?.id);
  if (!feature || !Number.isInteger(segmentId)) {
    throw new Error("Cannot recalculate a segment without a valid id.");
  }
  const response = await fetch("/api/osm/recalculate-segment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feature }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `Selected match recalculation failed: ${response.status}`);
  }
  replaceSelectedSegmentMatchResult(segmentId, payload.match.summary, payload.match.preview);
  return payload.match.summary;
}

async function recalculateSelectedOverlayMatch() {
  if (state.baseOverlay.loading || state.baseOverlay.recalculating) return;
  if (!state.baseOverlay.loaded) {
    state.baseOverlay.enabled = true;
    await loadBaseOverlayData();
  }

  const feature = selectedFeature();
  const segmentId = selectedSegmentId();
  if (!feature || segmentId === null) {
    setStatus("Select a CW segment before recalculating its match.", "error");
    return;
  }
  if (isBaseOverlayMappingLocked(overlayMappingForSegment(segmentId))) {
    setStatus("Clear the saved base overlay mapping before recalculating this segment.", "error");
    return;
  }
  const missingManualGraphEdges = missingManualGraphEdgeIdsForSegment(segmentId);
  if (isBaseGraphStale() || missingManualGraphEdges.length > 0) {
    await recalculateOsmGraph();
    return;
  }

  state.baseOverlay.recalculating = true;
  renderAll();
  setStatus(`Recalculating base match for ${featureName(feature)}...`);
  try {
    const summary = await recalculateSegmentMatch(feature);
    setStatus(
      `Recalculated ${featureName(feature)}: ${formatPercent(summary.coverageRatio)} coverage · ${summary.confidence} · ${summary.gapCount} gaps.`,
    );
  } finally {
    state.baseOverlay.recalculating = false;
    renderAll();
  }
}

async function persistSelectedOverlayMatch(segmentId) {
  const summary = matchSummaryForSegment(segmentId);
  if (!summary) {
    throw new Error("Recalculate the selected segment before accepting it.");
  }
  const preview = {
    type: "FeatureCollection",
    features: matchPreviewFeaturesForSegment(segmentId),
  };
  const response = await fetch("/api/osm/persist-segment-match", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ segmentId, summary, preview }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `Selected match persistence failed: ${response.status}`);
  }
  state.baseOverlay.matchSummary = payload.summary || state.baseOverlay.matchSummary;
  state.baseOverlay.matchPreview = payload.preview || state.baseOverlay.matchPreview;
}

async function saveBaseOverlay() {
  const response = await fetch("/api/cw-base-overlay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state.baseOverlay.overlay),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `Overlay save failed: ${response.status}`);
  }
  state.baseOverlay.overlay = payload.overlay || state.baseOverlay.overlay;
}

async function saveManualBaseEdges() {
  const response = await fetch("/api/manual-base-edges", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state.baseOverlay.manualBaseEdges || emptyManualBaseEdges()),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `Manual base edge save failed: ${response.status}`);
  }
  state.baseOverlay.manualBaseEdges = payload.manualBaseEdges || state.baseOverlay.manualBaseEdges;
  markBaseGraphStaleBecauseManualEdgesChanged();
}

async function saveSelectedBaseOverlayMapping(mapping) {
  state.baseOverlay.overlay = {
    ...emptyBaseOverlay(),
    ...state.baseOverlay.overlay,
    segments: {
      ...(state.baseOverlay.overlay?.segments || {}),
      [String(mapping.segmentId)]: mapping,
    },
  };
  await saveBaseOverlay();
  renderAll();
}

function clearBaseOverlayMappingForSegment(segmentId) {
  const key = String(segmentId);
  const segments = { ...(state.baseOverlay.overlay?.segments || {}) };
  delete segments[key];
  state.baseOverlay.overlay = {
    ...emptyBaseOverlay(),
    ...state.baseOverlay.overlay,
    segments,
  };
}

async function acceptSelectedAutoMatch() {
  if (!state.baseOverlay.loaded) {
    await loadBaseOverlayData();
  }
  const segmentId = selectedSegmentId();
  const feature = selectedFeature();
  const match = matchSummaryForSegment(segmentId);
  const existing = overlayMappingForSegment(segmentId);
  const edgeRefs = normalizeOverlayEdgeRefs(displayedOverlayEdgeRefs());
  if (!feature || segmentId === null || edgeRefs.length === 0) {
    setStatus("No reviewed base edge set is available for the selected segment.", "error");
    return;
  }
  if (isBaseOverlayMappingLocked(existing)) {
    setStatus("Clear the accepted base overlay mapping before accepting a new edge set.", "error");
    return;
  }

  if (state.dirty) {
    await saveSource();
  }
  if (match) {
    await persistSelectedOverlayMatch(segmentId);
  }
  await saveSelectedBaseOverlayMapping(reviewedOverlayMapping(segmentId, feature, match, edgeRefs));
  const status = overlayNetworkStatus(matchSummaryForSegment(segmentId));
  setStatus(
    status.resolved
      ? `Accepted ${edgeRefs.length} reviewed base graph edges for ${featureName(feature)}.`
      : `Saved ${edgeRefs.length} reviewed base graph edges for ${featureName(feature)}, but validation still reports: ${status.label}.`,
    status.resolved ? "info" : "error",
  );
}

async function bulkAcceptFullAutoMatches() {
  if (!state.baseOverlay.loaded) {
    state.baseOverlay.enabled = true;
    await loadBaseOverlayData();
  }

  const candidates = fullAutoAcceptCandidates();
  if (candidates.length === 0) {
    setStatus("No full auto-match candidates are available.", "error");
    return;
  }

  const segments = { ...(state.baseOverlay.overlay?.segments || {}) };
  let written = 0;
  let preserved = 0;
  let skippedNoEdges = 0;

  for (const match of candidates) {
    const key = String(match.segmentId);
    const existing = segments[key];
    if (existing) {
      preserved += 1;
      continue;
    }

    const edgeRefs = edgeRefsForAutoMatch(Number(match.segmentId));
    if (edgeRefs.length === 0) {
      skippedNoEdges += 1;
      continue;
    }

    segments[key] = autoMatchMapping(match, edgeRefs, "bulk_auto_match");
    written += 1;
  }

  state.baseOverlay.overlay = {
    ...emptyBaseOverlay(),
    ...state.baseOverlay.overlay,
    segments,
  };
  await saveBaseOverlay();
  renderAll();

  const details = [
    `${written} full auto matches saved`,
    preserved > 0 ? `${preserved} manual/edit mappings preserved` : null,
    skippedNoEdges > 0 ? `${skippedNoEdges} skipped without edge refs` : null,
  ].filter(Boolean);
  setStatus(details.join(" · "));
}

async function markSelectedManualBaseNeeded() {
  if (!state.baseOverlay.loaded) {
    await loadBaseOverlayData();
  }
  const segmentId = selectedSegmentId();
  const feature = selectedFeature();
  const match = matchSummaryForSegment(segmentId);
  if (!feature || segmentId === null) {
    setStatus("Select a segment before marking a manual base edge.", "error");
    return;
  }
  if (isBaseOverlayMappingLocked(overlayMappingForSegment(segmentId))) {
    setStatus("Clear the saved base overlay mapping before marking this segment manual.", "error");
    return;
  }

  await saveSelectedBaseOverlayMapping({
    segmentId,
    segmentName: featureName(feature),
    status: "manual_base_edge_needed",
    source: "editor",
    confidence: match?.confidence || "none",
    coverageRatio: match?.coverageRatio || 0,
    avgDistanceMeters: match?.avgDistanceMeters ?? null,
    gapCount: match?.gapCount || 0,
    failureClass: match?.failureClass || "manual_base_edge_needed",
    edgeRefs: [],
    updatedAt: new Date().toISOString(),
  });
  setStatus(`Marked ${featureName(feature)} as needing a manual base edge.`);
}

async function clearSelectedBaseOverlayMapping() {
  const segmentId = selectedSegmentId();
  const feature = selectedFeature();
  if (!feature || segmentId === null) return;

  const segments = { ...(state.baseOverlay.overlay?.segments || {}) };
  if (!segments[String(segmentId)]) {
    setStatus("No saved base overlay mapping to clear.");
    return;
  }
  delete segments[String(segmentId)];
  state.baseOverlay.overlay = {
    ...emptyBaseOverlay(),
    ...state.baseOverlay.overlay,
    segments,
  };
  await saveBaseOverlay();
  renderAll();
  setStatus(`Cleared base overlay mapping for ${featureName(feature)}.`);
}

async function saveSource() {
  setStatus("Saving source...");
  clearAlert();
  try {
    const response = await fetch("/api/source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.source),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `Save failed: ${response.status}`);
    }
    markDirty(false);
    clearAlert();
    setStatus(payload.changed === false ? "Source already up to date." : "Source saved.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showAlert("Save failed. Changes are still unsaved.", message);
    setStatus("Save failed. Changes are still unsaved.", "error");
    throw markAlertShown(error);
  }
}

function reportIssueDetails(report) {
  if (!report) return [];
  const validation = report.validation || {};
  const elevation = report.elevation || {};
  const issues = [];

  if (elevation.skipElevation) {
    issues.push("Elevation was skipped");
  }
  if ((elevation.failures || 0) > 0) {
    issues.push(`${elevation.failures} elevation lookup failure${elevation.failures === 1 ? "" : "s"}`);
  }
  for (const name of validation.duplicateFeatureNames || []) {
    issues.push(`Duplicate feature name: ${name}`);
  }
  for (const id of Object.keys(validation.duplicateIds || {})) {
    issues.push(`Duplicate segment ID: ${id}`);
  }
  if ((validation.invalidDataMarkers || []).length > 0) {
    issues.push(
      `${validation.invalidDataMarkers.length} invalid data marker${
        validation.invalidDataMarkers.length === 1 ? "" : "s"
      }`,
    );
  }
  if ((validation.invalidQuality || []).length > 0) {
    issues.push(
      `${validation.invalidQuality.length} invalid quality record${validation.invalidQuality.length === 1 ? "" : "s"}`,
    );
  }
  for (const item of validation.activeMissingMiddle || []) {
    issues.push(`Active segment missing middle: ${item.name || item.segment || item.id || JSON.stringify(item)}`);
  }
  for (const item of validation.activeSplitNumberedNames || []) {
    issues.push(`Numbered split child: ${item.name || item.segment || item.id || JSON.stringify(item)}`);
  }
  for (const warning of validation.routeCompatibilityWarnings || []) {
    const segment = warning.segment || warning.id || "unknown segment";
    issues.push(`Route compatibility: ${segment} - ${warning.issue || "warning"}`);
  }
  for (const blocker of validation.baseRouting?.blockers || []) {
    const segment = blocker.segmentName || blocker.segmentId || "unknown segment";
    issues.push(`Base routing blocker: ${segment} - ${blocker.issue || "validation blocker"}`);
  }
  for (const warning of validation.baseRouting?.warnings || []) {
    const segment = warning.segmentName || warning.segmentId || "unknown segment";
    issues.push(`Base routing warning: ${segment} - ${warning.issue || "validation warning"}`);
  }
  const displayFallbacks = validation.cyclewaysDisplayGeometry?.sourceFallbackSegments || 0;
  if (displayFallbacks > 0) {
    issues.push(
      `${displayFallbacks} public CycleWays segment${displayFallbacks === 1 ? "" : "s"} still use source geometry fallback`,
    );
  }
  return issues;
}

function buildSummary(report) {
  if (!report) return "Build completed, but no report was returned.";
  const validation = report.validation || {};
  const elevation = report.elevation || {};
  const issues = reportIssueDetails(report);
  return JSON.stringify(
    {
      issues,
      featureCount: validation.featureCount,
      segmentsCount: validation.segmentsCount,
      newSegments: validation.newSegments?.length ?? 0,
      duplicateFeatureNames: validation.duplicateFeatureNames || [],
      duplicateIds: validation.duplicateIds || {},
      activeMissingMiddle: validation.activeMissingMiddle?.length ?? 0,
      invalidQuality: validation.invalidQuality?.length ?? 0,
      activeSplitNumberedNames: validation.activeSplitNumberedNames || [],
      routeCompatibilityWarnings: validation.routeCompatibilityWarnings?.length ?? 0,
      routeCompatibilityWarningDetails: validation.routeCompatibilityWarnings || [],
      baseRoutingWarnings: validation.baseRouting?.warnings || [],
      baseRoutingBlockers: validation.baseRouting?.blockers || [],
      connectedComponents: validation.topology?.connectedComponents,
      orphanEndpointCount: validation.topology?.orphanEndpointCount,
      elevation: {
        skipElevation: elevation.skipElevation,
        lookups: elevation.lookups,
        cacheHits: elevation.cacheHits,
        failures: elevation.failures,
      },
      outputs: report.outputs,
    },
    null,
    2,
  );
}

function buildOutputSummary(report) {
  if (!report) return "No build report";
  const validation = report.validation || {};
  const elevation = report.elevation || {};
  const version = report.outputs?.runtime?.version;
  const qualityIssues = validation.invalidQuality?.length || 0;
  const splitNameIssues = validation.activeSplitNumberedNames?.length || 0;
  const routeWarnings = validation.routeCompatibilityWarnings?.length || 0;
  const elevationFailures = elevation.failures || 0;
  const issues = reportIssueDetails(report).length || qualityIssues + splitNameIssues + routeWarnings + elevationFailures;
  const prefix = version ? `v${version}` : "Build";
  return issues > 0 ? `${prefix} · ${issues} issues` : `${prefix} · OK`;
}

async function runBuild() {
  if (state.dirty) {
    await saveSource();
  }

  setStatus("Running build...");
  els.runBuild.disabled = true;
  try {
    const response = await fetch("/api/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skipElevation: els.skipElevation.checked }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `Build failed: ${response.status}`);
    }
    state.lastBuildReport = payload.report;
    const issues = reportIssueDetails(payload.report);
    els.buildOutputSummary.textContent = buildOutputSummary(payload.report);
    els.buildOutputSummary.title = issues.join("\n");
    els.buildReport.textContent = buildSummary(payload.report);
    updatePromoteButton();
    if (issues.length > 0) {
      setStatus(
        `Build finished with ${issues.length} issue${issues.length === 1 ? "" : "s"}. Fix before promoting.`,
        "error",
      );
    } else {
      setStatus(payload.report?.elevation?.skipElevation ? "Build complete. Run a full build before promoting." : "Build complete. Ready to promote.");
    }
  } finally {
    els.runBuild.disabled = false;
  }
}

async function promoteBuild() {
  if (state.dirty) {
    throw new Error("Save and run a fresh full build before promoting.");
  }
  if (!canPromoteReport(state.lastBuildReport)) {
    throw new Error("Run a full build before promoting.");
  }

  setStatus("Promoting build...");
  els.promoteBuild.disabled = true;
  try {
    const response = await fetch("/api/promote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `Promote failed: ${response.status}`);
    }
    els.buildReport.textContent = `${els.buildReport.textContent}\n\nPromoted:\n${JSON.stringify(payload.promoted, null, 2)}\n\nRemoved old versions:\n${JSON.stringify(payload.removed || [], null, 2)}`;
    els.buildOutputSummary.textContent = `Promoted ${payload.version}`;
    setStatus("Build promoted to site files.");
  } finally {
    updatePromoteButton();
  }
}

function wireEvents() {
  els.workspaceSegments.addEventListener("click", () => setWorkspaceMode("segments").catch(showError));
  els.workspaceBase.addEventListener("click", () => setWorkspaceMode("base").catch(showError));
  els.workspaceOverlay.addEventListener("click", () => setWorkspaceMode("overlay").catch(showError));
  els.workspaceVideoSync.addEventListener("click", () => setWorkspaceMode("video-sync").catch(showError));
  els.workspaceRouteCatalog.addEventListener("click", () => setWorkspaceMode("route-catalog").catch(showError));
  els.segmentSearch.addEventListener("input", renderList);
  els.toggleSegments.addEventListener("click", () => setSegmentDrawer(!state.segmentsOpen));
  els.closeSegments.addEventListener("click", () => setSegmentDrawer(false));
  els.addSegment.addEventListener("click", addSegment);
  els.releaseName.addEventListener("click", releaseSelectedName);
  els.modeSelect.addEventListener("click", () => setMode("select"));
  els.modeInsert.addEventListener("click", () => setMode("insert"));
  els.extendSegment.addEventListener("click", startExtendDraw);
  els.deleteVertex.addEventListener("click", deleteSelectedVertex);
  els.splitSegment.addEventListener("click", splitSelectedSegment);
  els.toggleBaseOverlay.addEventListener("click", () => toggleBaseOverlay().catch(showError));
  els.drawDone.addEventListener("click", () => finishDraw().catch(showError));
  els.drawCancel.addEventListener("click", cancelDraw);
  els.drawUndoLast.addEventListener("click", () => removeLastDrawStep());
  els.drawFreehand.addEventListener("click", () => switchComposeToFreehand());
  els.editSegmentEdges.addEventListener("click", () => {
    state.editingEdgePickEdges = !state.editingEdgePickEdges;
    if (state.editingEdgePickEdges) {
      state.splittingEdgePickAt = null;
      setStatus("Click base edges to add or remove them from this segment.");
    } else {
      setStatus("Exited edge-edit mode.");
    }
    renderAll();
  });
  els.splitSegmentEdge.addEventListener("click", () => {
    if (!isEdgePickedSelected()) return;
    state.splittingEdgePickAt = state.splittingEdgePickAt === null ? 0 : null;
    if (state.splittingEdgePickAt !== null) {
      state.editingEdgePickEdges = false;
      setStatus("Click an internal edge on the segment to split it there.");
    } else {
      setStatus("Cancelled split.");
    }
    renderAll();
  });
  els.newManualBaseEdge.addEventListener("click", startManualBaseEdgeDraw);
  els.cloneBaseGraphEdge.addEventListener("click", () => cloneSelectedBaseGraphEdgeAsManual().catch(showError));
  els.deleteManualBaseEdge.addEventListener("click", () => deleteSelectedManualBaseEdge().catch(showError));
  els.splitManualBaseEdge.addEventListener("click", () => splitSelectedManualBaseEdge().catch(showError));
  els.recalculateOsmGraph.addEventListener("click", () => recalculateOsmGraph().catch(showError));
  els.addData.addEventListener("click", addDataMarker);
  els.mapStyle.addEventListener("change", () => switchMapStyle(els.mapStyle.value));
  els.toggleUnresolvedSegments.addEventListener("click", () => toggleUnresolvedSegments().catch(showError));
  els.processChangedQueue.addEventListener("click", () => processChangedSegmentQueue().catch(showError));
  els.clearChangedQueue.addEventListener("click", clearChangedSegmentQueue);
  els.saveSource.addEventListener("click", () => saveSource().catch(showError));
  els.runBuild.addEventListener("click", () => runBuild().catch(showError));
  els.promoteBuild.addEventListener("click", () => promoteBuild().catch(showError));
  els.acceptBaseOverlay.addEventListener("click", () => acceptSelectedAutoMatch().catch(showError));
  els.recalculateSelectedOverlay.addEventListener("click", () => recalculateSelectedOverlayMatch().catch(showError));
  els.snapBoundaryOverlay.addEventListener("click", () => snapSelectedBoundaryOverlay().catch(showError));
  els.bulkAcceptBaseOverlay.addEventListener("click", () => bulkAcceptFullAutoMatches().catch(showError));
  els.markManualBaseOverlay.addEventListener("click", () => markSelectedManualBaseNeeded().catch(showError));
  els.clearBaseOverlay.addEventListener("click", () => clearSelectedBaseOverlayMapping().catch(showError));

  for (const input of [
    els.segmentName,
    els.segmentStatus,
    els.segmentRoadType,
    els.segmentTodo,
    els.segmentNotes,
  ]) {
    input.addEventListener("change", updateSelectedProperties);
  }

  map.on("click", "cw-overlay-network-hit-layer", (event) => {
    if (state.workspaceMode !== "overlay" || state.mode !== "select") return;
    const feature = event.features?.[0];
    const segmentId = Number(feature?.properties?.overlaySegmentId);
    if (!Number.isInteger(segmentId) || !selectSegmentById(segmentId)) return;
    state.suppressNextSegmentClick = true;
    window.setTimeout(() => {
      state.suppressNextSegmentClick = false;
    }, 0);
    setStatus(`Selected mapped CW segment ${feature.properties.overlaySegmentName || segmentId}.`);
  });

  map.on("click", "base-graph-edges-hit-layer", (event) => {
    if (state.mode !== "select" && !isComposingNewSegmentEdges()) return;
    if (
      state.mode === "select" &&
      !["base", "overlay"].includes(state.workspaceMode) &&
      !((state.editingEdgePickEdges || state.splittingEdgePickAt !== null) && isEdgePickedSelected())
    ) {
      return;
    }
    if (cwOverlayNetworkFeaturesAtPoint(event.point).length > 0) return;
    state.suppressNextSegmentClick = true;
    window.setTimeout(() => {
      state.suppressNextSegmentClick = false;
    }, 0);
    if (isComposingNewSegmentEdges()) {
      toggleEdgeInCompose(event.features[0]);
      return;
    }
    if (state.splittingEdgePickAt !== null && isEdgePickedSelected()) {
      splitEdgePickedAtClickedEdge(event.features[0]).catch(showError);
      return;
    }
    if (state.editingEdgePickEdges && isEdgePickedSelected()) {
      toggleEdgeInEdgePickedSegment(event.features[0]).catch(showError);
      return;
    }
    if (state.workspaceMode === "base") {
      selectBaseGraphEdge(event.features[0]);
    } else {
      toggleSelectedOverlayBaseEdge(event.features[0]).catch(showError);
    }
  });

  map.on("click", "manual-base-edges-hit-layer", (event) => {
    if (state.mode !== "select" && !isComposingNewSegmentEdges()) return;
    if (cwOverlayNetworkFeaturesAtPoint(event.point).length > 0) return;
    if (isComposingNewSegmentEdges()) {
      state.suppressNextSegmentClick = true;
      window.setTimeout(() => {
        state.suppressNextSegmentClick = false;
      }, 0);
      toggleEdgeInCompose(event.features[0]);
      return;
    }
    if (state.splittingEdgePickAt !== null && isEdgePickedSelected()) {
      state.suppressNextSegmentClick = true;
      window.setTimeout(() => {
        state.suppressNextSegmentClick = false;
      }, 0);
      splitEdgePickedAtClickedEdge(event.features[0]).catch(showError);
      return;
    }
    if (state.editingEdgePickEdges && isEdgePickedSelected()) {
      state.suppressNextSegmentClick = true;
      window.setTimeout(() => {
        state.suppressNextSegmentClick = false;
      }, 0);
      toggleEdgeInEdgePickedSegment(event.features[0]).catch(showError);
      return;
    }
    const manualIndex = Number(event.features[0].properties.manualIndex);
    if (state.workspaceMode === "base") {
      selectManualBaseEdgeByIndex(manualIndex);
      return;
    }
    if (state.workspaceMode === "overlay") {
      state.suppressNextSegmentClick = true;
      window.setTimeout(() => {
        state.suppressNextSegmentClick = false;
      }, 0);
      toggleSelectedOverlayBaseEdge(event.features[0]).catch(showError);
    }
  });

  map.on("mouseenter", "base-graph-edges-hit-layer", () => {
    if (state.mode === "select" && ["base", "overlay"].includes(state.workspaceMode)) {
      map.getCanvas().style.cursor = "pointer";
    }
  });
  map.on("mouseleave", "base-graph-edges-hit-layer", () => {
    if (isComposingNewSegmentEdges()) {
      state.draw.hoverEdgeId = null;
      map.getCanvas().style.cursor = "crosshair";
      return;
    }
    if (state.mode === "select" && !state.draggingManualBaseVertex) {
      map.getCanvas().style.cursor = "";
    }
  });
  map.on("mousemove", "base-graph-edges-hit-layer", (event) => {
    if (!isComposingNewSegmentEdges()) return;
    const f = event.features?.[0];
    if (!f) return;
    const edgeId = String(graphEdgeFeatureId(f));
    const already = state.draw.edgeRefs.some((r) => String(r.edgeId) === edgeId);
    map.getCanvas().style.cursor = already ? "not-allowed" : "copy";
    state.draw.hoverEdgeId = edgeId;
  });
  map.on("mousemove", "manual-base-edges-hit-layer", (event) => {
    if (!isComposingNewSegmentEdges()) return;
    const f = event.features?.[0];
    if (!f) return;
    const edgeId = String(manualBaseEdgeFeatureId(f));
    const already = state.draw.edgeRefs.some((r) => String(r.edgeId) === edgeId);
    map.getCanvas().style.cursor = already ? "not-allowed" : "copy";
    state.draw.hoverEdgeId = edgeId;
  });
  map.on("mouseleave", "manual-base-edges-hit-layer", () => {
    if (isComposingNewSegmentEdges()) {
      state.draw.hoverEdgeId = null;
      map.getCanvas().style.cursor = "crosshair";
    }
  });
  map.on("mouseenter", "cw-overlay-network-hit-layer", () => {
    if (state.workspaceMode === "overlay" && state.mode === "select") {
      map.getCanvas().style.cursor = "pointer";
    }
  });
  map.on("mouseleave", "cw-overlay-network-hit-layer", () => {
    if (state.workspaceMode === "overlay" && state.mode === "select") {
      map.getCanvas().style.cursor = "";
    }
  });

  map.on("click", "segments-layer", (event) => {
    if (state.mode !== "select") return;
    if (state.suppressNextSegmentClick) {
      state.suppressNextSegmentClick = false;
      return;
    }
    const sourceIndex = event.features[0].properties.sourceIndex;
    const activeIndex = state.activeFeatures.findIndex((record) => record.sourceIndex === sourceIndex);
    if (activeIndex >= 0) selectFeatureByActiveIndex(activeIndex);
  });

  map.on("click", (event) => {
    if (state.workspaceMode === "video-sync") {
      handleVideoSyncMapClick(event);
      return;
    }
    if (state.mode === "draw") {
      handleDrawClick(event);
      return;
    }
    if (state.mode === "insert") {
      if (state.workspaceMode === "base") {
        insertManualBaseVertexAtClick(event.lngLat, event.point).catch(showError);
      } else {
        insertVertexAtClick(event.lngLat, event.point);
      }
    }
  });

  map.on("dblclick", (event) => {
    if (state.mode !== "draw") return;
    event.preventDefault();
    finishDraw().catch(showError);
  });

  map.on("mouseenter", "segments-layer", () => {
    if (state.mode === "select") map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", "segments-layer", () => {
    if (state.mode === "select") map.getCanvas().style.cursor = "";
  });

  map.on("click", "data-markers-halo", (event) => {
    if (state.mode !== "select") return;
    const properties = event.features[0].properties;
    selectDataMarker(Number(properties.sourceIndex), Number(properties.index));
  });

  map.on("mousedown", "data-markers-halo", (event) => {
    if (state.mode !== "select") return;
    event.preventDefault();
    const properties = event.features[0].properties;
    const sourceIndex = Number(properties.sourceIndex);
    const dataIndex = Number(properties.index);
    state.draggingDataMarker = { sourceIndex, dataIndex };
    selectDataMarker(sourceIndex, dataIndex);
    map.dragPan.disable();
    map.getCanvas().style.cursor = "grabbing";
  });

  map.on("mouseenter", "data-markers-halo", () => {
    if (state.mode === "select") map.getCanvas().style.cursor = "grab";
  });
  map.on("mouseleave", "data-markers-halo", () => {
    if (state.mode === "select" && !state.draggingDataMarker) map.getCanvas().style.cursor = "";
  });

  map.on("click", "vertices-layer", (event) => {
    if (state.mode !== "select") return;
    if (isEdgePickedSelected()) return;
    if (state.workspaceMode === "base") {
      state.baseOverlay.selectedManualVertexIndex = Number(event.features[0].properties.index);
    } else {
      state.selectedVertexIndex = Number(event.features[0].properties.index);
      state.selectedDataIndex = -1;
    }
    renderVertexSelectionState();
    setStatus(
      state.workspaceMode === "base"
        ? `Selected manual base vertex ${state.baseOverlay.selectedManualVertexIndex + 1}.`
        : `Selected vertex ${state.selectedVertexIndex + 1}.`,
    );
  });

  map.on("mousedown", "vertices-layer", (event) => {
    if (state.mode !== "select") return;
    event.preventDefault();
    if (state.workspaceMode === "base") {
      state.draggingManualBaseVertex = true;
      state.baseOverlay.selectedManualVertexIndex = Number(event.features[0].properties.index);
    } else {
      state.draggingVertex = true;
      state.selectedVertexIndex = Number(event.features[0].properties.index);
      state.selectedDataIndex = -1;
    }
    map.dragPan.disable();
    renderVertexSelectionState();
  });

  map.on("mousemove", (event) => {
    state.lastMapPointer = {
      lngLat: event.lngLat,
      point: event.point,
    };

    if (state.mode === "draw") {
      updateDrawHover(event);
      return;
    }

    if (state.draggingDataMarker) {
      const { sourceIndex, dataIndex } = state.draggingDataMarker;
      const feature = state.source.features[sourceIndex];
      const snapped = snapPointToFeature(event.point, feature);
      if (!snapped) return;
      updateDataMarkerAtSource(sourceIndex, dataIndex, {
        location: [roundCoord(snapped.lat), roundCoord(snapped.lng)],
      });
      return;
    }

    if (!state.draggingVertex) return;
    const feature = selectedFeature();
    if (!feature || state.selectedVertexIndex < 0) return;
    const coord = feature.geometry.coordinates[state.selectedVertexIndex];
    coord[0] = event.lngLat.lng;
    coord[1] = event.lngLat.lat;
    markDirtyForLiveEdit();
    updateSelectedSegmentEditSources();
  });

  map.on("mousemove", (event) => {
    if (!state.draggingManualBaseVertex) return;
    const feature = selectedManualBaseEdge();
    const vertexIndex = state.baseOverlay.selectedManualVertexIndex;
    const coord = feature?.geometry?.coordinates?.[vertexIndex];
    if (!coord) return;
    coord[0] = roundCoord(event.lngLat.lng);
    coord[1] = roundCoord(event.lngLat.lat);
    feature.properties = {
      ...(feature.properties || {}),
      updatedAt: new Date().toISOString(),
    };
    updateManualBaseEditSources();
  });

  map.on("mouseup", () => {
    if (state.draggingDataMarker) {
      state.draggingDataMarker = null;
      map.dragPan.enable();
      map.getCanvas().style.cursor = "";
      renderAll();
      setStatus("Data marker moved.");
      return;
    }

    if (state.draggingManualBaseVertex) {
      state.draggingManualBaseVertex = false;
      map.dragPan.enable();
      saveManualBaseEdges()
        .then(() => {
          renderAll();
          setStatus("Manual base vertex moved. Recalculate the graph when ready.");
        })
        .catch(showError);
      return;
    }

    if (!state.draggingVertex) return;
    const movedFeature = selectedFeature();
    state.draggingVertex = false;
    map.dragPan.enable();
    clearSelectedSegmentMatchResult();
    queueChangedFeature(movedFeature);
    map.getSource("segments")?.setData(mapFeatureCollection());
    renderForm();
    renderDrawControls();
    setStatus("Vertex moved.");
  });

  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select")) {
      return;
    }

    if (!isDrawing()) {
      if (event.code === "Space" && !event.repeat) {
        event.preventDefault();
        quickSnapEditSelectedSegment();
        return;
      }
      if (
        event.key.toLowerCase() === "d" &&
        !event.repeat &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        state.workspaceMode === "segments" &&
        selectedFeature() &&
        state.selectedVertexIndex >= 0
      ) {
        event.preventDefault();
        deleteSelectedVertex();
        return;
      }
      if (event.key === "Escape" && state.segmentsOpen) {
        event.preventDefault();
        setSegmentDrawer(false);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelDraw();
    } else if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      removeLastDrawStep();
    } else if (event.key === "Enter") {
      event.preventDefault();
      finishDraw().catch(showError);
    }
  });
}

function showError(error) {
  console.error(error);
  const message = error instanceof Error ? error.message : String(error);
  if (error?.editorAlertShown) {
    return;
  }
  showAlert("Action failed", message);
  setStatus(message, "error");
}

async function addMapLayers() {
  await loadDataMarkerIcons();

  if (!map.getSource("segments")) {
    map.addSource("segments", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getSource("selected-segment-source")) {
    map.addSource("selected-segment-source", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getSource("vertices")) {
    map.addSource("vertices", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getSource("data-markers")) {
    map.addSource("data-markers", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getSource("draw-line")) {
    map.addSource("draw-line", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getSource("draw-points")) {
    map.addSource("draw-points", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getSource("base-graph-edges")) {
    map.addSource("base-graph-edges", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getSource("selected-base-graph-edge")) {
    map.addSource("selected-base-graph-edge", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getSource("selected-match-preview")) {
    map.addSource("selected-match-preview", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getSource("selected-overlay-edges")) {
    map.addSource("selected-overlay-edges", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getSource("cw-overlay-network")) {
    map.addSource("cw-overlay-network", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getSource("manual-base-edges")) {
    map.addSource("manual-base-edges", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getSource("compose-edge-pick")) {
    map.addSource("compose-edge-pick", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }

  if (!map.getLayer("base-graph-edges-layer")) {
    map.addLayer({
      id: "base-graph-edges-layer",
      type: "line",
      source: "base-graph-edges",
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": [
          "case",
          ["==", ["get", "source"], "manual"],
          BASE_GRAPH_LINE_COLOR,
          ["coalesce", ["get", "graphColor"], BASE_GRAPH_FALLBACK_LINE_COLOR],
        ],
        "line-width": BASE_GRAPH_LINE_WIDTH,
        "line-opacity": BASE_GRAPH_LINE_OPACITY,
      },
    });
  }

  if (!map.getLayer("base-graph-edges-hit-layer")) {
    map.addLayer({
      id: "base-graph-edges-hit-layer",
      type: "line",
      source: "base-graph-edges",
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": "#000000",
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 16, 14, 22, 16, 28],
        "line-opacity": 0.01,
      },
    });
  }

  if (!map.getLayer("selected-base-graph-edge-layer")) {
    map.addLayer({
      id: "selected-base-graph-edge-layer",
      type: "line",
      source: "selected-base-graph-edge",
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": "#f2c94c",
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 5, 14, 8, 16, 11],
        "line-opacity": 0.95,
      },
    });
  }

  if (!map.getLayer("segments-layer")) {
    map.addLayer({
      id: "segments-layer",
      type: "line",
      source: "segments",
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": [
          "match",
          ["get", "roadType"],
          "dirt",
          "#ae9067",
          "road",
          "#8f2424",
          "#0288d1",
        ],
        "line-width": 3,
        "line-opacity": 0.85,
      },
    });
  }

  if (!map.getLayer("unresolved-segments-layer")) {
    map.addLayer({
      id: "unresolved-segments-layer",
      type: "line",
      source: "segments",
      filter: ["==", ["get", "id"], "__none__"],
      layout: {
        "line-join": "round",
        "line-cap": "round",
        visibility: "none",
      },
      paint: {
        "line-color": "#dc2626",
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 5, 14, 8, 16, 11],
        "line-opacity": 0.95,
      },
    });
  }

  if (!map.getLayer("cw-overlay-network-layer")) {
    map.addLayer({
      id: "cw-overlay-network-layer",
      type: "line",
      source: "cw-overlay-network",
      layout: {
        "line-join": "round",
        "line-cap": "round",
        visibility: "none",
      },
      paint: {
        "line-color": [
          "match",
          ["get", "roadType"],
          "dirt",
          "#ae9067",
          "road",
          "#8f2424",
          "#0288d1",
        ],
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3.8, 14, 5.4, 16, 7.4],
        "line-opacity": 0.82,
      },
    });
  }

  if (!map.getLayer("cw-overlay-network-hit-layer")) {
    map.addLayer({
      id: "cw-overlay-network-hit-layer",
      type: "line",
      source: "cw-overlay-network",
      layout: {
        "line-join": "round",
        "line-cap": "round",
        visibility: "none",
      },
      paint: {
        "line-color": "#000000",
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 14, 14, 20, 16, 26],
        "line-opacity": 0.01,
      },
    });
  }

  if (!map.getLayer("selected-segment")) {
    map.addLayer({
      id: "selected-segment",
      type: "line",
      source: "selected-segment-source",
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": "#f2c94c",
        "line-width": 7,
        "line-opacity": 0.9,
      },
    });
  }

  if (!map.getLayer("selected-overlay-edges-layer")) {
    map.addLayer({
      id: "selected-overlay-edges-layer",
      type: "line",
      source: "selected-overlay-edges",
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": ["case", ["==", ["get", "overlayHovered"], true], "#f97316", "#14b8a6"],
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          ["case", ["==", ["get", "overlayHovered"], true], 8, 5],
          14,
          ["case", ["==", ["get", "overlayHovered"], true], 12, 8],
          16,
          ["case", ["==", ["get", "overlayHovered"], true], 16, 11],
        ],
        "line-opacity": ["case", ["==", ["get", "overlayHovered"], true], 1, 0.72],
      },
    });
  }

  if (!map.getLayer("compose-edge-pick-layer")) {
    map.addLayer({
      id: "compose-edge-pick-layer",
      type: "line",
      source: "compose-edge-pick",
      layout: { "line-join": "round", "line-cap": "round", visibility: "none" },
      paint: {
        "line-color": "#ea580c",
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 5, 14, 9, 16, 13],
        "line-opacity": 0.9,
      },
    });
  }
  if (!map.getLayer("compose-edge-pick-labels")) {
    map.addLayer({
      id: "compose-edge-pick-labels",
      type: "symbol",
      source: "compose-edge-pick",
      layout: {
        "symbol-placement": "line-center",
        "text-field": ["to-string", ["get", "sequenceNumber"]],
        "text-size": 14,
        "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
        visibility: "none",
      },
      paint: {
        "text-color": "#ffffff",
        "text-halo-color": "#ea580c",
        "text-halo-width": 2,
      },
    });
  }

  if (!map.getLayer("selected-match-edges-layer")) {
    map.addLayer({
      id: "selected-match-edges-layer",
      type: "line",
      source: "selected-match-preview",
      filter: ["==", ["get", "kind"], "matchedEdge"],
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": [
          "match",
          ["get", "confidence"],
          "high",
          "#0f766e",
          "medium",
          "#b7791f",
          "low",
          "#c05621",
          "#64748b",
        ],
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 4, 14, 7, 16, 10],
        "line-opacity": 0.82,
      },
    });
  }

  if (!map.getLayer("selected-match-gaps-layer")) {
    map.addLayer({
      id: "selected-match-gaps-layer",
      type: "line",
      source: "selected-match-preview",
      filter: ["==", ["get", "kind"], "gap"],
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": "#d21f3c",
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 4, 14, 7, 16, 10],
        "line-dasharray": [0.8, 0.8],
        "line-opacity": 0.9,
      },
    });
  }

  if (!map.getLayer("selected-match-continuity-gaps-layer")) {
    map.addLayer({
      id: "selected-match-continuity-gaps-layer",
      type: "line",
      source: "selected-match-preview",
      filter: ["==", ["get", "kind"], "continuityGap"],
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": "#7c2d12",
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 5, 14, 8, 16, 11],
        "line-dasharray": [0.3, 1.1],
        "line-opacity": 0.95,
      },
    });
  }

  if (!map.getLayer("selected-match-unmatched-samples-layer")) {
    map.addLayer({
      id: "selected-match-unmatched-samples-layer",
      type: "circle",
      source: "selected-match-preview",
      filter: ["==", ["get", "kind"], "unmatchedSample"],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 14, 7, 16, 10],
        "circle-color": "#dc2626",
        "circle-opacity": 0.95,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });
  }

  if (!map.getLayer("selected-match-distant-samples-layer")) {
    map.addLayer({
      id: "selected-match-distant-samples-layer",
      type: "circle",
      source: "selected-match-preview",
      filter: ["==", ["get", "kind"], "distantSample"],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 14, 5, 16, 8],
        "circle-color": "#f97316",
        "circle-opacity": 0.9,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.5,
      },
    });
  }

  if (!map.getLayer("selected-overlay-hovered-edge-layer")) {
    map.addLayer({
      id: "selected-overlay-hovered-edge-layer",
      type: "line",
      source: "selected-overlay-edges",
      filter: ["==", ["get", "overlayHovered"], true],
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": "#f97316",
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 9, 14, 13, 16, 18],
        "line-opacity": 1,
      },
    });
  }

  if (!map.getLayer("manual-base-edges-hit-layer")) {
    map.addLayer({
      id: "manual-base-edges-hit-layer",
      type: "line",
      source: "manual-base-edges",
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": "#000000",
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 12, 14, 16, 16, 20],
        "line-opacity": 0.01,
      },
    });
  }

  if (!map.getLayer("manual-base-edges-layer")) {
    map.addLayer({
      id: "manual-base-edges-layer",
      type: "line",
      source: "manual-base-edges",
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": BASE_GRAPH_LINE_COLOR,
        "line-width": BASE_GRAPH_LINE_WIDTH,
        "line-opacity": BASE_GRAPH_LINE_OPACITY,
      },
    });
  }

  if (!map.getLayer("selected-manual-base-edge")) {
    map.addLayer({
      id: "selected-manual-base-edge",
      type: "line",
      source: "manual-base-edges",
      filter: selectedManualBaseEdgeFilter(),
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": "#f2c94c",
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 6, 14, 9, 16, 12],
        "line-opacity": 0.95,
      },
    });
  }

  if (!map.getLayer("draw-line-layer")) {
    map.addLayer({
      id: "draw-line-layer",
      type: "line",
      source: "draw-line",
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": "#0b4f5d",
        "line-width": 4,
        "line-dasharray": [1.4, 1.2],
        "line-opacity": 0.95,
      },
    });
  }

  if (!map.getLayer("draw-points-layer")) {
    map.addLayer({
      id: "draw-points-layer",
      type: "circle",
      source: "draw-points",
      paint: {
        "circle-radius": [
          "case",
          ["==", ["get", "kind"], "endpoint"],
          ["case", ["get", "active"], 10, 8],
          ["case", ["get", "active"], 7, 5],
        ],
        "circle-color": [
          "case",
          ["==", ["get", "kind"], "endpoint"],
          ["case", ["get", "active"], "#f2c94c", "#ffffff"],
          "#116a7b",
        ],
        "circle-stroke-color": "#1f2a2e",
        "circle-stroke-width": [
          "case",
          ["==", ["get", "kind"], "endpoint"],
          3,
          2,
        ],
      },
    });
  }

  if (!map.getLayer("vertices-layer")) {
    map.addLayer({
      id: "vertices-layer",
      type: "circle",
      source: "vertices",
      paint: {
        "circle-radius": ["case", ["get", "selected"], 7, 5],
        "circle-color": ["case", ["get", "selected"], "#f2c94c", "#ffffff"],
        "circle-stroke-color": "#1f2a2e",
        "circle-stroke-width": 2,
      },
    });
  }

  if (!map.getLayer("data-markers-halo")) {
    map.addLayer({
      id: "data-markers-halo",
      type: "circle",
      source: "data-markers",
      paint: {
        "circle-radius": ["case", ["get", "selected"], 13, 10],
        "circle-color": dataColorExpression(),
        "circle-opacity": ["case", ["get", "selected"], 0.42, 0.24],
        "circle-stroke-color": ["case", ["get", "selected"], "#1f2a2e", "#ffffff"],
        "circle-stroke-width": ["case", ["get", "selected"], 2, 1],
      },
    });
  }

  if (!map.getLayer("data-markers-layer")) {
    map.addLayer({
      id: "data-markers-layer",
      type: "symbol",
      source: "data-markers",
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": ["case", ["get", "selected"], 1.12, 0.95],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "text-field": [
          "match",
          ["get", "type"],
          ["payment", "gate", "mud", "warning", "slope", "narrow", "severe"],
          "",
          ["coalesce", ["get", "emoji"], ""],
        ],
        "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
        "text-size": ["case", ["get", "selected"], 16, 13],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "icon-opacity": ["case", ["get", "selected"], 1, 0.72],
      },
    });
  }
}

// ============================================================
// Video Sync mode
// ============================================================

const VS_ROUTE_SOURCE_ID = "vs-route-source";
const VS_ROUTE_LAYER_ID = "vs-route-layer";
const VS_KF_SOURCE_ID = "vs-kf-source";
const VS_KF_LAYER_ID = "vs-kf-layer";
const VS_SNAP_THRESHOLD_M = 80;

const videoSyncState = {
  slug: null,
  routePolyline: null,   // [{lat, lng}, ...]
  keyframes: [],         // [{t, lat, lon}, ...] (lon to match JSON convention)
  youtubeId: null,
  player: null,
  videoDuration: 0,
  selectedIndex: -1,
};

const vsEls = {
  slug: document.getElementById("vs-slug"),
  ytUrl: document.getElementById("vs-yt-url"),
  player: document.getElementById("vs-player"),
  keyframesList: document.getElementById("vs-keyframes"),
  saveDraft: document.getElementById("vs-save-draft"),
  promote: document.getElementById("vs-promote"),
  status: document.getElementById("vs-status"),
};

function vsSetStatus(msg) {
  if (vsEls.status) vsEls.status.textContent = msg || "";
}

function vsFormatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

function vsExtractYouTubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1) || null;
    if (u.hostname.includes("youtube.com")) return u.searchParams.get("v");
  } catch {}
  return null;
}

// Snap a {lat, lng} point to the nearest point on the polyline.
// Returns { lat, lng, distanceMeters } or null if route empty.
function vsSnapToPolyline(point, polyline) {
  if (!polyline || polyline.length < 2) return null;
  const EARTH_R = 6371000;
  const DEG = Math.PI / 180;
  function hav(a, b) {
    const dLat = (b.lat - a.lat) * DEG;
    const dLng = (b.lng - a.lng) * DEG;
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_R * Math.asin(Math.sqrt(h));
  }
  let best = { lat: 0, lng: 0, dist: Infinity };
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const cosLat = Math.cos(((a.lat + b.lat) / 2) * DEG);
    const ax = a.lng * cosLat, ay = a.lat;
    const bx = b.lng * cosLat, by = b.lat;
    const px = point.lng * cosLat, py = point.lat;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const projLat = a.lat + (b.lat - a.lat) * t;
    const projLng = a.lng + (b.lng - a.lng) * t;
    const d = hav(point, { lat: projLat, lng: projLng });
    if (d < best.dist) best = { lat: projLat, lng: projLng, dist: d };
  }
  return { lat: best.lat, lng: best.lng, distanceMeters: best.dist };
}

function vsLoadYouTubeIframeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  return new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
}

async function vsLoadVideo(youtubeId) {
  if (videoSyncState.youtubeId === youtubeId && videoSyncState.player) return;
  videoSyncState.youtubeId = youtubeId;
  const YT = await vsLoadYouTubeIframeApi();
  vsEls.player.innerHTML = "";
  if (videoSyncState.player) {
    try { videoSyncState.player.destroy(); } catch {}
  }
  videoSyncState.player = new YT.Player(vsEls.player, {
    videoId: youtubeId,
    playerVars: { enablejsapi: 1, rel: 0 },
    events: {
      onReady: () => {
        const dur = videoSyncState.player.getDuration?.();
        if (typeof dur === "number" && dur > 0) videoSyncState.videoDuration = dur;
      },
    },
  });
}

function vsRenderRouteLayer() {
  if (!map) return;
  const coords = (videoSyncState.routePolyline || []).map((p) => [p.lng, p.lat]);
  const data = {
    type: "FeatureCollection",
    features: coords.length >= 2
      ? [{ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} }]
      : [],
  };
  if (!map.getSource(VS_ROUTE_SOURCE_ID)) {
    map.addSource(VS_ROUTE_SOURCE_ID, { type: "geojson", data });
    map.addLayer({
      id: VS_ROUTE_LAYER_ID,
      type: "line",
      source: VS_ROUTE_SOURCE_ID,
      paint: { "line-color": "#1976d2", "line-width": 4, "line-opacity": 0.7 },
    });
  } else {
    map.getSource(VS_ROUTE_SOURCE_ID).setData(data);
  }
}

function vsRenderKeyframesLayer() {
  if (!map) return;
  const features = videoSyncState.keyframes.map((kf, i) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [kf.lon, kf.lat] },
    properties: { idx: i, selected: i === videoSyncState.selectedIndex },
  }));
  const data = { type: "FeatureCollection", features };
  if (!map.getSource(VS_KF_SOURCE_ID)) {
    map.addSource(VS_KF_SOURCE_ID, { type: "geojson", data });
    map.addLayer({
      id: VS_KF_LAYER_ID,
      type: "circle",
      source: VS_KF_SOURCE_ID,
      paint: {
        "circle-radius": ["case", ["boolean", ["get", "selected"], false], 9, 6],
        "circle-color": ["case", ["boolean", ["get", "selected"], false], "#ff6d00", "#ff3d3d"],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });
  } else {
    map.getSource(VS_KF_SOURCE_ID).setData(data);
  }
}

function vsClearMapLayers() {
  if (!map) return;
  for (const id of [VS_KF_LAYER_ID, VS_ROUTE_LAYER_ID]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of [VS_KF_SOURCE_ID, VS_ROUTE_SOURCE_ID]) {
    if (map.getSource(id)) map.removeSource(id);
  }
}

function vsRenderKeyframesList() {
  vsEls.keyframesList.innerHTML = "";
  videoSyncState.keyframes.forEach((kf, i) => {
    const li = document.createElement("li");
    if (i === videoSyncState.selectedIndex) li.classList.add("selected");
    const time = document.createElement("span");
    time.className = "vs-kf-time";
    time.textContent = vsFormatTime(kf.t);
    const coord = document.createElement("span");
    coord.className = "vs-kf-coord";
    coord.textContent = `${kf.lat.toFixed(5)}, ${kf.lon.toFixed(5)}`;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "mini-button";
    del.textContent = "Delete";
    del.addEventListener("click", () => {
      videoSyncState.keyframes.splice(i, 1);
      if (videoSyncState.selectedIndex === i) videoSyncState.selectedIndex = -1;
      vsRenderKeyframesList();
      vsRenderKeyframesLayer();
    });
    li.addEventListener("click", () => {
      videoSyncState.selectedIndex = i;
      if (videoSyncState.player?.seekTo) videoSyncState.player.seekTo(kf.t, true);
      vsRenderKeyframesList();
      vsRenderKeyframesLayer();
    });
    li.append(time, coord, del);
    vsEls.keyframesList.appendChild(li);
  });
}

function handleVideoSyncMapClick(event) {
  if (!videoSyncState.routePolyline) {
    vsSetStatus("Pick a route first.");
    return;
  }
  if (!videoSyncState.player || typeof videoSyncState.player.getCurrentTime !== "function") {
    vsSetStatus("Load a YouTube URL first.");
    return;
  }
  const snap = vsSnapToPolyline(
    { lat: event.lngLat.lat, lng: event.lngLat.lng },
    videoSyncState.routePolyline,
  );
  if (!snap || snap.distanceMeters > VS_SNAP_THRESHOLD_M) {
    vsSetStatus(`Click too far from route (${snap?.distanceMeters?.toFixed(0)}m).`);
    return;
  }
  const t = videoSyncState.player.getCurrentTime();
  // Replace any existing keyframe at same t (within 50ms), else insert sorted.
  const filtered = videoSyncState.keyframes.filter((kf) => Math.abs(kf.t - t) > 0.05);
  filtered.push({ t, lat: snap.lat, lon: snap.lng });
  filtered.sort((a, b) => a.t - b.t);
  videoSyncState.keyframes = filtered;
  videoSyncState.selectedIndex = filtered.findIndex((kf) => kf.t === t);
  vsRenderKeyframesList();
  vsRenderKeyframesLayer();
  vsSetStatus(`Added keyframe at ${vsFormatTime(t)}.`);
}

async function vsLoadRouteForSlug(slug) {
  vsSetStatus(`Loading route ${slug}…`);
  const r = await fetch(`/api/video-keyframes/${slug}/route-polyline`);
  if (!r.ok) {
    const err = await r.text();
    vsSetStatus(`Route load failed: ${err}`);
    videoSyncState.routePolyline = null;
    vsRenderRouteLayer();
    return;
  }
  const polyline = await r.json();
  videoSyncState.routePolyline = polyline;
  vsRenderRouteLayer();
  // Fit map to route bounds
  if (polyline.length >= 2 && map) {
    const lons = polyline.map((p) => p.lng);
    const lats = polyline.map((p) => p.lat);
    map.fitBounds(
      [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      { padding: 60, duration: 600 },
    );
  }
  vsSetStatus("Route loaded.");
}

async function vsLoadExistingDraft(slug) {
  videoSyncState.keyframes = [];
  videoSyncState.selectedIndex = -1;
  vsRenderKeyframesList();
  vsRenderKeyframesLayer();
  // The GET draft endpoint falls back to the promoted file on the server side
  // so the editor can resume editing after a promote (which removes the draft).
  const r = await fetch(`/api/video-keyframes/${slug}/draft`);
  if (!r.ok) {
    vsEls.ytUrl.value = "";
    return;
  }
  const draft = await r.json();
  videoSyncState.keyframes = (draft.keyframes || []).slice().sort((a, b) => a.t - b.t);
  vsRenderKeyframesList();
  vsRenderKeyframesLayer();
  if (draft.youtubeId) {
    vsEls.ytUrl.value = `https://youtube.com/watch?v=${draft.youtubeId}`;
    vsLoadVideo(draft.youtubeId).catch((err) => vsSetStatus(`YT load failed: ${err.message}`));
  }
  if (typeof draft.videoDuration === "number") {
    videoSyncState.videoDuration = draft.videoDuration;
  }
  vsSetStatus(`Loaded draft with ${videoSyncState.keyframes.length} keyframes.`);
}

async function vsOnSlugChange() {
  const slug = vsEls.slug.value;
  videoSyncState.slug = slug;
  if (!slug) return;
  await vsLoadRouteForSlug(slug);
  await vsLoadExistingDraft(slug);
}

async function activateVideoSyncMode() {
  // Populate slug dropdown once.
  if (!vsEls.slug.options.length) {
    const r = await fetch("/api/featured-slugs");
    const slugs = r.ok ? await r.json() : [];
    for (const slug of slugs) {
      const opt = document.createElement("option");
      opt.value = slug;
      opt.textContent = slug;
      vsEls.slug.appendChild(opt);
    }
    if (slugs.length > 0) vsEls.slug.value = slugs[0];
  }
  await vsOnSlugChange();
}

// Wire static event handlers once at startup.
vsEls.slug.addEventListener("change", () => vsOnSlugChange().catch(showError));
vsEls.ytUrl.addEventListener("change", (e) => {
  const id = vsExtractYouTubeId(e.target.value);
  if (id) vsLoadVideo(id).catch((err) => vsSetStatus(`YT load failed: ${err.message}`));
});
vsEls.saveDraft.addEventListener("click", async () => {
  const slug = videoSyncState.slug;
  const youtubeId = videoSyncState.youtubeId;
  const videoDuration = videoSyncState.player?.getDuration?.() || videoSyncState.videoDuration;
  if (!slug || !youtubeId || !videoDuration) {
    vsSetStatus("Need a slug, YouTube URL, and loaded video to save.");
    return;
  }
  const payload = {
    version: 1,
    youtubeId,
    videoDuration,
    keyframes: videoSyncState.keyframes,
  };
  const r = await fetch(`/api/video-keyframes/${slug}/draft`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await r.json().catch(() => ({}));
  vsSetStatus(r.ok ? "Draft saved." : `Save failed: ${result?.error || r.statusText}`);
});
vsEls.promote.addEventListener("click", async () => {
  const slug = videoSyncState.slug;
  if (!slug) return;
  const r = await fetch(`/api/video-keyframes/${slug}/promote`, { method: "POST" });
  const result = await r.json().catch(() => ({}));
  vsSetStatus(r.ok ? "Promoted." : `Promote failed: ${result?.error || r.statusText}`);
});

map.on("style.load", () => {
  restoreEditorLayersAfterStyleChange().catch(showError);
});

// ============================================================
// Route Catalog mode
// ============================================================

const routeCatalogState = {
  loaded: null,
  draft: null,
  selectedSlug: null,
  places: [],
};

const rcEls = {
  status: document.getElementById("rc-status"),
  list: document.getElementById("rc-list"),
  detail: document.getElementById("rc-detail"),
  newBtn: document.getElementById("rc-new"),
  saveBtn: document.getElementById("rc-save-draft"),
  recomputeBtn: document.getElementById("rc-recompute"),
  promoteBtn: document.getElementById("rc-promote"),
};

function rcSetStatus(msg) {
  if (rcEls.status) rcEls.status.textContent = msg || "";
}

function rcSelectedEntry() {
  if (!routeCatalogState.draft) return null;
  return (
    routeCatalogState.draft.entries.find((e) => e.slug === routeCatalogState.selectedSlug) ||
    null
  );
}

function rcRenderList() {
  const draft = routeCatalogState.draft;
  rcEls.list.innerHTML = "";
  if (!draft || draft.entries.length === 0) {
    const li = document.createElement("li");
    li.textContent = "(no entries — click + New entry)";
    li.style.opacity = "0.6";
    rcEls.list.appendChild(li);
    return;
  }
  for (const entry of draft.entries) {
    const li = document.createElement("li");
    if (entry.slug === routeCatalogState.selectedSlug) li.classList.add("selected");
    const main = document.createElement("span");
    main.textContent = `${entry.name || entry.slug}${entry.featured ? " ⭐" : ""}`;
    const tags = document.createElement("span");
    tags.className = "rc-tags";
    const dist = entry.distanceKm != null ? `${entry.distanceKm} km` : "?";
    const diff = entry.difficulty || "?";
    const style = entry.style || "?";
    tags.textContent = `${dist} · ${diff} · ${style}`;
    li.append(main, tags);
    li.addEventListener("click", () => {
      routeCatalogState.selectedSlug = entry.slug;
      rcRenderList();
      rcRenderDetail();
    });
    rcEls.list.appendChild(li);
  }
}

function rcRenderDetail() {
  const entry = rcSelectedEntry();
  if (!entry) {
    rcEls.detail.hidden = true;
    return;
  }
  rcEls.detail.hidden = false;
  rcEls.detail.innerHTML = "";
  const fields = [
    { key: "slug", label: "Slug" },
    { key: "name", label: "Name" },
    { key: "summary", label: "Summary" },
    { key: "route", label: "Route token" },
    { key: "notes", label: "Notes", textarea: true },
  ];
  for (const f of fields) {
    const row = document.createElement("div");
    row.className = "rc-row";
    const label = document.createElement("label");
    label.textContent = `${f.label}:`;
    const input = document.createElement(f.textarea ? "textarea" : "input");
    input.value = entry[f.key] ?? "";
    if (!f.textarea) input.type = "text";
    input.addEventListener("input", (e) => {
      entry[f.key] = e.target.value;
    });
    row.append(label, input);
    rcEls.detail.appendChild(row);
  }
  const featuredRow = document.createElement("div");
  featuredRow.className = "rc-row";
  const fLabel = document.createElement("label");
  fLabel.textContent = "Featured:";
  const fInput = document.createElement("input");
  fInput.type = "checkbox";
  fInput.checked = !!entry.featured;
  fInput.addEventListener("change", (e) => {
    entry.featured = e.target.checked;
  });
  featuredRow.append(fLabel, fInput);
  rcEls.detail.appendChild(featuredRow);

  const computed = document.createElement("div");
  computed.className = "rc-computed";
  const lines = [
    `Distance: ${entry.distanceKm ?? "?"} km · Elevation gain: ${entry.elevationGainM ?? "?"} m`,
    `Region: ${entry.regionId ?? "?"} · Difficulty: ${entry.difficulty ?? "?"} · Style: ${entry.style ?? "?"}`,
    `Passes near: ${(entry.passesNear || []).join(", ") || "(none)"}`,
  ];
  computed.textContent = lines.join("\n");
  rcEls.detail.appendChild(computed);

  const actionRow = document.createElement("div");
  actionRow.className = "rc-row";
  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "secondary-button danger";
  delBtn.textContent = "Delete";
  delBtn.addEventListener("click", () => {
    if (!confirm(`Delete ${entry.slug}?`)) return;
    routeCatalogState.draft.entries = routeCatalogState.draft.entries.filter(
      (e) => e.slug !== entry.slug,
    );
    routeCatalogState.selectedSlug = null;
    rcRenderList();
    rcRenderDetail();
  });
  actionRow.appendChild(delBtn);
  rcEls.detail.appendChild(actionRow);
}

async function rcLoad() {
  rcSetStatus("Loading…");
  const r = await fetch("/api/route-catalog/draft");
  if (!r.ok) {
    rcSetStatus("Load failed");
    return;
  }
  routeCatalogState.loaded = await r.json();
  routeCatalogState.draft = JSON.parse(JSON.stringify(routeCatalogState.loaded));
  const pr = await fetch("/api/route-catalog/places");
  routeCatalogState.places = pr.ok ? ((await pr.json())?.places || []) : [];
  rcSetStatus(`${routeCatalogState.draft.entries.length} entries loaded.`);
  rcRenderList();
  rcRenderDetail();
}

async function rcSaveDraft() {
  rcSetStatus("Saving…");
  const r = await fetch("/api/route-catalog/draft", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(routeCatalogState.draft),
  });
  const result = await r.json().catch(() => ({}));
  rcSetStatus(r.ok ? "Draft saved." : `Save failed: ${result.error || r.statusText}`);
}

async function rcRecompute() {
  rcSetStatus("Computing…");
  const r = await fetch("/api/route-catalog/recompute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(routeCatalogState.draft),
  });
  const result = await r.json().catch(() => ({}));
  if (!r.ok) {
    rcSetStatus(`Recompute failed: ${result.error || r.statusText}`);
    return;
  }
  routeCatalogState.draft = result;
  rcSetStatus("Metadata refreshed.");
  rcRenderList();
  rcRenderDetail();
}

async function rcPromote() {
  await rcSaveDraft();
  rcSetStatus("Promoting…");
  const r = await fetch("/api/route-catalog/promote", { method: "POST" });
  const result = await r.json().catch(() => ({}));
  rcSetStatus(
    r.ok
      ? `Promoted (${result.entryCount} entries).`
      : `Promote failed: ${result.error || r.statusText}`,
  );
  if (r.ok) await rcLoad();
}

function rcNewEntry() {
  const slug = prompt("New entry slug (lowercase, kebab-case):");
  if (!slug || !/^[a-z][a-z0-9-]*$/.test(slug)) {
    alert("Invalid slug.");
    return;
  }
  if (routeCatalogState.draft.entries.some((e) => e.slug === slug)) {
    alert("Slug already exists.");
    return;
  }
  routeCatalogState.draft.entries.push({
    slug,
    name: slug,
    summary: "",
    route: "",
    notes: "",
    featured: false,
  });
  routeCatalogState.selectedSlug = slug;
  rcRenderList();
  rcRenderDetail();
}

rcEls.newBtn.addEventListener("click", rcNewEntry);
rcEls.saveBtn.addEventListener("click", () => rcSaveDraft().catch(showError));
rcEls.recomputeBtn.addEventListener("click", () => rcRecompute().catch(showError));
rcEls.promoteBtn.addEventListener("click", () => rcPromote().catch(showError));

async function activateRouteCatalogMode() {
  if (!routeCatalogState.draft) await rcLoad();
}

map.on("load", async () => {
  try {
    await addMapLayers();
    wireEvents();
    await loadSource();
  } catch (error) {
    showError(error);
  }
});
