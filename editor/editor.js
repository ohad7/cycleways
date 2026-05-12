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

const DATA_TYPES = [
  { value: "payment", label: "payment" },
  { value: "gate", label: "gate" },
  { value: "mud", label: "mud" },
  { value: "warning", label: "warning" },
  { value: "slope", label: "slope" },
  { value: "narrow", label: "narrow" },
  { value: "severe", label: "severe" },
];

const DATA_TYPE_COLORS = {
  payment: "#4a5783",
  gate: "#ff5722",
  mud: "#9d744d",
  warning: "#ff9800",
  slope: "#8e5b9a",
  narrow: "#d6568b",
  severe: "#ff675b",
};

const DATA_TYPE_ICONS = {
  payment: "bank-11",
  gate: "barrier-11",
  mud: "wetland-11",
  warning: "caution-11",
  slope: "mountain-11",
  narrow: "car-11",
  severe: "roadblock-11",
};

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
  selectedIndex: -1,
  selectedVertexIndex: -1,
  selectedDataIndex: -1,
  mode: "select",
  dirty: false,
  segmentsOpen: false,
  draggingVertex: false,
  draggingDataMarker: null,
  lastBuildReport: null,
  mapStyle: getInitialMapStyle(),
  draw: emptyDrawState(),
};

const els = {
  mapToolbar: document.querySelector(".map-toolbar"),
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
  fitSelected: document.getElementById("fit-selected"),
  drawDone: document.getElementById("draw-done"),
  drawCancel: document.getElementById("draw-cancel"),
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
  };
}

function isDrawing() {
  return state.mode === "draw" && state.draw.active;
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
  return Boolean(
    report &&
      !report.elevation?.skipElevation &&
      (report.elevation?.failures || 0) === 0 &&
      (report.validation?.activeSplitNumberedNames || []).length === 0,
  );
}

function promoteBlockerMessage(report) {
  if (!report) return "Run a successful full build before promoting";
  if (report.elevation?.skipElevation) return "Run a full build before promoting";
  if ((report.elevation?.failures || 0) > 0) return "Fix elevation failures before promoting";
  if ((report.validation?.activeSplitNumberedNames || []).length > 0) {
    return "Rename numbered split children before promoting";
  }
  return "Run a successful full build before promoting";
}

