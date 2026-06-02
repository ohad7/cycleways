// End-user map layers: route network, route geometry, route points + drag
// preview, direction pulse, data markers, and the featured-route video cursor.
// These are the layers a future React Native MapSurface will re-implement.
// dataMarkerFeaturesFromSegments now lives in the platform-agnostic data layer;
// re-exported here for back-compat (FeaturedRouteMap still imports it via the
// mapLayers barrel).
import {
  dataMarkerFeatureCollection,
  dataMarkerFeaturesFromSegments,
} from "@cycleways/core/data/dataMarkers.js";
export {
  dataMarkerFeatureCollection,
  dataMarkerFeaturesFromSegments,
};
// Network appearance logic now lives in the platform-agnostic core (shared with
// the RN map); re-exported here for back-compat via the mapLayers barrel.
import {
  getRouteFeatureColor,
  prepareRouteNetworkFeatures,
} from "@cycleways/core/domain/routeNetwork.js";
export { getRouteFeatureColor, prepareRouteNetworkFeatures };
import { buildRouteDirectionPulseFeatureCollection } from "@cycleways/core/map/routeDirectionPulse.js";
export { buildRouteDirectionPulseFeatureCollection };

import {
  ROUTE_NETWORK_SOURCE_ID,
  ROUTE_NETWORK_LINE_LAYER_ID,
  ROUTE_NETWORK_HIT_LAYER_ID,
  ROUTE_NETWORK_HOVER_LAYER_ID,
  ROUTE_NETWORK_FOCUS_LAYER_ID,
  ROUTE_GEOMETRY_SOURCE_ID,
  ROUTE_GEOMETRY_LAYER_ID,
  ROUTE_GEOMETRY_HIT_LAYER_ID,
  ROUTE_POINTS_SOURCE_ID,
  ROUTE_POINTS_LAYER_ID,
  ROUTE_POINT_DRAG_PREVIEW_SOURCE_ID,
  ROUTE_POINT_DRAG_PREVIEW_LINE_CASING_LAYER_ID,
  ROUTE_POINT_DRAG_PREVIEW_LINE_LAYER_ID,
  ROUTE_POINT_DRAG_PREVIEW_HALO_LAYER_ID,
  ROUTE_DIRECTION_PULSE_SOURCE_ID,
  ROUTE_DIRECTION_PULSE_CASING_LAYER_ID,
  ROUTE_DIRECTION_PULSE_CORE_LAYER_ID,
  ROUTE_DIRECTION_LIT_POINT_SOURCE_ID,
  ROUTE_DIRECTION_LIT_POINT_CIRCLE_LAYER_ID,
  ROUTE_DIRECTION_LIT_POINT_TEXT_LAYER_ID,
  DATA_MARKERS_SOURCE_ID,
  DATA_MARKERS_LAYER_ID,
  VIDEO_CURSOR_SOURCE_ID,
  VIDEO_CURSOR_LAYER_ID,
  ROUTE_NETWORK_LINE_STYLE,
  ROUTE_NETWORK_HIT_STYLE,
  ROUTE_NETWORK_HOVER_STYLE,
  ROUTE_NETWORK_FOCUS_STYLE,
  ROUTE_GEOMETRY_LINE_STYLE,
  ROUTE_GEOMETRY_HIT_STYLE,
  ROUTE_POINTS_STYLE,
  ROUTE_POINT_DRAG_PREVIEW_LINE_CASING_STYLE,
  ROUTE_POINT_DRAG_PREVIEW_LINE_STYLE,
  ROUTE_POINT_DRAG_PREVIEW_HALO_STYLE,
  ROUTE_DIRECTION_PULSE_CASING_STYLE,
  ROUTE_DIRECTION_PULSE_CORE_STYLE,
  ROUTE_DIRECTION_LIT_POINT_CIRCLE_STYLE,
  ROUTE_DIRECTION_LIT_POINT_TEXT_STYLE,
  DATA_MARKERS_STYLE,
  VIDEO_CURSOR_STYLE,
} from "@cycleways/core/map/mapStyles.js";

