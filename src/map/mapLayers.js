import { getDistance } from "../../utils/distance.js";

export const ROUTE_NETWORK_SOURCE_ID = "cycleways-network";
export const ROUTE_NETWORK_LINE_LAYER_ID = "cycleways-network-line";
export const ROUTE_NETWORK_HIT_LAYER_ID = "cycleways-network-hit";
export const ROUTE_NETWORK_HOVER_LAYER_ID = "cycleways-network-hover";
export const ROUTE_NETWORK_FOCUS_LAYER_ID = "cycleways-network-focus";
export const ROUTE_GEOMETRY_SOURCE_ID = "react-route-geometry";
export const ROUTE_GEOMETRY_LAYER_ID = "react-route-geometry-line";
export const ROUTE_GEOMETRY_HIT_LAYER_ID = "react-route-geometry-hit";
export const ROUTE_POINTS_SOURCE_ID = "react-route-points";
export const ROUTE_POINTS_LAYER_ID = "react-route-points-circle";
export const ROUTE_POINT_DRAG_PREVIEW_SOURCE_ID = "route-point-drag-preview";
export const ROUTE_POINT_DRAG_PREVIEW_LINE_CASING_LAYER_ID =
  "route-point-drag-preview-line-casing";
export const ROUTE_POINT_DRAG_PREVIEW_LINE_LAYER_ID =
  "route-point-drag-preview-line";
export const ROUTE_POINT_DRAG_PREVIEW_HALO_LAYER_ID =
  "route-point-drag-preview-halo";
export const ROUTE_DIRECTION_PULSE_SOURCE_ID = "route-direction-pulse";
export const ROUTE_DIRECTION_PULSE_CASING_LAYER_ID =
  "route-direction-pulse-casing";
export const ROUTE_DIRECTION_PULSE_CORE_LAYER_ID = "route-direction-pulse-core";
export const ROUTE_DIRECTION_LIT_POINT_SOURCE_ID = "route-direction-lit-point";
export const ROUTE_DIRECTION_LIT_POINT_CIRCLE_LAYER_ID =
  "route-direction-lit-point-circle";
export const ROUTE_DIRECTION_LIT_POINT_TEXT_LAYER_ID =
  "route-direction-lit-point-text";
export const DATA_MARKERS_SOURCE_ID = "react-data-markers";
export const DATA_MARKERS_LAYER_ID = "react-data-markers-layer";
export const OSM_DEBUG_SOURCE_ID = "osm-debug-network";
export const OSM_DEBUG_LINE_LAYER_ID = "osm-debug-network-line";
export const OSM_DEBUG_RESTRICTED_LAYER_ID = "osm-debug-network-restricted";
export const OSM_DEBUG_HOVER_LAYER_ID = "osm-debug-network-hover";
export const OSM_DEBUG_HIT_LAYER_ID = "osm-debug-network-hit";
export const OSM_INTERSECTIONS_SOURCE_ID = "osm-debug-intersections";
export const OSM_INTERSECTIONS_LAYER_ID = "osm-debug-intersections-circle";
export const OSM_INTERSECTIONS_HIT_LAYER_ID = "osm-debug-intersections-hit";
export const OSM_GRAPH_EDGES_SOURCE_ID = "osm-base-graph-edges";
export const OSM_GRAPH_EDGES_LAYER_ID = "osm-base-graph-edges-line";
export const OSM_GRAPH_EDGES_HOVER_LAYER_ID = "osm-base-graph-edges-hover";
export const OSM_GRAPH_EDGES_HIT_LAYER_ID = "osm-base-graph-edges-hit";
export const OSM_GRAPH_NODES_SOURCE_ID = "osm-base-graph-nodes";
export const OSM_GRAPH_NODES_LAYER_ID = "osm-base-graph-nodes-circle";
export const CW_OSM_MATCH_SOURCE_ID = "cw-osm-match-preview";
export const CW_OSM_MATCH_MATCHED_LAYER_ID = "cw-osm-match-matched-line";
export const CW_OSM_MATCH_GAP_LAYER_ID = "cw-osm-match-gap-line";
export const CW_OSM_MATCH_HOVER_LAYER_ID = "cw-osm-match-hover-line";
export const CW_OSM_MATCH_FOCUS_LAYER_ID = "cw-osm-match-focus-line";
export const CW_OSM_MATCH_HIT_LAYER_ID = "cw-osm-match-hit-line";
export const CW_OSM_REVIEW_SOURCE_ID = "cw-osm-review-original";
export const CW_OSM_REVIEW_HALO_LAYER_ID = "cw-osm-review-original-halo";
export const CW_OSM_REVIEW_LINE_LAYER_ID = "cw-osm-review-original-line";

const COLORS = {
  SEGMENT_HOVER: "#666633",
  HIGHLIGHT_WHITE: "#ffffff",
};

const DATA_MARKER_EMOJIS = {
  payment: "💳",
  gate: "🚧",
  mud: "🌧️",
  warning: "⚠️",
  slope: "⛰️",
  narrow: "🚗",
  severe: "‼️",
};

const DATA_MARKER_ICONS = {
  payment: "bank-11",
  gate: "barrier-11",
  mud: "wetland-11",
  warning: "caution-11",
  slope: "mountain-11",
  narrow: "car-11",
  severe: "roadblock-11",
};

const DATA_MARKER_ICON_FILES = {
  "bank-11": "icons/bank.svg",
  "barrier-11": "icons/barrier.svg",
  "wetland-11": "icons/wetland.svg",
  "caution-11": "icons/caution.svg",
  "mountain-11": "icons/mountain.svg",
  "car-11": "icons/car.svg",
  "roadblock-11": "icons/roadblock.svg",
};

