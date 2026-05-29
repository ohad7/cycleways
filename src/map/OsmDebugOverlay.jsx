// OsmDebugOverlay: web-only developer tooling that layers OSM debug/review data
// (raw ways, base-graph edges/nodes, CycleWays↔OSM match/review) onto the live
// map instance owned by MapSurface. Renders null. NOT part of the portable
// MapSurface contract and not ported to React Native.
import { useEffect, useRef } from "react";
import {
  addOsmDebugLayers,
  clearOsmDebugLayers,
  clearOsmRawLayers,
  CW_OSM_MATCH_HIT_LAYER_ID,
  CW_OSM_MATCH_HOVER_LAYER_ID,
  OSM_DEBUG_HIT_LAYER_ID,
  OSM_GRAPH_EDGES_HOVER_LAYER_ID,
  OSM_GRAPH_EDGES_HIT_LAYER_ID,
  OSM_INTERSECTIONS_HIT_LAYER_ID,
  setCwOsmMatchFocus,
  setCwOsmMatchHover,
  setOsmDebugHover,
  setOsmGraphEdgeHover,
  syncCwOsmMatchLayers,
  syncCwOsmReviewLayers,
  syncOsmGraphLayers,
  syncOsmIntersectionLayers,
} from "./mapLayers.js";
import { getMapboxGl } from "./mapboxProvider.js";