const DATA_MARKER_ICON_FILES = {
  "bank-11": "/icons/bank.svg",
  "barrier-11": "/icons/barrier.svg",
  "wetland-11": "/icons/wetland.svg",
  "caution-11": "/icons/caution.svg",
  "mountain-11": "/icons/mountain.svg",
  "car-11": "/icons/car.svg",
  "roadblock-11": "/icons/roadblock.svg",
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

function setRouteNetworkFilter(map, layerId, segmentName) {
  if (!map?.getLayer(layerId)) return;

  map.setFilter(
    layerId,
    segmentName ? ["==", ["get", "name"], segmentName] : ["==", ["get", "name"], ""],
  );
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
    ...ROUTE_NETWORK_LINE_STYLE,
  });

  map.addLayer({
    id: ROUTE_NETWORK_HIT_LAYER_ID,
    type: "line",
    source: ROUTE_NETWORK_SOURCE_ID,
    ...ROUTE_NETWORK_HIT_STYLE,
  });

  map.addLayer({
    id: ROUTE_NETWORK_HOVER_LAYER_ID,
    type: "line",
    source: ROUTE_NETWORK_SOURCE_ID,
    filter: ["==", ["get", "name"], ""],
    ...ROUTE_NETWORK_HOVER_STYLE,
  });

  map.addLayer({
    id: ROUTE_NETWORK_FOCUS_LAYER_ID,
    type: "line",
    source: ROUTE_NETWORK_SOURCE_ID,
    filter: ["==", ["get", "name"], ""],
    ...ROUTE_NETWORK_FOCUS_STYLE,
  });
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
    ...ROUTE_POINTS_STYLE,
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
    ...ROUTE_GEOMETRY_LINE_STYLE,
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
    ...ROUTE_GEOMETRY_HIT_STYLE,
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
      ...ROUTE_POINT_DRAG_PREVIEW_LINE_CASING_STYLE,
    },
    beforePointLayer,
  );

  map.addLayer(
    {
      id: ROUTE_POINT_DRAG_PREVIEW_LINE_LAYER_ID,
      type: "line",
      source: ROUTE_POINT_DRAG_PREVIEW_SOURCE_ID,
      filter: ["==", ["geometry-type"], "LineString"],
      ...ROUTE_POINT_DRAG_PREVIEW_LINE_STYLE,
    },
    beforePointLayer,
  );

  map.addLayer(
    {
      id: ROUTE_POINT_DRAG_PREVIEW_HALO_LAYER_ID,
      type: "circle",
      source: ROUTE_POINT_DRAG_PREVIEW_SOURCE_ID,
      filter: ["==", ["geometry-type"], "Point"],
      ...ROUTE_POINT_DRAG_PREVIEW_HALO_STYLE,
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
      ...ROUTE_DIRECTION_PULSE_CASING_STYLE,
    },
    beforePointLayer,
  );

  map.addLayer(
    {
      id: ROUTE_DIRECTION_PULSE_CORE_LAYER_ID,
      type: "line",
      source: ROUTE_DIRECTION_PULSE_SOURCE_ID,
      ...ROUTE_DIRECTION_PULSE_CORE_STYLE,
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
    ...ROUTE_DIRECTION_LIT_POINT_CIRCLE_STYLE,
  });

  map.addLayer({
    id: ROUTE_DIRECTION_LIT_POINT_TEXT_LAYER_ID,
    type: "symbol",
    source: ROUTE_DIRECTION_LIT_POINT_SOURCE_ID,
    ...ROUTE_DIRECTION_LIT_POINT_TEXT_STYLE,
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

export function syncDataMarkerLayers(
  map,
  dataMarkerFeatures,
  activeDataPointIds = [],
) {
  const data = dataMarkerFeatureCollection(
    dataMarkerFeatures,
    activeDataPointIds,
  );

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
    ...DATA_MARKERS_STYLE,
  });
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
      ...VIDEO_CURSOR_STYLE,
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