export function getRouteNetworkLayerIds() {
  return [
    ROUTE_NETWORK_HIT_LAYER_ID,
    ROUTE_NETWORK_FOCUS_LAYER_ID,
    ROUTE_NETWORK_HOVER_LAYER_ID,
    ROUTE_NETWORK_LINE_LAYER_ID,
  ];
}

export function clearRouteNetworkLayers(map) {
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

export function clearOsmDebugLayers(map) {
  if (!map) return;

  clearOsmRawLayers(map);
  clearOsmIntersectionLayers(map);
  clearOsmGraphLayers(map);
  clearCwOsmMatchLayers(map);
  clearCwOsmReviewLayers(map);
}

export function clearOsmRawLayers(map) {
  if (!map) return;

  [
    OSM_DEBUG_HIT_LAYER_ID,
    OSM_DEBUG_HOVER_LAYER_ID,
    OSM_DEBUG_RESTRICTED_LAYER_ID,
    OSM_DEBUG_LINE_LAYER_ID,
  ].forEach((layerId) => {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
  });

  if (map.getSource(OSM_DEBUG_SOURCE_ID)) {
    map.removeSource(OSM_DEBUG_SOURCE_ID);
  }
}

export function clearOsmIntersectionLayers(map) {
  if (!map) return;

  [OSM_INTERSECTIONS_HIT_LAYER_ID, OSM_INTERSECTIONS_LAYER_ID].forEach((layerId) => {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
  });

  if (map.getSource(OSM_INTERSECTIONS_SOURCE_ID)) {
    map.removeSource(OSM_INTERSECTIONS_SOURCE_ID);
  }
}

export function clearOsmGraphLayers(map) {
  if (!map) return;

  [
    OSM_GRAPH_NODES_LAYER_ID,
    OSM_GRAPH_EDGES_HIT_LAYER_ID,
    OSM_GRAPH_EDGES_HOVER_LAYER_ID,
    OSM_GRAPH_EDGES_LAYER_ID,
  ].forEach((layerId) => {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
  });

  if (map.getSource(OSM_GRAPH_NODES_SOURCE_ID)) {
    map.removeSource(OSM_GRAPH_NODES_SOURCE_ID);
  }
  if (map.getSource(OSM_GRAPH_EDGES_SOURCE_ID)) {
    map.removeSource(OSM_GRAPH_EDGES_SOURCE_ID);
  }
}

export function clearCwOsmMatchLayers(map) {
  if (!map) return;

  [
    CW_OSM_MATCH_HIT_LAYER_ID,
    CW_OSM_MATCH_FOCUS_LAYER_ID,
    CW_OSM_MATCH_HOVER_LAYER_ID,
    CW_OSM_MATCH_GAP_LAYER_ID,
    CW_OSM_MATCH_MATCHED_LAYER_ID,
  ].forEach((layerId) => {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
  });

  if (map.getSource(CW_OSM_MATCH_SOURCE_ID)) {
    map.removeSource(CW_OSM_MATCH_SOURCE_ID);
  }
}

export function clearRoutePointLayers(map) {
  if (!map) return;
  if (map.getLayer(ROUTE_POINTS_LAYER_ID)) {
    map.removeLayer(ROUTE_POINTS_LAYER_ID);
  }
  if (map.getSource(ROUTE_POINTS_SOURCE_ID)) {
    map.removeSource(ROUTE_POINTS_SOURCE_ID);
  }
}

export function clearRouteGeometryLayers(map) {
  if (!map) return;
  if (map.getLayer(ROUTE_GEOMETRY_HIT_LAYER_ID)) {
    map.removeLayer(ROUTE_GEOMETRY_HIT_LAYER_ID);
  }
  if (map.getLayer(ROUTE_GEOMETRY_LAYER_ID)) {
    map.removeLayer(ROUTE_GEOMETRY_LAYER_ID);
  }
  if (map.getSource(ROUTE_GEOMETRY_SOURCE_ID)) {
    map.removeSource(ROUTE_GEOMETRY_SOURCE_ID);
  }
}

export function clearDataMarkerLayers(map) {
  if (!map) return;
  if (map.getLayer(DATA_MARKERS_LAYER_ID)) {
    map.removeLayer(DATA_MARKERS_LAYER_ID);
  }
  if (map.getSource(DATA_MARKERS_SOURCE_ID)) {
    map.removeSource(DATA_MARKERS_SOURCE_ID);
  }
}

export function setRouteNetworkHover(map, segmentName) {
  setRouteNetworkFilter(map, ROUTE_NETWORK_HOVER_LAYER_ID, segmentName);
}

export function setRouteNetworkFocus(map, segmentName) {
  setRouteNetworkFilter(map, ROUTE_NETWORK_FOCUS_LAYER_ID, segmentName);
}

export function setOsmDebugHover(map, osmId) {
  if (!map?.getLayer(OSM_DEBUG_HOVER_LAYER_ID)) return;

  map.setFilter(
    OSM_DEBUG_HOVER_LAYER_ID,
    osmId !== null && osmId !== undefined
      ? ["==", ["get", "osmId"], osmId]
      : ["==", ["get", "osmId"], ""],
  );
}

export function setOsmGraphEdgeHover(map, edgeId) {
  if (!map?.getLayer(OSM_GRAPH_EDGES_HOVER_LAYER_ID)) return;

  map.setFilter(
    OSM_GRAPH_EDGES_HOVER_LAYER_ID,
    edgeId ? ["==", ["get", "edgeId"], edgeId] : ["==", ["get", "edgeId"], ""],
  );
}

export function setCwOsmMatchHover(map, segmentId) {
  if (!map?.getLayer(CW_OSM_MATCH_HOVER_LAYER_ID)) return;

  const numericSegmentId = Number(segmentId);
  map.setFilter(
    CW_OSM_MATCH_HOVER_LAYER_ID,
    Number.isFinite(numericSegmentId)
      ? ["==", ["get", "segmentId"], numericSegmentId]
      : ["==", ["get", "segmentId"], -1],
  );
}

export function setCwOsmMatchFocus(map, segmentId) {
  if (!map?.getLayer(CW_OSM_MATCH_FOCUS_LAYER_ID)) return;

  const numericSegmentId = Number(segmentId);
  map.setFilter(
    CW_OSM_MATCH_FOCUS_LAYER_ID,
    Number.isFinite(numericSegmentId)
      ? ["==", ["get", "segmentId"], numericSegmentId]
      : ["==", ["get", "segmentId"], -1],
  );
}

function setRouteNetworkFilter(map, layerId, segmentName) {
  if (!map?.getLayer(layerId)) return;

  map.setFilter(
    layerId,
    segmentName ? ["==", ["get", "name"], segmentName] : ["==", ["get", "name"], ""],
  );
}

export function getRouteFeatureColor(feature) {
  const roadType = feature.properties?.roadType;
  const originalColor =
    feature.properties?.stroke ||
    feature.properties?.["stroke-color"] ||
    "#0288d1";

  if (originalColor === "#0288d1" || originalColor === "rgb(2, 136, 209)") {
    return "rgb(101, 170, 162)";
  }

  if (
    roadType === "road" ||
    originalColor === "#8f2424" ||
    originalColor === "rgb(143, 36, 36)" ||
    originalColor === "#e6ee9c" ||
    originalColor === "rgb(230, 238, 156)"
  ) {
    return "rgb(138, 147, 158)";
  }

  return "rgb(174, 144, 103)";
}

export function prepareRouteNetworkFeatures(geoJsonData) {
  return (geoJsonData?.features || [])
    .filter((feature) => feature?.geometry?.type === "LineString")
    .map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        name: feature.properties?.name || "Unnamed Route",
        routeColor: getRouteFeatureColor(feature),
        routeWidth: 3,
        routeOpacity: 1,
      },
    }));
}

