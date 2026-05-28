// Web-only OSM tooling layers: raw OSM debug ways, base-graph edges/nodes, and
// the CycleWays↔OSM match/review overlays. Not ported to React Native.
import {
  OSM_DEBUG_SOURCE_ID,
  OSM_DEBUG_LINE_LAYER_ID,
  OSM_DEBUG_RESTRICTED_LAYER_ID,
  OSM_DEBUG_HOVER_LAYER_ID,
  OSM_DEBUG_HIT_LAYER_ID,
  OSM_INTERSECTIONS_SOURCE_ID,
  OSM_INTERSECTIONS_LAYER_ID,
  OSM_INTERSECTIONS_HIT_LAYER_ID,
  OSM_GRAPH_EDGES_SOURCE_ID,
  OSM_GRAPH_EDGES_LAYER_ID,
  OSM_GRAPH_EDGES_HOVER_LAYER_ID,
  OSM_GRAPH_EDGES_HIT_LAYER_ID,
  OSM_GRAPH_NODES_SOURCE_ID,
  OSM_GRAPH_NODES_LAYER_ID,
  CW_OSM_MATCH_SOURCE_ID,
  CW_OSM_MATCH_MATCHED_LAYER_ID,
  CW_OSM_MATCH_GAP_LAYER_ID,
  CW_OSM_MATCH_HOVER_LAYER_ID,
  CW_OSM_MATCH_FOCUS_LAYER_ID,
  CW_OSM_MATCH_HIT_LAYER_ID,
  CW_OSM_REVIEW_SOURCE_ID,
  CW_OSM_REVIEW_HALO_LAYER_ID,
  CW_OSM_REVIEW_LINE_LAYER_ID,
  ROUTE_NETWORK_LINE_LAYER_ID,
  OSM_DEBUG_LINE_STYLE,
  OSM_DEBUG_RESTRICTED_STYLE,
  OSM_DEBUG_HIT_STYLE,
  OSM_DEBUG_HOVER_STYLE,
  OSM_INTERSECTIONS_STYLE,
  OSM_INTERSECTIONS_HIT_STYLE,
  OSM_GRAPH_EDGES_STYLE,
  OSM_GRAPH_EDGES_HIT_STYLE,
  OSM_GRAPH_EDGES_HOVER_STYLE,
  OSM_GRAPH_NODES_STYLE,
  CW_OSM_MATCH_MATCHED_STYLE,
  CW_OSM_MATCH_GAP_STYLE,
  CW_OSM_MATCH_HOVER_STYLE,
  CW_OSM_MATCH_FOCUS_STYLE,
  CW_OSM_MATCH_HIT_STYLE,
  CW_OSM_REVIEW_HALO_STYLE,
  CW_OSM_REVIEW_LINE_STYLE,
} from "./mapStyles.js";

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
    ...OSM_DEBUG_LINE_STYLE,
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
    ...OSM_DEBUG_RESTRICTED_STYLE,
  });

  addLayerBeforeRouteNetwork(map, {
    id: OSM_DEBUG_HIT_LAYER_ID,
    type: "line",
    source: OSM_DEBUG_SOURCE_ID,
    ...OSM_DEBUG_HIT_STYLE,
  });

  addLayerBeforeRouteNetwork(map, {
    id: OSM_DEBUG_HOVER_LAYER_ID,
    type: "line",
    source: OSM_DEBUG_SOURCE_ID,
    filter: ["==", ["get", "osmId"], ""],
    ...OSM_DEBUG_HOVER_STYLE,
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
    ...OSM_INTERSECTIONS_STYLE,
  });

  map.addLayer({
    id: OSM_INTERSECTIONS_HIT_LAYER_ID,
    type: "circle",
    source: OSM_INTERSECTIONS_SOURCE_ID,
    ...OSM_INTERSECTIONS_HIT_STYLE,
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
      ...OSM_GRAPH_EDGES_STYLE,
    });
    addLayerBeforeIntersections(map, {
      id: OSM_GRAPH_EDGES_HIT_LAYER_ID,
      type: "line",
      source: OSM_GRAPH_EDGES_SOURCE_ID,
      ...OSM_GRAPH_EDGES_HIT_STYLE,
    });
    addLayerBeforeIntersections(map, {
      id: OSM_GRAPH_EDGES_HOVER_LAYER_ID,
      type: "line",
      source: OSM_GRAPH_EDGES_SOURCE_ID,
      filter: ["==", ["get", "edgeId"], ""],
      ...OSM_GRAPH_EDGES_HOVER_STYLE,
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
      ...OSM_GRAPH_NODES_STYLE,
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
    ...CW_OSM_MATCH_MATCHED_STYLE,
  });

  addLayerBeforeIntersections(map, {
    id: CW_OSM_MATCH_GAP_LAYER_ID,
    type: "line",
    source: CW_OSM_MATCH_SOURCE_ID,
    filter: ["==", ["get", "kind"], "gap"],
    ...CW_OSM_MATCH_GAP_STYLE,
  });

  addLayerBeforeIntersections(map, {
    id: CW_OSM_MATCH_HOVER_LAYER_ID,
    type: "line",
    source: CW_OSM_MATCH_SOURCE_ID,
    filter: ["==", ["get", "segmentId"], -1],
    ...CW_OSM_MATCH_HOVER_STYLE,
  });

  addLayerBeforeIntersections(map, {
    id: CW_OSM_MATCH_FOCUS_LAYER_ID,
    type: "line",
    source: CW_OSM_MATCH_SOURCE_ID,
    filter: ["==", ["get", "segmentId"], -1],
    ...CW_OSM_MATCH_FOCUS_STYLE,
  });

  addLayerBeforeIntersections(map, {
    id: CW_OSM_MATCH_HIT_LAYER_ID,
    type: "line",
    source: CW_OSM_MATCH_SOURCE_ID,
    ...CW_OSM_MATCH_HIT_STYLE,
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
    ...CW_OSM_REVIEW_HALO_STYLE,
  });

  addLayerBeforeIntersections(map, {
    id: CW_OSM_REVIEW_LINE_LAYER_ID,
    type: "line",
    source: CW_OSM_REVIEW_SOURCE_ID,
    ...CW_OSM_REVIEW_LINE_STYLE,
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
