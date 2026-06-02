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
export const OSM_DEBUG_SOURCE_ID = "osm-debug-network";
export const OSM_INTERSECTIONS_SOURCE_ID = "osm-debug-intersections";
export const OSM_GRAPH_EDGES_SOURCE_ID = "osm-base-graph-edges";
export const OSM_GRAPH_NODES_SOURCE_ID = "osm-base-graph-nodes";
export const CW_OSM_MATCH_SOURCE_ID = "cw-osm-match-preview";
export const CW_OSM_REVIEW_SOURCE_ID = "cw-osm-review-original";

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
export const OSM_DEBUG_LINE_LAYER_ID = "osm-debug-network-line";
export const OSM_DEBUG_RESTRICTED_LAYER_ID = "osm-debug-network-restricted";
export const OSM_DEBUG_HOVER_LAYER_ID = "osm-debug-network-hover";
export const OSM_DEBUG_HIT_LAYER_ID = "osm-debug-network-hit";
export const OSM_INTERSECTIONS_LAYER_ID = "osm-debug-intersections-circle";
export const OSM_INTERSECTIONS_HIT_LAYER_ID = "osm-debug-intersections-hit";
export const OSM_GRAPH_EDGES_LAYER_ID = "osm-base-graph-edges-line";
export const OSM_GRAPH_EDGES_HOVER_LAYER_ID = "osm-base-graph-edges-hover";
export const OSM_GRAPH_EDGES_HIT_LAYER_ID = "osm-base-graph-edges-hit";
export const OSM_GRAPH_NODES_LAYER_ID = "osm-base-graph-nodes-circle";
export const CW_OSM_MATCH_MATCHED_LAYER_ID = "cw-osm-match-matched-line";
export const CW_OSM_MATCH_GAP_LAYER_ID = "cw-osm-match-gap-line";
export const CW_OSM_MATCH_HOVER_LAYER_ID = "cw-osm-match-hover-line";
export const CW_OSM_MATCH_FOCUS_LAYER_ID = "cw-osm-match-focus-line";
export const CW_OSM_MATCH_HIT_LAYER_ID = "cw-osm-match-hit-line";
export const CW_OSM_REVIEW_HALO_LAYER_ID = "cw-osm-review-original-halo";
export const CW_OSM_REVIEW_LINE_LAYER_ID = "cw-osm-review-original-line";

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

export const OSM_DEBUG_LINE_STYLE = {
  layout: {
    "line-join": "round",
    "line-cap": "round",
  },
  paint: {
    "line-color": ["coalesce", ["get", "osmColor"], "#7f7f7f"],
    "line-width": ["coalesce", ["get", "osmWidth"], 1.8],
    "line-opacity": ["coalesce", ["get", "osmOpacity"], 0.45],
  },
};

export const OSM_DEBUG_RESTRICTED_STYLE = {
  layout: {
    "line-join": "round",
    "line-cap": "round",
  },
  paint: {
    "line-color": ["coalesce", ["get", "osmColor"], "#7f7f7f"],
    "line-width": ["coalesce", ["get", "osmWidth"], 1.8],
    "line-opacity": ["coalesce", ["get", "osmOpacity"], 0.45],
    "line-dasharray": [2, 1.5],
  },
};

export const OSM_DEBUG_HIT_STYLE = {
  layout: {
    "line-join": "round",
    "line-cap": "round",
  },
  paint: {
    "line-color": "#ffffff",
    "line-width": 16,
    "line-opacity": 0.01,
  },
};

export const OSM_DEBUG_HOVER_STYLE = {
  layout: {
    "line-join": "round",
    "line-cap": "round",
  },
  paint: {
    "line-color": "#ffffff",
    "line-width": 5,
    "line-opacity": 0.95,
  },
};

export const OSM_INTERSECTIONS_STYLE = {
  paint: {
    "circle-radius": [
      "interpolate",
      ["linear"],
      ["coalesce", ["get", "wayCount"], 2],
      2,
      3,
      4,
      4.5,
      8,
      7,
    ],
    "circle-color": "#dc2626",
    "circle-opacity": 0.92,
    "circle-stroke-width": 1.4,
    "circle-stroke-color": "#ffffff",
    "circle-stroke-opacity": 0.95,
  },
};

export const OSM_INTERSECTIONS_HIT_STYLE = {
  paint: {
    "circle-radius": 9,
    "circle-color": "#ffffff",
    "circle-opacity": 0.01,
  },
};

export const OSM_GRAPH_EDGES_STYLE = {
  layout: {
    "line-join": "round",
    "line-cap": "round",
  },
  paint: {
    "line-color": ["coalesce", ["get", "graphColor"], "#2563eb"],
    "line-width": [
      "interpolate",
      ["linear"],
      ["zoom"],
      9,
      0.8,
      13,
      1.4,
      16,
      2.4,
    ],
    "line-opacity": ["coalesce", ["get", "graphOpacity"], 0.68],
  },
};