export function addRouteNetworkLayers(map, features) {
  if (!map || features.length === 0) return;

  clearRouteNetworkLayers(map);

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
    id: ROUTE_NETWORK_HIT_LAYER_ID,
    type: "line",
    source: ROUTE_NETWORK_SOURCE_ID,
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
    paint: {
      "line-color": "#ffffff",
      "line-width": 20,
      "line-opacity": 0.01,
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

export function addOsmDebugLayers(map, features) {
  if (!map || features.length === 0) return;

  clearOsmRawLayers(map);

  map.addSource(OSM_DEBUG_SOURCE_ID, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features,
    },
  });

  addLayerBeforeRouteNetwork(map, {
    id: OSM_DEBUG_LINE_LAYER_ID,
    type: "line",
    source: OSM_DEBUG_SOURCE_ID,
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
    paint: {
      "line-color": ["coalesce", ["get", "osmColor"], "#7f7f7f"],
      "line-width": ["coalesce", ["get", "osmWidth"], 1.8],
      "line-opacity": ["coalesce", ["get", "osmOpacity"], 0.45],
    },
  });

  addLayerBeforeRouteNetwork(map, {
    id: OSM_DEBUG_RESTRICTED_LAYER_ID,
    type: "line",
    source: OSM_DEBUG_SOURCE_ID,
    filter: [
      "any",
      ["==", ["get", "accessStatus"], "restricted"],
      ["==", ["get", "accessStatus"], "conditional"],
    ],
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
  });

  addLayerBeforeRouteNetwork(map, {
    id: OSM_DEBUG_HIT_LAYER_ID,
    type: "line",
    source: OSM_DEBUG_SOURCE_ID,
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
    paint: {
      "line-color": "#ffffff",
      "line-width": 16,
      "line-opacity": 0.01,
    },
  });

  addLayerBeforeRouteNetwork(map, {
    id: OSM_DEBUG_HOVER_LAYER_ID,
    type: "line",
    source: OSM_DEBUG_SOURCE_ID,
    filter: ["==", ["get", "osmId"], ""],
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
    paint: {
      "line-color": "#ffffff",
      "line-width": 5,
      "line-opacity": 0.95,
    },
  });
}

export function syncOsmIntersectionLayers(map, features) {
  if (!map) return;
  const normalizedFeatures = Array.isArray(features) ? features : [];

  const data = {
    type: "FeatureCollection",
    features: normalizedFeatures,
  };

  if (normalizedFeatures.length === 0) {
    clearOsmIntersectionLayers(map);
    return;
  }

  if (map.getSource(OSM_INTERSECTIONS_SOURCE_ID)) {
    map.getSource(OSM_INTERSECTIONS_SOURCE_ID).setData(data);
    return;
  }

  map.addSource(OSM_INTERSECTIONS_SOURCE_ID, {
    type: "geojson",
    data,
  });

  map.addLayer({
    id: OSM_INTERSECTIONS_LAYER_ID,
    type: "circle",
    source: OSM_INTERSECTIONS_SOURCE_ID,
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
  });

  map.addLayer({
    id: OSM_INTERSECTIONS_HIT_LAYER_ID,
    type: "circle",
    source: OSM_INTERSECTIONS_SOURCE_ID,
    paint: {
      "circle-radius": 9,
      "circle-color": "#ffffff",
      "circle-opacity": 0.01,
    },
  });
}

