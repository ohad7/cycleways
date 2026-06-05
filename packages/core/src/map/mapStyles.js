// Pure data module — no mapbox calls, no imports from mapLayers.
// Contains all layer/source ID constants and Mapbox paint/layout style specs.

// ---------------------------------------------------------------------------
// Source IDs
// ---------------------------------------------------------------------------
export const ROUTE_NETWORK_SOURCE_ID = "cycleways-network";
export const ROUTE_GEOMETRY_SOURCE_ID = "react-route-geometry";
export const ROUTE_POINTS_SOURCE_ID = "react-route-points";
export const ROUTE_POINT_DRAG_PREVIEW_SOURCE_ID = "route-point-drag-preview";
export const ROUTE_DIRECTION_PULSE_SOURCE_ID = "route-direction-pulse";
export const ROUTE_DIRECTION_LIT_POINT_SOURCE_ID = "route-direction-lit-point";
export const DATA_MARKERS_SOURCE_ID = "react-data-markers";
export const VIDEO_CURSOR_SOURCE_ID = "video-cursor-source";
export const VIDEO_CURSOR_TRAIL_SOURCE_ID = "video-cursor-trail-source";
export const VIDEO_CURSOR_PROGRESS_SOURCE_ID = "video-cursor-progress-source";

// ---------------------------------------------------------------------------
// Layer IDs
// ---------------------------------------------------------------------------
export const ROUTE_NETWORK_LINE_LAYER_ID = "cycleways-network-line";
export const ROUTE_NETWORK_HIT_LAYER_ID = "cycleways-network-hit";
export const ROUTE_NETWORK_HOVER_LAYER_ID = "cycleways-network-hover";
export const ROUTE_NETWORK_FOCUS_LAYER_ID = "cycleways-network-focus";
export const ROUTE_GEOMETRY_LAYER_ID = "react-route-geometry-line";
export const ROUTE_GEOMETRY_HIT_LAYER_ID = "react-route-geometry-hit";
export const ROUTE_POINTS_LAYER_ID = "react-route-points-circle";
export const ROUTE_POINT_DRAG_PREVIEW_LINE_CASING_LAYER_ID =
  "route-point-drag-preview-line-casing";
export const ROUTE_POINT_DRAG_PREVIEW_LINE_LAYER_ID =
  "route-point-drag-preview-line";
export const ROUTE_POINT_DRAG_PREVIEW_HALO_LAYER_ID =
  "route-point-drag-preview-halo";
export const ROUTE_DIRECTION_PULSE_CASING_LAYER_ID =
  "route-direction-pulse-casing";
export const ROUTE_DIRECTION_PULSE_CORE_LAYER_ID = "route-direction-pulse-core";
export const ROUTE_DIRECTION_LIT_POINT_CIRCLE_LAYER_ID =
  "route-direction-lit-point-circle";
export const ROUTE_DIRECTION_LIT_POINT_TEXT_LAYER_ID =
  "route-direction-lit-point-text";
export const DATA_MARKERS_LAYER_ID = "react-data-markers-layer";
export const DATA_MARKERS_CIRCLE_LAYER_ID = "react-data-markers-circle";
export const VIDEO_CURSOR_PROGRESS_LAYER_ID = "video-cursor-progress-layer";
export const VIDEO_CURSOR_TRAIL_LAYER_ID = "video-cursor-trail-layer";
export const VIDEO_CURSOR_PULSE_LAYER_ID = "video-cursor-pulse-layer";
export const VIDEO_CURSOR_HALO_LAYER_ID = "video-cursor-halo-layer";
export const VIDEO_CURSOR_NAV_CIRCLE_LAYER_ID = "video-cursor-nav-circle-layer";
export const VIDEO_CURSOR_LAYER_ID = "video-cursor-layer";
export const VIDEO_CURSOR_SYMBOL_LAYER_ID = "video-cursor-symbol-layer";

// ---------------------------------------------------------------------------
// Color constants used in style specs
// ---------------------------------------------------------------------------
const SEGMENT_HOVER = "#666633";
const HIGHLIGHT_WHITE = "#ffffff";

// ---------------------------------------------------------------------------
// Style specs — paint/layout object literals, verbatim from mapLayers.js
// ---------------------------------------------------------------------------

export const ROUTE_NETWORK_LINE_STYLE = {
  layout: {
    "line-join": "round",
    "line-cap": "round",
  },
  paint: {
    "line-color": ["get", "routeColor"],
    "line-width": ["get", "routeWidth"],
    "line-opacity": ["get", "routeOpacity"],
  },
};

export const ROUTE_NETWORK_HIT_STYLE = {
  layout: {
    "line-join": "round",
    "line-cap": "round",
  },
  paint: {
    "line-color": "#ffffff",
    "line-width": 20,
    "line-opacity": 0.01,
  },
};

