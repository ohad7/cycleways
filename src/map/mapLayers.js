export const ROUTE_NETWORK_SOURCE_ID = "cycleways-network";
export const ROUTE_NETWORK_LINE_LAYER_ID = "cycleways-network-line";
export const ROUTE_NETWORK_HIT_LAYER_ID = "cycleways-network-hit";
export const ROUTE_NETWORK_HOVER_LAYER_ID = "cycleways-network-hover";
export const ROUTE_NETWORK_FOCUS_LAYER_ID = "cycleways-network-focus";
export const ROUTE_GEOMETRY_SOURCE_ID = "react-route-geometry";
export const ROUTE_GEOMETRY_LAYER_ID = "react-route-geometry-line";
export const ROUTE_POINTS_SOURCE_ID = "react-route-points";
export const ROUTE_POINTS_LAYER_ID = "react-route-points-circle";
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
  const originalColor =
    feature.properties?.stroke ||
    feature.properties?.["stroke-color"] ||
    "#0288d1";

  if (originalColor === "#0288d1" || originalColor === "rgb(2, 136, 209)") {
    return "rgb(101, 170, 162)";
  }

  if (
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
  const data = {
    type: "FeatureCollection",
    features: routePoints.map((point, index) => ({
      type: "Feature",
      id: point.id,
      geometry: {
        type: "Point",
        coordinates: [point.lng, point.lat],
      },
      properties: {
        id: point.id,
        index,
        pending: Boolean(point.pending),
        selected: index === selectedRoutePointIndex,
      },
    })),
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
        5,
        4,
      ],
      "circle-color": [
        "case",
        ["boolean", ["get", "pending"], false],
        "#f97316",
        "#ff4444",
      ],
      "circle-opacity": [
        "case",
        ["boolean", ["get", "pending"], false],
        0.78,
        1,
      ],
      "circle-stroke-width": [
        "case",
        ["boolean", ["get", "pending"], false],
        3,
        2,
      ],
      "circle-stroke-color": "#ffffff",
    },
  });
}

export function syncRouteGeometryLayer(map, routeGeometry) {
  const coordinates = Array.isArray(routeGeometry)
    ? routeGeometry
        .map((point) => [Number(point.lng), Number(point.lat)])
        .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))
    : [];
  const data = {
    type: "FeatureCollection",
    features:
      coordinates.length >= 2
        ? [
            {
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates,
              },
              properties: {},
            },
          ]
        : [],
  };

  if (map.getSource(ROUTE_GEOMETRY_SOURCE_ID)) {
    map.getSource(ROUTE_GEOMETRY_SOURCE_ID).setData(data);
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
      "line-opacity": 0.9,
    },
  });
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