export function syncOsmGraphLayers(map, edgeFeatures, nodeFeatures) {
  if (!map) return;

  const normalizedEdges = Array.isArray(edgeFeatures) ? edgeFeatures : [];
  const normalizedNodes = Array.isArray(nodeFeatures) ? nodeFeatures : [];
  if (normalizedEdges.length === 0 && normalizedNodes.length === 0) {
    clearOsmGraphLayers(map);
    return;
  }

  const edgeData = {
    type: "FeatureCollection",
    features: normalizedEdges,
  };
  const nodeData = {
    type: "FeatureCollection",
    features: normalizedNodes,
  };

  if (map.getSource(OSM_GRAPH_EDGES_SOURCE_ID)) {
    map.getSource(OSM_GRAPH_EDGES_SOURCE_ID).setData(edgeData);
  } else if (normalizedEdges.length > 0) {
    map.addSource(OSM_GRAPH_EDGES_SOURCE_ID, {
      type: "geojson",
      data: edgeData,
    });
    addLayerBeforeIntersections(map, {
      id: OSM_GRAPH_EDGES_LAYER_ID,
      type: "line",
      source: OSM_GRAPH_EDGES_SOURCE_ID,
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
    });
    addLayerBeforeIntersections(map, {
      id: OSM_GRAPH_EDGES_HIT_LAYER_ID,
      type: "line",
      source: OSM_GRAPH_EDGES_SOURCE_ID,
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": "#ffffff",
        "line-width": 10,
        "line-opacity": 0.01,
      },
    });
    addLayerBeforeIntersections(map, {
      id: OSM_GRAPH_EDGES_HOVER_LAYER_ID,
      type: "line",
      source: OSM_GRAPH_EDGES_SOURCE_ID,
      filter: ["==", ["get", "edgeId"], ""],
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
    });
  }

  if (map.getSource(OSM_GRAPH_NODES_SOURCE_ID)) {
    map.getSource(OSM_GRAPH_NODES_SOURCE_ID).setData(nodeData);
  } else if (normalizedNodes.length > 0) {
    map.addSource(OSM_GRAPH_NODES_SOURCE_ID, {
      type: "geojson",
      data: nodeData,
    });
    addLayerBeforeIntersections(map, {
      id: OSM_GRAPH_NODES_LAYER_ID,
      type: "circle",
      source: OSM_GRAPH_NODES_SOURCE_ID,
      minzoom: 12,
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
    });
  }
}

export function syncCwOsmMatchLayers(map, features) {
  if (!map) return;

  const normalizedFeatures = Array.isArray(features) ? features : [];
  if (normalizedFeatures.length === 0) {
    clearCwOsmMatchLayers(map);
    return;
  }

  const data = {
    type: "FeatureCollection",
    features: normalizedFeatures,
  };

  if (map.getSource(CW_OSM_MATCH_SOURCE_ID)) {
    map.getSource(CW_OSM_MATCH_SOURCE_ID).setData(data);
    return;
  }

  map.addSource(CW_OSM_MATCH_SOURCE_ID, {
    type: "geojson",
    data,
  });

  addLayerBeforeIntersections(map, {
    id: CW_OSM_MATCH_MATCHED_LAYER_ID,
    type: "line",
    source: CW_OSM_MATCH_SOURCE_ID,
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
  });

  addLayerBeforeIntersections(map, {
    id: CW_OSM_MATCH_GAP_LAYER_ID,
    type: "line",
    source: CW_OSM_MATCH_SOURCE_ID,
    filter: ["==", ["get", "kind"], "gap"],
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
  });

  addLayerBeforeIntersections(map, {
    id: CW_OSM_MATCH_HOVER_LAYER_ID,
    type: "line",
    source: CW_OSM_MATCH_SOURCE_ID,
    filter: ["==", ["get", "segmentId"], -1],
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
  });

  addLayerBeforeIntersections(map, {
    id: CW_OSM_MATCH_FOCUS_LAYER_ID,
    type: "line",
    source: CW_OSM_MATCH_SOURCE_ID,
    filter: ["==", ["get", "segmentId"], -1],
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
  });

  addLayerBeforeIntersections(map, {
    id: CW_OSM_MATCH_HIT_LAYER_ID,
    type: "line",
    source: CW_OSM_MATCH_SOURCE_ID,
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
    paint: {
      "line-color": "#ffffff",
      "line-width": 18,
      "line-opacity": 0.01,
    },
  });
}

export function syncCwOsmReviewLayers(map, feature) {
  if (!map) return;

  if (!feature?.geometry || feature.geometry.type !== "LineString") {
    clearCwOsmReviewLayers(map);
    return;
  }

  const data = {
    type: "FeatureCollection",
    features: [feature],
  };

  if (map.getSource(CW_OSM_REVIEW_SOURCE_ID)) {
    map.getSource(CW_OSM_REVIEW_SOURCE_ID).setData(data);
    return;
  }

  map.addSource(CW_OSM_REVIEW_SOURCE_ID, {
    type: "geojson",
    data,
  });

  addLayerBeforeIntersections(map, {
    id: CW_OSM_REVIEW_HALO_LAYER_ID,
    type: "line",
    source: CW_OSM_REVIEW_SOURCE_ID,
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
  });

  addLayerBeforeIntersections(map, {
    id: CW_OSM_REVIEW_LINE_LAYER_ID,
    type: "line",
    source: CW_OSM_REVIEW_SOURCE_ID,
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
  });
}

