import {
  stitchCoordsFromEdgeRefs,
  validateEdgePickMapping,
  conflictingSegmentForEdge,
  orientAppendedEdgeRef,
} from "./lib/edge-pick.mjs";
import { migrateOverlayEdgeReplacement } from "./lib/overlay-edge-migration.mjs";
import { filterRoundaboutItems } from "./lib/roundaboutReview.mjs";
import { filterCrossingItems } from "./lib/crossingReview.mjs";
import {
  buildBaseEdgeDirectionLayer,
  summarizeBaseEdgeDirectionLayer,
} from "./lib/base-edge-direction-layer.mjs";
import {
  POI_TYPE_OPTIONS,
  poiColor,
  poiEmoji,
  poiMarkerIconName,
} from "../packages/core/src/data/poiTypes.js";
import { registerPoiEmojiImages } from "../packages/core/src/map/emojiMarkerImage.js";
import { parseRichText } from "../packages/core/src/utils/richText.js";
import { bootstrapKeyframesFromGps } from "../src/components/featured/gpsBootstrap.js";
import { createVideoSync } from "../packages/core/src/featured/videoSync.js";
import {
  buildCumulativeDistances,
  nearestPointOnPolyline,
  pointAtFraction,
  snapPointToRouteWithinWindow,
} from "../packages/core/src/domain/routeGeometryMath.js";
import { vsFormatTime, vsParseTime } from "./lib/vs-time.mjs";
import {
  DEFAULT_CONNECTOR_STRATEGY,
  evaluateConnectorEdge,
  hasCyclewaysNetworkMembership,
} from "../packages/core/src/routing/connectorCostModel.js";
import { computeConnectorFeatures } from "../packages/core/src/routing/connectorFeatures.js";
import {
  DEFAULT_CONNECTOR_THRESHOLDS,
} from "../packages/core/src/routing/connectorConfidence.js";
import { evaluateThresholds } from "../packages/core/src/routing/connectorEvaluate.js";
import {
  connectorCostColor,
  connectorClassColor,
  connectorAccessColor,
  CONNECTOR_COST_LEGEND,
  CONNECTOR_CLASS_LEGEND,
  CONNECTOR_ACCESS_LEGEND,
  CONNECTOR_EXCLUDED_COLOR,
} from "./lib/connectorColors.mjs";

const CONNECTOR_CLASS_KEYS = ["cw_network", "road", "local_road", "cycle", "path_track", "manual", "other"];
const CONNECTOR_ACCESS_KEYS = ["restricted", "conditional"];
const CONNECTOR_VERDICT_COLORS = {
  valid: "#1b7837",
  unacceptable: "#dc2626",
  borderline: "#f59e0b",
};

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
  directionReviewToggledThisClick: null,
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
  roundabouts: {
    loading: false,
    loaded: false,
    error: null,
    data: null,
    filter: "all",
    selectedId: null,
  },
  crossings: {
    loading: false,
    loaded: false,
    error: null,
    data: null,
    filter: "all",
    selectedId: null,
  },
  baseOverlay: {
    enabled: false,
    loading: false,
    loaded: false,
    recalculating: false,
    showOneWayDirections: false,
    selectedGraphEdgeId: null,
    selectedManualEdgeIndex: -1,
    selectedManualVertexIndex: -1,
    hoveredOverlayEdgeId: null,
    graphEdges: null,
    matchSummary: null,
    matchPreview: null,
    manualBaseEdges: emptyManualBaseEdges(),
    traversalOverrides: emptyTraversalOverrides(),
    overlay: emptyBaseOverlay(),
    cache: {},
  },
  directionReview: {
    loaded: false,
    source: null,
    readOnly: true,
    profile: "production-v1",
    overlay: null,
    alignmentKey: "aToB",
    applying: false,
    busy: false,
    editing: false,
  },
  connectorLens: {
    // "off" | "class" | "access" | "eligibility" | "cost"
    colorMode: "off",
    strategy: structuredClone(DEFAULT_CONNECTOR_STRATEGY),
    targetStart: null,
    targetRouteSlug: "",
    pickingTarget: false,
    routesLoaded: false,
    lastFrequencyResult: null,
    hideUnreachable: true,
    labeling: {
      active: false,
      index: 0,
      verdicts: new Map(),
      busy: false,
    },
    thresholds: structuredClone(DEFAULT_CONNECTOR_THRESHOLDS),
    labelsCache: [],
  },
};