export const OSM_GRAPH_EDGES_HIT_STYLE = {
  layout: {
    "line-join": "round",
    "line-cap": "round",
  },
  paint: {
    "line-color": "#ffffff",
    "line-width": 10,
    "line-opacity": 0.01,
  },
};

export const OSM_GRAPH_EDGES_HOVER_STYLE = {
  layout: {
    "line-join": "round",
    "line-cap": "round",
  },
  paint: {
    "line-color": "#ffffff",
    "line-width": [
      "interpolate",
      ["linear"],
      ["zoom"],
      9,
      2.4,
      13,
      3.4,
      16,
      5,
    ],
    "line-opacity": 0.95,
  },
};

export const OSM_GRAPH_NODES_STYLE = {
  paint: {
    "circle-radius": [
      "interpolate",
      ["linear"],
      ["coalesce", ["get", "degree"], 1],
      1,
      1.6,
      3,
      2.2,
      5,
      3.2,
    ],
    "circle-color": [
      "match",
      ["get", "source"],
      "calculated_crossing",
      "#f97316",
      "osm_intersection",
      "#2563eb",
      "osm_endpoint",
      "#64748b",
      "#0f766e",
    ],
    "circle-opacity": 0.78,
    "circle-stroke-width": 0.8,
    "circle-stroke-color": "#ffffff",
  },
};

export const CW_OSM_MATCH_MATCHED_STYLE = {
  layout: {
    "line-join": "round",
    "line-cap": "round",
  },
  paint: {
    "line-color": [
      "match",
      ["get", "confidence"],
      "high",
      "#16a34a",
      "medium",
      "#eab308",
      "low",
      "#f97316",
      "none",
      "#9ca3af",
      "#14b8a6",
    ],
    "line-width": [
      "interpolate",
      ["linear"],
      ["zoom"],
      9,
      2.4,
      13,
      3.8,
      16,
      5.5,
    ],
    "line-opacity": 0.88,
  },
};

export const CW_OSM_MATCH_GAP_STYLE = {
  layout: {
    "line-join": "round",
    "line-cap": "round",
  },
  paint: {
    "line-color": "#dc2626",
    "line-width": [
      "interpolate",
      ["linear"],
      ["zoom"],
      9,
      3.2,
      13,
      5,
      16,
      7,
    ],
    "line-opacity": 0.96,
    "line-dasharray": [0.4, 1.1],
  },
};

export const CW_OSM_MATCH_HOVER_STYLE = {
  layout: {
    "line-join": "round",
    "line-cap": "round",
  },
  paint: {
    "line-color": "#ffffff",
    "line-width": [
      "interpolate",
      ["linear"],
      ["zoom"],
      9,
      4.8,
      13,
      7,
      16,
      9,
    ],
    "line-opacity": 0.78,
  },
};

export const CW_OSM_MATCH_FOCUS_STYLE = {
  layout: {
    "line-join": "round",
    "line-cap": "round",
  },
  paint: {
    "line-color": "#0f172a",
    "line-width": [
      "interpolate",
      ["linear"],
      ["zoom"],
      9,
      5.4,
      13,
      8,
      16,
      10,
    ],
    "line-opacity": 0.72,
  },
};

export const CW_OSM_MATCH_HIT_STYLE = {
  layout: {
    "line-join": "round",
    "line-cap": "round",
  },
  paint: {
    "line-color": "#ffffff",
    "line-width": 18,
    "line-opacity": 0.01,
  },
};

export const CW_OSM_REVIEW_HALO_STYLE = {
  layout: {
    "line-join": "round",
    "line-cap": "round",
  },
  paint: {
    "line-color": "#111827",
    "line-width": [
      "interpolate",
      ["linear"],
      ["zoom"],
      9,
      5,
      13,
      7,
      16,
      9,
    ],
    "line-opacity": 0.82,
  },
};

export const CW_OSM_REVIEW_LINE_STYLE = {
  layout: {
    "line-join": "round",
    "line-cap": "round",
  },
  paint: {
    "line-color": "#f8fafc",
    "line-width": [
      "interpolate",
      ["linear"],
      ["zoom"],
      9,
      2.4,
      13,
      3.6,
      16,
      5,
    ],
    "line-opacity": 0.95,
    "line-dasharray": [1.2, 0.8],
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
    "icon-image": ["get", "icon"],
    "icon-size": 1,
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
    "text-size": ["interpolate", ["linear"], ["zoom"], 10, 11, 16, 16],
    "text-allow-overlap": true,
    "text-ignore-placement": true,
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

export const VIDEO_CURSOR_SOURCE_ID = "video-cursor-source";
export const VIDEO_CURSOR_LAYER_ID = "video-cursor-layer";

export const VIDEO_CURSOR_STYLE = {
  paint: {
    "circle-radius": 9,
    "circle-color": "#ff3d3d",
    "circle-stroke-color": "#ffffff",
    "circle-stroke-width": 3,
  },
};