function updatePromoteButton() {
  els.promoteBuild.disabled = isDrawing() || state.dirty || !canPromoteReport(state.lastBuildReport);
  els.promoteBuild.title = isDrawing()
    ? "Finish or cancel drawing before promoting"
    : state.dirty
    ? "Save and run a fresh full build before promoting"
    : canPromoteReport(state.lastBuildReport)
      ? "Copy the latest build into the site files"
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

function mapFeatureCollection() {
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
  const sourceIndex = selectedSourceIndex();
  return sourceIndex >= 0 ? ["==", ["get", "sourceIndex"], sourceIndex] : ["==", ["get", "sourceIndex"], -1];
}

function vertexCollection() {
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
          icon: DATA_TYPE_ICONS[type] || "caution-11",
          information: marker.information || "",
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
  if (!isDrawing() || state.draw.type !== "extend") return null;
  const feature = state.source?.features[state.draw.sourceIndex];
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
  if (state.draw.type === "new") {
    coords = cloneCoords(state.draw.coords);
  } else if (state.draw.type === "extend" && state.draw.endpoint) {
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
  if (state.draw.type === "extend") {
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

function updateMapSources() {
  if (!map.getSource("segments")) return;
  map.getSource("segments").setData(mapFeatureCollection());
  map.getSource("vertices").setData(vertexCollection());
  map.getSource("data-markers").setData(dataMarkerCollection());
  map.getSource("draw-line")?.setData(drawLineCollection());
  map.getSource("draw-points")?.setData(drawPointCollection());
  map.setFilter("selected-segment", selectedFilter());
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

function renderForm() {
  const feature = selectedFeature();
  const drawing = isDrawing();
  const disabled = !feature || drawing;
  const canSplit =
    feature &&
    !drawing &&
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

  els.deleteVertex.disabled = drawing || !feature || state.selectedVertexIndex < 0;
  els.splitSegment.disabled = !canSplit;
  els.extendSegment.disabled = drawing || !feature;
  els.fitSelected.disabled = drawing || !feature;
  els.addData.disabled = drawing || !feature;

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
  if (state.draw.type === "new") {
    return state.draw.coords.length >= 2;
  }
  return state.draw.type === "extend" && Boolean(state.draw.endpoint) && state.draw.coords.length >= 1;
}

function renderDrawControls() {
  const drawing = isDrawing();
  const editButtons = [
    els.addSegment,
    els.modeSelect,
    els.modeInsert,
    els.extendSegment,
    els.deleteVertex,
    els.splitSegment,
    els.fitSelected,
  ];

  for (const button of editButtons) {
    button.hidden = drawing;
  }

  els.drawDone.hidden = !drawing;
  els.drawCancel.hidden = !drawing;
  els.drawDone.disabled = !canFinishDraw();
  els.drawCancel.disabled = !drawing;
  els.mapToolbar.classList.toggle("drawing", drawing);
  els.addSegment.disabled = !state.source || drawing;
  els.saveSource.disabled = !state.dirty || drawing;
  els.runBuild.disabled = drawing;
  updatePromoteButton();
}

function renderAll() {
  els.sourceSummary.textContent = `${state.activeFeatures.length} active · ${state.source.features.length} records`;
  renderDrawControls();
  renderList();
  renderForm();
  renderDataList();
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
  const coords = feature.geometry.coordinates;
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
    setStatus("Click near the selected segment to insert a vertex.");
  } else if (mode === "draw") {
    setStatus("Click the map to draw.");
  } else {
    setStatus("Select or drag vertices.");
  }
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
  markDirty();
  renderAll();
  setStatus(`Inserted vertex ${state.selectedVertexIndex + 1}.`);
}

function deleteSelectedVertex() {
  const feature = selectedFeature();
  if (!feature || state.selectedVertexIndex < 0) return;
  const coords = feature.geometry.coordinates;
  if (coords.length <= 2) {
    setStatus("A segment must keep at least two vertices.");
    return;
  }
  coords.splice(state.selectedVertexIndex, 1);
  state.selectedVertexIndex = -1;
  markDirty();
  renderAll();
  setStatus("Vertex deleted.");
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

function addSegment() {
  startNewSegmentDraw();
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
  return {
    feature,
    message: `Extended ${featureName(feature)} from the ${state.draw.endpoint}.`,
  };
}

function finishDraw() {
  if (!isDrawing()) return;
  if (!canFinishDraw()) {
    setStatus(
      state.draw.type === "extend" && !state.draw.endpoint
        ? "Click near the start or end of the selected segment first."
        : "Add more points before finishing.",
    );
    return;
  }

  const result = state.draw.type === "new" ? commitNewDrawnSegment() : commitExtendDrawnSegment();
  clearDrawState();
  state.mode = "select";
  els.modeSelect.classList.add("active");
  els.modeInsert.classList.remove("active");
  markDirty();
  renderAll();
  fitFeature(result.feature);
  setStatus(`${result.message} Save the source when ready.`);
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

function removeLastDrawPoint() {
  if (!isDrawing() || state.draw.coords.length === 0) return;
  state.draw.coords.pop();
  updateMapSources();
  renderDrawControls();
  setStatus("Removed last drawn point.");
}

function handleDrawClick(event) {
  if (!isDrawing()) return;

  if (state.draw.type === "extend" && !state.draw.endpoint) {
    const closest = closestExtendEndpoint(event.point);
    if (!closest) {
      setStatus("Click closer to the start or end of the selected segment.");
      return;
    }
    state.draw.endpoint = closest.endpoint;
    state.draw.hoverEndpoint = closest.endpoint;
    state.draw.hoverCoord = null;
    updateMapSources();
    renderDrawControls();
    setStatus(`Extending from the ${closest.endpoint}. Click points to add new route geometry.`);
    return;
  }

  state.draw.coords.push(coordFromLngLat(event.lngLat));
  state.draw.hoverCoord = null;
  updateMapSources();
  renderDrawControls();
  setStatus(
    state.draw.type === "new"
      ? `${state.draw.coords.length} point${state.draw.coords.length === 1 ? "" : "s"} drawn.`
      : `${state.draw.coords.length} extension point${state.draw.coords.length === 1 ? "" : "s"} drawn.`,
  );
}

function updateDrawHover(event) {
  if (!isDrawing()) return;

  state.draw.hoverCoord = coordFromLngLat(event.lngLat);
  state.draw.hoverEndpoint =
    state.draw.type === "extend" && !state.draw.endpoint
      ? closestExtendEndpoint(event.point)?.endpoint || null
      : state.draw.hoverEndpoint;
  map.getCanvas().style.cursor =
    state.draw.type === "extend" && !state.draw.endpoint && !state.draw.hoverEndpoint
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
  markDirty();
  updateMapSources();
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

  if (!feature) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No segment selected";
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

    const infoLabel = document.createElement("label");
    infoLabel.className = "field-label";
    infoLabel.textContent = "Information";
    item.appendChild(infoLabel);

    const infoInput = document.createElement("textarea");
    infoInput.className = "text-input textarea";
    infoInput.rows = 2;
    infoInput.value = marker.information || "";
    infoInput.addEventListener("change", () => {
      updateDataMarker(index, { information: infoInput.value.trim() });
      renderDataList();
    });
    item.appendChild(infoInput);

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
  markDirty();
  renderAll();
  setStatus(`Split ${originalName} into ${firstProperties.name} and ${secondProperties.name}.`);
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
    setStatus("Source saved.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showAlert("Save failed. Changes are still unsaved.", message);
    setStatus("Save failed. Changes are still unsaved.", "error");
    throw markAlertShown(error);
  }
}

function buildSummary(report) {
  if (!report) return "Build completed, but no report was returned.";
  const validation = report.validation || {};
  const elevation = report.elevation || {};
  return JSON.stringify(
    {
      featureCount: validation.featureCount,
      segmentsCount: validation.segmentsCount,
      newSegments: validation.newSegments?.length ?? 0,
      duplicateFeatureNames: validation.duplicateFeatureNames || [],
      duplicateIds: validation.duplicateIds || {},
      activeMissingMiddle: validation.activeMissingMiddle?.length ?? 0,
      invalidQuality: validation.invalidQuality?.length ?? 0,
      activeSplitNumberedNames: validation.activeSplitNumberedNames || [],
      routeCompatibilityWarnings: validation.routeCompatibilityWarnings?.length ?? 0,
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
  const version = report.outputs?.versioned?.version;
  const qualityIssues = validation.invalidQuality?.length || 0;
  const splitNameIssues = validation.activeSplitNumberedNames?.length || 0;
  const routeWarnings = validation.routeCompatibilityWarnings?.length || 0;
  const elevationFailures = elevation.failures || 0;
  const issues = qualityIssues + splitNameIssues + routeWarnings + elevationFailures;
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
    els.buildOutputSummary.textContent = buildOutputSummary(payload.report);
    els.buildReport.textContent = buildSummary(payload.report);
    updatePromoteButton();
    if ((payload.report?.elevation?.failures || 0) > 0) {
      setStatus("Build finished with elevation failures. Fix the elevation service and rebuild.", "error");
    } else if ((payload.report?.validation?.activeSplitNumberedNames || []).length > 0) {
      setStatus("Build finished with numbered split names. Rename them before promoting.", "error");
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
  els.drawDone.addEventListener("click", finishDraw);
  els.drawCancel.addEventListener("click", cancelDraw);
  els.addData.addEventListener("click", addDataMarker);
  els.mapStyle.addEventListener("change", () => switchMapStyle(els.mapStyle.value));
  els.fitSelected.addEventListener("click", () => {
    const feature = selectedFeature();
    if (feature) fitFeature(feature);
  });
  els.saveSource.addEventListener("click", () => saveSource().catch(showError));
  els.runBuild.addEventListener("click", () => runBuild().catch(showError));
  els.promoteBuild.addEventListener("click", () => promoteBuild().catch(showError));

  for (const input of [
    els.segmentName,
    els.segmentStatus,
    els.segmentRoadType,
    els.segmentTodo,
    els.segmentNotes,
  ]) {
    input.addEventListener("change", updateSelectedProperties);
  }

  map.on("click", "segments-layer", (event) => {
    if (state.mode !== "select") return;
    const sourceIndex = event.features[0].properties.sourceIndex;
    const activeIndex = state.activeFeatures.findIndex((record) => record.sourceIndex === sourceIndex);
    if (activeIndex >= 0) selectFeatureByActiveIndex(activeIndex);
  });

  map.on("click", (event) => {
    if (state.mode === "draw") {
      handleDrawClick(event);
      return;
    }
    if (state.mode === "insert") {
      insertVertexAtClick(event.lngLat, event.point);
    }
  });

  map.on("dblclick", (event) => {
    if (state.mode !== "draw") return;
    event.preventDefault();
    finishDraw();
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
    state.selectedVertexIndex = Number(event.features[0].properties.index);
    state.selectedDataIndex = -1;
    renderAll();
    setStatus(`Selected vertex ${state.selectedVertexIndex + 1}.`);
  });

  map.on("mousedown", "vertices-layer", (event) => {
    if (state.mode !== "select") return;
    event.preventDefault();
    state.draggingVertex = true;
    state.selectedVertexIndex = Number(event.features[0].properties.index);
    state.selectedDataIndex = -1;
    map.dragPan.disable();
    renderAll();
  });

  map.on("mousemove", (event) => {
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
    markDirty();
    updateMapSources();
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

    if (!state.draggingVertex) return;
    state.draggingVertex = false;
    map.dragPan.enable();
    renderAll();
    setStatus("Vertex moved.");
  });

  window.addEventListener("keydown", (event) => {
    if (!isDrawing()) {
      if (event.key === "Escape" && state.segmentsOpen) {
        event.preventDefault();
        setSegmentDrawer(false);
      }
      return;
    }
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select")) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelDraw();
    } else if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      removeLastDrawPoint();
    } else if (event.key === "Enter") {
      event.preventDefault();
      finishDraw();
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

  if (!map.getLayer("selected-segment")) {
    map.addLayer({
      id: "selected-segment",
      type: "line",
      source: "segments",
      filter: selectedFilter(),
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
      },
      paint: {
        "icon-opacity": ["case", ["get", "selected"], 1, 0.72],
      },
    });
  }
}

map.on("style.load", () => {
  restoreEditorLayersAfterStyleChange().catch(showError);
});

map.on("load", async () => {
  try {
    await addMapLayers();
    wireEvents();
    await loadSource();
  } catch (error) {
    showError(error);
  }
});