const els = {
  mapToolbar: document.querySelector(".map-toolbar"),
  workspaceSegments: document.getElementById("workspace-segments"),
  workspaceBase: document.getElementById("workspace-base"),
  workspaceOverlay: document.getElementById("workspace-overlay"),
  workspaceRoundabouts: document.getElementById("workspace-roundabouts"),
  workspaceCrossings: document.getElementById("workspace-crossings"),
  workspaceVideoSync: document.getElementById("workspace-video-sync"),
  workspaceRouteCatalog: document.getElementById("workspace-route-catalog"),
  baseGraphPanel: document.getElementById("base-graph-panel"),
  cwOverlayPanel: document.getElementById("cw-overlay-panel"),
  roundaboutsPanel: document.getElementById("roundabouts-panel"),
  roundaboutsStatus: document.getElementById("roundabouts-status"),
  roundaboutsCoverage: document.getElementById("roundabouts-coverage"),
  roundaboutsSummary: document.getElementById("roundabouts-summary"),
  roundaboutsFilter: document.getElementById("roundabouts-filter"),
  roundaboutsList: document.getElementById("roundabouts-list"),
  roundaboutsDetail: document.getElementById("roundabouts-detail"),
  crossingsPanel: document.getElementById("crossings-panel"),
  crossingsStatus: document.getElementById("crossings-status"),
  crossingsCoverage: document.getElementById("crossings-coverage"),
  crossingsSummary: document.getElementById("crossings-summary"),
  crossingsFilter: document.getElementById("crossings-filter"),
  crossingsList: document.getElementById("crossings-list"),
  crossingsDetail: document.getElementById("crossings-detail"),
  crossingsManualJson: document.getElementById("crossings-manual-json"),
  crossingsSaveManual: document.getElementById("crossings-save-manual"),
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
  editorAlert: document.getElementById("editor-alert"),
  editorAlertTitle: document.getElementById("editor-alert-title"),
  editorAlertMessage: document.getElementById("editor-alert-message"),
  buildOutputSummary: document.getElementById("build-output-summary"),
  buildReport: document.getElementById("build-report"),
  baseGraphStatus: document.getElementById("base-graph-status"),
  baseGraphSummary: document.getElementById("base-graph-summary"),
  baseEdgeSearch: document.getElementById("base-edge-search"),
  findBaseEdge: document.getElementById("find-base-edge"),
  toggleBaseOneWayDirections: document.getElementById("toggle-base-one-way-directions"),
  baseOneWayDirectionLegend: document.getElementById("base-one-way-direction-legend"),
  baseOneWayDirectionSummary: document.getElementById("base-one-way-direction-summary"),
  newManualBaseEdge: document.getElementById("new-manual-base-edge"),
  cloneBaseGraphEdge: document.getElementById("clone-base-graph-edge"),
  deleteManualBaseEdge: document.getElementById("delete-manual-base-edge"),
  splitManualBaseEdge: document.getElementById("split-manual-base-edge"),
  manualEdgeDirectionReview: document.getElementById("manual-edge-direction-review"),
  baseEdgeDirectionHelp: document.getElementById("base-edge-direction-help"),
  manualEdgeForward: document.getElementById("manual-edge-forward"),
  manualEdgeReverse: document.getElementById("manual-edge-reverse"),
  manualEdgeReviewer: document.getElementById("manual-edge-reviewer"),
  manualEdgeReviewDate: document.getElementById("manual-edge-review-date"),
  manualEdgeRationale: document.getElementById("manual-edge-rationale"),
  baseEdgeDirectionEvidence: document.getElementById("base-edge-direction-evidence"),
  saveManualEdgeDirection: document.getElementById("save-manual-edge-direction"),
  clearOsmDirectionOverride: document.getElementById("clear-osm-direction-override"),
  manualEdgeDirectionStatus: document.getElementById("manual-edge-direction-status"),
  recalculateOsmGraph: document.getElementById("recalculate-osm-graph"),
  refreshDirectionReview: document.getElementById("refresh-direction-review"),
  baseGraphHelp: document.getElementById("base-graph-help"),
  connectorLensPanel: document.getElementById("connector-lens-panel"),
  connectorColorMode: document.getElementById("connector-color-mode"),
  connectorLegend: document.getElementById("connector-legend"),
  connectorUphillWeight: document.getElementById("connector-uphill-weight"),
  connectorSnap: document.getElementById("connector-snap"),
  connectorResetStrategy: document.getElementById("connector-reset-strategy"),
  connectorCopyStrategy: document.getElementById("connector-copy-strategy"),
  connectorTargetRoute: document.getElementById("connector-target-route"),
  connectorPickTarget: document.getElementById("connector-pick-target"),
  connectorRadius: document.getElementById("connector-radius"),
  connectorRun: document.getElementById("connector-run"),
  connectorClearRun: document.getElementById("connector-clear-run"),
  connectorHideUnreachable: document.getElementById("connector-hide-unreachable"),
  connectorRunStatus: document.getElementById("connector-run-status"),
  connectorLabelMode: document.getElementById("connector-label-mode"),
  connectorLabelStatus: document.getElementById("connector-label-status"),
  connectorCalibLoad: document.getElementById("connector-calib-load"),
  connectorCalibReadout: document.getElementById("connector-calib-readout"),
  connectorThresholdTooFarRadius: document.getElementById("connector-threshold-too-far-radius"),
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
  directionReviewSource: document.getElementById("direction-review-source"),
  directionReviewAToB: document.getElementById("direction-review-a-to-b"),
  directionReviewBToA: document.getElementById("direction-review-b-to-a"),
  directionReviewSlotStatuses: document.getElementById("direction-review-slot-statuses"),
  directionReviewSummary: document.getElementById("direction-review-summary"),
  directionReviewEdges: document.getElementById("direction-review-edges"),
  directionReviewReviewer: document.getElementById("direction-review-reviewer"),
  directionReviewDate: document.getElementById("direction-review-date"),
  directionReviewBatch: document.getElementById("direction-review-batch"),
  directionReviewApplyMigration: document.getElementById("direction-review-apply-migration"),
  directionReviewApplySymmetricBatch: document.getElementById("direction-review-apply-symmetric-batch"),
  directionReviewEdit: document.getElementById("direction-review-edit"),
  directionReviewRevalidate: document.getElementById("direction-review-revalidate"),
  directionReviewUseReverse: document.getElementById("direction-review-use-reverse"),
  directionReviewAccept: document.getElementById("direction-review-accept"),
  directionReviewClearDraft: document.getElementById("direction-review-clear-draft"),
  directionReviewUnavailableReason: document.getElementById("direction-review-unavailable-reason"),
  directionReviewRationale: document.getElementById("direction-review-rationale"),
  directionReviewUserExplanation: document.getElementById("direction-review-user-explanation"),
  directionReviewMarkUnavailable: document.getElementById("direction-review-mark-unavailable"),
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

function emptyTraversalOverrides() {
  return {
    schemaVersion: 1,
    policyId: "il-bicycle-v1",
    description: "Reviewed whole-source-way bicycle traversal overrides.",
    overrides: [],
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

  // POI types render emoji via a rasterized icon-image (not text-field, which
  // can't render astral-plane emoji glyphs).
  registerPoiEmojiImages(map);
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
          icon: marker.icon || poiMarkerIconName(type),
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

function connectorLensColor(props) {
  const mode = state.connectorLens.colorMode;
  if (mode === "off") return null;
  const edge = {
    routeClass: props.osmRouteClass ?? props.routeClass,
    roadType: props.roadType,
    accessStatus: props.accessStatus,
    cwSegmentIds: props.cwSegmentIds,
    cyclewaysSegmentIds: props.cyclewaysSegmentIds,
    cwSegmentId: props.cwSegmentId,
    cyclewaysSegmentId: props.cyclewaysSegmentId,
    cwSegmentCount: props.cwSegmentCount,
    cyclewaysSegmentCount: props.cyclewaysSegmentCount,
  };
  if (mode === "class") {
    return connectorClassColor(
      hasCyclewaysNetworkMembership(edge) ? "cw_network" : edge.routeClass,
    );
  }
  if (mode === "access") return connectorAccessColor(edge.accessStatus);
  const verdict = evaluateConnectorEdge(edge, state.connectorLens.strategy);
  if (mode === "eligibility") return verdict.allowed ? "#1b7837" : "#9ca3af";
  return connectorCostColor(verdict.multiplier); // "cost"
}

function connectorVerdictText(props) {
  const edge = {
    routeClass: props.osmRouteClass ?? props.routeClass,
    roadType: props.roadType,
    accessStatus: props.accessStatus,
    cwSegmentIds: props.cwSegmentIds,
    cyclewaysSegmentIds: props.cyclewaysSegmentIds,
    cwSegmentId: props.cwSegmentId,
    cyclewaysSegmentId: props.cyclewaysSegmentId,
    cwSegmentCount: props.cwSegmentCount,
    cyclewaysSegmentCount: props.cyclewaysSegmentCount,
  };
  const strategy = state.connectorLens.strategy;
  const v = evaluateConnectorEdge(edge, strategy);
  if (v.allowed && hasCyclewaysNetworkMembership(edge)) {
    return `allowed — CW network ×${v.multiplier.toFixed(2)}`;
  }
  if (!v.allowed) {
    const accessExcluded =
      edge.accessStatus &&
      strategy.accessPolicy &&
      edge.accessStatus in strategy.accessPolicy &&
      strategy.accessPolicy[edge.accessStatus] == null;
    const reason = accessExcluded
      ? `access "${edge.accessStatus}" excluded`
      : `class "${edge.routeClass}" excluded`;
    return `excluded — ${reason}`;
  }
  return `allowed — ×${v.multiplier.toFixed(2)}`;
}

function baseGraphCollection() {
  if (!state.baseOverlay.graphEdges) {
    return EMPTY_FEATURE_COLLECTION;
  }
  const cache = state.baseOverlay.cache || (state.baseOverlay.cache = {});
  if (
    cache.baseGraphCollection &&
    cache.baseGraphCollectionGraphEdges === state.baseOverlay.graphEdges &&
    cache.baseGraphCollectionManualEdges === state.baseOverlay.manualBaseEdges &&
    cache.baseGraphCollectionLensMode === state.connectorLens.colorMode &&
    cache.baseGraphCollectionLensStrategy === state.connectorLens.strategy
  ) {
    return cache.baseGraphCollection;
  }
  const overriddenEdgeIds = overriddenBaseGraphEdgeIds();
  const sourceFeatures =
    overriddenEdgeIds.size === 0
      ? state.baseOverlay.graphEdges.features || []
      : (state.baseOverlay.graphEdges.features || []).filter(
          (feature) => !overriddenEdgeIds.has(String(graphEdgeFeatureId(feature))),
        );
  const features = sourceFeatures.map((feature) => ({
    ...feature,
    properties: {
      ...feature.properties,
      connectorLensColor: connectorLensColor(feature.properties || {}),
    },
  }));
  cache.baseGraphCollection = { ...state.baseOverlay.graphEdges, features };
  cache.baseGraphCollectionGraphEdges = state.baseOverlay.graphEdges;
  cache.baseGraphCollectionManualEdges = state.baseOverlay.manualBaseEdges;
  cache.baseGraphCollectionLensMode = state.connectorLens.colorMode;
  cache.baseGraphCollectionLensStrategy = state.connectorLens.strategy;
  return cache.baseGraphCollection;
}

function baseGraphOneWayDirectionCollection() {
  if (!state.baseOverlay.graphEdges) return EMPTY_FEATURE_COLLECTION;
  const cache = state.baseOverlay.cache || (state.baseOverlay.cache = {});
  if (
    cache.baseGraphOneWayDirectionCollection &&
    cache.baseGraphOneWayDirectionGraphEdges === state.baseOverlay.graphEdges &&
    cache.baseGraphOneWayDirectionManualEdges === state.baseOverlay.manualBaseEdges &&
    cache.baseGraphOneWayDirectionOverrides === state.baseOverlay.traversalOverrides
  ) {
    return cache.baseGraphOneWayDirectionCollection;
  }
  cache.baseGraphOneWayDirectionCollection = buildBaseEdgeDirectionLayer(
    state.baseOverlay.graphEdges,
    state.baseOverlay.manualBaseEdges,
    state.baseOverlay.traversalOverrides,
  );
  cache.baseGraphOneWayDirectionGraphEdges = state.baseOverlay.graphEdges;
  cache.baseGraphOneWayDirectionManualEdges = state.baseOverlay.manualBaseEdges;
  cache.baseGraphOneWayDirectionOverrides = state.baseOverlay.traversalOverrides;
  cache.baseGraphOneWayDirectionSummary = summarizeBaseEdgeDirectionLayer(
    cache.baseGraphOneWayDirectionCollection,
  );
  return cache.baseGraphOneWayDirectionCollection;
}

function baseGraphOneWayDirectionSummary() {
  baseGraphOneWayDirectionCollection();
  return (
    state.baseOverlay.cache?.baseGraphOneWayDirectionSummary || {
      total: 0,
      confirmedOneWay: 0,
      needsReview: 0,
    }
  );
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

function selectedBaseEdgePermittedDirectionCollection() {
  if (!state.baseOverlay.enabled || state.workspaceMode !== "base") {
    return EMPTY_FEATURE_COLLECTION;
  }
  const feature = selectedManualBaseEdge() || selectedBaseGraphEdge();
  if (!feature) return EMPTY_FEATURE_COLLECTION;
  return buildBaseEdgeDirectionLayer(
    { type: "FeatureCollection", features: [feature] },
    state.baseOverlay.manualBaseEdges,
    state.baseOverlay.traversalOverrides,
  );
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

function manualBaseEdgeEndpointCollection() {
  const feature = selectedManualBaseEdge() || selectedBaseGraphEdge();
  const coordinates = feature?.geometry?.coordinates || [];
  if (state.workspaceMode !== "base" || coordinates.length < 2) {
    return EMPTY_FEATURE_COLLECTION;
  }
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: coordinates[0] },
        properties: { label: "A", direction: "forward start" },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: coordinates[coordinates.length - 1] },
        properties: { label: "B", direction: "forward end" },
      },
    ],
  };
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

function directionReviewSegment(segmentId = selectedSegmentId()) {
  if (segmentId === null || !state.directionReview.loaded) return null;
  return state.directionReview.overlay?.segments?.[String(segmentId)] || null;
}

function reverseDirectionReviewRefs(refs) {
  return normalizeOverlayEdgeRefs(refs)
    .reverse()
    .map((ref, sequenceIndex) => ({
      ...ref,
      direction: ref.direction === "reverse" ? "forward" : "reverse",
      sequenceIndex,
    }));
}

function directionReviewRefsForRecord(segment, alignmentKey, record) {
  if (record?.realization?.type === "explicit") {
    return normalizeOverlayEdgeRefs(record.realization.edgeRefs);
  }
  if (record?.realization?.type === "reverseOf") {
    const target = segment?.alignments?.[record.realization.alignmentKey]?.published;
    if (target?.realization?.type === "explicit") {
      return reverseDirectionReviewRefs(target.realization.edgeRefs);
    }
  }
  if (record?.candidate?.kind === "exact-reverse") {
    const targetKey = record.candidate.reverseOfAlignmentKey || (alignmentKey === "aToB" ? "bToA" : "aToB");
    const targetSlot = segment?.alignments?.[targetKey];
    const target = targetSlot?.draft || targetSlot?.published;
    if (target?.realization?.type === "explicit") {
      return reverseDirectionReviewRefs(target.realization.edgeRefs);
    }
  }
  return [];
}

function directionReviewDisplayRecord(segment, alignmentKey) {
  const slot = segment?.alignments?.[alignmentKey];
  return slot?.draft || slot?.published || null;
}

function directionReviewTraversalForRef(ref) {
  const feature = graphFeatureForEdgeId(ref?.edgeId);
  const evidence = feature?.properties?.bicycleTraversal || {};
  const direction = ref?.direction === "reverse" ? "reverse" : "forward";
  return {
    state: evidence[direction] || "unknown",
    reason: evidence[`${direction}Reason`] || "missing_policy_evidence",
    policyId: evidence.policyId || state.directionReview.overlay?.policyId || "unknown",
    policyDigest: evidence.policyDigest || state.directionReview.overlay?.policyDigest || "unknown",
  };
}

function directionReviewAlignmentCollection() {
  if (
    !state.baseOverlay.enabled ||
    state.workspaceMode !== "overlay" ||
    !state.directionReview.loaded
  ) {
    return EMPTY_FEATURE_COLLECTION;
  }
  const segment = directionReviewSegment();
  if (!segment) return EMPTY_FEATURE_COLLECTION;
  const features = [];
  for (const alignmentKey of ["aToB", "bToA"]) {
    const record = directionReviewDisplayRecord(segment, alignmentKey);
    const refs = directionReviewRefsForRecord(segment, alignmentKey, record);
    for (const [index, ref] of refs.entries()) {
      const source = graphFeatureForEdgeId(ref.edgeId);
      const coords = source?.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) continue;
      const oriented = ref.direction === "reverse"
        ? [...coords].reverse().map((coord) => coord.slice())
        : coords.map((coord) => coord.slice());
      const traversal = directionReviewTraversalForRef(ref);
      features.push({
        type: "Feature",
        id: `direction-review-${segment.segmentId}-${alignmentKey}-${index}`,
        geometry: { type: "LineString", coordinates: oriented },
        properties: {
          alignmentKey,
          alignmentLabel: alignmentKey === "aToB" ? "A → B" : "B → A",
          selected: state.directionReview.alignmentKey === alignmentKey,
          edgeId: String(ref.edgeId),
          direction: ref.direction === "reverse" ? "reverse" : "forward",
          sequenceIndex: index,
          sequenceNumber: index + 1,
          traversalState: traversal.state,
          traversalReason: traversal.reason,
          draft: Boolean(segment.alignments[alignmentKey]?.draft),
          hovered: String(state.baseOverlay.hoveredOverlayEdgeId || "") === String(ref.edgeId),
        },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

function directionReviewEndpointCollection() {
  if (
    !state.baseOverlay.enabled ||
    state.workspaceMode !== "overlay" ||
    !state.directionReview.loaded
  ) {
    return EMPTY_FEATURE_COLLECTION;
  }
  const segment = directionReviewSegment();
  if (!segment) return EMPTY_FEATURE_COLLECTION;
  return {
    type: "FeatureCollection",
    features: ["a", "b"].map((endpointKey) => ({
      type: "Feature",
      id: `direction-review-endpoint-${segment.segmentId}-${endpointKey}`,
      geometry: {
        type: "Point",
        coordinates: segment.endpoints[endpointKey].coordinate,
      },
      properties: {
        endpointKey,
        label: endpointKey.toUpperCase(),
        zoneMeters: Number(segment.endpoints[endpointKey].zoneMeters),
      },
    })),
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
  setSourceData("base-graph-one-way-directions", baseGraphOneWayDirectionCollection());
  setSourceData("selected-base-graph-edge", selectedBaseGraphEdgeCollection());
  setSourceData(
    "selected-base-edge-permitted-direction",
    selectedBaseEdgePermittedDirectionCollection(),
  );
  setSourceData("selected-match-preview", selectedMatchCollection());
  setSourceData("selected-overlay-edges", selectedOverlayEdgeCollection());
  setSourceData("direction-review-alignments", directionReviewAlignmentCollection());
  setSourceData("direction-review-endpoints", directionReviewEndpointCollection());
  setSourceData("cw-overlay-network", cwOverlayNetworkCollection());
  setSourceData("manual-base-edges", manualBaseEdgeCollection());
  setSourceData("manual-base-edge-endpoints", manualBaseEdgeEndpointCollection());
  setSourceData("compose-edge-pick", composeEdgePickCollection());
  updateRoundaboutSources();
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

function connectorLensFeaturesAtPoint(point) {
  if (state.workspaceMode !== "base" || !connectorLensRunActive()) return [];
  const layers = [
    "connector-origins-layer",
    "connector-single-path-layer",
    "connector-single-path-casing-layer",
  ].filter((layerId) => map.getLayer(layerId));
  return layers.length > 0 ? map.queryRenderedFeatures(point, { layers }) : [];
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
  const showCrossings = state.workspaceMode === "crossings";
  const showOneWayDirections = (showBaseEdit && state.baseOverlay.showOneWayDirections) || showCrossings;
  const showOverlay = showBaseWorkspaceGraph && state.workspaceMode === "overlay";
  const showDirectionReview = showOverlay && state.directionReview.loaded;
  const showRoundabouts = state.workspaceMode === "roundabouts";

  setLayerVisibility("segments-layer", showSegments);
  setLayerVisibility("selected-segment", showSelectedSegment);
  setLayerVisibility("unresolved-segments-layer", showUnresolvedSegments);
  for (const layerId of ["base-graph-edges-layer", "manual-base-edges-layer"]) {
    setLayerVisibility(layerId, showBaseGraphVisual);
  }
  for (const layerId of ["base-graph-edges-hit-layer", "manual-base-edges-hit-layer"]) {
    setLayerVisibility(layerId, showBaseGraphHit);
  }
  for (const layerId of [
    "base-graph-one-way-directions-layer",
    "base-graph-one-way-direction-arrows",
  ]) {
    setLayerVisibility(layerId, showOneWayDirections);
  }
  for (const layerId of [
    "selected-base-graph-edge-layer",
    "selected-base-graph-edge-direction-arrows",
    "selected-manual-base-edge",
    "manual-base-edge-endpoints-layer",
    "manual-base-edge-endpoint-labels",
  ]) {
    setLayerVisibility(layerId, showBaseEdit);
  }
  for (const layerId of [
    "connector-usage-layer",
    "connector-origins-layer",
    "connector-single-path-casing-layer",
    "connector-single-path-layer",
  ]) {
    setLayerVisibility(layerId, showBaseEdit);
  }
  for (const layerId of [
    "cw-overlay-network-layer",
    "cw-overlay-network-hit-layer",
  ]) {
    setLayerVisibility(layerId, showOverlay);
  }
  for (const layerId of [
    "selected-overlay-edges-layer",
    "selected-overlay-hovered-edge-layer",
    "selected-match-edges-layer",
    "selected-match-gaps-layer",
    "selected-match-continuity-gaps-layer",
    "selected-match-unmatched-samples-layer",
    "selected-match-distant-samples-layer",
  ]) {
    setLayerVisibility(layerId, showOverlay && !showDirectionReview);
  }
  for (const layerId of [
    "direction-review-alignments-layer",
    "direction-review-hover-layer",
    "direction-review-arrows-layer",
    "direction-review-sequence-layer",
    "direction-review-endpoints-layer",
    "direction-review-endpoint-labels",
  ]) {
    setLayerVisibility(layerId, showDirectionReview);
  }
  setLayerVisibility("compose-edge-pick-layer", composing);
  setLayerVisibility("compose-edge-pick-labels", composing);
  for (const layerId of [
    "roundabout-corridors-layer",
    "roundabout-lines-corridor-layer",
    "roundabout-lines-layer",
    "roundabout-points-layer",
  ]) {
    setLayerVisibility(layerId, showRoundabouts);
  }
  for (const layerId of [
    "crossing-corridors-layer",
    "crossing-context-layer",
    "crossing-actions-layer",
    "crossing-arrows-layer",
  ]) {
    setLayerVisibility(layerId, showCrossings);
  }
  if (map.getLayer("selected-segment")) {
    map.setPaintProperty("selected-segment", "line-color", showDirectionReview ? "#64748b" : "#f2c94c");
    map.setPaintProperty("selected-segment", "line-opacity", showDirectionReview ? 0.42 : 0.9);
    map.setPaintProperty("selected-segment", "line-width", showDirectionReview ? 5 : 7);
  }
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
  map.getSource("manual-base-edge-endpoints")?.setData(manualBaseEdgeEndpointCollection());
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

const BASE_EDGE_PROPERTY_PRIORITY = [
  "edgeId",
  "manualEdgeId",
  "id",
  "source",
  "copiedFromEdgeId",
  "osmType",
  "osmId",
  "osmWayId",
  "sliceIndex",
  "name",
  "highway",
  "osmRouteClass",
  "roadType",
  "accessStatus",
  "oneway",
  "distanceMeters",
  "fromNodeId",
  "toNodeId",
];

function baseEdgePropertySortRank(key) {
  const index = BASE_EDGE_PROPERTY_PRIORITY.indexOf(key);
  return index >= 0 ? index : BASE_EDGE_PROPERTY_PRIORITY.length;
}

function formatBaseEdgePropertyValue(value) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value || "''";
  return JSON.stringify(value);
}

function renderBaseEdgeAttributes(feature) {
  if (!feature) {
    return `<section class="base-edge-data"><h3>Data</h3><div class="empty-state">Select a base graph edge to see its attributes.</div></section>`;
  }

  const properties = feature.properties || {};
  const connectorRow = `<div><dt>Connector</dt><dd>${escapeHtml(connectorVerdictText(properties))}</dd></div>`;
  const rows = Object.keys(properties)
    .sort((a, b) => (baseEdgePropertySortRank(a) - baseEdgePropertySortRank(b)) || a.localeCompare(b))
    .map((key) => {
      const formattedValue = formatBaseEdgePropertyValue(properties[key]);
      return `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(formattedValue)}</dd></div>`;
    });

  const geometry = feature.geometry || {};
  const coordinates = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  const geometryRows = [
    `<div><dt>geometry.type</dt><dd>${escapeHtml(geometry.type || "unknown")}</dd></div>`,
    `<div><dt>geometry.vertices</dt><dd>${coordinates.length}</dd></div>`,
  ];

  return `
    <section class="base-edge-data">
      <h3>Data</h3>
      <dl class="base-edge-attributes">
        ${[connectorRow, ...geometryRows, ...rows].join("") || `<div><dt>properties</dt><dd>No attributes</dd></div>`}
      </dl>
    </section>
  `;
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
    const idDisplayClear = document.getElementById("segment-id-display");
    if (idDisplayClear) idDisplayClear.textContent = "";
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
  const idDisplay = document.getElementById("segment-id-display");
  if (idDisplay) idDisplay.textContent = feature.properties.id != null ? `#${feature.properties.id}` : "";
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
  const metadata = state.baseOverlay.graphEdges?.metadata || {};
  return Boolean(
    metadata.graphStaleBecauseManualBaseEdgesChanged ||
    metadata.graphStaleBecauseTraversalOverridesChanged
  );
}

function baseGraphStaleReason() {
  const metadata = state.baseOverlay.graphEdges?.metadata || {};
  if (metadata.graphStaleBecauseTraversalOverridesChanged) {
    const graphTime = metadata.graphEdgesModifiedAt
      ? new Date(metadata.graphEdgesModifiedAt).toLocaleString()
      : "unknown";
    const overrideTime = metadata.bicycleTraversalOverridesModifiedAt
      ? new Date(metadata.bicycleTraversalOverridesModifiedAt).toLocaleString()
      : "unknown";
    return `Traversal overrides changed after graph build (${overrideTime} > ${graphTime})`;
  }
  if (!metadata.graphStaleBecauseManualBaseEdgesChanged) return "";
  const graphTime = metadata.graphEdgesModifiedAt ? new Date(metadata.graphEdgesModifiedAt).toLocaleString() : "unknown";
  const manualTime = metadata.manualBaseEdgesModifiedAt
    ? new Date(metadata.manualBaseEdgesModifiedAt).toLocaleString()
    : "unknown";
  return `Manual base edges changed after graph build (${manualTime} > ${graphTime})`;
}

function markBaseGraphStaleBecauseTraversalOverridesChanged() {
  if (!state.baseOverlay.graphEdges) return;
  state.baseOverlay.graphEdges = {
    ...state.baseOverlay.graphEdges,
    metadata: {
      ...(state.baseOverlay.graphEdges.metadata || {}),
      bicycleTraversalOverridesModifiedAt: new Date().toISOString(),
      graphStaleBecauseTraversalOverridesChanged: true,
    },
  };
  invalidateBaseOverlayDerivedCache();
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
  // A manual base edge that has been folded into the graph lives in BOTH the
  // base-graph and manual-base-edges hit layers under the same edgeId. A single
  // map click dispatches to both layer handlers, which would otherwise toggle
  // the edge on then immediately back off — leaving the draft empty and Done
  // disabled. Process each edgeId at most once per click dispatch.
  if (!state.composeToggledThisClick) {
    state.composeToggledThisClick = new Set();
    window.setTimeout(() => {
      state.composeToggledThisClick = null;
    }, 0);
  }
  if (state.composeToggledThisClick.has(String(ref.edgeId))) return;
  state.composeToggledThisClick.add(String(ref.edgeId));
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
  els.workspaceRoundabouts.classList.toggle("active", state.workspaceMode === "roundabouts");
  els.workspaceCrossings.classList.toggle("active", state.workspaceMode === "crossings");
  els.workspaceVideoSync.classList.toggle("active", state.workspaceMode === "video-sync");
  els.workspaceRouteCatalog.classList.toggle("active", state.workspaceMode === "route-catalog");
  els.baseGraphPanel.hidden = state.workspaceMode !== "base";
  els.connectorLensPanel.hidden = state.workspaceMode !== "base";
  els.cwOverlayPanel.hidden = state.workspaceMode !== "overlay";
  els.roundaboutsPanel.hidden = state.workspaceMode !== "roundabouts";
  els.crossingsPanel.hidden = state.workspaceMode !== "crossings";
  els.routeCatalogPanel.hidden = state.workspaceMode !== "route-catalog";
  els.mapToolbar.hidden = state.workspaceMode === "roundabouts" || state.workspaceMode === "crossings";
  els.toggleBaseOverlay.classList.toggle("active", state.baseOverlay.enabled);
  els.toggleBaseOverlay.disabled = state.baseOverlay.loading || state.baseOverlay.recalculating;
}

async function loadRoundaboutReview() {
  state.roundabouts.loading = true;
  state.roundabouts.error = null;
  renderRoundaboutsPanel();
  try {
    const response = await fetch("/api/roundabouts/review");
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not load roundabouts");
    state.roundabouts.data = payload;
    state.roundabouts.loaded = true;
    const ids = (payload.items || []).map((item) => item.candidate?.id).filter(Boolean);
    if (!ids.includes(state.roundabouts.selectedId)) state.roundabouts.selectedId = ids[0] || null;
    updateRoundaboutSources();
  } catch (error) {
    state.roundabouts.error = error instanceof Error ? error.message : String(error);
    state.roundabouts.loaded = false;
  } finally {
    state.roundabouts.loading = false;
    renderRoundaboutsPanel();
  }
}

function roundaboutFilteredItems() {
  return filterRoundaboutItems(
    state.roundabouts.data?.items || [],
    state.roundabouts.filter,
  );
}

function updateRoundaboutLayerFilters() {
  const ids = roundaboutFilteredItems().map((item) => item.candidate.id);
  const filter = ids.length
    ? ["in", ["get", "id"], ["literal", ids]]
    : ["==", ["get", "id"], "__none__"];
  for (const layerId of ["roundabout-corridors-layer", "roundabout-lines-corridor-layer", "roundabout-lines-layer", "roundabout-points-layer"]) {
    if (map.getLayer(layerId)) map.setFilter(layerId, filter);
  }
}

function updateRoundaboutSources() {
  const geojson = state.roundabouts.data?.geojson || {};
  setSourceData("roundabout-lines", geojson.lines || EMPTY_FEATURE_COLLECTION);
  setSourceData("roundabout-points", geojson.points || EMPTY_FEATURE_COLLECTION);
  setSourceData("roundabout-corridors", geojson.corridors || EMPTY_FEATURE_COLLECTION);
  updateRoundaboutLayerFilters();
}

function fitRoundaboutCandidate(candidate) {
  const bbox = candidate?.bbox;
  if (!Array.isArray(bbox) || bbox.length !== 4) return;
  const bounds = new mapboxgl.LngLatBounds([bbox[0], bbox[1]], [bbox[2], bbox[3]]);
  map.fitBounds(bounds, { padding: 110, maxZoom: 18, duration: 400 });
}

async function saveRoundaboutReview(status) {
  const item = state.roundabouts.data?.items?.find(
    (entry) => entry.candidate?.id === state.roundabouts.selectedId,
  );
  if (!item) return;
  const note = els.roundaboutsDetail.querySelector("textarea")?.value || "";
  const response = await fetch("/api/roundabouts/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: item.candidate.id,
      fingerprint: item.candidate.fingerprint,
      status,
      note,
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not save review");
  state.roundabouts.data = payload;
  updateRoundaboutSources();
  const filtered = roundaboutFilteredItems();
  const next = filtered.find((entry) => entry.candidate.id !== item.candidate.id)
    || payload.items?.find((entry) => entry.candidate.id !== item.candidate.id);
  state.roundabouts.selectedId = next?.candidate?.id || item.candidate.id;
  renderRoundaboutsPanel();
  const selected = payload.items?.find((entry) => entry.candidate.id === state.roundabouts.selectedId);
  if (selected) fitRoundaboutCandidate(selected.candidate);
}

function moveRoundaboutSelection(delta) {
  const items = roundaboutFilteredItems();
  if (!items.length) return;
  const current = items.findIndex((item) => item.candidate.id === state.roundabouts.selectedId);
  const nextIndex = Math.max(0, Math.min(items.length - 1, (current < 0 ? 0 : current) + delta));
  state.roundabouts.selectedId = items[nextIndex].candidate.id;
  renderRoundaboutsPanel();
  fitRoundaboutCandidate(items[nextIndex].candidate);
}

function renderRoundaboutsPanel() {
  if (!els.roundaboutsPanel || state.workspaceMode !== "roundabouts") return;
  if (state.roundabouts.loading) {
    els.roundaboutsStatus.textContent = "Loading";
    return;
  }
  if (state.roundabouts.error) {
    els.roundaboutsStatus.textContent = "Unavailable";
    els.roundaboutsCoverage.innerHTML = `<div class="empty-state">${escapeHtml(state.roundabouts.error)}</div>`;
    els.roundaboutsSummary.innerHTML = "";
    els.roundaboutsList.innerHTML = "";
    els.roundaboutsDetail.innerHTML = "";
    return;
  }
  const data = state.roundabouts.data;
  if (!data) return;
  els.roundaboutsStatus.textContent = data.sourceFresh ? "Current snapshot" : "Stale — recalculate";
  const coverage = data.coverage || {};
  els.roundaboutsCoverage.innerHTML = `
    <strong>Saved source coverage</strong>
    <span>Tagged ways: ${escapeHtml(coverage.roundaboutWays || "unknown")}</span>
    <span>Circular ways: ${escapeHtml(coverage.circularWays || "unknown")}</span>
    <span>Mini nodes: ${escapeHtml(coverage.miniRoundaboutNodes || "unknown")}</span>
  `;
  els.roundaboutsSummary.innerHTML = Object.entries(data.summary || {})
    .map(([key, value]) => `<div class="base-overlay-stat"><strong>${value}</strong><span>${escapeHtml(key)}</span></div>`)
    .join("");
  els.roundaboutsFilter.value = state.roundabouts.filter;
  const items = roundaboutFilteredItems();
  els.roundaboutsList.innerHTML = "";
  for (const item of items) {
    const candidate = item.candidate;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `roundabout-review-item state-${item.state}${candidate.id === state.roundabouts.selectedId ? " active" : ""}`;
    button.innerHTML = `<strong>${escapeHtml(candidate.id)}</strong><span>${escapeHtml(candidate.classification)} · ${escapeHtml(item.state)}${candidate.warnings?.length ? ` · ⚠ ${candidate.warnings.length}` : ""}</span>`;
    button.addEventListener("click", () => {
      state.roundabouts.selectedId = candidate.id;
      renderRoundaboutsPanel();
      fitRoundaboutCandidate(candidate);
    });
    els.roundaboutsList.appendChild(button);
  }
  const selected = data.items?.find((item) => item.candidate.id === state.roundabouts.selectedId);
  if (!selected) {
    els.roundaboutsDetail.innerHTML = `<div class="empty-state">No candidates in this filter.</div>`;
    return;
  }
  const candidate = selected.candidate;
  const osmLinks = (candidate.memberWayIds || [])
    .map((id) => `<a href="https://www.openstreetmap.org/way/${encodeURIComponent(id)}" target="_blank" rel="noreferrer">way ${escapeHtml(id)}</a>`)
    .join(" · ");
  els.roundaboutsDetail.innerHTML = `
    <h3>${escapeHtml(candidate.id)}</h3>
    <p>${escapeHtml(candidate.classification)} · radius ${Number(candidate.radiusM).toFixed(1)} m</p>
    <p>${osmLinks || (candidate.sourceNodeId ? `<a href="https://www.openstreetmap.org/node/${encodeURIComponent(candidate.sourceNodeId)}" target="_blank" rel="noreferrer">node ${escapeHtml(candidate.sourceNodeId)}</a>` : "")}</p>
    <p>Warnings: ${escapeHtml((candidate.warnings || []).join(", ") || "none")}</p>
    <textarea class="text-input textarea" rows="3" maxlength="1000" placeholder="Optional review note">${escapeHtml(selected.review?.note || "")}</textarea>
    <div class="action-row">
      <button type="button" data-review="accepted" class="primary-button">Accept</button>
      <button type="button" data-review="rejected" class="secondary-button danger">Reject</button>
    </div>
    <div class="action-row">
      <button type="button" data-move="-1" class="secondary-button">Previous</button>
      <button type="button" data-move="1" class="secondary-button">Next</button>
    </div>
  `;
  for (const button of els.roundaboutsDetail.querySelectorAll("[data-review]")) {
    button.addEventListener("click", () => saveRoundaboutReview(button.dataset.review).catch(showError));
  }
  for (const button of els.roundaboutsDetail.querySelectorAll("[data-move]")) {
    button.addEventListener("click", () => moveRoundaboutSelection(Number(button.dataset.move)));
  }
}

async function loadCrossingReview() {
  state.crossings.loading = true;
  state.crossings.error = null;
  renderCrossingsPanel();
  try {
    const response = await fetch("/api/crossings/review");
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not load crossings");
    state.crossings.data = payload;
    state.crossings.loaded = true;
    const ids = crossingFilteredItems().map((item) => item.candidate?.id).filter(Boolean);
    if (!ids.includes(state.crossings.selectedId)) state.crossings.selectedId = ids[0] || null;
    updateCrossingSources();
  } catch (error) {
    state.crossings.error = error instanceof Error ? error.message : String(error);
    state.crossings.loaded = false;
  } finally {
    state.crossings.loading = false;
    renderCrossingsPanel();
  }
}

function crossingReviewItems() {
  const candidates = state.crossings.data?.items || [];
  const manual = (state.crossings.data?.manualItems || []).map((item) => ({
    candidate: item.crossing,
    review: null,
    state: item.state,
    manual: true,
  }));
  return [...candidates, ...manual];
}

function crossingFilteredItems() {
  const items = crossingReviewItems();
  if (state.crossings.filter === "manual") return items.filter((item) => item.manual);
  return filterCrossingItems(items, state.crossings.filter);
}

function updateCrossingLayerFilters() {
  const ids = crossingFilteredItems().map((item) => item.candidate.id);
  const filter = ids.length
    ? ["in", ["get", "id"], ["literal", ids]]
    : ["==", ["get", "id"], "__none__"];
  for (const layerId of [
    "crossing-corridors-layer", "crossing-context-layer",
    "crossing-actions-layer", "crossing-arrows-layer",
  ]) {
    if (map.getLayer(layerId)) map.setFilter(layerId, filter);
  }
}

function updateCrossingSources() {
  const geojson = state.crossings.data?.geojson || {};
  setSourceData("crossing-corridors", geojson.corridors || EMPTY_FEATURE_COLLECTION);
  setSourceData("crossing-context", geojson.context || EMPTY_FEATURE_COLLECTION);
  setSourceData("crossing-actions", geojson.action || EMPTY_FEATURE_COLLECTION);
  setSourceData("crossing-arrows", geojson.arrows || EMPTY_FEATURE_COLLECTION);
  updateCrossingLayerFilters();
}

function fitCrossingCandidate(candidate) {
  const bbox = candidate?.bbox;
  if (!Array.isArray(bbox) || bbox.length !== 4) return;
  const bounds = new mapboxgl.LngLatBounds([bbox[0], bbox[1]], [bbox[2], bbox[3]]);
  if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
    bounds.extend([bbox[0] + 0.0002, bbox[1] + 0.0002]);
    bounds.extend([bbox[0] - 0.0002, bbox[1] - 0.0002]);
  }
  map.fitBounds(bounds, { padding: 120, maxZoom: 19, duration: 400 });
}

async function saveCrossingReview(status) {
  const item = state.crossings.data?.items?.find(
    (entry) => entry.candidate?.id === state.crossings.selectedId,
  );
  if (!item) return;
  const note = els.crossingsDetail.querySelector("textarea[data-crossing-note]")?.value || "";
  const acceptedMappingIds = [...els.crossingsDetail.querySelectorAll("input[data-mapping-id]:checked")]
    .map((input) => input.dataset.mappingId);
  let mappingOverrides = [];
  const overrideText = els.crossingsDetail.querySelector("textarea[data-mapping-overrides]")?.value.trim();
  if (overrideText) {
    mappingOverrides = JSON.parse(overrideText);
    if (!Array.isArray(mappingOverrides)) throw new Error("Mapping overrides must be a JSON array.");
  }
  const response = await fetch("/api/crossings/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: item.candidate.id,
      candidateFingerprint: item.candidate.fingerprint,
      status,
      acceptedMappingIds,
      mappingOverrides,
      note,
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not save crossing review");
  state.crossings.data = payload;
  updateCrossingSources();
  renderCrossingsPanel();
}

async function saveManualCrossing() {
  const crossing = JSON.parse(els.crossingsManualJson.value);
  const response = await fetch("/api/crossings/manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ crossing }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not save manual crossing");
  state.crossings.data = payload;
  state.crossings.selectedId = crossing.id;
  updateCrossingSources();
  renderCrossingsPanel();
  fitCrossingCandidate(crossing);
}

function moveCrossingSelection(delta) {
  const items = crossingFilteredItems();
  if (!items.length) return;
  const current = items.findIndex((item) => item.candidate.id === state.crossings.selectedId);
  const nextIndex = Math.max(0, Math.min(items.length - 1, (current < 0 ? 0 : current) + delta));
  state.crossings.selectedId = items[nextIndex].candidate.id;
  renderCrossingsPanel();
  fitCrossingCandidate(items[nextIndex].candidate);
}

function renderCrossingsPanel() {
  if (!els.crossingsPanel || state.workspaceMode !== "crossings") return;
  if (state.crossings.loading) {
    els.crossingsStatus.textContent = "Loading";
    return;
  }
  if (state.crossings.error) {
    els.crossingsStatus.textContent = "Unavailable";
    els.crossingsCoverage.innerHTML = `<div class="empty-state">${escapeHtml(state.crossings.error)}</div>`;
    els.crossingsSummary.innerHTML = "";
    els.crossingsList.innerHTML = "";
    els.crossingsDetail.innerHTML = "";
    return;
  }
  const data = state.crossings.data;
  if (!data) return;
  els.crossingsStatus.textContent = data.sourceFresh ? "Current graph snapshot" : "Stale — regenerate candidates";
  const coverage = data.coverage || {};
  els.crossingsCoverage.innerHTML = `
    <strong>Graph-wide review queue</strong>
    <span>Base graph: ${escapeHtml(coverage.baseGraph || "unknown")}</span>
    <span>Stable edge IDs: ${escapeHtml(coverage.stableEdgeShareIds || "unknown")}</span>
    <span>Grade separation: ${escapeHtml(coverage.gradeSeparationTags || "unknown")}</span>
    <span>One-way base-edge arrows are shown on the map in this workspace.</span>
  `;
  els.crossingsSummary.innerHTML = Object.entries(data.summary || {})
    .map(([key, value]) => `<div class="base-overlay-stat"><strong>${value}</strong><span>${escapeHtml(key)}</span></div>`)
    .join("");
  els.crossingsFilter.value = state.crossings.filter;
  const items = crossingFilteredItems();
  els.crossingsList.innerHTML = "";
  for (const item of items) {
    const candidate = item.candidate;
    const roadName = candidate.crossedRoad?.name || candidate.crossedRoad?.highway || "road";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `roundabout-review-item state-${item.state}${candidate.id === state.crossings.selectedId ? " active" : ""}`;
    const representation = candidate.representation || "action-path";
    button.innerHTML = `<strong>${escapeHtml(roadName)}</strong><span>${escapeHtml(item.state)} · ${escapeHtml(representation)} · ${candidate.mappings?.length || 0} mapping(s)${candidate.warnings?.length ? ` · ⚠ ${candidate.warnings.length}` : ""}</span>`;
    button.addEventListener("click", () => {
      state.crossings.selectedId = candidate.id;
      renderCrossingsPanel();
      fitCrossingCandidate(candidate);
    });
    els.crossingsList.appendChild(button);
  }
  const selected = crossingReviewItems().find((item) => item.candidate.id === state.crossings.selectedId);
  if (!selected) {
    els.crossingsDetail.innerHTML = `<div class="empty-state">No crossings in this filter.</div>`;
    return;
  }
  const candidate = selected.candidate;
  if (selected.manual) {
    els.crossingsDetail.innerHTML = `
      <h3>${escapeHtml(candidate.id)}</h3>
      <p>Manual confirmed crossing · ${escapeHtml(candidate.representation || "action-path")} · ${escapeHtml(candidate.guidancePolicy || "always")} · ${candidate.mappings?.length || 0} mapping(s)</p>
      <button type="button" data-edit-manual class="secondary-button">Load into manual editor</button>
      <div class="action-row"><button type="button" data-move="-1" class="secondary-button">Previous</button><button type="button" data-move="1" class="secondary-button">Next</button></div>
    `;
    els.crossingsDetail.querySelector("[data-edit-manual]")?.addEventListener("click", () => {
      els.crossingsManualJson.value = JSON.stringify(candidate, null, 2);
    });
  } else {
    const accepted = new Set(selected.review?.acceptedMappingIds || candidate.mappings?.map((mapping) => mapping.id) || []);
    const mappings = (candidate.mappings || []).map((mapping) => {
      const slices = (section) => (mapping.match?.[section] || [])
        .map((slice) => `${slice.edgeShareId}:${slice.fromFractionQ}→${slice.toFractionQ}`).join(" · ");
      const continuation = mapping.continuation?.type === "turn"
        ? ` · then ${mapping.continuation.direction}`
        : "";
      return `<label class="crossing-mapping-review"><span><input type="checkbox" data-mapping-id="${escapeHtml(mapping.id)}" ${accepted.has(mapping.id) ? "checked" : ""}> <strong>${escapeHtml(mapping.direction || "explicit")}</strong> · ${escapeHtml(mapping.policy?.state || "unknown")}${escapeHtml(continuation)}</span><code>before ${escapeHtml(slices("before"))}</code><code>action ${escapeHtml(slices("action") || "junction anchor")}</code><code>after ${escapeHtml(slices("after"))}</code></label>`;
    }).join("");
    els.crossingsDetail.innerHTML = `
      <h3>${escapeHtml(candidate.id)}</h3>
      <p>${escapeHtml(candidate.crossedRoad?.name || candidate.crossedRoad?.highway || "Unknown road")} · ${escapeHtml(selected.state)} · ${escapeHtml(candidate.representation || "action-path")} · ${escapeHtml(candidate.guidancePolicy || "always")}</p>
      <p>Evidence: ${escapeHtml((candidate.evidence || []).join(", ") || "none")}</p>
      <p>Warnings: ${escapeHtml((candidate.warnings || []).join(", ") || "none")}</p>
      ${mappings}
      <label class="field-label">Mapping overrides (advanced JSON array)</label>
      <textarea data-mapping-overrides class="text-input textarea" rows="5" spellcheck="false">${escapeHtml(JSON.stringify(selected.review?.mappingOverrides || [], null, 2))}</textarea>
      <textarea data-crossing-note class="text-input textarea" rows="3" maxlength="1000" placeholder="Review note">${escapeHtml(selected.review?.note || "")}</textarea>
      <div class="action-row"><button type="button" data-review="accepted" class="primary-button">Accept selected mappings</button><button type="button" data-review="rejected" class="secondary-button danger">Reject</button></div>
      <div class="action-row"><button type="button" data-move="-1" class="secondary-button">Previous</button><button type="button" data-move="1" class="secondary-button">Next</button></div>
    `;
    for (const button of els.crossingsDetail.querySelectorAll("[data-review]")) {
      button.addEventListener("click", () => saveCrossingReview(button.dataset.review).catch(showError));
    }
  }
  for (const button of els.crossingsDetail.querySelectorAll("[data-move]")) {
    button.addEventListener("click", () => moveCrossingSelection(Number(button.dataset.move)));
  }
}

function traversalOverrideForFeature(feature) {
  const osmWayId = Number(feature?.properties?.osmWayId);
  if (!Number.isInteger(osmWayId) || osmWayId <= 0) return null;
  return (
    state.baseOverlay.traversalOverrides?.overrides?.find(
      (record) => Number(record.osmWayId) === osmWayId,
    ) || null
  );
}

function renderBaseEdgeDirectionReview(feature, disabled) {
  const properties = feature?.properties || {};
  const manual = properties.source === "manual";
  const selectedId = manual ? manualBaseEdgeFeatureId(feature) : graphEdgeFeatureId(feature);
  const override = manual ? null : traversalOverrideForFeature(feature);
  els.manualEdgeDirectionReview.hidden = !feature;
  if (!feature) {
    els.manualEdgeDirectionReview.dataset.edgeId = "";
    return;
  }

  const traversal = properties.bicycleTraversal || {};
  const forward = override?.states?.forward || traversal.forward || "unknown";
  const reverse = override?.states?.reverse || traversal.reverse || "unknown";
  const fullyReviewed = manual
    ? traversal.reviewed === true && forward !== "unknown" && reverse !== "unknown"
    : Boolean(override);
  const activeInput = els.manualEdgeDirectionReview.contains(document.activeElement);
  const selectionKey = `${manual ? "manual" : "osm"}:${selectedId || ""}`;
  const changedSelection = els.manualEdgeDirectionReview.dataset.edgeId !== selectionKey;
  if (!activeInput || changedSelection) {
    els.manualEdgeForward.value = forward;
    els.manualEdgeReverse.value = reverse;
    els.manualEdgeReviewer.value = override?.reviewer || traversal.reviewer || "";
    els.manualEdgeReviewDate.value = override?.reviewedAt || traversal.reviewedAt || new Date().toISOString().slice(0, 10);
    els.manualEdgeRationale.value = override?.rationale || traversal.rationale || "";
    els.baseEdgeDirectionEvidence.value = override?.evidence || traversal.evidence || "";
  }
  els.manualEdgeDirectionReview.dataset.edgeId = selectionKey;
  for (const input of [
    els.manualEdgeForward,
    els.manualEdgeReverse,
    els.manualEdgeReviewer,
    els.manualEdgeReviewDate,
    els.manualEdgeRationale,
    els.baseEdgeDirectionEvidence,
  ]) {
    input.disabled = disabled;
  }
  const osmEditable =
    Number.isInteger(Number(properties.osmWayId)) &&
    Boolean(properties.sourceGeometryDigest);
  els.saveManualEdgeDirection.disabled = disabled || (!manual && !osmEditable);
  els.saveManualEdgeDirection.textContent = manual
    ? "Save manual direction policy"
    : override
      ? "Update reviewed OSM override"
      : "Create reviewed OSM override";
  els.clearOsmDirectionOverride.hidden = manual || !override;
  els.clearOsmDirectionOverride.disabled = disabled || manual || !override;
  els.baseEdgeDirectionHelp.textContent = manual
    ? "Forward follows the stored manual line from A to B. Review this base edge once; every logical segment using it will revalidate after rebuild."
    : `Forward follows OSM way ${properties.osmWayId || "unknown"} from A to B. The values below are the normalized routing policy. An override applies to every split edge from this source way and requires evidence.`;
  els.manualEdgeDirectionStatus.className = `base-overlay-bulk-summary state-${
    fullyReviewed || (!manual && forward !== "unknown" && reverse !== "unknown") ? "reviewed" : "unreviewed"
  }`;
  els.manualEdgeDirectionStatus.textContent = manual
    ? fullyReviewed
      ? `Reviewed by ${traversal.reviewer} on ${traversal.reviewedAt}. Rebuild before using this evidence in routing or Direction Review.`
      : "Not fully reviewed. Unknown manual-edge directions remain blocked from every routing surface."
    : override
      ? `Reviewed override by ${override.reviewer} on ${override.reviewedAt}. Rebuild before it affects routing. OSM policy was ${traversal.forward || "unknown"}/${traversal.reverse || "unknown"} (${traversal.forwardReason || "unknown"}; ${traversal.reverseReason || "unknown"}).`
      : `Derived from OSM: ${forward}/${reverse} (${traversal.forwardReason || "unknown"}; ${traversal.reverseReason || "unknown"}). Create an override only when reviewed evidence shows the source data is wrong or incomplete.`;
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
  const selectedBaseFeature = selected || selectedGraphEdge;
  const selectedGraphProperties = selectedGraphEdge?.properties || {};
  const selectedGraphId = graphEdgeFeatureId(selectedGraphEdge);
  const selectedVertex = state.baseOverlay.selectedManualVertexIndex;
  const coords = selected?.geometry?.coordinates || [];
  const directionSummary = loaded
    ? baseGraphOneWayDirectionSummary()
    : { total: 0, confirmedOneWay: 0, needsReview: 0 };

  els.baseGraphStatus.textContent = recalculating ? "Recalculating" : loading ? "Loading" : loaded ? "Loaded" : "Not loaded";
  els.baseEdgeSearch.disabled = loading || recalculating || !loaded;
  els.findBaseEdge.disabled = loading || recalculating || !loaded;
  els.toggleBaseOneWayDirections.checked = state.baseOverlay.showOneWayDirections;
  els.toggleBaseOneWayDirections.disabled = !loaded || loading || recalculating;
  els.baseOneWayDirectionLegend.hidden = !state.baseOverlay.showOneWayDirections;
  els.baseOneWayDirectionSummary.textContent = loaded
    ? `${directionSummary.confirmedOneWay.toLocaleString()} confirmed one-way · ${directionSummary.needsReview.toLocaleString()} direction-limited review · arrows point in the permitted travel direction`
    : loading
      ? "Loading direction-policy evidence…"
      : "Load the Base Graph to inspect all direction-limited edges.";
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
  const canRefreshDirectionReview =
    loaded &&
    !loading &&
    !recalculating &&
    !isDrawing() &&
    state.directionReview.profile === "staged-v2" &&
    !state.directionReview.readOnly;
  els.refreshDirectionReview.disabled = !canRefreshDirectionReview;
  els.refreshDirectionReview.textContent = recalculating
    ? "Refreshing V2 evidence..."
    : "Rebuild graph + refresh V2 evidence";
  renderBaseEdgeDirectionReview(
    selectedBaseFeature,
    loading || recalculating || isDrawing() || !loaded,
  );

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
    ${renderBaseEdgeAttributes(selectedBaseFeature)}
  `;
  els.baseGraphHelp.textContent = selected
    ? "Review both stored directions above. After geometry or policy changes, rebuild and refresh V2 evidence before revalidating an alignment."
    : selectedGraphEdge
      ? "Inspect normalized direction evidence above. Geometry remains generated from OSM; reviewed direction corrections are saved as source-way overrides."
      : "Click any base graph edge to inspect it. Create a new manual edge, or copy a selected OSM edge to edit it.";
}

function renderConnectorLensLegend() {
  const mode = state.connectorLens.colorMode;
  let items = [];
  if (mode === "class") {
    items = CONNECTOR_CLASS_LEGEND;
  } else if (mode === "access") {
    items = CONNECTOR_ACCESS_LEGEND;
  } else if (mode === "eligibility") {
    items = [
      { label: "allowed", color: "#1b7837" },
      { label: "excluded", color: CONNECTOR_EXCLUDED_COLOR },
    ];
  } else if (mode === "cost") {
    items = CONNECTOR_COST_LEGEND;
  }
  els.connectorLegend.innerHTML = items
    .map(
      (item) =>
        `<span class="connector-legend-item"><span class="connector-legend-swatch" style="background:${item.color}"></span>${escapeHtml(item.label)}</span>`,
    )
    .join("");
}

function renderConnectorLensPanel() {
  const strategy = state.connectorLens.strategy;
  els.connectorColorMode.value = state.connectorLens.colorMode;
  for (const key of CONNECTOR_CLASS_KEYS) {
    const value = strategy.classMultipliers?.[key];
    const numInput = document.getElementById(`connector-class-${key}`);
    const excludedInput = document.getElementById(`connector-class-${key}-excluded`);
    const excluded = value === null || value === undefined;
    excludedInput.checked = excluded;
    // Only overwrite the number input when it holds a real value; leave it
    // populated (just disabled) while excluded so the prior multiplier is
    // preserved and can be restored on uncheck (see setConnectorClassExcluded).
    if (!excluded) numInput.value = value;
    numInput.disabled = excluded;
  }
  for (const key of CONNECTOR_ACCESS_KEYS) {
    const value = strategy.accessPolicy?.[key];
    const numInput = document.getElementById(`connector-access-${key}`);
    const excludedInput = document.getElementById(`connector-access-${key}-excluded`);
    const excluded = value === null || value === undefined;
    excludedInput.checked = excluded;
    if (!excluded) numInput.value = value;
    numInput.disabled = excluded;
  }
  els.connectorUphillWeight.value = strategy.uphillWeight;
  els.connectorSnap.value = strategy.snap;
  renderConnectorLensLegend();
  const target = state.connectorLens.targetStart;
  els.connectorRun.disabled = !target;
  els.connectorClearRun.disabled = !connectorLensRunActive();
  els.connectorHideUnreachable.checked = state.connectorLens.hideUnreachable;
  els.connectorLabelMode.checked = state.connectorLens.labeling.active;
  els.connectorPickTarget.classList.toggle("active", state.connectorLens.pickingTarget);
  const thresholds = state.connectorLens.thresholds;
  els.connectorThresholdTooFarRadius.value = thresholds.tooFarRadiusMeters;
  renderConnectorLabelStatus();
  renderConnectorCalibration();
}

function connectorLensRunActive() {
  return Boolean(state.connectorLens.lastFrequencyResult);
}

function connectorOriginKey(origin) {
  return `${Number(origin.lat).toFixed(6)},${Number(origin.lng).toFixed(6)}`;
}

function connectorLabelOrigins() {
  return (state.connectorLens.lastFrequencyResult?.origins || []).filter(
    (origin) => origin.status !== "snap-failed",
  );
}

function connectorLabelCounts() {
  const counts = { valid: 0, unacceptable: 0, borderline: 0 };
  for (const verdict of state.connectorLens.labeling.verdicts.values()) {
    if (verdict in counts) counts[verdict] += 1;
  }
  return counts;
}

function renderConnectorLabelStatus() {
  if (!els.connectorLabelStatus) return;
  const list = connectorLabelOrigins();
  const labeling = state.connectorLens.labeling;
  if (!labeling.active) {
    els.connectorLabelStatus.textContent = list.length
      ? `${list.length} labelable origins`
      : "Run frequency first.";
    return;
  }
  if (list.length === 0) {
    els.connectorLabelStatus.textContent = "No labelable origins.";
    return;
  }
  const clampedIndex = Math.max(0, Math.min(list.length - 1, labeling.index));
  if (clampedIndex !== labeling.index) labeling.index = clampedIndex;
  const counts = connectorLabelCounts();
  const current = list[labeling.index];
  const currentVerdict = state.connectorLens.labeling.verdicts.get(
    connectorOriginKey(current),
  );
  els.connectorLabelStatus.textContent =
    `origin ${labeling.index + 1}/${list.length}` +
    (currentVerdict ? ` · ${currentVerdict}` : " · unlabeled") +
    ` · valid ${counts.valid} · unacceptable ${counts.unacceptable} · borderline ${counts.borderline}`;
}

function setConnectorLabelMode(active) {
  state.connectorLens.labeling.active = active;
  if (active) {
    state.connectorLens.labeling.index = Math.max(
      0,
      Math.min(state.connectorLens.labeling.index, connectorLabelOrigins().length - 1),
    );
    chooseRandomConnectorLabelOrigin()
      .then((advanced) => {
        if (!advanced) return stepConnectorLabel(0);
        return null;
      })
      .catch(showError);
  } else {
    renderConnectorOrigins(state.connectorLens.lastFrequencyResult?.origins || []);
    renderConnectorLabelStatus();
  }
}

function selectedConnectorLabelOrigin() {
  const list = connectorLabelOrigins();
  return list[state.connectorLens.labeling.index] || null;
}

function randomUnlabeledConnectorLabelIndex(list) {
  const candidates = [];
  for (let index = 0; index < list.length; index += 1) {
    if (!state.connectorLens.labeling.verdicts.has(connectorOriginKey(list[index]))) {
      candidates.push(index);
    }
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

async function chooseRandomConnectorLabelOrigin() {
  const list = connectorLabelOrigins();
  if (list.length === 0) {
    renderConnectorOrigins(state.connectorLens.lastFrequencyResult?.origins || []);
    renderConnectorLabelStatus();
    return false;
  }
  const randomIndex = randomUnlabeledConnectorLabelIndex(list);
  if (randomIndex === null) {
    renderConnectorOrigins(state.connectorLens.lastFrequencyResult?.origins || []);
    renderConnectorLabelStatus();
    return false;
  }
  state.connectorLens.labeling.index = randomIndex;
  renderConnectorOrigins(state.connectorLens.lastFrequencyResult?.origins || []);
  renderConnectorLabelStatus();
  await runConnectorSingle(list[randomIndex]);
  return true;
}

async function stepConnectorLabel(delta, { skipLabeled = false } = {}) {
  const list = connectorLabelOrigins();
  if (list.length === 0) {
    renderConnectorOrigins(state.connectorLens.lastFrequencyResult?.origins || []);
    renderConnectorLabelStatus();
    return;
  }
  const labeling = state.connectorLens.labeling;
  let nextIndex = Math.max(0, Math.min(list.length - 1, labeling.index + delta));
  if (skipLabeled) {
    for (let offset = 1; offset <= list.length; offset += 1) {
      const candidate = Math.min(
        list.length - 1,
        Math.max(0, labeling.index + Math.sign(delta || 1) * offset),
      );
      if (!labeling.verdicts.has(connectorOriginKey(list[candidate]))) {
        nextIndex = candidate;
        break;
      }
      if (candidate === 0 || candidate === list.length - 1) break;
    }
  }
  labeling.index = nextIndex;
  renderConnectorOrigins(state.connectorLens.lastFrequencyResult?.origins || []);
  renderConnectorLabelStatus();
  const origin = selectedConnectorLabelOrigin();
  if (origin) await runConnectorSingle(origin);
}

function selectConnectorLabelOrigin(origin) {
  const key = connectorOriginKey(origin);
  const index = connectorLabelOrigins().findIndex(
    (candidate) => connectorOriginKey(candidate) === key,
  );
  if (index >= 0) state.connectorLens.labeling.index = index;
  renderConnectorOrigins(state.connectorLens.lastFrequencyResult?.origins || []);
  renderConnectorLabelStatus();
}

function renderConnectorCalibration() {
  if (!els.connectorCalibReadout) return;
  const labels = state.connectorLens.labelsCache || [];
  if (labels.length === 0) {
    els.connectorCalibReadout.textContent = "No labels loaded.";
    return;
  }
  const result = evaluateThresholds(labels, state.connectorLens.thresholds);
  const pct = (value) =>
    value == null ? "n/a" : `${Math.round(Number(value) * 100)}%`;
  const valid = result.counts.valid;
  const unacceptable = result.counts.unacceptable;
  const borderline = result.counts.borderline;
  els.connectorCalibReadout.textContent =
    `labels ${result.counts.total} · would-guide valid ${pct(result.validGuideRate)} ` +
    `· wrongly-guide unacceptable ${pct(result.invalidGuideRate)} ` +
    `· valid guide/too-far ${valid.guide}/${valid.tooFar} ` +
    `· unacceptable guide/too-far ${unacceptable.guide}/${unacceptable.tooFar} ` +
    `· borderline guide/too-far ${borderline.guide}/${borderline.tooFar}`;
}

function setConnectorThresholdNumber(key, rawValue, label) {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) {
    setStatus(`${label} must be a non-negative number.`, "error");
    renderConnectorLensPanel();
    return;
  }
  state.connectorLens.thresholds = {
    ...state.connectorLens.thresholds,
    [key]: value,
  };
  renderConnectorCalibration();
}

async function loadConnectorLabels() {
  const response = await fetch("/api/connector/labels");
  if (!response.ok) {
    setStatus(`Label load failed (${response.status})`, "error");
    return;
  }
  const data = await response.json();
  state.connectorLens.labelsCache = Array.isArray(data.labels) ? data.labels : [];
  renderConnectorCalibration();
  setStatus(`Loaded ${state.connectorLens.labelsCache.length} connector labels.`);
}

function handleConnectorLabelKey(event) {
  if (!state.connectorLens.labeling.active || state.workspaceMode !== "base") return false;
  if (event.altKey || event.ctrlKey || event.metaKey) return false;
  const key = event.key.toLowerCase();
  if (key === "v") {
    event.preventDefault();
    labelCurrentConnectorOrigin("valid").catch(showError);
    return true;
  }
  if (key === "i") {
    event.preventDefault();
    labelCurrentConnectorOrigin("unacceptable").catch(showError);
    return true;
  }
  if (key === "b") {
    event.preventDefault();
    labelCurrentConnectorOrigin("borderline").catch(showError);
    return true;
  }
  if (event.key === "[") {
    event.preventDefault();
    stepConnectorLabel(-1).catch(showError);
    return true;
  }
  if (event.key === "]") {
    event.preventDefault();
    stepConnectorLabel(1).catch(showError);
    return true;
  }
  return false;
}

function clearBaseGraphSelectionForConnectorRun() {
  state.baseOverlay.selectedGraphEdgeId = null;
  state.baseOverlay.selectedManualEdgeIndex = -1;
  state.baseOverlay.selectedManualVertexIndex = -1;
  updateMapSources();
  renderBaseGraphPanel();
}

// Every strategy edit must REASSIGN state.connectorLens.strategy to a new
// object so the reference-equality cache in baseGraphCollection() detects
// the change and recolors the base-graph-edges source.
function applyConnectorStrategyChange(mutate) {
  const next = structuredClone(state.connectorLens.strategy);
  mutate(next);
  state.connectorLens.strategy = next;
  updateMapSources();
  renderConnectorLensPanel();
  renderBaseGraphPanel();
}

function setConnectorColorMode(mode) {
  state.connectorLens.colorMode = mode;
  updateMapSources();
  renderConnectorLensPanel();
}

function connectorNonNegativeNumber(rawValue, label) {
  if (rawValue === "") {
    setStatus(`${label} must be a non-negative number.`, "error");
    renderConnectorLensPanel();
    return null;
  }
  const n = Number(rawValue);
  if (!Number.isFinite(n) || n < 0) {
    setStatus(`${label} must be a non-negative number.`, "error");
    renderConnectorLensPanel();
    return null;
  }
  return n;
}

function setConnectorClassMultiplier(key, rawValue) {
  const value = connectorNonNegativeNumber(rawValue, `Class multiplier ${key}`);
  if (value === null) return;
  applyConnectorStrategyChange((strategy) => {
    strategy.classMultipliers = { ...strategy.classMultipliers, [key]: value };
  });
}

function setConnectorClassExcluded(key, excluded, fallbackValue) {
  const fallback = excluded
    ? null
    : connectorNonNegativeNumber(
        fallbackValue === "" ? "1" : fallbackValue,
        `Class multiplier ${key}`,
      );
  if (!excluded && fallback === null) return;
  applyConnectorStrategyChange((strategy) => {
    strategy.classMultipliers = {
      ...strategy.classMultipliers,
      [key]: excluded ? null : fallback,
    };
  });
}

function setConnectorAccessValue(key, rawValue) {
  const value = connectorNonNegativeNumber(rawValue, `Access multiplier ${key}`);
  if (value === null) return;
  applyConnectorStrategyChange((strategy) => {
    strategy.accessPolicy = { ...strategy.accessPolicy, [key]: value };
  });
}

function setConnectorAccessExcluded(key, excluded, fallbackValue) {
  const fallback = excluded
    ? null
    : connectorNonNegativeNumber(
        fallbackValue === "" ? "1" : fallbackValue,
        `Access multiplier ${key}`,
      );
  if (!excluded && fallback === null) return;
  applyConnectorStrategyChange((strategy) => {
    strategy.accessPolicy = {
      ...strategy.accessPolicy,
      [key]: excluded ? null : fallback,
    };
  });
}

function setConnectorUphillWeight(rawValue) {
  const value = connectorNonNegativeNumber(rawValue, "Uphill weight");
  if (value === null) return;
  applyConnectorStrategyChange((strategy) => {
    strategy.uphillWeight = value;
  });
}

function setConnectorSnap(value) {
  applyConnectorStrategyChange((strategy) => {
    strategy.snap = value;
  });
}

function resetConnectorStrategy() {
  state.connectorLens.strategy = structuredClone(DEFAULT_CONNECTOR_STRATEGY);
  updateMapSources();
  renderConnectorLensPanel();
  renderBaseGraphPanel();
  setStatus("Connector Lens strategy reset to production defaults.");
}

async function copyConnectorStrategyJson() {
  const json = JSON.stringify(state.connectorLens.strategy, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    setStatus("Connector Lens strategy JSON copied to clipboard.");
  } catch (err) {
    showError(err);
  }
}

async function activateConnectorLensMode() {
  if (state.connectorLens.routesLoaded) return;
  state.connectorLens.routesLoaded = true;
  try {
    const r = await fetch("/api/featured-slugs");
    if (!r.ok) throw new Error(`Failed to load featured slugs (${r.status})`);
    const slugs = await r.json();
    for (const slug of slugs) {
      const opt = document.createElement("option");
      opt.value = slug;
      opt.textContent = slug;
      els.connectorTargetRoute.appendChild(opt);
    }
  } catch (err) {
    showError(err);
  }
}

async function onConnectorTargetRouteChange() {
  const slug = els.connectorTargetRoute.value;
  state.connectorLens.targetRouteSlug = slug;
  if (!slug) {
    renderConnectorLensPanel();
    return;
  }
  setStatus(`Loading route ${slug} for Connector Lens target…`);
  try {
    const r = await fetch(`/api/video-keyframes/${slug}/route-polyline`);
    if (!r.ok) throw new Error(`Route load failed (${r.status})`);
    const polyline = await r.json();
    if (!Array.isArray(polyline) || polyline.length === 0) {
      throw new Error("Route has no geometry.");
    }
    state.connectorLens.targetStart = { lat: polyline[0].lat, lng: polyline[0].lng };
    setStatus(`Connector Lens target set to start of ${slug}.`);
    renderConnectorLensPanel();
  } catch (err) {
    showError(err);
  }
}

function toggleConnectorPickTarget() {
  state.connectorLens.pickingTarget = !state.connectorLens.pickingTarget;
  if (state.connectorLens.pickingTarget) {
    setStatus("Connector Lens: click the map to set the target point.");
  }
  renderConnectorLensPanel();
}

function handleConnectorPickTargetClick(event) {
  state.connectorLens.pickingTarget = false;
  state.connectorLens.targetRouteSlug = "";
  els.connectorTargetRoute.value = "";
  state.connectorLens.targetStart = { lat: event.lngLat.lat, lng: event.lngLat.lng };
  setStatus("Connector Lens target set from map click.");
  renderConnectorLensPanel();
}

function connectorUsageCollection(edgeUsage) {
  const features = [];
  for (const [edgeId, count] of Object.entries(edgeUsage || {})) {
    const feature = graphFeatureForEdgeId(edgeId);
    if (!feature || feature.geometry?.type !== "LineString") continue;
    features.push({
      ...feature,
      properties: { ...(feature.properties || {}), count },
    });
  }
  return { type: "FeatureCollection", features };
}

function connectorOriginsCollection(origins) {
  const shown = state.connectorLens.hideUnreachable
    ? (origins || []).filter((origin) => origin.status !== "snap-failed")
    : (origins || []);
  const selected = selectedConnectorLabelOrigin();
  const selectedKey = selected ? connectorOriginKey(selected) : null;
  const features = shown.map((origin) => ({
    type: "Feature",
    properties: {
      status: origin.status,
      lat: origin.lat,
      lng: origin.lng,
      verdict: state.connectorLens.labeling.verdicts.get(connectorOriginKey(origin)) || "",
      selected: state.connectorLens.labeling.active &&
        connectorOriginKey(origin) === selectedKey,
    },
    geometry: { type: "Point", coordinates: [origin.lng, origin.lat] },
  }));
  return { type: "FeatureCollection", features };
}

function renderConnectorUsage(edgeUsage) {
  setSourceData("connector-usage", connectorUsageCollection(edgeUsage));
}

function renderConnectorOrigins(origins) {
  setSourceData("connector-origins", connectorOriginsCollection(origins));
}

function clearConnectorSinglePath() {
  setSourceData("connector-single-path", EMPTY_FEATURE_COLLECTION);
}

function clearConnectorRun() {
  state.connectorLens.lastFrequencyResult = null;
  state.connectorLens.labeling.index = 0;
  state.connectorLens.labeling.verdicts = new Map();
  renderConnectorUsage({});
  renderConnectorOrigins([]);
  clearConnectorSinglePath();
  els.connectorRunStatus.textContent = "";
  renderConnectorLabelStatus();
  renderConnectorLensPanel();
  setStatus("Connector run cleared.");
}

async function runConnectorFrequency() {
  const target = state.connectorLens.targetStart;
  if (!target) {
    setStatus("Pick a target route/point first", "error");
    return;
  }
  clearConnectorSinglePath();
  setStatus("Running connector frequency…");
  els.connectorRun.disabled = true;
  try {
    const res = await fetch("/api/connector/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "frequency",
        routeStart: target,
        strategy: state.connectorLens.strategy,
        radiusMeters: Number(els.connectorRadius.value) || 2000,
        gridSpacingMeters: 150,
        maxOrigins: 400,
      }),
    });
    if (!res.ok) {
      setStatus(`Connector run failed (${res.status})`, "error");
      return;
    }
    const data = await res.json();
    state.connectorLens.lastFrequencyResult = data;
    state.connectorLens.labeling.index = 0;
    state.connectorLens.labeling.verdicts = new Map();
    clearBaseGraphSelectionForConnectorRun();
    renderConnectorUsage(data.edgeUsage);
    renderConnectorOrigins(data.origins);
    renderConnectorLensPanel();
    const s = data.stats;
    const reachable = Number.isFinite(Number(s.reachable)) ? Number(s.reachable) : s.ok;
    const quality = s.reachableQuality == null
      ? "n/a"
      : `${Math.round(Number(s.reachableQuality) * 100)}%`;
    const failures = Object.entries(s.byFailure || {})
      .map(([key, value]) => `${key} ${value}`)
      .join(" · ") || "none";
    els.connectorRunStatus.textContent =
      `reachable ${s.ok}/${reachable} (${quality}) · total origins ${s.total} · ${failures}` +
      (data.grid.capped ? ` · grid coarsened to ${Math.round(data.grid.spacingMeters)}m` : "");
    if (state.connectorLens.labeling.active) {
      const advanced = await chooseRandomConnectorLabelOrigin();
      if (!advanced) await stepConnectorLabel(0);
    }
    setStatus("Connector frequency run complete.");
  } catch (err) {
    showError(err);
  } finally {
    els.connectorRun.disabled = !state.connectorLens.targetStart;
  }
}

async function fetchConnectorSingle(origin, target = state.connectorLens.targetStart) {
  if (!target) return null;
  const res = await fetch("/api/connector/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "single",
      routeStart: target,
      origin: { lat: origin.lat, lng: origin.lng },
      strategy: state.connectorLens.strategy,
    }),
  });
  if (!res.ok) {
    throw new Error(`Connector single path failed (${res.status})`);
  }
  return res.json();
}

function drawConnectorSinglePath(data) {
  if (!data || data.failure || !Array.isArray(data.geometry) || data.geometry.length === 0) {
    clearConnectorSinglePath();
    return false;
  }
  setSourceData("connector-single-path", {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: data.geometry.map((p) => [p.lng, p.lat]),
        },
      },
    ],
  });
  return true;
}

async function runConnectorSingle(origin) {
  const target = state.connectorLens.targetStart;
  if (!target) return;
  try {
    const data = await fetchConnectorSingle(origin, target);
    if (!drawConnectorSinglePath(data)) {
      setStatus(data.failure ? `No path: ${data.failure}` : "No path found for that origin.");
      return;
    }
    setStatus(`Connector single path: ${Math.round(data.distanceMeters)}m.`);
  } catch (err) {
    showError(err);
  }
}

async function labelCurrentConnectorOrigin(verdict) {
  const labeling = state.connectorLens.labeling;
  if (!labeling.active || labeling.busy) return;
  const target = state.connectorLens.targetStart;
  const origin = selectedConnectorLabelOrigin();
  if (!target || !origin) return;

  labeling.busy = true;
  try {
    const single = await fetchConnectorSingle(origin, target);
    drawConnectorSinglePath(single);
    const features = computeConnectorFeatures(single, { origin, routeStart: target });
    const response = await fetch("/api/connector/label", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routeSlug: state.connectorLens.targetRouteSlug || null,
        routeStart: target,
        origin: { lat: origin.lat, lng: origin.lng },
        verdict,
        features,
        strategy: state.connectorLens.strategy,
      }),
    });
    if (!response.ok) {
      setStatus(`Label save failed (${response.status})`, "error");
      return;
    }
    labeling.verdicts.set(connectorOriginKey(origin), verdict);
    renderConnectorOrigins(state.connectorLens.lastFrequencyResult?.origins || []);
    renderConnectorLabelStatus();
    const advanced = await chooseRandomConnectorLabelOrigin();
    if (!advanced) {
      setStatus("Label saved. All visible origins have labels.");
    }
  } catch (err) {
    showError(err);
  } finally {
    labeling.busy = false;
  }
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
  renderDirectionReview(segmentId);

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

function directionReviewRecord(segmentId, alignmentKey = state.directionReview.alignmentKey) {
  return state.directionReview.overlay?.segments?.[String(segmentId)]?.alignments?.[alignmentKey] || null;
}

function directionReviewSlotLabel(slot) {
  const published = slot?.published;
  const draft = slot?.draft;
  if (draft) return `${draft.candidate?.kind || "draft"} · ${draft.validation?.status || "pending"}`;
  if (published?.disposition === "accepted") return "accepted";
  if (published?.disposition === "unavailable") {
    return `unavailable · ${published.unavailableReasonCode}`;
  }
  return "unreviewed";
}

function directionReviewEvidenceSummary(ref) {
  const feature = graphFeatureForEdgeId(ref.edgeId);
  const properties = feature?.properties || {};
  const traversal = directionReviewTraversalForRef(ref);
  const raw = [
    properties.highway ? `highway=${properties.highway}` : null,
    properties.oneway ? `oneway=${properties.oneway}` : null,
    properties["oneway:bicycle"] ? `oneway:bicycle=${properties["oneway:bicycle"]}` : null,
    properties.bicycle ? `bicycle=${properties.bicycle}` : null,
    properties.ref ? `ref=${properties.ref}` : null,
  ].filter(Boolean);
  return { traversal, raw: raw.join(" · ") || properties.source || "no raw tags" };
}

function renderDirectionReviewEdges(segment, alignmentKey, record) {
  els.directionReviewEdges.innerHTML = "";
  const refs = directionReviewRefsForRecord(segment, alignmentKey, record);
  if (refs.length === 0) {
    els.directionReviewEdges.innerHTML = '<div class="empty-state">No physical alignment is mapped for this direction.</div>';
    return refs;
  }
  for (const [index, ref] of refs.entries()) {
    const evidence = directionReviewEvidenceSummary(ref);
    const row = document.createElement("div");
    row.className = "direction-review-edge";
    row.dataset.edgeId = String(ref.edgeId);
    row.innerHTML = `
      <span class="direction-review-edge-sequence">${index + 1}</span>
      <span class="direction-review-edge-main">
        <strong>${escapeHtml(String(ref.edgeId))} · ${escapeHtml(ref.direction === "reverse" ? "reverse" : "forward")}</strong>
        <small><span class="direction-review-edge-state ${escapeHtml(evidence.traversal.state)}">${escapeHtml(evidence.traversal.state)}</span> · ${escapeHtml(evidence.traversal.reason)} · ${escapeHtml(evidence.raw)}</small>
      </span>
      <span class="direction-review-edge-buttons"></span>`;
    const buttons = row.querySelector(".direction-review-edge-buttons");
    if (state.directionReview.editing) {
      const flip = document.createElement("button");
      flip.type = "button";
      flip.textContent = "↕";
      flip.title = `Flip traversal of ${ref.edgeId}`;
      flip.addEventListener("click", () => flipDirectionReviewEdge(index).catch(showError));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.title = `Remove ${ref.edgeId}`;
      remove.addEventListener("click", () => removeDirectionReviewEdge(index).catch(showError));
      buttons.append(flip, remove);
    }
    row.addEventListener("mouseenter", () => {
      state.baseOverlay.hoveredOverlayEdgeId = String(ref.edgeId);
      row.classList.add("hovered");
      updateMapSources();
    });
    row.addEventListener("mouseleave", () => {
      if (String(state.baseOverlay.hoveredOverlayEdgeId) === String(ref.edgeId)) {
        state.baseOverlay.hoveredOverlayEdgeId = null;
      }
      row.classList.remove("hovered");
      updateMapSources();
    });
    els.directionReviewEdges.appendChild(row);
  }
  return refs;
}

function renderDirectionReview(segmentId) {
  if (!els.directionReviewSummary) return;
  const review = state.directionReview;
  els.directionReviewAToB.classList.toggle("active", review.alignmentKey === "aToB");
  els.directionReviewBToA.classList.toggle("active", review.alignmentKey === "bToA");
  els.directionReviewAToB.setAttribute("aria-selected", String(review.alignmentKey === "aToB"));
  els.directionReviewBToA.setAttribute("aria-selected", String(review.alignmentKey === "bToA"));
  els.directionReviewEdges.classList.toggle("direction-review-editing", review.editing);
  els.directionReviewSource.textContent = review.loaded
    ? `${review.source} · ${review.profile}${review.readOnly ? " · read-only" : ""}`
    : "Not prepared";
  if (!review.loaded) {
    els.directionReviewSummary.innerHTML =
      '<div class="empty-state">Run the policy audit and V2 migration proposal before Direction Review.</div>';
    els.directionReviewSlotStatuses.innerHTML = "";
    els.directionReviewEdges.innerHTML = "";
    els.directionReviewApplyMigration.disabled = true;
    els.directionReviewApplySymmetricBatch.disabled = true;
    return;
  }
  const segment = review.overlay?.segments?.[String(segmentId)];
  if (!segment) {
    els.directionReviewSummary.innerHTML =
      '<div class="empty-state">This segment is not present in the active V1 migration set.</div>';
    els.directionReviewSlotStatuses.innerHTML = "";
    els.directionReviewEdges.innerHTML = "";
    els.directionReviewApplyMigration.disabled = true;
    els.directionReviewApplySymmetricBatch.disabled = true;
    return;
  }
  const slot = segment.alignments[review.alignmentKey];
  const record = slot.draft || slot.published;
  const validation = slot.draft?.validation;
  els.directionReviewSlotStatuses.innerHTML = ["aToB", "bToA"]
    .map((alignmentKey) => `
      <div class="direction-review-slot-status${alignmentKey === review.alignmentKey ? " active" : ""}">
        <strong>${alignmentKey === "aToB" ? "A → B" : "B → A"}</strong>
        <span>${escapeHtml(directionReviewSlotLabel(segment.alignments[alignmentKey]))}</span>
      </div>`)
    .join("");
  const reasonList = (validation?.reasons || [])
    .slice(0, 8)
    .map((reason) => `${reason.edgeId ? `${reason.edgeId}: ` : ""}${reason.reason || reason.code}`)
    .join("; ");
  const refs = renderDirectionReviewEdges(segment, review.alignmentKey, record);
  const stateClass = validation?.status === "valid" || (!slot.draft && slot.published?.disposition === "accepted")
    ? "direction-review-state-valid"
    : "direction-review-state-invalid";
  const endpointDistances = validation?.endpointDistancesMeters;
  els.directionReviewSummary.innerHTML = `
    <dl class="base-overlay-metrics">
      <div><dt>Logical segment</dt><dd>${escapeHtml(segment.segmentName)} (#${segment.segmentId})</dd></div>
      <div><dt>Alignment</dt><dd>${review.alignmentKey === "aToB" ? "A → B" : "B → A"}</dd></div>
      <div><dt>Published</dt><dd>${escapeHtml(slot.published?.disposition || "none")}</dd></div>
      <div><dt>Draft</dt><dd>${escapeHtml(slot.draft?.candidate?.kind || slot.draft?.disposition || "none")}</dd></div>
      <div><dt>Classification</dt><dd>${escapeHtml(segment.migration?.classification || "—")}</dd></div>
      <div><dt>Directed refs</dt><dd>${refs.length}</dd></div>
      <div><dt>Validation</dt><dd class="${stateClass}">${escapeHtml(validation?.status || slot.published?.disposition || "unreviewed")}</dd></div>
      ${endpointDistances ? `<div><dt>Endpoint drift</dt><dd>${Math.round(endpointDistances.start)}m start · ${Math.round(endpointDistances.end)}m end</dd></div>` : ""}
      ${reasonList ? `<div><dt>Blocking evidence</dt><dd>${escapeHtml(reasonList)}</dd></div>` : ""}
    </dl>`;
  const writable =
    !review.busy &&
    !review.applying &&
    review.profile === "staged-v2" &&
    !review.readOnly;
  const oppositeKey = review.alignmentKey === "aToB" ? "bToA" : "aToB";
  const oppositePublished = segment.alignments[oppositeKey]?.published;
  const canReverse = oppositePublished?.disposition === "accepted" && oppositePublished.realization?.type === "explicit";
  els.directionReviewEdit.disabled = !writable;
  els.directionReviewEdit.textContent = review.editing ? "Finish edge editing" : "Edit directed edges";
  els.directionReviewRevalidate.disabled = !writable || !slot.draft;
  els.directionReviewUseReverse.disabled = !writable || !canReverse;
  const draftCanMaterialize =
    Boolean(slot.draft?.realization) ||
    (slot.draft?.candidate?.kind === "exact-reverse" && canReverse);
  els.directionReviewAccept.disabled =
    !writable || !slot.draft || validation?.status !== "valid" || !draftCanMaterialize;
  els.directionReviewClearDraft.disabled = !writable || !slot.draft;
  els.directionReviewMarkUnavailable.disabled = !writable;
  const canApply =
    writable &&
    slot.draft?.candidate?.kind === "v1-existing" &&
    validation?.status === "valid";
  els.directionReviewApplyMigration.disabled = !canApply;
  const symmetricIds = directionReviewSymmetricBatchIds();
  els.directionReviewApplySymmetricBatch.disabled = !writable || symmetricIds.length === 0;
  els.directionReviewApplySymmetricBatch.textContent = symmetricIds.length > 0
    ? `Batch-approve ${symmetricIds.length} verified bidirectional segments`
    : "No verified bidirectional segments pending";
}

function directionReviewSymmetricBatchIds() {
  return Object.values(state.directionReview.overlay?.segments || {})
    .filter((segment) => {
      if (segment.migration?.classification !== "symmetric_candidate") return false;
      const slots = Object.values(segment.alignments || {});
      if (slots.some((slot) => slot?.published)) return false;
      const existing = slots.find((slot) => slot?.draft?.candidate?.kind === "v1-existing");
      const reverse = slots.find((slot) => slot?.draft?.candidate?.kind === "exact-reverse");
      return existing?.draft?.validation?.status === "valid" && reverse?.draft?.validation?.status === "valid";
    })
    .map((segment) => segment.segmentId)
    .sort((a, b) => Number(a) - Number(b));
}

function directionReviewReviewFields() {
  return {
    reviewer: els.directionReviewReviewer.value.trim(),
    reviewedAt: els.directionReviewDate.value,
    batchId: els.directionReviewBatch.value.trim(),
  };
}

async function runDirectionReviewAction(action, extra = {}) {
  const segmentId = selectedSegmentId();
  const alignmentKey = state.directionReview.alignmentKey;
  if (!segmentId) throw new Error("Select a segment first.");
  state.directionReview.busy = true;
  renderAll();
  try {
    const response = await fetch("/api/cw-base-overlay-v2/alignment-action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ segmentId, alignmentKey, action, ...extra }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `Direction Review action failed: ${response.status}`);
    }
    state.directionReview.overlay = payload.overlay;
    state.directionReview.source = payload.source || "staged";
    state.directionReview.readOnly = false;
    setStatus(`${alignmentKey === "aToB" ? "A → B" : "B → A"}: ${action.replaceAll("-", " ")}.`);
    return payload;
  } finally {
    state.directionReview.busy = false;
    renderAll();
  }
}

function currentDirectionReviewRefs() {
  const segment = directionReviewSegment();
  if (!segment) return [];
  const record = directionReviewDisplayRecord(segment, state.directionReview.alignmentKey);
  return directionReviewRefsForRecord(segment, state.directionReview.alignmentKey, record);
}

async function toggleDirectionReviewEditing() {
  if (state.directionReview.editing) {
    state.directionReview.editing = false;
    renderAll();
    setStatus("Finished directed-edge editing. Revalidate, then accept when all checks pass.");
    return;
  }
  const slot = directionReviewRecord(selectedSegmentId());
  if (!slot?.draft?.realization || slot.draft.realization.type !== "explicit") {
    await runDirectionReviewAction("save-draft", { edgeRefs: currentDirectionReviewRefs() });
  }
  state.directionReview.editing = true;
  renderAll();
  setStatus("Direction editing active: click base edges to add/remove them; use ↕ to flip traversal.");
}

async function saveDirectionReviewRefs(edgeRefs) {
  await runDirectionReviewAction("save-draft", { edgeRefs: normalizeOverlayEdgeRefs(edgeRefs) });
}

async function removeDirectionReviewEdge(index) {
  const refs = currentDirectionReviewRefs();
  if (index < 0 || index >= refs.length) return;
  await saveDirectionReviewRefs(refs.filter((_ref, refIndex) => refIndex !== index));
}

async function flipDirectionReviewEdge(index) {
  const refs = currentDirectionReviewRefs();
  if (index < 0 || index >= refs.length) return;
  refs[index] = {
    ...refs[index],
    direction: refs[index].direction === "reverse" ? "forward" : "reverse",
  };
  await saveDirectionReviewRefs(refs);
}

async function toggleDirectionReviewBaseEdge(feature) {
  const refs = currentDirectionReviewRefs();
  const nextRef = edgeRefFromBaseFeature(feature, refs.length);
  if (!nextRef) return;
  if (!state.directionReviewToggledThisClick) {
    state.directionReviewToggledThisClick = new Set();
    window.setTimeout(() => {
      state.directionReviewToggledThisClick = null;
    }, 0);
  }
  if (state.directionReviewToggledThisClick.has(String(nextRef.edgeId))) return;
  state.directionReviewToggledThisClick.add(String(nextRef.edgeId));
  const existingIndex = refs.findIndex((ref) => String(ref.edgeId) === String(nextRef.edgeId));
  const nextRefs = existingIndex >= 0
    ? refs.filter((_ref, index) => index !== existingIndex)
    : orientAppendedEdgeRef(refs, nextRef, baseEdgeGeometryLookup());
  await saveDirectionReviewRefs(nextRefs);
}

async function acceptSelectedDirectionReview() {
  const review = directionReviewReviewFields();
  if (!review.reviewer || !review.reviewedAt || !review.batchId) {
    throw new Error("Reviewer, review date, and batch ID are required.");
  }
  await runDirectionReviewAction("accept", review);
  state.directionReview.editing = false;
}

async function markSelectedDirectionUnavailable() {
  const review = directionReviewReviewFields();
  const unavailableReasonCode = els.directionReviewUnavailableReason.value;
  const rationale = els.directionReviewRationale.value.trim();
  if (!review.reviewer || !review.reviewedAt || !unavailableReasonCode || !rationale) {
    throw new Error("Reviewer, review date, unavailable reason, and rationale are required.");
  }
  await runDirectionReviewAction("unavailable", {
    ...review,
    unavailableReasonCode,
    rationale,
    userExplanation: els.directionReviewUserExplanation.value.trim(),
  });
  state.directionReview.editing = false;
}

async function applySelectedDirectionMigration() {
  const segmentId = selectedSegmentId();
  const reviewer = els.directionReviewReviewer.value.trim();
  const reviewedAt = els.directionReviewDate.value;
  const batchId = els.directionReviewBatch.value.trim();
  if (!segmentId || !reviewer || !reviewedAt || !batchId) {
    throw new Error("Reviewer, review date, and batch ID are required.");
  }
  state.directionReview.applying = true;
  renderAll();
  try {
    const response = await fetch("/api/cw-base-overlay-v2/apply-migration", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ segmentIds: [segmentId], reviewer, reviewedAt, batchId }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || `Migration apply failed: ${response.status}`);
    state.directionReview.overlay = payload.overlay;
    state.directionReview.source = "staged";
    state.directionReview.readOnly = false;
    state.directionReview.editing = false;
    setStatus(`Applied reviewed V1 direction for segment ${segmentId}.`);
  } finally {
    state.directionReview.applying = false;
    renderAll();
  }
}

async function applySymmetricDirectionMigrationBatch() {
  const segmentIds = directionReviewSymmetricBatchIds();
  const { reviewer, reviewedAt, batchId } = directionReviewReviewFields();
  if (!reviewer || !reviewedAt || !batchId) {
    throw new Error("Reviewer, review date, and batch ID are required.");
  }
  if (segmentIds.length === 0) {
    throw new Error("No mechanically verified bidirectional segments are pending.");
  }
  state.directionReview.applying = true;
  renderAll();
  try {
    const response = await fetch("/api/cw-base-overlay-v2/apply-symmetric-batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ segmentIds, reviewer, reviewedAt, batchId }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `Symmetric migration failed: ${response.status}`);
    }
    state.directionReview.overlay = payload.overlay;
    state.directionReview.source = "staged";
    state.directionReview.readOnly = false;
    state.directionReview.editing = false;
    setStatus(`Batch-approved ${payload.applied?.length || 0} verified bidirectional segments.`);
  } finally {
    state.directionReview.applying = false;
    renderAll();
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
  renderConnectorLensPanel();
  renderRoundaboutsPanel();
  renderCrossingsPanel();
  renderComposeStatus();
  updateMapSources();
}

function selectFeatureByActiveIndex(index, fit = false) {
  if (isDrawing()) {
    setStatus("Finish or cancel drawing before selecting another segment.");
    return;
  }
  state.selectedIndex = index;
  state.directionReview.editing = false;
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
  if (!["segments", "base", "overlay", "roundabouts", "crossings", "video-sync", "route-catalog"].includes(mode)) return;
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

  const previousMode = state.workspaceMode;
  state.workspaceMode = mode;
  if (previousMode === "video-sync" && mode !== "video-sync") {
    vsDeactivate();
  }
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

  if (mode === "base" || mode === "overlay" || mode === "roundabouts" || mode === "crossings") {
    state.baseOverlay.enabled = true;
    if (!state.baseOverlay.loaded) {
      renderAll();
      await loadBaseOverlayData();
    }
    setStatus(
      mode === "base"
        ? "Base Graph mode: edit manual base edges."
        : mode === "overlay"
          ? "CW Overlay mode: select a segment, then choose graph edges."
          : mode === "roundabouts"
            ? "Roundabouts mode: review classifications from the saved OSM snapshot."
            : "Crossings mode: review directed side-change mappings; arrows run from entry to exit.",
    );
    if (mode === "base") {
      activateConnectorLensMode().catch(showError);
    }
    if (mode === "roundabouts" && !state.roundabouts.loaded && !state.roundabouts.loading) {
      await loadRoundaboutReview();
    }
    if (mode === "crossings" && !state.crossings.loaded && !state.crossings.loading) {
      await loadCrossingReview();
    }
  } else if (mode === "video-sync") {
    state.baseOverlay.enabled = false;
    setStatus("Video Sync mode: pick a route, paste a YouTube URL, click on the map to add keyframes.");
    vsActivateOverlay();
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
  setStatus(
    `Selected OSM base edge ${graphEdgeId}. Review direction below; use Copy Selected only to edit geometry.`,
  );
}

function findBaseEdgeById() {
  const edgeId = els.baseEdgeSearch.value.trim();
  if (!edgeId) {
    setStatus("Enter a base edge ID to find.", "error");
    els.baseEdgeSearch.focus();
    return;
  }
  if (!state.baseOverlay.loaded) {
    setStatus("Load the Base Graph before finding an edge.", "error");
    return;
  }

  const manualIndex = manualBaseEdgeFeatures().findIndex(
    (feature) => String(manualBaseEdgeFeatureId(feature)) === edgeId,
  );
  if (manualIndex >= 0) {
    selectManualBaseEdgeByIndex(manualIndex, true);
    return;
  }

  const graphFeature = (state.baseOverlay.graphEdges?.features || []).find(
    (feature) => String(graphEdgeFeatureId(feature)) === edgeId,
  );
  if (graphFeature) {
    selectBaseGraphEdge(graphFeature, true);
    return;
  }

  setStatus(`Base edge ${edgeId} was not found in the loaded graph or manual edges.`, "error");
  els.baseEdgeSearch.select();
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
  const migration = migrateOverlayEdgeReplacement(
    state.baseOverlay.overlay,
    graphEdgeId,
    [{ edgeId: manualEdgeId, source: "manual", manualEdgeId }],
    { updatedAt: now },
  );
  state.baseOverlay.overlay = migration.overlay;
  await saveBaseEdgeState();
  renderAll();
  const migrated = migration.migratedSegmentIds.length;
  setStatus(
    `Copied ${graphEdgeId} to editable manual base edge ${manualEdgeId}` +
    `${migrated ? ` and migrated ${migrated} overlay mapping${migrated === 1 ? "" : "s"}` : ""}. ` +
    "Recalculate the graph when ready.",
  );
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

// Renders the rich-text AST into a DOM preview node (mirrors the app renderers;
// links validated by the shared parser, so no raw-HTML path here either).
function renderRichTextPreview(target, value) {
  target.replaceChildren();
  const blocks = parseRichText(value);
  const renderInline = (parent, nodes) => {
    for (const node of nodes) {
      if (node.t === "text") {
        parent.appendChild(document.createTextNode(node.v));
      } else if (node.t === "break") {
        parent.appendChild(document.createElement("br"));
      } else if (node.t === "bold") {
        const strong = document.createElement("strong");
        renderInline(strong, node.children);
        parent.appendChild(strong);
      } else if (node.t === "link") {
        const a = document.createElement("a");
        a.href = node.href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        renderInline(a, node.children);
        parent.appendChild(a);
      }
    }
  };
  for (const block of blocks) {
    const p = document.createElement("p");
    renderInline(p, block);
    target.appendChild(p);
  }
  target.hidden = blocks.length === 0;
}

function appendDataTextField(item, { label, value = "", rows = 0, onCommit, preview = false }) {
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

  if (preview) {
    const previewEl = document.createElement("div");
    previewEl.className = "rich-text-preview";
    item.appendChild(previewEl);
    const update = () => renderRichTextPreview(previewEl, input.value);
    input.addEventListener("input", update);
    update();
  }

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
    // The stable ID is normally auto-generated when the marker is created;
    // backfill one here for any legacy marker that lacks it.
    let id = marker && typeof marker.id === "string" ? marker.id.trim() : "";
    if (!id) {
      id = generatePoiId();
      updateDataMarker(index, { id });
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

// Auto-generated stable identifier for a POI. Stays constant for the life of
// the marker so uploaded images and gallery/map references keep pointing at it.
function generatePoiId() {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(16).slice(2, 10);
  return `poi-${rand}`;
}

function addDataMarker() {
  const feature = selectedFeature();
  if (!feature) return;

  const data = ensureDataMarkers(feature);
  data.push({
    id: generatePoiId(),
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

    // Stable ID is auto-generated (see generatePoiId / addDataMarker); not an
    // editable field.

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
      preview: true,
      onCommit: (information) => {
        updateDataMarker(index, { information });
        renderDataList();
      },
    });

    appendDataTextField(item, {
      label: "Long description",
      value: marker.description,
      rows: 3,
      preview: true,
      onCommit: (description) => {
        updateDataMarker(index, { description });
        renderDataList();
      },
    });

    appendDataImageManager(item, index, marker);
    appendDataImageUpload(item, index);

    // Image POIs appear in route galleries by default; tick this to hide a
    // specific one. (Warnings are never shown in galleries regardless.)
    appendDataCheckboxField(item, {
      label: "Hide from route galleries",
      checked: marker.gallery === false,
      onCommit: (hidden) => {
        updateDataMarker(index, { gallery: hidden ? false : undefined });
        renderDataList();
      },
    });

    // Website / Phone / Hours are hidden for now (data contract still supports
    // them, but they are not exposed for editing).

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
  const migration = migrateOverlayEdgeReplacement(
    state.baseOverlay.overlay,
    originalId,
    [
      { edgeId: firstId, source: "manual", manualEdgeId: firstId },
      { edgeId: secondId, source: "manual", manualEdgeId: secondId },
    ],
    { updatedAt: now },
  );
  state.baseOverlay.overlay = migration.overlay;
  await saveBaseEdgeState();
  renderAll();
  const migrated = migration.migratedSegmentIds.length;
  const invalidated = migration.invalidatedSegmentIds.length;
  setStatus(
    `Split manual base edge ${originalId}` +
    `${migrated ? `; migrated ${migrated} overlay mapping${migrated === 1 ? "" : "s"}` : ""}` +
    `${invalidated ? `; marked ${invalidated} mapping${invalidated === 1 ? "" : "s"} as needing edit` : ""}. ` +
    "Recalculate the graph when ready.",
  );
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
      traversalOverridesResponse,
    ] = await Promise.all([
      fetch("/api/osm/graph-edges"),
      fetch("/api/osm/match-summary"),
      fetch("/api/osm/match-preview"),
      fetch("/api/cw-base-overlay"),
      fetch("/api/manual-base-edges"),
      fetch("/api/bicycle-traversal-overrides"),
    ]);
    for (const response of [
      graphEdgesResponse,
      matchSummaryResponse,
      matchPreviewResponse,
      overlayResponse,
      manualBaseEdgesResponse,
      traversalOverridesResponse,
    ]) {
      if (!response.ok) {
        throw new Error(`Failed to load ${response.url}: ${response.status}`);
      }
    }
    const [graphEdges, matchSummary, matchPreview, overlay, manualBaseEdges, traversalOverrides] = await Promise.all([
      graphEdgesResponse.json(),
      matchSummaryResponse.json(),
      matchPreviewResponse.json(),
      overlayResponse.json(),
      manualBaseEdgesResponse.json(),
      traversalOverridesResponse.json(),
    ]);
    state.baseOverlay.graphEdges = graphEdges;
    state.baseOverlay.matchSummary = matchSummary;
    state.baseOverlay.matchPreview = matchPreview;
    state.baseOverlay.manualBaseEdges = manualBaseEdges || emptyManualBaseEdges();
    state.baseOverlay.traversalOverrides = traversalOverrides || emptyTraversalOverrides();
    state.baseOverlay.overlay = overlay || emptyBaseOverlay();
    try {
      const directionResponse = await fetch("/api/cw-base-overlay-v2");
      if (directionResponse.ok) {
        const directionPayload = await directionResponse.json();
        state.directionReview.loaded = true;
        state.directionReview.source = directionPayload.source;
        state.directionReview.readOnly = directionPayload.readOnly;
        state.directionReview.profile = directionPayload.profile;
        state.directionReview.overlay = directionPayload.overlay;
      }
    } catch {
      state.directionReview.loaded = false;
    }
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

async function refreshDirectionReviewEvidence() {
  if (state.baseOverlay.loading || state.baseOverlay.recalculating || state.directionReview.busy) return;
  if (state.directionReview.profile !== "staged-v2" || state.directionReview.readOnly) {
    throw new Error("Restart the editor with CW_OVERLAY_PROFILE=staged-v2 before refreshing V2 evidence.");
  }
  state.baseOverlay.recalculating = true;
  state.directionReview.busy = true;
  renderAll();
  setStatus("Rebuilding the graph, policy audit, and Direction Review proposal...");
  try {
    const response = await fetch("/api/cw-base-overlay-v2/refresh-evidence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `Direction Review refresh failed: ${response.status}`);
    }
    state.baseOverlay.loaded = false;
    state.baseOverlay.graphEdges = null;
    state.baseOverlay.matchSummary = null;
    state.baseOverlay.matchPreview = null;
    state.directionReview.overlay = payload.overlay;
    state.directionReview.source = payload.source || "staged";
    state.directionReview.readOnly = false;
    invalidateBaseOverlayDerivedCache();
    await loadBaseOverlayData();
    const preserved = payload.preserved || {};
    const sourceRebaseText = Number(preserved.rebasedSourceChanges || 0) > 0
      ? ` ${Number(preserved.rebasedSourceChanges)} source-changed segment${Number(preserved.rebasedSourceChanges) === 1 ? "" : "s"} rebased without losing mappings.`
      : "";
    setStatus(
      `Direction Review evidence refreshed. ${Number(preserved.publishedAsDraft || 0)} accepted alignment${Number(preserved.publishedAsDraft || 0) === 1 ? "" : "s"} moved back to reviewed drafts; ${Number(preserved.drafts || 0)} working draft${Number(preserved.drafts || 0) === 1 ? "" : "s"} and ${Number(preserved.unavailable || 0)} unavailable decision${Number(preserved.unavailable || 0) === 1 ? "" : "s"} preserved.${sourceRebaseText}`,
    );
  } finally {
    state.directionReview.busy = false;
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

async function saveSelectedManualEdgeDirectionPolicy() {
  const index = state.baseOverlay.selectedManualEdgeIndex;
  const manualFeature = selectedManualBaseEdge();
  const graphFeature = selectedBaseGraphEdge();
  const feature = manualFeature || graphFeature;
  if (!feature) {
    throw new Error("Select a base edge before reviewing its direction policy.");
  }

  const forward = els.manualEdgeForward.value;
  const reverse = els.manualEdgeReverse.value;
  const forwardUnknown = forward === "unknown";
  const reverseUnknown = reverse === "unknown";
  if (forwardUnknown !== reverseUnknown) {
    throw new Error("Review both directions together, or leave both as Needs review.");
  }

  const reviewed = !forwardUnknown;
  const reviewer = els.manualEdgeReviewer.value.trim();
  const reviewedAt = els.manualEdgeReviewDate.value;
  const rationale = els.manualEdgeRationale.value.trim();
  const evidence = els.baseEdgeDirectionEvidence.value.trim();
  if (manualFeature && reviewed && (!reviewer || !reviewedAt || !rationale)) {
    throw new Error("Reviewed manual directions require a reviewer, review date, and evidence/rationale.");
  }

  if (graphFeature) {
    const properties = graphFeature.properties || {};
    const osmWayId = Number(properties.osmWayId);
    const sourceGeometryDigest = properties.sourceGeometryDigest;
    if (!Number.isInteger(osmWayId) || osmWayId <= 0 || !sourceGeometryDigest) {
      throw new Error("The selected OSM edge is missing stable source-way identity. Rebuild the graph first.");
    }
    if (!reviewer || !reviewedAt || !rationale || !evidence) {
      throw new Error("OSM direction overrides require reviewer, review date, rationale, and evidence reference.");
    }
    const current = state.baseOverlay.traversalOverrides || emptyTraversalOverrides();
    const record = {
      osmWayId,
      sourceGeometryDigest,
      states: { forward, reverse },
      rationale,
      evidence,
      reviewer,
      reviewedAt,
      updatedAt: new Date().toISOString(),
    };
    const overrides = [
      ...(current.overrides || []).filter((item) => Number(item.osmWayId) !== osmWayId),
      record,
    ].sort((left, right) => Number(left.osmWayId) - Number(right.osmWayId));
    const response = await fetch("/api/bicycle-traversal-overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...current, overrides }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `Traversal override save failed: ${response.status}`);
    }
    state.baseOverlay.traversalOverrides = payload.overrides;
    markBaseGraphStaleBecauseTraversalOverridesChanged();
    renderAll();
    setStatus(
      `Saved reviewed ${forward}/${reverse} override for OSM way ${osmWayId}. Rebuild before routing uses it.`,
    );
    return;
  }

  if (index < 0) {
    throw new Error("Select a manual base edge before saving its direction policy.");
  }

  const now = new Date().toISOString();
  const nextFeature = {
    ...feature,
    properties: {
      ...(feature.properties || {}),
      updatedAt: now,
      bicycleTraversal: reviewed
        ? { forward, reverse, reviewed: true, reviewer, reviewedAt, rationale, ...(evidence ? { evidence } : {}) }
        : { forward: "unknown", reverse: "unknown", reviewed: false },
    },
  };
  const features = [...manualBaseEdgeFeatures()];
  features[index] = nextFeature;
  state.baseOverlay.manualBaseEdges = { type: "FeatureCollection", features };
  await saveManualBaseEdges();
  renderAll();
  setStatus(
    reviewed
      ? `Saved reviewed ${forward}/${reverse} direction policy for ${manualBaseEdgeFeatureId(nextFeature)}. Recalculate the graph before V2 revalidation.`
      : `Cleared direction review for ${manualBaseEdgeFeatureId(nextFeature)}. The edge remains blocked until reviewed and rebuilt.`,
  );
}

async function clearSelectedOsmDirectionOverride() {
  const feature = selectedBaseGraphEdge();
  const osmWayId = Number(feature?.properties?.osmWayId);
  if (!feature || !Number.isInteger(osmWayId) || osmWayId <= 0) {
    throw new Error("Select an OSM base edge with a reviewed override.");
  }
  const current = state.baseOverlay.traversalOverrides || emptyTraversalOverrides();
  if (!(current.overrides || []).some((item) => Number(item.osmWayId) === osmWayId)) {
    throw new Error(`OSM way ${osmWayId} has no reviewed override.`);
  }
  const response = await fetch("/api/bicycle-traversal-overrides", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...current,
      overrides: current.overrides.filter((item) => Number(item.osmWayId) !== osmWayId),
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `Traversal override removal failed: ${response.status}`);
  }
  state.baseOverlay.traversalOverrides = payload.overrides;
  markBaseGraphStaleBecauseTraversalOverridesChanged();
  renderAll();
  setStatus(`Removed the reviewed override for OSM way ${osmWayId}. Rebuild to restore OSM-derived policy.`);
}

async function saveBaseEdgeState() {
  const response = await fetch("/api/base-edge-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      manualBaseEdges: state.baseOverlay.manualBaseEdges || emptyManualBaseEdges(),
      overlay: state.baseOverlay.overlay || emptyBaseOverlay(),
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `Base edge state save failed: ${response.status}`);
  }
  state.baseOverlay.manualBaseEdges = payload.manualBaseEdges || state.baseOverlay.manualBaseEdges;
  state.baseOverlay.overlay = payload.overlay || state.baseOverlay.overlay;
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
  for (const item of validation.placeholderSegmentNames || []) {
    issues.push(`Placeholder segment name: ${item.segment || item.name || item.id || JSON.stringify(item)}`);
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
      placeholderSegmentNames: validation.placeholderSegmentNames || [],
      activeSplitNumberedNames: validation.activeSplitNumberedNames || [],
      routeCompatibilityWarnings: validation.routeCompatibilityWarnings?.length ?? 0,
      routeCompatibilityWarningDetails: validation.routeCompatibilityWarnings || [],
      baseRoutingWarnings: validation.baseRouting?.warnings || [],
      baseRoutingBlockers: validation.baseRouting?.blockers || [],
      connectedComponents: validation.topology?.connectedComponents,
      orphanEndpointCount: validation.topology?.orphanEndpointCount,
      elevation: {
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
      body: JSON.stringify({}),
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
      setStatus("Build complete. Ready to promote.");
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
  els.directionReviewAToB.addEventListener("click", () => {
    state.directionReview.alignmentKey = "aToB";
    state.directionReview.editing = false;
    renderAll();
  });
  els.directionReviewBToA.addEventListener("click", () => {
    state.directionReview.alignmentKey = "bToA";
    state.directionReview.editing = false;
    renderAll();
  });
  if (!els.directionReviewDate.value) {
    els.directionReviewDate.value = new Date().toISOString().slice(0, 10);
  }
  els.directionReviewApplyMigration.addEventListener("click", () =>
    applySelectedDirectionMigration().catch(showError),
  );
  els.directionReviewApplySymmetricBatch.addEventListener("click", () =>
    applySymmetricDirectionMigrationBatch().catch(showError),
  );
  els.directionReviewEdit.addEventListener("click", () => toggleDirectionReviewEditing().catch(showError));
  els.directionReviewRevalidate.addEventListener("click", () =>
    runDirectionReviewAction("revalidate").catch(showError),
  );
  els.directionReviewUseReverse.addEventListener("click", () =>
    runDirectionReviewAction("derive-reverse").catch(showError),
  );
  els.directionReviewAccept.addEventListener("click", () => acceptSelectedDirectionReview().catch(showError));
  els.directionReviewClearDraft.addEventListener("click", () => {
    state.directionReview.editing = false;
    runDirectionReviewAction("clear-draft").catch(showError);
  });
  els.directionReviewMarkUnavailable.addEventListener("click", () =>
    markSelectedDirectionUnavailable().catch(showError),
  );
  els.workspaceRoundabouts.addEventListener("click", () => setWorkspaceMode("roundabouts").catch(showError));
  els.workspaceCrossings.addEventListener("click", () => setWorkspaceMode("crossings").catch(showError));
  els.workspaceVideoSync.addEventListener("click", () => setWorkspaceMode("video-sync").catch(showError));
  els.workspaceRouteCatalog.addEventListener("click", () => setWorkspaceMode("route-catalog").catch(showError));
  els.roundaboutsFilter.addEventListener("change", () => {
    state.roundabouts.filter = els.roundaboutsFilter.value;
    const first = roundaboutFilteredItems()[0];
    state.roundabouts.selectedId = first?.candidate?.id || null;
    updateRoundaboutLayerFilters();
    renderRoundaboutsPanel();
  });
  els.crossingsFilter.addEventListener("change", () => {
    state.crossings.filter = els.crossingsFilter.value;
    const first = crossingFilteredItems()[0];
    state.crossings.selectedId = first?.candidate?.id || null;
    updateCrossingLayerFilters();
    renderCrossingsPanel();
  });
  els.crossingsSaveManual.addEventListener("click", () => saveManualCrossing().catch(showError));
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
  els.findBaseEdge.addEventListener("click", findBaseEdgeById);
  els.baseEdgeSearch.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    findBaseEdgeById();
  });
  els.cloneBaseGraphEdge.addEventListener("click", () => cloneSelectedBaseGraphEdgeAsManual().catch(showError));
  els.deleteManualBaseEdge.addEventListener("click", () => deleteSelectedManualBaseEdge().catch(showError));
  els.splitManualBaseEdge.addEventListener("click", () => splitSelectedManualBaseEdge().catch(showError));
  if (!els.manualEdgeReviewDate.value) {
    els.manualEdgeReviewDate.value = new Date().toISOString().slice(0, 10);
  }
  els.saveManualEdgeDirection.addEventListener("click", () =>
    saveSelectedManualEdgeDirectionPolicy().catch(showError),
  );
  els.clearOsmDirectionOverride.addEventListener("click", () =>
    clearSelectedOsmDirectionOverride().catch(showError),
  );
  els.toggleBaseOneWayDirections.addEventListener("change", () => {
    state.baseOverlay.showOneWayDirections = els.toggleBaseOneWayDirections.checked;
    renderAll();
    setStatus(
      state.baseOverlay.showOneWayDirections
        ? "Showing every direction-limited base edge. Arrowheads point in the permitted travel direction."
        : "One-way direction layer hidden.",
    );
  });
  els.recalculateOsmGraph.addEventListener("click", () => recalculateOsmGraph().catch(showError));
  els.refreshDirectionReview.addEventListener("click", () =>
    refreshDirectionReviewEvidence().catch(showError),
  );
  els.connectorColorMode.addEventListener("change", () => setConnectorColorMode(els.connectorColorMode.value));
  for (const key of CONNECTOR_CLASS_KEYS) {
    const numInput = document.getElementById(`connector-class-${key}`);
    const excludedInput = document.getElementById(`connector-class-${key}-excluded`);
    numInput.addEventListener("change", () => setConnectorClassMultiplier(key, numInput.value));
    excludedInput.addEventListener("change", () =>
      setConnectorClassExcluded(key, excludedInput.checked, numInput.value),
    );
  }
  for (const key of CONNECTOR_ACCESS_KEYS) {
    const numInput = document.getElementById(`connector-access-${key}`);
    const excludedInput = document.getElementById(`connector-access-${key}-excluded`);
    numInput.addEventListener("change", () => setConnectorAccessValue(key, numInput.value));
    excludedInput.addEventListener("change", () =>
      setConnectorAccessExcluded(key, excludedInput.checked, numInput.value),
    );
  }
  els.connectorUphillWeight.addEventListener("change", () => setConnectorUphillWeight(els.connectorUphillWeight.value));
  els.connectorSnap.addEventListener("change", () => setConnectorSnap(els.connectorSnap.value));
  els.connectorResetStrategy.addEventListener("click", resetConnectorStrategy);
  els.connectorCopyStrategy.addEventListener("click", () => copyConnectorStrategyJson().catch(showError));
  els.connectorTargetRoute.addEventListener("change", () => onConnectorTargetRouteChange().catch(showError));
  els.connectorPickTarget.addEventListener("click", toggleConnectorPickTarget);
  els.connectorRun.addEventListener("click", () => runConnectorFrequency().catch(showError));
  els.connectorClearRun.addEventListener("click", clearConnectorRun);
  els.connectorHideUnreachable.addEventListener("change", () => {
    state.connectorLens.hideUnreachable = els.connectorHideUnreachable.checked;
    renderConnectorOrigins(state.connectorLens.lastFrequencyResult?.origins || []);
  });
  els.connectorLabelMode.addEventListener("change", () =>
    setConnectorLabelMode(els.connectorLabelMode.checked),
  );
  els.connectorCalibLoad.addEventListener("click", () => loadConnectorLabels().catch(showError));
  els.connectorThresholdTooFarRadius.addEventListener("change", () =>
    setConnectorThresholdNumber(
      "tooFarRadiusMeters",
      els.connectorThresholdTooFarRadius.value,
      "Too-far radius",
    ),
  );
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

  for (const layerId of ["crossing-actions-layer", "crossing-arrows-layer", "crossing-corridors-layer"]) {
    map.on("click", layerId, (event) => {
      if (state.workspaceMode !== "crossings") return;
      const crossingId = String(event.features?.[0]?.properties?.id || "");
      const item = crossingReviewItems().find((entry) => entry.candidate?.id === crossingId);
      if (!item) return;
      state.crossings.selectedId = crossingId;
      renderCrossingsPanel();
      fitCrossingCandidate(item.candidate);
    });
    map.on("mouseenter", layerId, () => {
      if (state.workspaceMode === "crossings") map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", layerId, () => {
      if (state.workspaceMode === "crossings") map.getCanvas().style.cursor = "";
    });
  }

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
    if (connectorLensFeaturesAtPoint(event.point).length > 0) return;
    if (state.workspaceMode === "base" && connectorLensRunActive()) {
      state.suppressNextSegmentClick = true;
      window.setTimeout(() => {
        state.suppressNextSegmentClick = false;
      }, 0);
      setStatus("Connector run is active. Clear the run to select base edges.");
      return;
    }
    state.suppressNextSegmentClick = true;
    window.setTimeout(() => {
      state.suppressNextSegmentClick = false;
    }, 0);
    if (isComposingNewSegmentEdges()) {
      toggleEdgeInCompose(event.features[0]);
      return;
    }
    if (state.workspaceMode === "overlay" && state.directionReview.editing) {
      toggleDirectionReviewBaseEdge(event.features[0]).catch(showError);
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

  map.on("click", "connector-origins-layer", (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    const { lat, lng } = feature.properties || {};
    if (typeof lat !== "number" || typeof lng !== "number") return;
    const origin = { lat, lng };
    if (state.connectorLens.labeling.active) {
      selectConnectorLabelOrigin(origin);
    }
    runConnectorSingle(origin).catch(showError);
  });
  map.on("mouseenter", "connector-origins-layer", () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", "connector-origins-layer", () => {
    map.getCanvas().style.cursor = state.mode === "insert" || state.mode === "draw" ? "crosshair" : "";
  });

  map.on("click", "manual-base-edges-hit-layer", (event) => {
    if (state.mode !== "select" && !isComposingNewSegmentEdges()) return;
    if (cwOverlayNetworkFeaturesAtPoint(event.point).length > 0) return;
    if (connectorLensFeaturesAtPoint(event.point).length > 0) return;
    if (isComposingNewSegmentEdges()) {
      state.suppressNextSegmentClick = true;
      window.setTimeout(() => {
        state.suppressNextSegmentClick = false;
      }, 0);
      toggleEdgeInCompose(event.features[0]);
      return;
    }
    if (state.workspaceMode === "overlay" && state.directionReview.editing) {
      state.suppressNextSegmentClick = true;
      window.setTimeout(() => {
        state.suppressNextSegmentClick = false;
      }, 0);
      toggleDirectionReviewBaseEdge(event.features[0]).catch(showError);
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
    if (state.workspaceMode === "base" && connectorLensRunActive()) {
      state.suppressNextSegmentClick = true;
      window.setTimeout(() => {
        state.suppressNextSegmentClick = false;
      }, 0);
      setStatus("Connector run is active. Clear the run to select base edges.");
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
    if (state.connectorLens.pickingTarget) {
      handleConnectorPickTargetClick(event);
      return;
    }
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

    if (handleConnectorLabelKey(event)) return;

    if (state.workspaceMode === "video-sync") {
      if (handleVideoSyncKey(event)) return;
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
  if (!map.getSource("base-graph-one-way-directions")) {
    map.addSource("base-graph-one-way-directions", {
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
  if (!map.getSource("selected-base-edge-permitted-direction")) {
    map.addSource("selected-base-edge-permitted-direction", {
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
  if (!map.getSource("direction-review-alignments")) {
    map.addSource("direction-review-alignments", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getSource("direction-review-endpoints")) {
    map.addSource("direction-review-endpoints", {
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
  if (!map.getSource("manual-base-edge-endpoints")) {
    map.addSource("manual-base-edge-endpoints", {
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
  if (!map.getSource("connector-usage")) {
    map.addSource("connector-usage", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getSource("connector-origins")) {
    map.addSource("connector-origins", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getSource("connector-single-path")) {
    map.addSource("connector-single-path", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  for (const sourceId of ["roundabout-lines", "roundabout-points", "roundabout-corridors"]) {
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, { type: "geojson", data: EMPTY_FEATURE_COLLECTION });
    }
  }
  for (const sourceId of ["crossing-corridors", "crossing-context", "crossing-actions", "crossing-arrows"]) {
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, { type: "geojson", data: EMPTY_FEATURE_COLLECTION });
    }
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
          [
            "coalesce",
            ["get", "connectorLensColor"],
            ["get", "graphColor"],
            BASE_GRAPH_FALLBACK_LINE_COLOR,
          ],
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

  if (!map.getLayer("selected-base-graph-edge-direction-arrows")) {
    map.addLayer({
      id: "selected-base-graph-edge-direction-arrows",
      type: "symbol",
      source: "selected-base-edge-permitted-direction",
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 90,
        "text-field": "▶",
        "text-size": 13,
        "text-rotation-alignment": "map",
        "text-keep-upright": false,
        "text-allow-overlap": true,
        visibility: "none",
      },
      paint: {
        "text-color": "#111827",
        "text-halo-color": "#f2c94c",
        "text-halo-width": 2,
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

  if (!map.getLayer("direction-review-alignments-layer")) {
    map.addLayer({
      id: "direction-review-alignments-layer",
      type: "line",
      source: "direction-review-alignments",
      layout: {
        "line-join": "round",
        "line-cap": "round",
        visibility: "none",
      },
      paint: {
        "line-color": [
          "match",
          ["get", "traversalState"],
          "prohibited",
          "#dc2626",
          "unknown",
          "#b91c1c",
          "conditional",
          "#d97706",
          ["case", ["==", ["get", "alignmentKey"], "aToB"], "#0f766e", "#7c3aed"],
        ],
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          ["case", ["get", "selected"], 6, 3.5],
          14,
          ["case", ["get", "selected"], 10, 6],
          16,
          ["case", ["get", "selected"], 14, 9],
        ],
        "line-opacity": ["case", ["get", "selected"], 0.96, 0.42],
      },
    });
  }

  if (!map.getLayer("direction-review-hover-layer")) {
    map.addLayer({
      id: "direction-review-hover-layer",
      type: "line",
      source: "direction-review-alignments",
      filter: ["==", ["get", "hovered"], true],
      layout: { "line-join": "round", "line-cap": "round", visibility: "none" },
      paint: {
        "line-color": "#f97316",
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 9, 14, 14, 16, 18],
        "line-opacity": 1,
      },
    });
  }

  if (!map.getLayer("direction-review-arrows-layer")) {
    map.addLayer({
      id: "direction-review-arrows-layer",
      type: "symbol",
      source: "direction-review-alignments",
      filter: ["==", ["get", "selected"], true],
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 90,
        "text-field": "▶",
        "text-size": 13,
        "text-rotation-alignment": "map",
        "text-keep-upright": false,
        "text-allow-overlap": true,
        visibility: "none",
      },
      paint: {
        "text-color": "#ffffff",
        "text-halo-color": [
          "case",
          ["==", ["get", "traversalState"], "allowed"],
          ["case", ["==", ["get", "alignmentKey"], "aToB"], "#0f766e", "#7c3aed"],
          "#b91c1c",
        ],
        "text-halo-width": 2,
      },
    });
  }

  if (!map.getLayer("direction-review-sequence-layer")) {
    map.addLayer({
      id: "direction-review-sequence-layer",
      type: "symbol",
      source: "direction-review-alignments",
      filter: ["==", ["get", "selected"], true],
      layout: {
        "symbol-placement": "line-center",
        "text-field": ["to-string", ["get", "sequenceNumber"]],
        "text-size": 10,
        "text-allow-overlap": false,
        visibility: "none",
      },
      paint: {
        "text-color": "#0f172a",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    });
  }

  if (!map.getLayer("direction-review-endpoints-layer")) {
    map.addLayer({
      id: "direction-review-endpoints-layer",
      type: "circle",
      source: "direction-review-endpoints",
      layout: { visibility: "none" },
      paint: {
        "circle-radius": 10,
        "circle-color": "#f8fafc",
        "circle-stroke-color": "#0f172a",
        "circle-stroke-width": 2,
      },
    });
  }

  if (!map.getLayer("direction-review-endpoint-labels")) {
    map.addLayer({
      id: "direction-review-endpoint-labels",
      type: "symbol",
      source: "direction-review-endpoints",
      layout: {
        "text-field": ["get", "label"],
        "text-size": 12,
        "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
        "text-allow-overlap": true,
        visibility: "none",
      },
      paint: { "text-color": "#0f172a" },
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

  if (!map.getLayer("manual-base-edge-endpoints-layer")) {
    map.addLayer({
      id: "manual-base-edge-endpoints-layer",
      type: "circle",
      source: "manual-base-edge-endpoints",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 6, 14, 8, 16, 10],
        "circle-color": ["match", ["get", "label"], "A", "#0f766e", "#7c3aed"],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });
  }

  if (!map.getLayer("manual-base-edge-endpoint-labels")) {
    map.addLayer({
      id: "manual-base-edge-endpoint-labels",
      type: "symbol",
      source: "manual-base-edge-endpoints",
      layout: {
        "text-field": ["get", "label"],
        "text-size": 11,
        "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#ffffff",
        "text-halo-color": "#111827",
        "text-halo-width": 0.4,
      },
    });
  }

  if (!map.getLayer("base-graph-one-way-directions-layer")) {
    map.addLayer({
      id: "base-graph-one-way-directions-layer",
      type: "line",
      source: "base-graph-one-way-directions",
      minzoom: 7,
      layout: {
        "line-join": "round",
        "line-cap": "round",
        visibility: "none",
      },
      paint: {
        "line-color": [
          "match",
          ["get", "directionLayerClass"],
          "confirmed-one-way",
          "#c2410c",
          "#a16207",
        ],
        "line-width": ["interpolate", ["linear"], ["zoom"], 7, 2, 11, 4, 15, 7],
        "line-opacity": 0.92,
      },
    });
  }

  if (!map.getLayer("base-graph-one-way-direction-arrows")) {
    map.addLayer({
      id: "base-graph-one-way-direction-arrows",
      type: "symbol",
      source: "base-graph-one-way-directions",
      minzoom: 9.5,
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 75,
        "text-field": "▶",
        "text-size": ["interpolate", ["linear"], ["zoom"], 9.5, 11, 14, 15, 17, 18],
        "text-rotation-alignment": "map",
        "text-keep-upright": false,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
        visibility: "none",
      },
      paint: {
        "text-color": "#ffffff",
        "text-halo-color": [
          "match",
          ["get", "directionLayerClass"],
          "confirmed-one-way",
          "#c2410c",
          "#a16207",
        ],
        "text-halo-width": 2.5,
      },
    });
  }

  for (const layerId of [
    "selected-base-graph-edge-layer",
    "selected-base-graph-edge-direction-arrows",
    "selected-manual-base-edge",
    "manual-base-edge-endpoints-layer",
    "manual-base-edge-endpoint-labels",
  ]) {
    if (map.getLayer(layerId)) map.moveLayer(layerId);
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
        // POI types render a rasterized emoji image; warnings render their SVG.
        // Emoji are not rendered via text-field — astral glyphs crash Mapbox.
        "icon-image": ["get", "icon"],
        "icon-size": ["case", ["get", "selected"], 1.12, 0.95],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: {
        "icon-opacity": ["case", ["get", "selected"], 1, 0.72],
      },
    });
  }

  if (!map.getLayer("connector-usage-layer")) {
    map.addLayer({
      id: "connector-usage-layer",
      type: "line",
      source: "connector-usage",
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-width": ["interpolate", ["linear"], ["get", "count"], 1, 1, 20, 8],
        "line-color": [
          "interpolate",
          ["linear"],
          ["get", "count"],
          1,
          "#c7e9c0",
          5,
          "#74c476",
          20,
          "#238b45",
        ],
        "line-opacity": 0.85,
      },
    });
  }

  if (!map.getLayer("connector-single-path-casing-layer")) {
    map.addLayer({
      id: "connector-single-path-casing-layer",
      type: "line",
      source: "connector-single-path",
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": "#0f172a",
        "line-width": 10,
        "line-opacity": 0.9,
      },
    });
  }

  if (!map.getLayer("connector-single-path-layer")) {
    map.addLayer({
      id: "connector-single-path-layer",
      type: "line",
      source: "connector-single-path",
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": "#facc15",
        "line-width": 6,
        "line-opacity": 1,
      },
    });
  }

  if (!map.getLayer("connector-origins-layer")) {
    map.addLayer({
      id: "connector-origins-layer",
      type: "circle",
      source: "connector-origins",
      paint: {
        "circle-radius": ["case", ["==", ["get", "selected"], true], 7, 5],
        "circle-color": [
          "match",
          ["get", "status"],
          "ok",
          "#1b7837",
          "snap-ineligible",
          "#f59e0b",
          "#dc2626",
        ],
        "circle-stroke-color": [
          "match",
          ["get", "verdict"],
          "valid",
          CONNECTOR_VERDICT_COLORS.valid,
          "unacceptable",
          CONNECTOR_VERDICT_COLORS.unacceptable,
          "borderline",
          CONNECTOR_VERDICT_COLORS.borderline,
          ["case", ["==", ["get", "selected"], true], "#facc15", "#1f2a2e"],
        ],
        "circle-stroke-width": [
          "case",
          ["!=", ["get", "verdict"], ""],
          3,
          ["==", ["get", "selected"], true],
          3,
          1,
        ],
      },
    });
  }

  const reviewColor = [
    "match",
    ["get", "state"],
    "accepted", "#15803d",
    "rejected", "#b91c1c",
    "stale", "#d97706",
    "staleAccepted", "#d97706",
    "staleRejected", "#d97706",
    "invalid", "#c026d3",
    "manual", "#2563eb",
    "#f59e0b",
  ];
  if (!map.getLayer("roundabout-corridors-layer")) {
    map.addLayer({
      id: "roundabout-corridors-layer",
      type: "fill",
      source: "roundabout-corridors",
      layout: { visibility: "none" },
      paint: { "fill-color": reviewColor, "fill-opacity": 0.16 },
    });
  }
  if (!map.getLayer("roundabout-lines-layer")) {
    map.addLayer({
      id: "roundabout-lines-corridor-layer",
      type: "line",
      source: "roundabout-lines",
      layout: { "line-join": "round", "line-cap": "round", visibility: "none" },
      paint: {
        "line-color": reviewColor,
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 9, 14, 18, 17, 34],
        "line-opacity": 0.16,
      },
    });
    map.addLayer({
      id: "roundabout-lines-layer",
      type: "line",
      source: "roundabout-lines",
      layout: { "line-join": "round", "line-cap": "round", visibility: "none" },
      paint: {
        "line-color": reviewColor,
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 5, 14, 9, 17, 15],
        "line-opacity": 0.88,
      },
    });
  }
  if (!map.getLayer("roundabout-points-layer")) {
    map.addLayer({
      id: "roundabout-points-layer",
      type: "circle",
      source: "roundabout-points",
      layout: { visibility: "none" },
      paint: {
        "circle-radius": 7,
        "circle-color": reviewColor,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });
  }
  if (!map.getLayer("crossing-corridors-layer")) {
    map.addLayer({
      id: "crossing-corridors-layer",
      type: "line",
      source: "crossing-corridors",
      layout: { "line-cap": "round", visibility: "none" },
      paint: { "line-color": "#7c3aed", "line-width": 8, "line-opacity": 0.45 },
    });
  }
  if (!map.getLayer("crossing-context-layer")) {
    map.addLayer({
      id: "crossing-context-layer",
      type: "line",
      source: "crossing-context",
      layout: { "line-join": "round", "line-cap": "round", visibility: "none" },
      paint: { "line-color": reviewColor, "line-width": 5, "line-opacity": 0.7, "line-dasharray": [1, 1.3] },
    });
  }
  if (!map.getLayer("crossing-actions-layer")) {
    map.addLayer({
      id: "crossing-actions-layer",
      type: "line",
      source: "crossing-actions",
      layout: { "line-join": "round", "line-cap": "round", visibility: "none" },
      paint: { "line-color": reviewColor, "line-width": 9, "line-opacity": 0.92 },
    });
  }
  if (!map.getLayer("crossing-arrows-layer")) {
    map.addLayer({
      id: "crossing-arrows-layer",
      type: "symbol",
      source: "crossing-arrows",
      layout: {
        visibility: "none",
        "symbol-placement": "line",
        "symbol-spacing": 45,
        "text-field": "▶",
        "text-size": 18,
        "text-rotation-alignment": "map",
        "text-keep-upright": false,
        "text-allow-overlap": true,
      },
      paint: { "text-color": reviewColor, "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
    });
  }
  updateRoundaboutSources();
  updateCrossingSources();
}

// ============================================================
// Video Sync mode
// ============================================================

const VS_ROUTE_SOURCE_ID = "vs-route-source";
const VS_ROUTE_LAYER_ID = "vs-route-layer";
const VS_KF_SOURCE_ID = "vs-kf-source";
const VS_KF_LAYER_ID = "vs-kf-layer";
const VS_GHOST_SOURCE_ID = "vs-ghost-source";
const VS_GHOST_LAYER_ID = "vs-ghost-layer";
const VS_SNAP_THRESHOLD_M = 80;
const VS_TICK_MS = 100;
const VS_PLAYBACK_BEHAVIOR_LEGACY = "legacy";
const VS_PLAYBACK_BEHAVIOR_NONE = "none";
const VS_PLAYBACK_BEHAVIORS = new Set([
  VS_PLAYBACK_BEHAVIOR_LEGACY,
  VS_PLAYBACK_BEHAVIOR_NONE,
]);

function vsNormalizePlaybackBehavior(value) {
  return VS_PLAYBACK_BEHAVIORS.has(value)
    ? value
    : VS_PLAYBACK_BEHAVIOR_LEGACY;
}

const videoSyncState = {
  slug: null,
  routePolyline: null,   // [{lat, lng}, ...]
  keyframes: [],         // [{t, lat, lon}, ...] (lon to match JSON convention)
  youtubeId: null,
  player: null,
  videoDuration: 0,
  playbackBehavior: VS_PLAYBACK_BEHAVIOR_LEGACY,
  selectedIndex: -1,
  sync: null,            // createVideoSync() interpolator, rebuilt on changes
  ticker: null,          // setInterval id for the live readout + ghost
};

const vsEls = {
  overlay: document.getElementById("vs-overlay"),
  title: document.getElementById("vs-overlay-title"),
  mapSlot: document.getElementById("vs-map-slot"),
  close: document.getElementById("vs-close"),
  slug: document.getElementById("vs-slug"),
  ytUrl: document.getElementById("vs-yt-url"),
  playbackBehavior: document.getElementById("vs-playback-behavior"),
  bootstrapFile: document.getElementById("vs-bootstrap-file"),
  bootstrapMaxError: document.getElementById("vs-bootstrap-max-error"),
  bootstrapSpeed: document.getElementById("vs-bootstrap-speed"),
  player: document.getElementById("vs-player"),
  keyframesList: document.getElementById("vs-keyframes"),
  saveDraft: document.getElementById("vs-save-draft"),
  promote: document.getElementById("vs-promote"),
  status: document.getElementById("vs-status"),
  timeNow: document.getElementById("vs-time-now"),
  playPause: document.getElementById("vs-playpause"),
  seekInput: document.getElementById("vs-seek-input"),
  seekGo: document.getElementById("vs-seek-go"),
  nudge: document.getElementById("vs-nudge"),
};

function vsSetStatus(msg) {
  if (vsEls.status) vsEls.status.textContent = msg || "";
}

function vsSetBusy(busy) {
  if (vsEls.saveDraft) vsEls.saveDraft.disabled = busy;
  if (vsEls.promote) vsEls.promote.disabled = busy;
  vsUpdateBootstrapControls(busy);
}

function vsCanBootstrapFromGps() {
  const hasRoute = videoSyncState.routePolyline && videoSyncState.routePolyline.length >= 2;
  const hasVideo = (
    videoSyncState.youtubeId ||
    vsExtractYouTubeId(vsEls.ytUrl?.value || "")
  ) && videoSyncState.videoDuration > 0;
  return Boolean(hasRoute && hasVideo);
}

function vsUpdateBootstrapControls(forceDisabled = false) {
  const disabled = forceDisabled || !vsCanBootstrapFromGps();
  for (const el of [
    vsEls.bootstrapFile,
    vsEls.bootstrapMaxError,
    vsEls.bootstrapSpeed,
  ]) {
    if (el) el.disabled = disabled;
  }
}

function vsReadNumberInput(input, fallback, predicate) {
  const value = Number(input?.value);
  return Number.isFinite(value) && predicate(value) ? value : fallback;
}

function vsFormatFraction(value) {
  return Number.isFinite(value) ? value.toFixed(3) : "n/a";
}

function vsSetPlaybackBehavior(value) {
  videoSyncState.playbackBehavior = vsNormalizePlaybackBehavior(value);
  if (vsEls.playbackBehavior) {
    vsEls.playbackBehavior.value = videoSyncState.playbackBehavior;
  }
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
//
// `window` ({ afterFraction, beforeFraction }) constrains the snap to the leg
// consistent with the surrounding keyframes' progress, so an out-and-back spur
// (where a point projects equally onto the outbound and return leg) snaps to the
// forward leg instead of jumping backward.
function vsSnapToPolyline(point, polyline, window = {}) {
  if (!polyline || polyline.length < 2) return null;
  const cumulative = buildCumulativeDistances(polyline);
  const snap = snapPointToRouteWithinWindow(point, polyline, cumulative, window);
  const snappedPoint = pointAtFraction(polyline, cumulative, snap.fraction);
  return {
    lat: snappedPoint.lat,
    lng: snappedPoint.lng,
    fraction: snap.fraction,
    distanceMeters: snap.distanceMeters,
  };
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
  videoSyncState.videoDuration = 0;
  vsUpdateBootstrapControls();
  const YT = await vsLoadYouTubeIframeApi();
  vsEls.player.innerHTML = "";
  if (videoSyncState.player) {
    try { videoSyncState.player.destroy(); } catch {}
  }
  videoSyncState.player = new YT.Player(vsEls.player, {
    videoId: youtubeId,
    width: "100%",
    height: "100%",
    playerVars: { enablejsapi: 1, rel: 0 },
    events: {
      onReady: () => {
        const dur = videoSyncState.player.getDuration?.();
        if (typeof dur === "number" && dur > 0) {
          videoSyncState.videoDuration = dur;
          vsRebuildSync();
          vsUpdateBootstrapControls();
        }
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
  for (const id of [VS_GHOST_LAYER_ID, VS_KF_LAYER_ID, VS_ROUTE_LAYER_ID]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of [VS_GHOST_SOURCE_ID, VS_KF_SOURCE_ID, VS_ROUTE_SOURCE_ID]) {
    if (map.getSource(id)) map.removeSource(id);
  }
}

// Rebuild the shared interpolator whenever keyframes / route / duration change.
// Needs >= 2 keyframes and a known duration; otherwise the ghost is hidden.
function vsRebuildSync() {
  const { routePolyline, keyframes, videoDuration } = videoSyncState;
  if (routePolyline && routePolyline.length >= 2 && keyframes.length >= 2 && videoDuration > 0) {
    try {
      videoSyncState.sync = createVideoSync({
        keyframes,
        videoDuration,
        routeGeometry: routePolyline,
      });
    } catch {
      videoSyncState.sync = null;
    }
  } else {
    videoSyncState.sync = null;
  }
  vsRenderGhost();
  vsUpdateBootstrapControls();
}

// Move the blue "predicted position" ring to where the current keyframes say the
// rider is at time t. Hidden when there is no usable interpolator.
function vsRenderGhost(t) {
  if (!map) return;
  let features = [];
  if (videoSyncState.sync) {
    const time = typeof t === "number"
      ? t
      : (videoSyncState.player?.getCurrentTime?.() || 0);
    const pos = videoSyncState.sync.timeToPosition(time);
    if (pos) {
      features = [{
        type: "Feature",
        geometry: { type: "Point", coordinates: [pos.lng, pos.lat] },
        properties: {},
      }];
    }
  }
  const data = { type: "FeatureCollection", features };
  if (!map.getSource(VS_GHOST_SOURCE_ID)) {
    map.addSource(VS_GHOST_SOURCE_ID, { type: "geojson", data });
    map.addLayer({
      id: VS_GHOST_LAYER_ID,
      type: "circle",
      source: VS_GHOST_SOURCE_ID,
      paint: {
        "circle-radius": 8,
        "circle-color": "rgba(21, 101, 192, 0.25)",
        "circle-stroke-color": "#1565c0",
        "circle-stroke-width": 3,
      },
    });
  } else {
    map.getSource(VS_GHOST_SOURCE_ID).setData(data);
  }
}

// --- Overlay show/hide + single-map relocation ----------------------------

// Move the one editor map into the overlay's right pane and show the overlay.
function vsActivateOverlay() {
  const mapContainer = document.getElementById("map");
  if (mapContainer && vsEls.mapSlot && mapContainer.parentNode !== vsEls.mapSlot) {
    vsEls.mapSlot.appendChild(mapContainer);
  }
  if (vsEls.overlay) vsEls.overlay.hidden = false;
  if (vsEls.title) {
    vsEls.title.textContent = videoSyncState.slug
      ? `Video Sync — ${videoSyncState.slug}`
      : "Video Sync";
  }
  // Mapbox must recompute its canvas size after the container moves / shows.
  // Double rAF so the overlay layout has flushed before Mapbox measures.
  vsResizeMapSoon();
  vsStartTicker();
}

// Move the map back to its home column, hide the overlay, stop the ticker.
function vsDeactivate() {
  vsStopTicker();
  const mapContainer = document.getElementById("map");
  const home = document.querySelector(".map-area");
  if (mapContainer && home && mapContainer.parentNode !== home) {
    home.prepend(mapContainer);
  }
  if (vsEls.overlay) vsEls.overlay.hidden = true;
  vsResizeMapSoon();
}

// Resize the Mapbox canvas after the next two frames, once layout has flushed.
function vsResizeMapSoon() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { try { map.resize(); } catch {} });
  });
}

// --- Live readout + ghost ticker ------------------------------------------

function vsStartTicker() {
  vsStopTicker();
  videoSyncState.ticker = setInterval(vsTick, VS_TICK_MS);
}

function vsStopTicker() {
  if (videoSyncState.ticker) {
    clearInterval(videoSyncState.ticker);
    videoSyncState.ticker = null;
  }
}

function vsTick() {
  const cur = videoSyncState.player?.getCurrentTime?.();
  if (typeof cur !== "number") return;
  vsUpdateReadout(cur);
  vsRenderGhost(cur);
  vsUpdatePlayPauseLabel();
}

function vsUpdateReadout(seconds) {
  if (!vsEls.timeNow) return;
  vsEls.timeNow.textContent =
    `${vsFormatTime(seconds)} / ${vsFormatTime(videoSyncState.videoDuration)}`;
}

// --- Transport controls ----------------------------------------------------

function vsSeekTo(t) {
  const player = videoSyncState.player;
  if (!player?.seekTo) return;
  const dur = videoSyncState.videoDuration || player.getDuration?.() || 0;
  const clamped = dur > 0 ? Math.max(0, Math.min(dur, t)) : Math.max(0, t);
  player.seekTo(clamped, true);
  vsUpdateReadout(clamped);
  vsRenderGhost(clamped);
}

// Pause first so a nudge settles on an exact frame.
function vsSeekBy(delta) {
  const player = videoSyncState.player;
  if (!player?.getCurrentTime) return;
  player.pauseVideo?.();
  vsSeekTo((player.getCurrentTime() || 0) + delta);
}

function vsHandleSeekInput() {
  const t = vsParseTime(vsEls.seekInput.value);
  if (t == null) {
    vsSetStatus("Couldn't parse that time (try m:ss or seconds).");
    return;
  }
  vsSeekTo(t);
}

function vsTogglePlay() {
  const player = videoSyncState.player;
  if (!player?.getPlayerState) return;
  if (player.getPlayerState() === 1) player.pauseVideo?.();
  else player.playVideo?.();
  vsUpdatePlayPauseLabel();
}

function vsUpdatePlayPauseLabel() {
  if (!vsEls.playPause) return;
  const playing = videoSyncState.player?.getPlayerState?.() === 1;
  vsEls.playPause.textContent = playing ? "⏸" : "▶︎";
}

// Returns true when the key was handled (video-sync mode only).
function handleVideoSyncKey(event) {
  switch (event.key) {
    case "ArrowRight": vsSeekBy(event.shiftKey ? 5 : 1); break;
    case "ArrowLeft": vsSeekBy(event.shiftKey ? -5 : -1); break;
    case ".": vsSeekBy(0.1); break;
    case ",": vsSeekBy(-0.1); break;
    case " ":
    case "Spacebar": vsTogglePlay(); break;
    default: return false;
  }
  event.preventDefault();
  return true;
}

// Render keyframes as a horizontal chip strip in the overlay footer.
function vsRenderKeyframesList() {
  vsEls.keyframesList.innerHTML = "";
  videoSyncState.keyframes.forEach((kf, i) => {
    const li = document.createElement("li");
    li.title = `${kf.lat.toFixed(5)}, ${kf.lon.toFixed(5)}`;
    if (i === videoSyncState.selectedIndex) li.classList.add("selected");
    const time = document.createElement("span");
    time.className = "vs-kf-time";
    time.textContent = vsFormatTime(kf.t);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "vs-kf-del";
    del.textContent = "✕";
    del.setAttribute("aria-label", "Delete keyframe");
    del.addEventListener("click", (event) => {
      event.stopPropagation();
      videoSyncState.keyframes.splice(i, 1);
      if (videoSyncState.selectedIndex === i) videoSyncState.selectedIndex = -1;
      vsRebuildSync();
      vsRenderKeyframesList();
      vsRenderKeyframesLayer();
    });
    li.addEventListener("click", () => {
      videoSyncState.selectedIndex = i;
      if (videoSyncState.player?.seekTo) videoSyncState.player.seekTo(kf.t, true);
      vsRenderKeyframesList();
      vsRenderKeyframesLayer();
    });
    li.append(time, del);
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
  const t = videoSyncState.player.getCurrentTime();
  // Replace any existing keyframe at same t (within 50ms), else insert sorted.
  const filtered = videoSyncState.keyframes.filter((kf) => Math.abs(kf.t - t) > 0.05);
  // Constrain the snap to the leg consistent with the neighbouring keyframes'
  // progress, so out-and-back spurs don't snap the return leg onto the overlapping
  // outbound leg (which would send the animation backward).
  const prevKf = filtered
    .filter((kf) => kf.t < t && Number.isFinite(kf.fraction))
    .reduce((best, kf) => (!best || kf.t > best.t ? kf : best), null);
  const nextKf = filtered
    .filter((kf) => kf.t > t && Number.isFinite(kf.fraction))
    .reduce((best, kf) => (!best || kf.t < best.t ? kf : best), null);
  const snap = vsSnapToPolyline(
    { lat: event.lngLat.lat, lng: event.lngLat.lng },
    videoSyncState.routePolyline,
    { afterFraction: prevKf?.fraction ?? null, beforeFraction: nextKf?.fraction ?? null },
  );
  if (!snap || snap.distanceMeters > VS_SNAP_THRESHOLD_M) {
    vsSetStatus(`Click too far from route (${snap?.distanceMeters?.toFixed(0)}m).`);
    return;
  }
  filtered.push({ t, lat: snap.lat, lon: snap.lng, fraction: snap.fraction });
  filtered.sort((a, b) => a.t - b.t);
  videoSyncState.keyframes = filtered;
  videoSyncState.selectedIndex = filtered.findIndex((kf) => kf.t === t);
  vsRebuildSync();
  vsRenderKeyframesList();
  vsRenderKeyframesLayer();
  vsSetStatus(`Added keyframe at ${vsFormatTime(t)}.`);
}

async function vsHandleBootstrapFile(file) {
  if (!file) return;
  if (!videoSyncState.routePolyline || videoSyncState.routePolyline.length < 2) {
    vsSetStatus("Pick a route first.");
    return;
  }
  const youtubeId = videoSyncState.youtubeId || vsExtractYouTubeId(vsEls.ytUrl.value);
  const videoDuration =
    videoSyncState.player?.getDuration?.() || videoSyncState.videoDuration;
  if (!youtubeId || !videoDuration) {
    vsSetStatus("Load a YouTube URL first (need its duration).");
    return;
  }

  const maxErrorMeters = vsReadNumberInput(
    vsEls.bootstrapMaxError,
    10,
    (value) => value >= 0,
  );
  const speedFactor = vsReadNumberInput(
    vsEls.bootstrapSpeed,
    5,
    (value) => value > 0,
  );

  let csvText;
  try {
    csvText = await file.text();
  } catch (err) {
    vsSetStatus(`Couldn't read file: ${err.message}`);
    return;
  }

  let result;
  try {
    result = bootstrapKeyframesFromGps({
      csvText,
      routeGeometry: videoSyncState.routePolyline,
      videoDuration,
      speedFactor,
      maxErrorMeters,
    });
  } catch (err) {
    vsSetStatus(`Bootstrap failed: ${err.message}`);
    return;
  }

  if (result.keyframes.length < 2) {
    vsSetStatus(
      `Bootstrap produced ${result.keyframes.length} keyframes; check the GPS file matches this route.`,
    );
    return;
  }
  if (
    videoSyncState.keyframes.length > 0 &&
    !window.confirm(
      `Replace ${videoSyncState.keyframes.length} existing keyframes with ${result.keyframes.length} from GPS?`,
    )
  ) {
    vsSetStatus("Bootstrap cancelled.");
    return;
  }

  videoSyncState.videoDuration = videoDuration;
  videoSyncState.keyframes = result.keyframes;
  videoSyncState.selectedIndex = -1;
  vsRebuildSync();
  vsRenderKeyframesList();
  vsRenderKeyframesLayer();

  const s = result.stats;
  vsSetStatus(
    `Bootstrapped ${s.keyframesOut} keyframes from ${s.fixesRead} fixes ` +
    `(${s.offRouteDropped} off-route, ${s.beyondDurationDropped} beyond end, ` +
    `${s.continuityDropped} continuity drops, ${s.continuityCorrections} continuity fixes; fractions ` +
    `${vsFormatFraction(s.startFraction)} -> ${vsFormatFraction(s.endFraction)}).`,
  );
}

async function vsLoadRouteForSlug(slug) {
  vsSetStatus(`Loading route ${slug}…`);
  const r = await fetch(`/api/video-keyframes/${slug}/route-polyline`);
  if (!r.ok) {
    const err = await r.text();
    vsSetStatus(`Route load failed: ${err}`);
    videoSyncState.routePolyline = null;
    vsRenderRouteLayer();
    vsRebuildSync();
    return;
  }
  const polyline = await r.json();
  videoSyncState.routePolyline = polyline;
  vsRenderRouteLayer();
  vsRebuildSync();
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
    videoSyncState.youtubeId = null;
    videoSyncState.videoDuration = 0;
    vsSetPlaybackBehavior(VS_PLAYBACK_BEHAVIOR_LEGACY);
    vsUpdateBootstrapControls();
    return;
  }
  const draft = await r.json();
  videoSyncState.keyframes = (draft.keyframes || []).slice().sort((a, b) => a.t - b.t);
  vsSetPlaybackBehavior(draft.playbackBehavior);
  vsRenderKeyframesList();
  vsRenderKeyframesLayer();
  if (draft.youtubeId) {
    vsEls.ytUrl.value = `https://youtube.com/watch?v=${draft.youtubeId}`;
    vsLoadVideo(draft.youtubeId).catch((err) => vsSetStatus(`YT load failed: ${err.message}`));
  }
  if (typeof draft.videoDuration === "number") {
    videoSyncState.videoDuration = draft.videoDuration;
    vsUpdateBootstrapControls();
  }
  vsRebuildSync();
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

function vsBuildDraftPayload() {
  const slug = videoSyncState.slug;
  const youtubeId = videoSyncState.youtubeId || vsExtractYouTubeId(vsEls.ytUrl.value);
  const videoDuration = videoSyncState.player?.getDuration?.() || videoSyncState.videoDuration;
  if (!slug || !youtubeId || !videoDuration) {
    throw new Error("Need a slug, YouTube URL, and loaded video to save.");
  }
  return {
    slug,
    payload: {
      version: 1,
      youtubeId,
      videoDuration,
      playbackBehavior: videoSyncState.playbackBehavior,
      keyframes: videoSyncState.keyframes.slice().sort((a, b) => a.t - b.t),
    },
  };
}

async function vsSaveDraft({ updateStatus = true } = {}) {
  const { slug, payload } = vsBuildDraftPayload();
  if (updateStatus) vsSetStatus("Saving draft…");
  const r = await fetch(`/api/video-keyframes/${slug}/draft`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(result?.error || r.statusText);
  }
  if (updateStatus) vsSetStatus(`Draft saved (${payload.keyframes.length} keyframes).`);
  return { slug, payload, result };
}

// Wire static event handlers once at startup.
vsEls.slug.addEventListener("change", () => vsOnSlugChange().catch(showError));
vsEls.playbackBehavior.addEventListener("change", (event) => {
  vsSetPlaybackBehavior(event.target.value);
  vsSetStatus(`Playback behavior: ${videoSyncState.playbackBehavior}.`);
});
vsEls.ytUrl.addEventListener("change", (e) => {
  const id = vsExtractYouTubeId(e.target.value);
  if (id) {
    vsLoadVideo(id).catch((err) => vsSetStatus(`YT load failed: ${err.message}`));
  } else {
    videoSyncState.youtubeId = null;
    videoSyncState.videoDuration = 0;
    vsRebuildSync();
    vsUpdateBootstrapControls();
  }
});
vsEls.bootstrapFile.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  vsHandleBootstrapFile(file).catch((err) => vsSetStatus(`Bootstrap failed: ${err.message}`));
  event.target.value = "";
});
vsEls.saveDraft.addEventListener("click", async () => {
  try {
    vsSetBusy(true);
    await vsSaveDraft();
  } catch (err) {
    vsSetStatus(`Save failed: ${err.message}`);
  } finally {
    vsSetBusy(false);
  }
});
vsEls.promote.addEventListener("click", async () => {
  try {
    vsSetBusy(true);
    const { slug, payload } = await vsSaveDraft({ updateStatus: false });
    vsSetStatus(`Draft saved. Promoting ${payload.keyframes.length} keyframes…`);
    const r = await fetch(`/api/video-keyframes/${slug}/promote`, { method: "POST" });
    const result = await r.json().catch(() => ({}));
    if (!r.ok) {
      vsSetStatus(`Promote failed: ${result?.error || r.statusText}`);
      return;
    }
    await vsLoadExistingDraft(slug);
    vsSetStatus(`Promoted ${payload.keyframes.length} keyframes.`);
  } catch (err) {
    vsSetStatus(`Promote failed: ${err.message}`);
  } finally {
    vsSetBusy(false);
  }
});
vsEls.close.addEventListener("click", () => setWorkspaceMode("segments").catch(showError));
vsEls.seekGo.addEventListener("click", vsHandleSeekInput);
vsEls.seekInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    vsHandleSeekInput();
  }
});
vsEls.playPause.addEventListener("click", vsTogglePlay);
vsEls.nudge.addEventListener("click", (event) => {
  const btn = event.target instanceof HTMLElement ? event.target.closest("[data-step]") : null;
  if (!btn) return;
  const step = Number(btn.dataset.step);
  if (Number.isFinite(step)) vsSeekBy(step);
});

map.on("style.load", () => {
  restoreEditorLayersAfterStyleChange().catch(showError);
  // setStyle() drops custom sources/layers; re-add the video-sync ones and
  // resize the canvas if the overlay is currently open.
  if (state.workspaceMode === "video-sync") {
    vsRenderRouteLayer();
    vsRenderKeyframesLayer();
    vsRenderGhost();
    requestAnimationFrame(() => { try { map.resize(); } catch {} });
  }
});

// ============================================================
// Route Catalog mode
// ============================================================

const routeCatalogState = {
  loaded: null,
  draft: null,
  selectedSlug: null,
  places: [],
  imageCandidates: new Map(),
};

const ROUTE_MAP_CAPTURE = {
  width: 1200,
  height: 800,
  style: "mapbox://styles/mapbox/outdoors-v12",
  routeSourceId: "rc-capture-route",
  routeHaloLayerId: "rc-capture-route-halo",
  routeLineLayerId: "rc-capture-route-line",
  pointsSourceId: "rc-capture-points",
  pointsLayerId: "rc-capture-points",
};

const routeMapCaptureState = {
  map: null,
  host: document.getElementById("rc-map-capture-host"),
  busy: false,
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

function rcEntryIssues(entry) {
  const errors = [];
  const warnings = [];
  if (!entry?.slug || !/^[a-z][a-z0-9-]*$/.test(entry.slug)) errors.push("Invalid slug");
  if (!entry?.name) errors.push("Missing name");
  if (!entry?.summary) errors.push("Missing summary");
  if (!entry?.route) errors.push("Missing route token");
  if (!String(entry?.intro || "").trim()) warnings.push("Missing intro");
  if (!entry?.description) warnings.push("Missing long description");
  if (!entry?.routeMapImage?.thumbnail && !entry?.routeMapImage?.photo) {
    warnings.push("Missing route map image");
  } else if (entry?.routeMapImage?.source?.type !== "mapbox-screenshot") {
    warnings.push("Route map image has no capture metadata");
  }
  if (!rcEntryDisplayImage(entry)) warnings.push("Missing representative image");
  if (!entry?.start) warnings.push("Missing start point");
  if ((entry?.story?.enabled || entry?.featured) && !entry?.featured) {
    warnings.push("Story flag set; confirm a route story module exists");
  }
  return { errors, warnings };
}

function rcEntryDisplayImage(entry) {
  if (entry?.heroImage?.thumbnail || entry?.heroImage?.photo) return entry.heroImage;
  const startImage = Array.isArray(entry?.start?.images) ? entry.start.images[0] : null;
  if (startImage?.thumbnail || startImage?.photo) return startImage;
  const endImage = Array.isArray(entry?.end?.images) ? entry.end.images[0] : null;
  if (endImage?.thumbnail || endImage?.photo) return endImage;
  return null;
}

function extractRouteTokenInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, window.location.href);
    const route = url.searchParams.get("route");
    if (route) return route;
  } catch {}
  const match = raw.match(/[?&]route=([^&#\s]+)/);
  if (match) return decodeURIComponent(match[1]);
  return raw;
}

function rcImageCandidateCacheKey(entry) {
  const route = String(entry?.route || "").trim();
  if (!route) return "";
  return `${String(entry?.slug || "").trim()}\n${route}`;
}

function rcEnsureImageCandidates(entry) {
  const key = rcImageCandidateCacheKey(entry);
  if (!key) return { status: "empty", candidates: [] };
  const cached = routeCatalogState.imageCandidates.get(key);
  if (cached) return cached;

  const loading = { status: "loading", candidates: [] };
  routeCatalogState.imageCandidates.set(key, loading);
  fetch("/api/route-catalog/image-candidates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug: entry?.slug || null, route: entry?.route || "" }),
  })
    .then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      routeCatalogState.imageCandidates.set(key, {
        status: "ready",
        candidates: Array.isArray(body.candidates) ? body.candidates : [],
      });
    })
    .catch((error) => {
      routeCatalogState.imageCandidates.set(key, {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        candidates: [],
      });
    })
    .finally(() => {
      if (rcImageCandidateCacheKey(rcSelectedEntry()) === key) rcRenderDetail();
    });
  return loading;
}

function rcClearImageCandidateCache(entry) {
  const key = rcImageCandidateCacheKey(entry);
  if (key) routeCatalogState.imageCandidates.delete(key);
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
    const issues = rcEntryIssues(entry);
    if (issues.errors.length > 0) li.classList.add("invalid");
    const main = document.createElement("span");
    main.textContent = [
      entry.name || entry.slug,
      entry.featured || entry.story?.enabled ? "⭐" : "",
      issues.warnings.length > 0 ? "⚠" : "",
    ].filter(Boolean).join(" ");
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
  rcEls.detail.appendChild(rcReadinessPanel(entry));
  const fields = [
    { key: "slug", label: "Slug" },
    { key: "name", label: "Name" },
    { key: "summary", label: "Summary" },
    { key: "intro", label: "Intro", textarea: true },
    { key: "description", label: "Description", textarea: true },
    { key: "route", label: "Route token / share URL", routeToken: true },
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
    if (f.routeToken) {
      input.placeholder = "Paste a route token or a full /?route=... share URL";
      input.addEventListener("change", (e) => {
        rcClearImageCandidateCache(entry);
        entry[f.key] = extractRouteTokenInput(e.target.value);
        e.target.value = entry[f.key];
        rcRenderList();
        rcRenderDetail();
      });
    } else {
      input.addEventListener("input", (e) => {
        entry[f.key] = e.target.value;
      });
    }
    row.append(label, input);
    if (f.textarea && ["intro", "description", "notes"].includes(f.key)) {
      const fieldPreview = document.createElement("div");
      fieldPreview.className = "rich-text-preview";
      row.appendChild(fieldPreview);
      const updateFieldPreview = () => renderRichTextPreview(fieldPreview, input.value);
      input.addEventListener("input", updateFieldPreview);
      updateFieldPreview();
    }
    rcEls.detail.appendChild(row);
  }
  rcEls.detail.appendChild(rcRouteMapImageSection(entry));
  rcEls.detail.appendChild(rcHeroImageSection(entry));
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

  for (const ep of [
    { key: "start", label: "Start point 🚩 (first stop in the list)" },
    { key: "end", label: "End point 🏁 (optional — omit for cyclic routes)" },
  ]) {
    rcEls.detail.appendChild(rcEndpointSection(entry, ep.key, ep.label));
  }

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

function rcReadinessPanel(entry) {
  const panel = document.createElement("div");
  panel.className = "rc-readiness";
  const issues = rcEntryIssues(entry);
  const title = document.createElement("strong");
  title.textContent =
    issues.errors.length > 0
      ? `Blocking issues (${issues.errors.length})`
      : issues.warnings.length > 0
        ? `Warnings (${issues.warnings.length})`
        : "Ready to promote";
  panel.appendChild(title);
  const list = document.createElement("ul");
  const rows = [
    ...issues.errors.map((text) => ({ text, type: "error" })),
    ...issues.warnings.map((text) => ({ text, type: "warn" })),
  ];
  if (rows.length === 0) {
    const li = document.createElement("li");
    li.textContent = "Required route catalog fields are present.";
    list.appendChild(li);
  } else {
    for (const row of rows) {
      const li = document.createElement("li");
      li.className = `rc-readiness__${row.type}`;
      li.textContent = row.text;
      list.appendChild(li);
    }
  }
  panel.appendChild(list);
  return panel;
}

function rcRouteMapImageSection(entry) {
  const section = document.createElement("div");
  section.className = "rc-endpoint rc-route-map-image";

  const heading = document.createElement("div");
  heading.className = "rc-endpoint-heading";
  heading.textContent = "Route map image";
  section.appendChild(heading);

  const image = entry.routeMapImage;
  if (image?.thumbnail || image?.photo) {
    const img = document.createElement("img");
    img.className = "rc-route-map-image__preview";
    img.src = dataImageSrc(image.thumbnail || image.photo);
    img.alt = image.alt || `Route map ${entry.name || entry.slug}`;
    section.appendChild(img);
  }

  const source = image?.source || {};
  const note = document.createElement("p");
  note.className = image ? "rc-help" : "rc-help rc-help--warn";
  if (!image) {
    note.textContent = "No generated route map image yet.";
  } else if (source.type === "mapbox-screenshot") {
    note.textContent = [
      "Generated from Mapbox screenshot",
      source.mapVersion ? `map ${source.mapVersion}` : "",
      source.generatedAt ? new Date(source.generatedAt).toLocaleString() : "",
    ].filter(Boolean).join(" · ");
  } else {
    note.textContent = "Image exists, but capture metadata is missing.";
  }
  section.appendChild(note);

  const actions = document.createElement("div");
  actions.className = "rc-route-map-image__actions";

  const generate = document.createElement("button");
  generate.type = "button";
  generate.className = "secondary-button";
  generate.textContent = image ? "Regenerate map image" : "Generate map image";
  generate.disabled = routeMapCaptureState.busy || !entry.route;
  generate.addEventListener("click", async () => {
    try {
      await rcGenerateRouteMapImage(entry);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      rcSetStatus(`Map image failed: ${message}`);
      showAlert("Route map image failed", message);
    }
  });
  actions.appendChild(generate);

  if (image) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary-button danger";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      delete entry.routeMapImage;
      rcRenderList();
      rcRenderDetail();
    });
    actions.appendChild(remove);
  }

  section.appendChild(actions);
  return section;
}