function OsmDebugOverlay({
  map,
  osmDebugMode = false,
  osmDebugLayerMode = "ways",
  osmDebugGeoJson = null,
  osmGraphEdgesGeoJson = null,
  osmGraphNodesGeoJson = null,
  cwOsmMatchGeoJson = null,
  osmIntersectionsGeoJson = null,
  selectedCwOsmReviewFeature = null,
  selectedCwOsmReviewSegmentId = null,
  onOsmDebugHover,
  onOsmGraphEdgeHover,
  onCwOsmMatchHover,
}) {
  const callbacksRef = useRef({});

  useEffect(() => {
    callbacksRef.current = {
      onOsmDebugHover,
      onOsmGraphEdgeHover,
      onCwOsmMatchHover,
    };
  }, [onOsmDebugHover, onOsmGraphEdgeHover, onCwOsmMatchHover]);

  useEffect(() => {
    if (!map) return undefined;

    if (!osmDebugMode) {
      clearOsmDebugLayers(map);
      callbacksRef.current.onOsmDebugHover?.(null);
      return undefined;
    }

    if (osmDebugLayerMode !== "ways") {
      clearOsmRawLayers(map);
      callbacksRef.current.onOsmDebugHover?.(null);
      return undefined;
    }

    const features = (osmDebugGeoJson?.features || []).filter(
      (feature) => feature?.geometry?.type === "LineString",
    );
    if (features.length === 0) {
      clearOsmDebugLayers(map);
      callbacksRef.current.onOsmDebugHover?.(null);
      return undefined;
    }

    addOsmDebugLayers(map, features);

    let popup = null;
    const handleOsmClick = (event) => {
      if (findOsmIntersectionFeatureAtClick(map, event)) return;
      if (findOsmGraphEdgeFeatureAtClick(map, event)) return;

      const feature = findOsmDebugFeatureAtClick(map, event);
      if (!feature) return;

      event.preventDefault?.();
      event.originalEvent?.stopPropagation?.();
      popup?.remove();
      const { Popup } = getMapboxGl();
      popup = new Popup({ maxWidth: "360px" })
        .setLngLat(event.lngLat)
        .setHTML(osmPopupHtml(feature.properties || {}))
        .addTo(map);
    };
    const handleOsmMouseEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const handleOsmMouseMove = (event) => {
      const feature = event.features?.[0];
      const osmId = feature?.properties?.osmId;
      setOsmDebugHover(map, osmId);
      callbacksRef.current.onOsmDebugHover?.(
        feature ? normalizeOsmDebugProperties(feature.properties || {}) : null,
      );
    };
    const handleOsmMouseLeave = () => {
      map.getCanvas().style.cursor = "";
      setOsmDebugHover(map, null);
      callbacksRef.current.onOsmDebugHover?.(null);
    };

    map.on("click", handleOsmClick);
    map.on("mouseenter", OSM_DEBUG_HIT_LAYER_ID, handleOsmMouseEnter);
    map.on("mousemove", OSM_DEBUG_HIT_LAYER_ID, handleOsmMouseMove);
    map.on("mouseleave", OSM_DEBUG_HIT_LAYER_ID, handleOsmMouseLeave);

    return () => {
      popup?.remove();
      map.off("click", handleOsmClick);
      map.off("mouseenter", OSM_DEBUG_HIT_LAYER_ID, handleOsmMouseEnter);
      map.off("mousemove", OSM_DEBUG_HIT_LAYER_ID, handleOsmMouseMove);
      map.off("mouseleave", OSM_DEBUG_HIT_LAYER_ID, handleOsmMouseLeave);
      callbacksRef.current.onOsmDebugHover?.(null);
      clearOsmRawLayers(map);
    };
  }, [osmDebugGeoJson, osmDebugLayerMode, osmDebugMode]);

  useEffect(() => {
    if (!map) return undefined;

    const edgeFeatures =
      osmDebugMode &&
      osmDebugLayerMode === "graph" &&
      Array.isArray(osmGraphEdgesGeoJson?.features)
        ? osmGraphEdgesGeoJson.features
        : [];
    const nodeFeatures =
      osmDebugMode &&
      osmDebugLayerMode === "graph" &&
      Array.isArray(osmGraphNodesGeoJson?.features)
        ? osmGraphNodesGeoJson.features
        : [];
    syncOsmGraphLayers(map, edgeFeatures, nodeFeatures);
    if (edgeFeatures.length === 0 || !map.getLayer(OSM_GRAPH_EDGES_HIT_LAYER_ID)) {
      callbacksRef.current.onOsmGraphEdgeHover?.(null);
      return undefined;
    }

    let popup = null;
    const handleGraphEdgeClick = (event) => {
      if (findOsmIntersectionFeatureAtClick(map, event)) return;

      const feature = event.features?.[0];
      if (!feature) return;

      event.preventDefault?.();
      event.originalEvent?.stopPropagation?.();
      popup?.remove();
      const { Popup } = getMapboxGl();
      popup = new Popup({ maxWidth: "380px" })
        .setLngLat(event.lngLat)
        .setHTML(osmGraphEdgePopupHtml(feature.properties || {}))
        .addTo(map);
    };
    const handleGraphMouseEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const handleGraphMouseMove = (event) => {
      const feature = event.features?.[0];
      const edgeId = feature?.properties?.edgeId;
      setOsmGraphEdgeHover(map, edgeId);
      callbacksRef.current.onOsmGraphEdgeHover?.(
        feature ? normalizeOsmGraphEdgeProperties(feature.properties || {}) : null,
      );
    };
    const handleGraphMouseLeave = () => {
      map.getCanvas().style.cursor = "";
      setOsmGraphEdgeHover(map, null);
      callbacksRef.current.onOsmGraphEdgeHover?.(null);
    };

    map.on("click", OSM_GRAPH_EDGES_HIT_LAYER_ID, handleGraphEdgeClick);
    map.on("mouseenter", OSM_GRAPH_EDGES_HIT_LAYER_ID, handleGraphMouseEnter);
    map.on("mousemove", OSM_GRAPH_EDGES_HIT_LAYER_ID, handleGraphMouseMove);
    map.on("mouseleave", OSM_GRAPH_EDGES_HIT_LAYER_ID, handleGraphMouseLeave);

    return () => {
      popup?.remove();
      if (map.getLayer(OSM_GRAPH_EDGES_HIT_LAYER_ID)) {
        map.off("click", OSM_GRAPH_EDGES_HIT_LAYER_ID, handleGraphEdgeClick);
        map.off("mouseenter", OSM_GRAPH_EDGES_HIT_LAYER_ID, handleGraphMouseEnter);
        map.off("mousemove", OSM_GRAPH_EDGES_HIT_LAYER_ID, handleGraphMouseMove);
        map.off("mouseleave", OSM_GRAPH_EDGES_HIT_LAYER_ID, handleGraphMouseLeave);
      }
      callbacksRef.current.onOsmGraphEdgeHover?.(null);
      if (map.getLayer(OSM_GRAPH_EDGES_HOVER_LAYER_ID)) {
        setOsmGraphEdgeHover(map, null);
      }
    };
  }, [
    osmDebugLayerMode,
    osmDebugMode,
    osmGraphEdgesGeoJson,
    osmGraphNodesGeoJson,
  ]);

  useEffect(() => {
    if (!map) return undefined;

    const features =
      osmDebugMode &&
      osmDebugLayerMode === "graph" &&
      Array.isArray(cwOsmMatchGeoJson?.features)
        ? cwOsmMatchGeoJson.features
        : [];
    syncCwOsmMatchLayers(map, features);
    if (features.length === 0 || !map.getLayer(CW_OSM_MATCH_HIT_LAYER_ID)) {
      callbacksRef.current.onCwOsmMatchHover?.(null);
      return undefined;
    }

    let popup = null;
    const handleMatchClick = (event) => {
      const feature = event.features?.[0];
      if (!feature) return;

      event.preventDefault?.();
      event.originalEvent?.stopPropagation?.();
      popup?.remove();
      const { Popup } = getMapboxGl();
      popup = new Popup({ maxWidth: "380px" })
        .setLngLat(event.lngLat)
        .setHTML(cwOsmMatchPopupHtml(feature.properties || {}))
        .addTo(map);
    };
    const handleMatchMouseEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const handleMatchMouseMove = (event) => {
      const feature = event.features?.[0];
      const segmentId = feature?.properties?.segmentId;
      setCwOsmMatchHover(map, segmentId);
      callbacksRef.current.onOsmGraphEdgeHover?.(null);
      callbacksRef.current.onCwOsmMatchHover?.(
        feature ? normalizeCwOsmMatchProperties(feature.properties || {}) : null,
      );
    };
    const handleMatchMouseLeave = () => {
      map.getCanvas().style.cursor = "";
      setCwOsmMatchHover(map, null);
      callbacksRef.current.onCwOsmMatchHover?.(null);
    };

    map.on("click", CW_OSM_MATCH_HIT_LAYER_ID, handleMatchClick);
    map.on("mouseenter", CW_OSM_MATCH_HIT_LAYER_ID, handleMatchMouseEnter);
    map.on("mousemove", CW_OSM_MATCH_HIT_LAYER_ID, handleMatchMouseMove);
    map.on("mouseleave", CW_OSM_MATCH_HIT_LAYER_ID, handleMatchMouseLeave);

    return () => {
      popup?.remove();
      if (map.getLayer(CW_OSM_MATCH_HIT_LAYER_ID)) {
        map.off("click", CW_OSM_MATCH_HIT_LAYER_ID, handleMatchClick);
        map.off("mouseenter", CW_OSM_MATCH_HIT_LAYER_ID, handleMatchMouseEnter);
        map.off("mousemove", CW_OSM_MATCH_HIT_LAYER_ID, handleMatchMouseMove);
        map.off("mouseleave", CW_OSM_MATCH_HIT_LAYER_ID, handleMatchMouseLeave);
      }
      callbacksRef.current.onCwOsmMatchHover?.(null);
      if (map.getLayer(CW_OSM_MATCH_HOVER_LAYER_ID)) {
        setCwOsmMatchHover(map, null);
      }
    };
  }, [cwOsmMatchGeoJson, osmDebugLayerMode, osmDebugMode]);

  useEffect(() => {
    if (!map) return;

    const shouldShowReview =
      osmDebugMode &&
      osmDebugLayerMode === "graph" &&
      selectedCwOsmReviewFeature?.geometry?.type === "LineString";

    syncCwOsmReviewLayers(map, shouldShowReview ? selectedCwOsmReviewFeature : null);
    setCwOsmMatchFocus(
      map,
      shouldShowReview ? selectedCwOsmReviewSegmentId : null,
    );

    if (!shouldShowReview) return;

    const coordinates = selectedCwOsmReviewFeature.geometry.coordinates
      .filter((coord) => coord.length >= 2)
      .map((coord) => ({ lng: Number(coord[0]), lat: Number(coord[1]) }))
      .filter((point) => Number.isFinite(point.lng) && Number.isFinite(point.lat));
    if (coordinates.length >= 2) {
      fitMapToCoordinates(map, coordinates, {
        maxZoom: 15,
        padding: 92,
      });
    }
  }, [
    osmDebugLayerMode,
    osmDebugMode,
    selectedCwOsmReviewFeature,
    selectedCwOsmReviewSegmentId,
  ]);

  useEffect(() => {
    if (!map) return undefined;

    const features =
      osmDebugMode &&
      osmDebugLayerMode === "ways" &&
      Array.isArray(osmIntersectionsGeoJson?.features)
        ? osmIntersectionsGeoJson.features
        : [];
    syncOsmIntersectionLayers(map, features);
    if (features.length === 0 || !map.getLayer(OSM_INTERSECTIONS_HIT_LAYER_ID)) {
      return undefined;
    }

    let popup = null;
    const handleIntersectionClick = (event) => {
      const feature = event.features?.[0];
      if (!feature) return;

      event.preventDefault?.();
      event.originalEvent?.stopPropagation?.();
      popup?.remove();
      const { Popup } = getMapboxGl();
      popup = new Popup({ maxWidth: "340px" })
        .setLngLat(event.lngLat)
        .setHTML(osmIntersectionPopupHtml(feature.properties || {}))
        .addTo(map);
    };

    map.on("click", OSM_INTERSECTIONS_HIT_LAYER_ID, handleIntersectionClick);

    return () => {
      popup?.remove();
      if (map.getLayer(OSM_INTERSECTIONS_HIT_LAYER_ID)) {
        map.off("click", OSM_INTERSECTIONS_HIT_LAYER_ID, handleIntersectionClick);
      }
    };
  }, [osmDebugLayerMode, osmDebugMode, osmIntersectionsGeoJson]);

  return null;
}