export const ROUTE_NETWORK_HOVER_STYLE = {
  layout: {
    "line-join": "round",
    "line-cap": "round",
  },
  paint: {
    "line-color": SEGMENT_HOVER,
    "line-width": 5,
    "line-opacity": 1,
  },
};

export const ROUTE_NETWORK_FOCUS_STYLE = {
  layout: {
    "line-join": "round",
    "line-cap": "round",
  },
  paint: {
    "line-color": HIGHLIGHT_WHITE,
    "line-width": 7,
    "line-opacity": 1,
  },
};

export const ROUTE_GEOMETRY_LINE_STYLE = {
  layout: {
    "line-join": "round",
    "line-cap": "round",
  },
  paint: {
    "line-color": "#006699",
    "line-width": 5,
    "line-opacity": [
      "case",
      ["boolean", ["get", "affected"], false],
      0.3,
      0.9,
    ],
  },
};

export const ROUTE_GEOMETRY_HIT_STYLE = {
  layout: {
    "line-join": "round",
    "line-cap": "round",
  },
  paint: {
    "line-color": "#000000",
    "line-width": 18,
    "line-opacity": 0.01,
  },
};

export const ROUTE_POINTS_STYLE = {
  paint: {
    "circle-radius": [
      "case",
      ["boolean", ["get", "pending"], false],
      4.2,
      ["!=", ["get", "endpoint"], "middle"],
      4.1,
      ["boolean", ["get", "selected"], false],
      3.8,
      3.2,
    ],
    "circle-color": [
      "case",
      ["boolean", ["get", "pending"], false],
      "rgba(255, 255, 255, 0.16)",
      ["==", ["get", "endpoint"], "start"],
      "#18a957",
      ["==", ["get", "endpoint"], "end"],
      "#c84c45",
      ["boolean", ["get", "selected"], false],
      "rgba(255, 255, 255, 0.12)",
      "rgba(255, 255, 255, 0.04)",
    ],
    "circle-opacity": [
      "case",
      ["boolean", ["get", "pending"], false],
      0.9,
      1,
    ],
    "circle-stroke-width": [
      "case",
      ["boolean", ["get", "pending"], false],
      1.2,
      ["boolean", ["get", "selected"], false],
      1.1,
      ["!=", ["get", "endpoint"], "middle"],
      1,
      0.85,
    ],
    "circle-stroke-color": [
      "case",
      ["==", ["get", "endpoint"], "start"],
      "#ffffff",
      ["==", ["get", "endpoint"], "end"],
      "#ffffff",
      ["boolean", ["get", "selected"], false],
      "#ffffff",
      "rgba(255, 255, 255, 0.82)",
    ],
  },
};

export const ROUTE_POINT_DRAG_PREVIEW_LINE_CASING_STYLE = {
  layout: {
    "line-join": "round",
    "line-cap": "round",
  },
  paint: {
    "line-color": "#0f6070",
    "line-width": 4.8,
    "line-opacity": 0.32,
    "line-dasharray": [1.25, 0.85],
  },
};

export const ROUTE_POINT_DRAG_PREVIEW_LINE_STYLE = {
  layout: {
    "line-join": "round",
    "line-cap": "round",
  },
  paint: {
    "line-color": "#f4feff",
    "line-width": 2.6,
    "line-opacity": 0.96,
    "line-dasharray": [1.25, 0.85],
  },
};

export const ROUTE_POINT_DRAG_PREVIEW_HALO_STYLE = {
  paint: {
    "circle-radius": 9,
    "circle-color": "rgba(217, 243, 248, 0.14)",
    "circle-stroke-color": "#d9f3f8",
    "circle-stroke-width": 1.5,
    "circle-stroke-opacity": 0.86,
  },
};

export const ROUTE_DIRECTION_PULSE_CASING_STYLE = {
  layout: {
    "line-join": "round",
    "line-cap": "round",
  },
  paint: {
    "line-color": "#f2fbfd",
    "line-width": 7.5,
    "line-opacity": 0.24,
    "line-blur": 0.35,
  },
};

export const ROUTE_DIRECTION_PULSE_CORE_STYLE = {
  layout: {
    "line-join": "round",
    "line-cap": "round",
  },
  paint: {
    "line-gradient": [
      "interpolate",
      ["linear"],
      ["line-progress"],
      0,
      "rgba(116, 184, 200, 0.08)",
      0.35,
      "rgba(116, 184, 200, 0.34)",
      0.78,
      "rgba(116, 184, 200, 0.76)",
      1,
      "rgba(242, 251, 253, 0.96)",
    ],
    "line-width": 5,
    "line-opacity": 0.82,
  },
};

export const ROUTE_DIRECTION_LIT_POINT_CIRCLE_STYLE = {
  paint: {
    "circle-radius": 6,
    "circle-color": "#ff4444",
    "circle-stroke-color": "#d9f3f8",
    "circle-stroke-width": 2.25,
    "circle-blur": 0.18,
  },
};