async function rcGenerateRouteMapImage(entry) {
  if (!entry?.route) throw new Error("Route token is required.");
  if (routeMapCaptureState.busy) return;
  routeMapCaptureState.busy = true;
  rcSetStatus(`Generating map image for ${entry.slug}…`);
  rcRenderDetail();
  try {
    const preview = await rcLoadRoutePreview(entry);
    const dataUrl = await rcCaptureRouteMap(preview.geometry);
    const res = await fetch("/api/route-catalog/map-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: entry.slug,
        route: entry.route,
        data: dataUrl,
        alt: `מפת מסלול ${entry.name || entry.slug}`,
        style: ROUTE_MAP_CAPTURE.style,
        width: ROUTE_MAP_CAPTURE.width,
        height: ROUTE_MAP_CAPTURE.height,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new Error(body.error || `upload failed (${res.status})`);
    entry.routeMapImage = body.image;
    rcSetStatus(`Map image generated for ${entry.slug}. Save draft to persist it.`);
  } finally {
    routeMapCaptureState.busy = false;
    rcRenderList();
    rcRenderDetail();
  }
}

async function rcLoadRoutePreview(entry) {
  const res = await fetch("/api/route-catalog/route-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug: entry.slug, route: entry.route }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) throw new Error(body.error || `preview failed (${res.status})`);
  if (!Array.isArray(body.geometry) || body.geometry.length < 2) {
    throw new Error("Route preview has no geometry.");
  }
  return body;
}

async function rcCaptureRouteMap(geometry) {
  const captureMap = await rcEnsureCaptureMap();
  await rcRenderCaptureRoute(captureMap, geometry);
  await rcWaitForMapEvent(captureMap, "idle", 8000);
  const canvas = captureMap.getCanvas();
  return rcCanvasToDataUrl(canvas);
}

async function rcEnsureCaptureMap() {
  if (!routeMapCaptureState.host) {
    throw new Error("Route map capture host is missing.");
  }
  if (routeMapCaptureState.map) return routeMapCaptureState.map;
  routeMapCaptureState.host.style.width = `${ROUTE_MAP_CAPTURE.width}px`;
  routeMapCaptureState.host.style.height = `${ROUTE_MAP_CAPTURE.height}px`;
  const captureMap = new mapboxgl.Map({
    container: routeMapCaptureState.host,
    style: ROUTE_MAP_CAPTURE.style,
    center: [35.617497, 33.183536],
    zoom: 10,
    interactive: false,
    preserveDrawingBuffer: true,
    attributionControl: false,
  });
  routeMapCaptureState.map = captureMap;
  await rcWaitForMapEvent(captureMap, "style.load", 12000);
  return captureMap;
}

async function rcRenderCaptureRoute(captureMap, geometry) {
  captureMap.resize();
  const coordinates = geometry
    .map((point) => {
      if (Array.isArray(point) && point.length >= 2) return [Number(point[0]), Number(point[1])];
      return [Number(point?.lng), Number(point?.lat)];
    })
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
  if (coordinates.length < 2) throw new Error("Route geometry is too short.");

  for (const layerId of [
    ROUTE_MAP_CAPTURE.routeLineLayerId,
    ROUTE_MAP_CAPTURE.routeHaloLayerId,
    ROUTE_MAP_CAPTURE.pointsLayerId,
  ]) {
    if (captureMap.getLayer(layerId)) captureMap.removeLayer(layerId);
  }
  for (const sourceId of [
    ROUTE_MAP_CAPTURE.routeSourceId,
    ROUTE_MAP_CAPTURE.pointsSourceId,
  ]) {
    if (captureMap.getSource(sourceId)) captureMap.removeSource(sourceId);
  }

  captureMap.addSource(ROUTE_MAP_CAPTURE.routeSourceId, {
    type: "geojson",
    data: {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates },
    },
  });
  captureMap.addLayer({
    id: ROUTE_MAP_CAPTURE.routeHaloLayerId,
    type: "line",
    source: ROUTE_MAP_CAPTURE.routeSourceId,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#ffffff",
      "line-width": 15,
      "line-opacity": 0.9,
    },
  });
  captureMap.addLayer({
    id: ROUTE_MAP_CAPTURE.routeLineLayerId,
    type: "line",
    source: ROUTE_MAP_CAPTURE.routeSourceId,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#245943",
      "line-width": 8,
      "line-opacity": 0.96,
    },
  });

  const start = coordinates[0];
  const end = coordinates[coordinates.length - 1];
  captureMap.addSource(ROUTE_MAP_CAPTURE.pointsSourceId, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { role: "start" },
          geometry: { type: "Point", coordinates: start },
        },
        {
          type: "Feature",
          properties: { role: "end" },
          geometry: { type: "Point", coordinates: end },
        },
      ],
    },
  });
  captureMap.addLayer({
    id: ROUTE_MAP_CAPTURE.pointsLayerId,
    type: "circle",
    source: ROUTE_MAP_CAPTURE.pointsSourceId,
    paint: {
      "circle-color": ["match", ["get", "role"], "start", "#245943", "#c97b3a"],
      "circle-radius": 9,
      "circle-stroke-width": 4,
      "circle-stroke-color": "#ffffff",
    },
  });

  const bounds = new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]);
  coordinates.forEach((coord) => bounds.extend(coord));
  captureMap.fitBounds(bounds, {
    padding: 90,
    duration: 0,
    maxZoom: 14,
  });
}