export function clearCwOsmReviewLayers(map) {
  if (!map) return;

  [CW_OSM_REVIEW_LINE_LAYER_ID, CW_OSM_REVIEW_HALO_LAYER_ID].forEach((layerId) => {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
  });

  if (map.getSource(CW_OSM_REVIEW_SOURCE_ID)) {
    map.removeSource(CW_OSM_REVIEW_SOURCE_ID);
  }
}

function addLayerBeforeIntersections(map, layer) {
  const beforeLayerId = map.getLayer(OSM_INTERSECTIONS_LAYER_ID)
    ? OSM_INTERSECTIONS_LAYER_ID
    : undefined;
  map.addLayer(layer, beforeLayerId);
}

function addLayerBeforeRouteNetwork(map, layer) {
  const beforeLayerId = map.getLayer(ROUTE_NETWORK_LINE_LAYER_ID)
    ? ROUTE_NETWORK_LINE_LAYER_ID
    : undefined;
  map.addLayer(layer, beforeLayerId);
}

export async function loadDataMarkerIcons(map) {
  if (!map || typeof Image === "undefined") return;

  await Promise.all(
    Object.entries(DATA_MARKER_ICON_FILES).map(async ([iconName, iconPath]) => {
      try {
        if (typeof map.hasImage === "function" && map.hasImage(iconName)) {
          return;
        }

        const response = await fetch(iconPath);
        if (!response.ok) {
          throw new Error(`${iconPath}: HTTP ${response.status}`);
        }
        const svgText = await response.text();
        const svgBlob = new Blob([svgText], { type: "image/svg+xml" });
        const objectUrl = URL.createObjectURL(svgBlob);
        const image = new Image();

        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = reject;
          image.src = objectUrl;
        });

        if (typeof map.hasImage !== "function" || !map.hasImage(iconName)) {
          map.addImage?.(iconName, image);
        }
        URL.revokeObjectURL(objectUrl);
      } catch (error) {
        console.warn(`Failed to load custom icon ${iconName}:`, error);
      }
    }),
  );
}

export function syncRoutePointLayers(map, routePoints, selectedRoutePointIndex) {
  const lastRoutePointIndex = routePoints.length - 1;
  const data = {
    type: "FeatureCollection",
    features: routePoints.map((point, index) => {
      const endpoint =
        index === 0 ? "start" : index === lastRoutePointIndex ? "end" : "middle";
      return {
        type: "Feature",
        id: point.id,
        geometry: {
          type: "Point",
          coordinates: [point.lng, point.lat],
        },
        properties: {
          id: point.id,
          index,
          endpoint,
          pending: Boolean(point.pending),
          selected: index === selectedRoutePointIndex,
        },
      };
    }),
  };

  if (map.getSource(ROUTE_POINTS_SOURCE_ID)) {
    map.getSource(ROUTE_POINTS_SOURCE_ID).setData(data);
    return;
  }

  map.addSource(ROUTE_POINTS_SOURCE_ID, {
    type: "geojson",
    data,
  });

  map.addLayer({
    id: ROUTE_POINTS_LAYER_ID,
    type: "circle",
    source: ROUTE_POINTS_SOURCE_ID,
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
  });
}

export function syncRouteGeometryLayer(map, routeGeometry, dragPreview = null) {
  const data = buildRouteGeometryFeatureCollection(routeGeometry, dragPreview);

  if (map.getSource(ROUTE_GEOMETRY_SOURCE_ID)) {
    map.getSource(ROUTE_GEOMETRY_SOURCE_ID).setData(data);
    addRouteGeometryHitLayer(map);
    return;
  }

  map.addSource(ROUTE_GEOMETRY_SOURCE_ID, {
    type: "geojson",
    data,
  });

  map.addLayer({
    id: ROUTE_GEOMETRY_LAYER_ID,
    type: "line",
    source: ROUTE_GEOMETRY_SOURCE_ID,
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
  });

  addRouteGeometryHitLayer(map);
}

export function buildRouteGeometryFeatureCollection(routeGeometry, dragPreview = null) {
  const coordinates = Array.isArray(routeGeometry)
    ? routeGeometry
        .map((point) => [Number(point.lng), Number(point.lat)])
        .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))
    : [];

  if (coordinates.length < 2) {
    return { type: "FeatureCollection", features: [] };
  }

  const affectedRange = routeGeometryAffectedRange(routeGeometry, dragPreview);
  if (!affectedRange) {
    return {
      type: "FeatureCollection",
      features: [routeGeometryFeature(coordinates, false)],
    };
  }

  const { start, end } = affectedRange;
  const features = [];
  addRouteGeometrySliceFeature(features, coordinates, 0, start, false);
  addRouteGeometrySliceFeature(features, coordinates, start, end, true);
  addRouteGeometrySliceFeature(
    features,
    coordinates,
    end,
    coordinates.length - 1,
    false,
  );

  return { type: "FeatureCollection", features };
}

function routeGeometryAffectedRange(routeGeometry, dragPreview) {
  if (!dragPreview || !Array.isArray(dragPreview.points)) return null;
  const points = dragPreview.points.map(normalizePoint);
  if (points.length < 2) return null;

  const pointIndices = points.map((point) =>
    nearestRouteGeometryIndex(point, routeGeometry),
  );

  let start = null;
  let end = null;
  if (dragPreview.mode === "insert") {
    const insertIndex = clampInteger(dragPreview.insertIndex, 0, points.length);
    start = pointIndices[insertIndex - 1] ?? null;
    end = pointIndices[insertIndex] ?? null;
  } else {
    const index = clampInteger(dragPreview.index, 0, points.length - 1);
    start = pointIndices[index - 1] ?? pointIndices[index] ?? null;
    end = pointIndices[index + 1] ?? pointIndices[index] ?? null;
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start === end) {
    return null;
  }

  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
  };
}