function fitMapToCoordinates(map, coordinates, options = {}) {
  const mapboxgl = getMapboxGl();
  const bounds = new mapboxgl.LngLatBounds();

  coordinates.forEach((point) => {
    const lng = Number(point.lng);
    const lat = Number(point.lat);
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      bounds.extend([lng, lat]);
    }
  });

  if (!bounds.isEmpty()) {
    map.fitBounds(bounds, {
      duration: 0,
      maxZoom: options.maxZoom || 14,
      padding: options.padding || 48,
    });
  }
}

function osmPopupHtml(properties) {
  const keys = [
    "osmId",
    "highway",
    "name",
    "ref",
    "surface",
    "tracktype",
    "bicycle",
    "access",
    "vehicle",
    "service",
    "bridge",
    "tunnel",
    "layer",
    "osmRouteClass",
    "accessStatus",
    "distanceMeters",
  ];
  const rows = keys
    .filter((key) => properties[key] !== undefined && properties[key] !== "")
    .map(
      (key) =>
        `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(properties[key])}</td></tr>`,
    )
    .join("");

  return `
    <div class="osm-debug-popup">
      <strong>OSM way</strong>
      <table>${rows}</table>
    </div>
  `;
}

function osmIntersectionPopupHtml(properties) {
  const wayIds = parseJsonProperty(properties.wayIds, []);
  const kinds = parseJsonProperty(properties.kinds, {});
  const rows = [
    ["id", properties.intersectionId],
    ["kind", properties.kind],
    ["ways", wayIds.join(", ")],
    ["wayCount", properties.wayCount],
    ["pairCount", properties.pairCount],
    ["kinds", Object.entries(kinds).map(([key, value]) => `${key}: ${value}`).join(", ")],
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");

  return `
    <div class="osm-debug-popup">
      <strong>OSM intersection</strong>
      <table>${rows
        .map(
          ([key, value]) =>
            `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`,
        )
        .join("")}</table>
    </div>
  `;
}

function osmGraphEdgePopupHtml(properties) {
  const rows = [
    ["edge", properties.edgeId],
    ["osmWay", properties.osmWayId],
    ["slice", properties.sliceIndex],
    ["from", properties.fromNodeId],
    ["to", properties.toNodeId],
    ["distance", `${properties.distanceMeters || 0} m`],
    ["highway", properties.highway],
    ["surface", properties.surface],
    ["tracktype", properties.tracktype],
    ["class", properties.osmRouteClass],
    ["status", properties.accessStatus],
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");

  return `
    <div class="osm-debug-popup">
      <strong>OSM graph edge</strong>
      <table>${rows
        .map(
          ([key, value]) =>
            `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`,
        )
        .join("")}</table>
    </div>
  `;
}

function cwOsmMatchPopupHtml(properties) {
  const isGap = properties.kind === "gap";
  const rows = [
    ["segment", properties.segmentName],
    ["segmentId", properties.segmentId],
    ["kind", properties.kind],
    ["confidence", properties.confidence],
    ["coverage", formatPercent(properties.coverageRatio)],
    ["edge", properties.edgeId],
    ["osmWay", properties.osmWayId],
    ["direction", properties.direction],
    ["avgDistance", formatMeters(properties.avgDistanceMeters)],
    ["gapDistance", isGap ? formatMeters(properties.distanceMeters) : null],
    ["highway", properties.graphHighway],
    ["class", properties.graphClass],
    ["status", properties.graphAccessStatus],
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");

  return `
    <div class="osm-debug-popup">
      <strong>${isGap ? "CW match gap" : "CW matched edge"}</strong>
      <table>${rows
        .map(
          ([key, value]) =>
            `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`,
        )
        .join("")}</table>
    </div>
  `;
}

function normalizeOsmDebugProperties(properties) {
  const normalized = {};
  [
    "osmId",
    "highway",
    "name",
    "ref",
    "surface",
    "tracktype",
    "bicycle",
    "access",
    "vehicle",
    "service",
    "bridge",
    "tunnel",
    "layer",
    "osmRouteClass",
    "accessStatus",
    "distanceMeters",
  ].forEach((key) => {
    if (properties[key] !== undefined && properties[key] !== "") {
      normalized[key] = properties[key];
    }
  });
  return normalized;
}

function normalizeOsmGraphEdgeProperties(properties) {
  const normalized = { debugType: "graphEdge" };
  [
    "edgeId",
    "osmWayId",
    "sliceIndex",
    "fromNodeId",
    "toNodeId",
    "highway",
    "surface",
    "tracktype",
    "bicycle",
    "access",
    "osmRouteClass",
    "accessStatus",
    "distanceMeters",
  ].forEach((key) => {
    if (properties[key] !== undefined && properties[key] !== "") {
      normalized[key] = properties[key];
    }
  });
  return normalized;
}

function normalizeCwOsmMatchProperties(properties) {
  const normalized = { debugType: properties.kind === "gap" ? "cwMatchGap" : "cwMatchEdge" };
  [
    "kind",
    "segmentId",
    "segmentName",
    "roadType",
    "confidence",
    "coverageRatio",
    "edgeId",
    "osmWayId",
    "direction",
    "sequenceIndex",
    "sampleCount",
    "avgDistanceMeters",
    "distanceMeters",
    "graphHighway",
    "graphClass",
    "graphAccessStatus",
  ].forEach((key) => {
    if (properties[key] !== undefined && properties[key] !== "") {
      normalized[key] = properties[key];
    }
  });
  return normalized;
}

function formatPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.round(number * 100)}%` : "";
}

function formatMeters(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(1)} m` : "";
}

function parseJsonProperty(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function findOsmDebugFeatureAtClick(map, event) {
  if (!map.getLayer(OSM_DEBUG_HIT_LAYER_ID)) return null;

  const radius = 8;
  const point = event.point;
  const features = map.queryRenderedFeatures(
    [
      [point.x - radius, point.y - radius],
      [point.x + radius, point.y + radius],
    ],
    { layers: [OSM_DEBUG_HIT_LAYER_ID] },
  );
  return features[0] || null;
}

function findOsmGraphEdgeFeatureAtClick(map, event) {
  if (!map.getLayer(OSM_GRAPH_EDGES_HIT_LAYER_ID)) return null;

  const radius = 6;
  const point = event.point;
  const features = map.queryRenderedFeatures(
    [
      [point.x - radius, point.y - radius],
      [point.x + radius, point.y + radius],
    ],
    { layers: [OSM_GRAPH_EDGES_HIT_LAYER_ID] },
  );
  return features[0] || null;
}

function findOsmIntersectionFeatureAtClick(map, event) {
  if (!map.getLayer(OSM_INTERSECTIONS_HIT_LAYER_ID)) return null;

  const features = map.queryRenderedFeatures(event.point, {
    layers: [OSM_INTERSECTIONS_HIT_LAYER_ID],
  });
  return features[0] || null;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default OsmDebugOverlay;