function rcWaitForMapEvent(captureMap, eventName, timeoutMs) {
  return new Promise((resolveReady, rejectReady) => {
    let timeoutId = null;
    const cleanup = () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      captureMap.off(eventName, onEvent);
      captureMap.off("error", onError);
    };
    const onEvent = () => {
      cleanup();
      resolveReady();
    };
    const onError = (event) => {
      cleanup();
      rejectReady(event?.error || new Error(`Mapbox ${eventName} failed`));
    };
    timeoutId = window.setTimeout(() => {
      cleanup();
      rejectReady(new Error(`Timed out waiting for map ${eventName}`));
    }, timeoutMs);
    captureMap.once(eventName, onEvent);
    captureMap.once("error", onError);
  });
}

function rcCanvasToDataUrl(canvas) {
  return new Promise((resolveDataUrl, rejectDataUrl) => {
    if (!canvas) {
      rejectDataUrl(new Error("Map canvas is missing."));
      return;
    }
    if (canvas.toBlob) {
      canvas.toBlob((blob) => {
        if (!blob) {
          rejectDataUrl(new Error("Map canvas capture failed."));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolveDataUrl(reader.result);
        reader.onerror = () => rejectDataUrl(reader.error || new Error("Blob read failed"));
        reader.readAsDataURL(blob);
      }, "image/png");
      return;
    }
    try {
      resolveDataUrl(canvas.toDataURL("image/png"));
    } catch (error) {
      rejectDataUrl(error);
    }
  });
}

function rcHeroImageSection(entry) {
  const section = document.createElement("div");
  section.className = "rc-endpoint";
  const heading = document.createElement("div");
  heading.className = "rc-endpoint-heading";
  heading.textContent = "Representative image";
  section.appendChild(heading);

  const image = entry.heroImage;
  if (image?.thumbnail || image?.photo) {
    const strip = document.createElement("div");
    strip.className = "rc-endpoint-images";
    const fig = document.createElement("div");
    const img = document.createElement("img");
    img.src = dataImageSrc(image.thumbnail || image.photo);
    img.alt = "";
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "secondary-button danger";
    rm.textContent = "Remove";
    rm.addEventListener("click", () => {
      delete entry.heroImage;
      rcRenderList();
      rcRenderDetail();
    });
    fig.append(img, rm);
    strip.appendChild(fig);
    section.appendChild(strip);
  }

  const altRow = document.createElement("div");
  altRow.className = "rc-row";
  const altLabel = document.createElement("label");
  altLabel.textContent = "Alt text:";
  const altInput = document.createElement("input");
  altInput.type = "text";
  altInput.value = entry.heroImage?.alt || "";
  altInput.addEventListener("input", (event) => {
    if (entry.heroImage?.photo || entry.heroImage?.thumbnail) {
      entry.heroImage = {
        ...entry.heroImage,
        alt: event.target.value,
      };
    }
  });
  altRow.append(altLabel, altInput);
  section.appendChild(altRow);

  const upRow = document.createElement("div");
  upRow.className = "rc-row";
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  const status = document.createElement("span");
  status.className = "data-image-status";
  fileInput.addEventListener("change", async () => {
    const file = (fileInput.files || [])[0];
    if (!file) return;
    status.textContent = "Uploading…";
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const res = await fetch("/api/poi-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: `${entry.slug}-hero`, data: dataUrl }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(body.error || `upload failed (${res.status})`);
      entry.heroImage = {
        photo: body.photo,
        thumbnail: body.thumbnail,
        alt: entry.heroImage?.alt || entry.name || "",
      };
      rcRenderList();
      rcRenderDetail();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      fileInput.value = "";
    }
  });
  upRow.append(fileInput, status);
  section.appendChild(upRow);
  section.appendChild(rcSegmentImagePicker(entry));

  const fallback = rcEntryDisplayImage(entry);
  if (!entry.heroImage && fallback) {
    const note = document.createElement("p");
    note.className = "rc-help";
    note.textContent = "No route-level image set. The public card can fall back to start/end images.";
    section.appendChild(note);
  }

  return section;
}

function rcSegmentImagePicker(entry) {
  const picker = document.createElement("div");
  picker.className = "rc-segment-image-picker";

  const header = document.createElement("div");
  header.className = "rc-segment-image-picker__header";
  const title = document.createElement("strong");
  title.textContent = "Images from included segments";
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "secondary-button";
  refresh.textContent = "Refresh";
  refresh.disabled = !entry.route;
  refresh.addEventListener("click", () => {
    rcClearImageCandidateCache(entry);
    rcRenderDetail();
  });
  header.append(title, refresh);
  picker.appendChild(header);

  if (!entry.route) {
    const note = document.createElement("p");
    note.className = "rc-help";
    note.textContent = "Add a route token to list images from the route's included segments.";
    picker.appendChild(note);
    return picker;
  }

  const state = rcEnsureImageCandidates(entry);
  if (state.status === "loading") {
    const note = document.createElement("p");
    note.className = "rc-help";
    note.textContent = "Loading segment images…";
    picker.appendChild(note);
    return picker;
  }
  if (state.status === "error") {
    const note = document.createElement("p");
    note.className = "rc-help rc-help--error";
    note.textContent = `Could not load segment images: ${state.error}`;
    picker.appendChild(note);
    return picker;
  }

  const candidates = Array.isArray(state.candidates) ? state.candidates : [];
  if (candidates.length === 0) {
    const note = document.createElement("p");
    note.className = "rc-help";
    note.textContent = "No reusable images found on this route's included segments.";
    picker.appendChild(note);
    return picker;
  }

  const grid = document.createElement("div");
  grid.className = "rc-segment-image-grid";
  const currentPhoto = entry.heroImage?.photo || "";
  const currentThumb = entry.heroImage?.thumbnail || "";
  candidates.forEach((candidate) => {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.className = "rc-segment-image-choice";
    const isCurrent =
      (currentPhoto && currentPhoto === candidate.photo) ||
      (currentThumb && currentThumb === candidate.thumbnail);
    if (isCurrent) choice.classList.add("selected");
    choice.title = candidate.segmentName || candidate.label || "";
    choice.addEventListener("click", () => {
      entry.heroImage = {
        photo: candidate.photo,
        thumbnail: candidate.thumbnail || candidate.photo,
        alt: entry.heroImage?.alt || candidate.alt || candidate.label || entry.name || "",
      };
      rcRenderList();
      rcRenderDetail();
    });

    const img = document.createElement("img");
    img.src = dataImageSrc(candidate.thumbnail || candidate.photo);
    img.alt = "";
    const meta = document.createElement("span");
    meta.className = "rc-segment-image-choice__meta";
    meta.textContent = candidate.label || candidate.segmentName || "Segment image";
    const segment = document.createElement("small");
    segment.textContent = candidate.segmentName || "";
    choice.append(img, meta, segment);
    grid.appendChild(choice);
  });
  picker.appendChild(grid);
  return picker;
}

// Editor sub-form for a route start/end point: name, description, and a single
// uploaded image (reusing the POI image pipeline). Location is derived from the
// route geometry at render time, so it is not edited here.
function rcEndpointSection(entry, key, label) {
  const section = document.createElement("div");
  section.className = "rc-endpoint";

  const heading = document.createElement("div");
  heading.className = "rc-endpoint-heading";
  heading.textContent = label;
  section.appendChild(heading);

  const point = entry[key] && typeof entry[key] === "object" ? entry[key] : null;
  const ensure = () =>
    (entry[key] = entry[key] && typeof entry[key] === "object"
      ? entry[key]
      : { name: "", description: "", images: [] });

  const nameRow = document.createElement("div");
  nameRow.className = "rc-row";
  const nameLabel = document.createElement("label");
  nameLabel.textContent = "Name:";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = point?.name ?? "";
  nameInput.addEventListener("input", (e) => {
    ensure().name = e.target.value;
  });
  nameRow.append(nameLabel, nameInput);
  section.appendChild(nameRow);

  const descRow = document.createElement("div");
  descRow.className = "rc-row";
  const descLabel = document.createElement("label");
  descLabel.textContent = "Description:";
  const descInput = document.createElement("textarea");
  descInput.value = point?.description ?? "";
  descInput.addEventListener("input", (e) => {
    ensure().description = e.target.value;
  });
  descRow.append(descLabel, descInput);
  section.appendChild(descRow);

  const descPreview = document.createElement("div");
  descPreview.className = "rich-text-preview";
  descRow.appendChild(descPreview);
  const updateDescPreview = () => renderRichTextPreview(descPreview, descInput.value);
  descInput.addEventListener("input", updateDescPreview);
  updateDescPreview();

  const images = Array.isArray(point?.images) ? point.images : [];
  if (images.length > 0) {
    const strip = document.createElement("div");
    strip.className = "rc-endpoint-images";
    images.forEach((image, i) => {
      const fig = document.createElement("div");
      const img = document.createElement("img");
      img.src = dataImageSrc(image.thumbnail || image.photo);
      img.alt = "";
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "secondary-button danger";
      rm.textContent = "Remove";
      rm.addEventListener("click", () => {
        const ep = entry[key];
        if (!ep) return;
        ep.images = (ep.images || []).filter((_, j) => j !== i);
        if (ep.images.length === 0 && !ep.name && !ep.description) delete entry[key];
        rcRenderDetail();
      });
      fig.append(img, rm);
      strip.appendChild(fig);
    });
    section.appendChild(strip);
  }

  const upRow = document.createElement("div");
  upRow.className = "rc-row";
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  const status = document.createElement("span");
  status.className = "data-image-status";
  fileInput.addEventListener("change", async () => {
    const file = (fileInput.files || [])[0];
    if (!file) return;
    status.textContent = "Uploading…";
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const res = await fetch("/api/poi-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: `${entry.slug}-${key}`, data: dataUrl }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(body.error || `upload failed (${res.status})`);
      const ep = ensure();
      ep.images = [...(ep.images || []), { photo: body.photo, thumbnail: body.thumbnail }];
      rcRenderDetail();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      fileInput.value = "";
    }
  });
  upRow.append(fileInput, status);
  section.appendChild(upRow);

  return section;
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
  if (!r.ok) {
    const message = result.error || r.statusText;
    rcSetStatus(`Save failed: ${message}`);
    showAlert("Route catalog save failed", message);
    throw markAlertShown(new Error(message));
  }
  rcSetStatus("Draft saved.");
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
    const message = result.error || r.statusText;
    rcSetStatus(`Recompute failed: ${message}`);
    showAlert("Route catalog recompute failed", message);
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
  if (!r.ok) {
    const message = result.error || r.statusText;
    rcSetStatus(`Promote failed: ${message}`);
    showAlert("Route catalog promote failed", message);
    return;
  }
  const snapErrs = result.snapshots?.errors ?? [];
  let message;
  if (snapErrs.length) {
    const slugs = snapErrs.map((e) => e?.slug ?? "?").join(", ");
    message = `Promoted (${result.entryCount} entries) — ${snapErrs.length} snapshot(s) FAILED: ${slugs}`;
    showAlert(
      "Route snapshot generation failed",
      `The catalog was promoted, but these route snapshots failed: ${slugs}`,
    );
  } else {
    message = `Promoted (${result.entryCount} entries).`;
  }
  await rcLoad();
  rcSetStatus(message);
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
    intro: "",
    description: "",
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