function nearestRouteGeometryIndex(point, routeGeometry) {
  const normalizedPoint = normalizePoint(point);
  if (!normalizedPoint || !Array.isArray(routeGeometry)) return null;

  let bestIndex = null;
  let bestDistance = Infinity;
  routeGeometry.forEach((candidate, index) => {
    const normalizedCandidate = normalizePoint(candidate);
    if (!normalizedCandidate) return;
    const dLat = normalizedCandidate.lat - normalizedPoint.lat;
    const dLng = normalizedCandidate.lng - normalizedPoint.lng;
    const distance = dLat * dLat + dLng * dLng;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function addRouteGeometrySliceFeature(features, coordinates, start, end, affected) {
  if (end - start < 1) return;
  features.push(routeGeometryFeature(coordinates.slice(start, end + 1), affected));
}

function routeGeometryFeature(coordinates, affected) {
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates,
    },
    properties: { affected },
  };
}

function addRouteGeometryHitLayer(map) {
  if (map.getLayer(ROUTE_GEOMETRY_HIT_LAYER_ID)) return;
  if (!map.getSource(ROUTE_GEOMETRY_SOURCE_ID)) return;

  map.addLayer({
    id: ROUTE_GEOMETRY_HIT_LAYER_ID,
    type: "line",
    source: ROUTE_GEOMETRY_SOURCE_ID,
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
    paint: {
      "line-color": "#000000",
      "line-width": 18,
      "line-opacity": 0.01,
    },
  });
}

export function syncRoutePointDragPreviewLayer(map, preview) {
  const data = buildRoutePointDragPreviewFeatureCollection(preview);

  if (map.getSource(ROUTE_POINT_DRAG_PREVIEW_SOURCE_ID)) {
    map.getSource(ROUTE_POINT_DRAG_PREVIEW_SOURCE_ID).setData(data);
    return;
  }

  if (data.features.length === 0) return;

  map.addSource(ROUTE_POINT_DRAG_PREVIEW_SOURCE_ID, {
    type: "geojson",
    data,
  });

  const beforePointLayer = map.getLayer(ROUTE_POINTS_LAYER_ID)
    ? ROUTE_POINTS_LAYER_ID
    : undefined;

  map.addLayer(
    {
      id: ROUTE_POINT_DRAG_PREVIEW_LINE_CASING_LAYER_ID,
      type: "line",
      source: ROUTE_POINT_DRAG_PREVIEW_SOURCE_ID,
      filter: ["==", ["geometry-type"], "LineString"],
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
    },
    beforePointLayer,
  );

  map.addLayer(
    {
      id: ROUTE_POINT_DRAG_PREVIEW_LINE_LAYER_ID,
      type: "line",
      source: ROUTE_POINT_DRAG_PREVIEW_SOURCE_ID,
      filter: ["==", ["geometry-type"], "LineString"],
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
    },
    beforePointLayer,
  );

  map.addLayer(
    {
      id: ROUTE_POINT_DRAG_PREVIEW_HALO_LAYER_ID,
      type: "circle",
      source: ROUTE_POINT_DRAG_PREVIEW_SOURCE_ID,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 9,
        "circle-color": "rgba(217, 243, 248, 0.14)",
        "circle-stroke-color": "#d9f3f8",
        "circle-stroke-width": 1.5,
        "circle-stroke-opacity": 0.86,
      },
    },
    beforePointLayer,
  );
}

export function clearRoutePointDragPreviewLayer(map) {
  if (map.getLayer(ROUTE_POINT_DRAG_PREVIEW_HALO_LAYER_ID)) {
    map.removeLayer(ROUTE_POINT_DRAG_PREVIEW_HALO_LAYER_ID);
  }
  if (map.getLayer(ROUTE_POINT_DRAG_PREVIEW_LINE_LAYER_ID)) {
    map.removeLayer(ROUTE_POINT_DRAG_PREVIEW_LINE_LAYER_ID);
  }
  if (map.getLayer(ROUTE_POINT_DRAG_PREVIEW_LINE_CASING_LAYER_ID)) {
    map.removeLayer(ROUTE_POINT_DRAG_PREVIEW_LINE_CASING_LAYER_ID);
  }
  if (map.getSource(ROUTE_POINT_DRAG_PREVIEW_SOURCE_ID)) {
    map.removeSource(ROUTE_POINT_DRAG_PREVIEW_SOURCE_ID);
  }
}

export function buildRoutePointDragPreviewFeatureCollection(preview) {
  const empty = { type: "FeatureCollection", features: [] };
  const cursor = normalizePoint(preview);
  if (!cursor || !Array.isArray(preview?.points)) return empty;

  const points = preview.points.map(normalizePoint);
  const neighbors = dragPreviewNeighbors(points, preview);
  const lineFeatures = [];

  if (neighbors.previous) {
    lineFeatures.push(dragPreviewLineFeature(neighbors.previous, cursor));
  }
  if (neighbors.next) {
    lineFeatures.push(dragPreviewLineFeature(cursor, neighbors.next));
  }

  return {
    type: "FeatureCollection",
    features: [
      ...lineFeatures,
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [cursor.lng, cursor.lat],
        },
        properties: { kind: "cursor" },
      },
    ],
  };
}

function dragPreviewNeighbors(points, preview) {
  if (preview.mode === "insert") {
    const insertIndex = clampInteger(preview.insertIndex, 0, points.length);
    return {
      previous: points[insertIndex - 1] || null,
      next: points[insertIndex] || null,
    };
  }

  const index = clampInteger(preview.index, 0, points.length - 1);
  return {
    previous: points[index - 1] || null,
    next: points[index + 1] || null,
  };
}