export const ROUTE_DIRECTION_LIT_POINT_TEXT_STYLE = {
  layout: {
    "text-field": ["coalesce", ["get", "index"], ""],
    "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
    "text-size": 10,
    "text-allow-overlap": true,
    "text-ignore-placement": true,
  },
  paint: {
    "text-color": "#ffffff",
  },
};

export const DATA_MARKERS_CIRCLE_STYLE = {
  paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 6, 14, 9, 16, 12],
    "circle-color": ["coalesce", ["get", "color"], "#607076"],
    "circle-opacity": ["case", ["boolean", ["get", "active"], false], 0.95, 0.6],
    "circle-stroke-color": "#ffffff",
    "circle-stroke-width": 1.5,
  },
};

export const DATA_MARKERS_STYLE = {
  layout: {
    // POI types use a rasterized emoji image (registerPoiEmojiImages); warnings
    // use their loaded SVG icon. Emoji are NOT rendered via `text-field` —
    // astral-plane glyphs (> U+FFFF) throw "glyphs > 65535 not supported" and
    // blank the whole map.
    "icon-image": ["get", "icon"],
    "icon-size": 1,
    "icon-allow-overlap": true,
    "icon-ignore-placement": true,
  },
  paint: {
    "icon-opacity": [
      "case",
      ["boolean", ["get", "active"], false],
      0.9,
      0.45,
    ],
  },
};

export const VIDEO_CURSOR_VARIANTS = Object.freeze({
  CHEVRON_HALO: "chevron-halo",
  CHEVRON_TRAIL: "chevron-trail",
  PROGRESS_HEAD: "progress-head",
  PROGRESS_HEAD_PULSE: "progress-head-pulse",
  NAV_CIRCLE: "nav-circle",
  PULSE_RING: "pulse-ring",
  DOT: "dot",
});

export const VIDEO_CURSOR_DEFAULT_VARIANT = VIDEO_CURSOR_VARIANTS.PROGRESS_HEAD_PULSE;

export const VIDEO_CURSOR_PROGRESS_STYLE = {
  layout: {
    "line-join": "round",
    "line-cap": "round",
  },
  paint: {
    "line-color": "#0f766e",
    "line-width": 6,
    "line-opacity": 0.72,
  },
};

export const VIDEO_CURSOR_TRAIL_STYLE = {
  layout: {
    "line-join": "round",
    "line-cap": "round",
  },
  paint: {
    "line-color": "#f97316",
    "line-width": 5,
    "line-opacity": 0.82,
  },
};

export const VIDEO_CURSOR_PULSE_STYLE = {
  filter: ["==", ["get", "showPulse"], true],
  paint: {
    "circle-radius": ["get", "pulseRadius"],
    "circle-color": ["get", "pulseColor"],
    "circle-opacity": ["get", "pulseOpacity"],
    "circle-stroke-color": "#ffffff",
    "circle-stroke-width": 1,
    "circle-stroke-opacity": 0.64,
  },
};

export const VIDEO_CURSOR_HALO_STYLE = {
  filter: ["==", ["get", "showHalo"], true],
  paint: {
    "circle-radius": 15,
    "circle-color": "#ffffff",
    "circle-opacity": 0.78,
    "circle-stroke-color": "#0f766e",
    "circle-stroke-width": 1.4,
    "circle-stroke-opacity": 0.7,
  },
};

export const VIDEO_CURSOR_NAV_CIRCLE_STYLE = {
  filter: ["==", ["get", "showNavCircle"], true],
  paint: {
    "circle-radius": 12,
    "circle-color": "#0f766e",
    "circle-opacity": 0.96,
    "circle-stroke-color": "#ffffff",
    "circle-stroke-width": 2.5,
  },
};

export const VIDEO_CURSOR_STYLE = {
  filter: ["==", ["get", "showCore"], true],
  paint: {
    "circle-radius": ["get", "coreRadius"],
    "circle-color": ["get", "coreColor"],
    "circle-opacity": 0.96,
    "circle-stroke-color": "#ffffff",
    "circle-stroke-width": ["get", "coreStrokeWidth"],
  },
};

export const VIDEO_CURSOR_SYMBOL_STYLE = {
  filter: ["==", ["get", "showSymbol"], true],
  layout: {
    "text-field": ["get", "symbol"],
    "text-size": ["get", "symbolSize"],
    "text-allow-overlap": true,
    "text-ignore-placement": true,
    "text-anchor": "center",
    "text-rotation-alignment": "map",
    "text-pitch-alignment": "map",
    "text-rotate": ["get", "bearing"],
  },
  paint: {
    "text-color": ["get", "symbolColor"],
    "text-halo-color": "#ffffff",
    "text-halo-width": 1.15,
  },
};