function dragPreviewLineFeature(from, to) {
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [from.lng, from.lat],
        [to.lng, to.lat],
      ],
    },
    properties: { kind: "guide" },
  };
}

function normalizePoint(point) {
  const lng = Number(point?.lng);
  const lat = Number(point?.lat);
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
}

function clampInteger(value, min, max) {
  if (!Number.isInteger(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function syncRouteDirectionPulseLayer(map, routeGeometry, progress) {
  const data = buildRouteDirectionPulseFeatureCollection(routeGeometry, progress);

  if (map.getSource(ROUTE_DIRECTION_PULSE_SOURCE_ID)) {
    map.getSource(ROUTE_DIRECTION_PULSE_SOURCE_ID).setData(data);
    return;
  }

  if (data.features.length === 0) return;

  map.addSource(ROUTE_DIRECTION_PULSE_SOURCE_ID, {
    type: "geojson",
    data,
    lineMetrics: true,
  });

  const beforePointLayer = map.getLayer(ROUTE_POINTS_LAYER_ID)
    ? ROUTE_POINTS_LAYER_ID
    : undefined;

  map.addLayer(
    {
      id: ROUTE_DIRECTION_PULSE_CASING_LAYER_ID,
      type: "line",
      source: ROUTE_DIRECTION_PULSE_SOURCE_ID,
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
    },
    beforePointLayer,
  );

  map.addLayer(
    {
      id: ROUTE_DIRECTION_PULSE_CORE_LAYER_ID,
      type: "line",
      source: ROUTE_DIRECTION_PULSE_SOURCE_ID,
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
    },
    beforePointLayer,
  );
}

export function clearRouteDirectionPulseLayer(map) {
  if (map.getLayer(ROUTE_DIRECTION_PULSE_CORE_LAYER_ID)) {
    map.removeLayer(ROUTE_DIRECTION_PULSE_CORE_LAYER_ID);
  }
  if (map.getLayer(ROUTE_DIRECTION_PULSE_CASING_LAYER_ID)) {
    map.removeLayer(ROUTE_DIRECTION_PULSE_CASING_LAYER_ID);
  }
  if (map.getSource(ROUTE_DIRECTION_PULSE_SOURCE_ID)) {
    map.removeSource(ROUTE_DIRECTION_PULSE_SOURCE_ID);
  }
}

export function buildRouteDirectionPulseFeatureCollection(routeGeometry, progress) {
  const empty = { type: "FeatureCollection", features: [] };
  if (!Number.isFinite(progress)) return empty;

  const points = normalizeRouteGeometry(routeGeometry);
  if (points.length < 2) return empty;

  const arc = precomputeRoutePulseArc(points);
  if (!(arc.totalDistMeters > 0)) return empty;

  const pulseMeters = Math.min(
    Math.max(arc.totalDistMeters * 0.045, 80),
    420,
  );
  const headDist = Math.min(
    arc.totalDistMeters,
    Math.max(0, progress) * arc.totalDistMeters,
  );
  const visibleHeadDist = Math.min(
    arc.totalDistMeters,
    Math.max(headDist, Math.min(pulseMeters * 0.35, arc.totalDistMeters)),
  );
  const tailDist = Math.max(0, visibleHeadDist - pulseMeters);
  const coordinates = sliceRoutePulseCoordinates(
    points,
    arc.cumDist,
    tailDist,
    visibleHeadDist,
  );

  return coordinates.length >= 2
    ? {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates,
            },
            properties: {},
          },
        ],
      }
    : empty;
}

function normalizeRouteGeometry(routeGeometry) {
  return Array.isArray(routeGeometry)
    ? routeGeometry
        .map((point) => ({
          lng: Number(point?.lng),
          lat: Number(point?.lat),
        }))
        .filter(
          (point) => Number.isFinite(point.lng) && Number.isFinite(point.lat),
        )
    : [];
}

function precomputeRoutePulseArc(points) {
  const cumDist = new Float64Array(points.length);
  let totalDistMeters = 0;

  for (let i = 1; i < points.length; i++) {
    const distance = getDistance(points[i - 1], points[i]);
    totalDistMeters += Number.isFinite(distance) && distance > 0 ? distance : 0;
    cumDist[i] = totalDistMeters;
  }

  return { cumDist, totalDistMeters };
}

function sliceRoutePulseCoordinates(points, cumDist, startDist, endDist) {
  const coordinates = [routePulsePointAtDistance(points, cumDist, startDist)];

  for (let i = 1; i < points.length - 1; i++) {
    if (cumDist[i] > startDist && cumDist[i] < endDist) {
      coordinates.push([points[i].lng, points[i].lat]);
    }
  }

  coordinates.push(routePulsePointAtDistance(points, cumDist, endDist));
  return coordinates.filter((coordinate, index, arr) => {
    if (index === 0) return true;
    const previous = arr[index - 1];
    return coordinate[0] !== previous[0] || coordinate[1] !== previous[1];
  });
}

function routePulsePointAtDistance(points, cumDist, distanceMeters) {
  const target = Math.max(
    0,
    Math.min(distanceMeters, cumDist[cumDist.length - 1]),
  );
  let segmentIndex = 0;

  while (
    segmentIndex < cumDist.length - 2 &&
    cumDist[segmentIndex + 1] < target
  ) {
    segmentIndex++;
  }

  const a = points[segmentIndex];
  const b = points[segmentIndex + 1];
  const segmentStart = cumDist[segmentIndex];
  const segmentLength = cumDist[segmentIndex + 1] - segmentStart;
  const fraction =
    segmentLength > 0 ? (target - segmentStart) / segmentLength : 0;

  return [
    a.lng + (b.lng - a.lng) * fraction,
    a.lat + (b.lat - a.lat) * fraction,
  ];
}

export function syncRouteDirectionLitPointLayer(map, payload) {
  const data = {
    type: "FeatureCollection",
    features:
      payload && Number.isFinite(payload.lng) && Number.isFinite(payload.lat)
        ? [
            {
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [payload.lng, payload.lat],
              },
              properties: {
                index: payload.displayIndex,
              },
            },
          ]
        : [],
  };

  if (map.getSource(ROUTE_DIRECTION_LIT_POINT_SOURCE_ID)) {
    map.getSource(ROUTE_DIRECTION_LIT_POINT_SOURCE_ID).setData(data);
    return;
  }

  map.addSource(ROUTE_DIRECTION_LIT_POINT_SOURCE_ID, {
    type: "geojson",
    data,
  });

  map.addLayer({
    id: ROUTE_DIRECTION_LIT_POINT_CIRCLE_LAYER_ID,
    type: "circle",
    source: ROUTE_DIRECTION_LIT_POINT_SOURCE_ID,
    paint: {
      "circle-radius": 6,
      "circle-color": "#ff4444",
      "circle-stroke-color": "#d9f3f8",
      "circle-stroke-width": 2.25,
      "circle-blur": 0.18,
    },
  });

  map.addLayer({
    id: ROUTE_DIRECTION_LIT_POINT_TEXT_LAYER_ID,
    type: "symbol",
    source: ROUTE_DIRECTION_LIT_POINT_SOURCE_ID,
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
  });
}

export function clearRouteDirectionLitPointLayer(map) {
  if (map.getLayer(ROUTE_DIRECTION_LIT_POINT_TEXT_LAYER_ID)) {
    map.removeLayer(ROUTE_DIRECTION_LIT_POINT_TEXT_LAYER_ID);
  }
  if (map.getLayer(ROUTE_DIRECTION_LIT_POINT_CIRCLE_LAYER_ID)) {
    map.removeLayer(ROUTE_DIRECTION_LIT_POINT_CIRCLE_LAYER_ID);
  }
  if (map.getSource(ROUTE_DIRECTION_LIT_POINT_SOURCE_ID)) {
    map.removeSource(ROUTE_DIRECTION_LIT_POINT_SOURCE_ID);
  }
}

export function dataMarkerFeaturesFromSegments(segmentsData) {
  const features = [];

  Object.entries(segmentsData || {}).forEach(([segmentName, segmentInfo]) => {
    if (!Array.isArray(segmentInfo?.data)) return;

    segmentInfo.data.forEach((dataPoint, index) => {
      const location = dataPoint?.location;
      if (!Array.isArray(location) || location.length < 2) return;

      const [lat, lng] = location;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      const dataPointId = `${segmentName}-${index}`;
      features.push({
        type: "Feature",
        id: dataPointId,
        geometry: {
          type: "Point",
          coordinates: [lng, lat],
        },
        properties: {
          dataPointId,
          type: dataPoint.type || "warning",
          information: dataPoint.information || "",
          segmentName,
          emoji: DATA_MARKER_EMOJIS[dataPoint.type] || "📍",
          icon: DATA_MARKER_ICONS[dataPoint.type] || "marker-11",
        },
      });
    });
  });

  return features;
}

export function syncDataMarkerLayers(
  map,
  dataMarkerFeatures,
  activeDataPointIds = [],
) {
  const activeIds = new Set(activeDataPointIds);
  const data = {
    type: "FeatureCollection",
    features: dataMarkerFeatures.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        active: activeIds.has(feature.properties?.dataPointId),
      },
    })),
  };

  if (map.getSource(DATA_MARKERS_SOURCE_ID)) {
    map.getSource(DATA_MARKERS_SOURCE_ID).setData(data);
    return;
  }

  map.addSource(DATA_MARKERS_SOURCE_ID, {
    type: "geojson",
    data,
  });

  map.addLayer({
    id: DATA_MARKERS_LAYER_ID,
    type: "symbol",
    source: DATA_MARKERS_SOURCE_ID,
    layout: {
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
  });
}

const VIDEO_CURSOR_SOURCE_ID = "video-cursor-source";
const VIDEO_CURSOR_LAYER_ID = "video-cursor-layer";

export function syncVideoCursorLayer(map, cursor) {
  if (!map || !map.isStyleLoaded()) return;
  const features =
    cursor && Number.isFinite(cursor.lat) && Number.isFinite(cursor.lng)
      ? [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [cursor.lng, cursor.lat] },
            properties: {},
          },
        ]
      : [];
  const data = { type: "FeatureCollection", features };
  if (!map.getSource(VIDEO_CURSOR_SOURCE_ID)) {
    map.addSource(VIDEO_CURSOR_SOURCE_ID, { type: "geojson", data });
    map.addLayer({
      id: VIDEO_CURSOR_LAYER_ID,
      type: "circle",
      source: VIDEO_CURSOR_SOURCE_ID,
      paint: {
        "circle-radius": 9,
        "circle-color": "#ff3d3d",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 3,
      },
    });
  } else {
    map.getSource(VIDEO_CURSOR_SOURCE_ID).setData(data);
  }
}

export function getGeoJsonBounds(mapboxgl, geoJsonData) {
  const bounds = new mapboxgl.LngLatBounds();

  for (const feature of geoJsonData?.features || []) {
    if (feature?.geometry?.type !== "LineString") continue;
    for (const coord of feature.geometry.coordinates || []) {
      bounds.extend(coord);
    }
  }

  return bounds;
}
