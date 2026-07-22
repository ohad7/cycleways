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
import { DISCOVER_ROUTE_PALETTE } from "@cycleways/core/map/discoverRouteColors.js";
import { getDistance } from "@cycleways/core/utils/distance.js";
export { buildRouteDirectionPulseFeatureCollection };

import {
  ROUTE_NETWORK_SOURCE_ID,
  ROUTE_NETWORK_LINE_LAYER_ID,
  ROUTE_NETWORK_CASING_LAYER_ID,
  ROUTE_NETWORK_SHADOW_LAYER_ID,
  ROUTE_NETWORK_HIT_LAYER_ID,
  ROUTE_NETWORK_HOVER_LAYER_ID,
  ROUTE_NETWORK_FOCUS_LAYER_ID,
  ROUTE_GEOMETRY_SOURCE_ID,
  ROUTE_GEOMETRY_LAYER_ID,
  ROUTE_GEOMETRY_CASING_LAYER_ID,
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
  DATA_MARKERS_CIRCLE_LAYER_ID,
  VIDEO_CURSOR_SOURCE_ID,
  VIDEO_CURSOR_TRAIL_SOURCE_ID,
  VIDEO_CURSOR_PROGRESS_SOURCE_ID,
  VIDEO_CURSOR_PROGRESS_LAYER_ID,
  VIDEO_CURSOR_TRAIL_LAYER_ID,
  VIDEO_CURSOR_PULSE_LAYER_ID,
  VIDEO_CURSOR_HALO_LAYER_ID,
  VIDEO_CURSOR_NAV_CIRCLE_LAYER_ID,
  VIDEO_CURSOR_LAYER_ID,
  VIDEO_CURSOR_SYMBOL_LAYER_ID,
  VIDEO_CURSOR_VARIANTS,
  VIDEO_CURSOR_DEFAULT_VARIANT,
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
  DATA_MARKERS_CIRCLE_STYLE,
  VIDEO_CURSOR_PROGRESS_STYLE,
  VIDEO_CURSOR_TRAIL_STYLE,
  VIDEO_CURSOR_PULSE_STYLE,
  VIDEO_CURSOR_HALO_STYLE,
  VIDEO_CURSOR_NAV_CIRCLE_STYLE,
  VIDEO_CURSOR_STYLE,
  VIDEO_CURSOR_SYMBOL_STYLE,
} from "@cycleways/core/map/mapStyles.js";
import {
  normalizeRouteGeometryPresentationVariant,
  routeGeometryCasingStyleForPresentation,
  routeGeometryLineStyleForPresentation,
  routeNetworkCasingStyleForPresentation,
  routeNetworkFocusStyleForPresentation,
  routeNetworkHoverStyleForPresentation,
  routeNetworkLineStyleForPresentation,
  routeNetworkPresentation,
  routeNetworkShadowStyleForPresentation,
} from "@cycleways/core/map/networkPresentation.js";
import { registerPoiEmojiImages } from "@cycleways/core/map/emojiMarkerImage.js";

const DATA_MARKER_ICON_FILES = {
  "bank-11": "/icons/bank.svg",
  "barrier-11": "/icons/barrier.svg",
  "wetland-11": "/icons/wetland.svg",
  "caution-11": "/icons/caution.svg",
  "mountain-11": "/icons/mountain.svg",
  "car-11": "/icons/car.svg",
  "roadblock-11": "/icons/roadblock.svg",
};

const VIDEO_CURSOR_OPTION_VARIANTS = new Map([
  ["1", VIDEO_CURSOR_VARIANTS.CHEVRON_HALO],
  ["2", VIDEO_CURSOR_VARIANTS.CHEVRON_TRAIL],
  ["3", VIDEO_CURSOR_VARIANTS.PROGRESS_HEAD],
  ["4", VIDEO_CURSOR_VARIANTS.NAV_CIRCLE],
  ["5", VIDEO_CURSOR_VARIANTS.PULSE_RING],
  ["6", VIDEO_CURSOR_VARIANTS.PROGRESS_HEAD_PULSE],
]);

const VIDEO_CURSOR_VARIANT_NAMES = new Set(Object.values(VIDEO_CURSOR_VARIANTS));

const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };
export const CW_ALIGNMENT_ARROW_LAYER_ID = "cw-directional-alignments-arrows";

export function clearCwAlignmentLayers(map) {
  if (!map) return;
  if (map.getLayer(CW_ALIGNMENT_ARROW_LAYER_ID)) {
    map.removeLayer(CW_ALIGNMENT_ARROW_LAYER_ID);
  }
}

export function syncCwAlignmentLayers(map, featureCollection) {
  if (!map) return;
  clearCwAlignmentLayers(map);
  const features = Array.isArray(featureCollection?.features)
    ? featureCollection.features
    : [];
  if (
    !map.getSource(ROUTE_NETWORK_SOURCE_ID) ||
    !features.some((feature) => feature?.properties?.showDirectionArrow === true)
  ) {
    return;
  }
  const beforeNetworkOverlayLayer = [
    RECOMMENDED_ROUTES_LAYER_ID,
    ROUTE_GEOMETRY_CASING_LAYER_ID,
    ROUTE_GEOMETRY_LAYER_ID,
    ROUTE_GEOMETRY_HIT_LAYER_ID,
    ROUTE_POINTS_LAYER_ID,
    DATA_MARKERS_CIRCLE_LAYER_ID,
    DATA_MARKERS_LAYER_ID,
  ].find((id) => map.getLayer(id));
  map.addLayer({
    id: CW_ALIGNMENT_ARROW_LAYER_ID,
    type: "symbol",
    source: ROUTE_NETWORK_SOURCE_ID,
    minzoom: 12,
    filter: ["==", ["get", "showDirectionArrow"], true],
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 90,
      "text-field": "➤",
      "text-size": 13,
      "text-keep-upright": false,
      "text-rotation-alignment": "map",
      "text-allow-overlap": true,
    },
    paint: {
      "text-color": "#ffffff",
      "text-halo-color": ["get", "routeColor"],
      "text-halo-width": 1.5,
    },
  }, beforeNetworkOverlayLayer);
}

export function getRouteNetworkLayerIds() {
  return [
    CW_ALIGNMENT_ARROW_LAYER_ID,
    ROUTE_NETWORK_HIT_LAYER_ID,
    ROUTE_NETWORK_FOCUS_LAYER_ID,
    ROUTE_NETWORK_HOVER_LAYER_ID,
    ROUTE_NETWORK_LINE_LAYER_ID,
    ROUTE_NETWORK_CASING_LAYER_ID,
    ROUTE_NETWORK_SHADOW_LAYER_ID,
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
  if (map.getLayer(ROUTE_GEOMETRY_CASING_LAYER_ID)) {
    map.removeLayer(ROUTE_GEOMETRY_CASING_LAYER_ID);
  }
  if (map.getSource(ROUTE_GEOMETRY_SOURCE_ID)) {
    map.removeSource(ROUTE_GEOMETRY_SOURCE_ID);
  }
}

export function clearDataMarkerLayers(map) {
  if (!map) return;
  if (map.getLayer(DATA_MARKERS_CIRCLE_LAYER_ID)) {
    map.removeLayer(DATA_MARKERS_CIRCLE_LAYER_ID);
  }
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

export function addRouteNetworkLayers(map, features, presentationOptions = {}) {
  if (!map || features.length === 0) return;

  clearRouteNetworkLayers(map);
  const presentation = routeNetworkPresentation(presentationOptions);

  map.addSource(ROUTE_NETWORK_SOURCE_ID, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features,
    },
  });

  const beforeNetworkOverlayLayer = [
    RECOMMENDED_ROUTES_LAYER_ID,
    ROUTE_GEOMETRY_CASING_LAYER_ID,
    ROUTE_GEOMETRY_LAYER_ID,
    ROUTE_GEOMETRY_HIT_LAYER_ID,
    ROUTE_POINTS_LAYER_ID,
    DATA_MARKERS_CIRCLE_LAYER_ID,
    DATA_MARKERS_LAYER_ID,
  ].find((id) => map.getLayer(id));

  if (presentation.cased) {
    map.addLayer(
      {
        id: ROUTE_NETWORK_SHADOW_LAYER_ID,
        type: "line",
        source: ROUTE_NETWORK_SOURCE_ID,
        ...routeNetworkShadowStyleForPresentation(presentation),
      },
      beforeNetworkOverlayLayer,
    );

    map.addLayer(
      {
        id: ROUTE_NETWORK_CASING_LAYER_ID,
        type: "line",
        source: ROUTE_NETWORK_SOURCE_ID,
        ...routeNetworkCasingStyleForPresentation(presentation),
      },
      beforeNetworkOverlayLayer,
    );
  }

  map.addLayer(
    {
      id: ROUTE_NETWORK_LINE_LAYER_ID,
      type: "line",
      source: ROUTE_NETWORK_SOURCE_ID,
      ...(
        presentation.variant === "current"
          ? ROUTE_NETWORK_LINE_STYLE
          : routeNetworkLineStyleForPresentation(presentation)
      ),
    },
    beforeNetworkOverlayLayer,
  );

  map.addLayer(
    {
      id: ROUTE_NETWORK_HIT_LAYER_ID,
      type: "line",
      source: ROUTE_NETWORK_SOURCE_ID,
      ...ROUTE_NETWORK_HIT_STYLE,
    },
    beforeNetworkOverlayLayer,
  );

  map.addLayer(
    {
      id: ROUTE_NETWORK_HOVER_LAYER_ID,
      type: "line",
      source: ROUTE_NETWORK_SOURCE_ID,
      filter: ["==", ["get", "name"], ""],
      ...(
        presentation.variant === "current"
          ? ROUTE_NETWORK_HOVER_STYLE
          : routeNetworkHoverStyleForPresentation(presentation)
      ),
    },
    beforeNetworkOverlayLayer,
  );

  map.addLayer(
    {
      id: ROUTE_NETWORK_FOCUS_LAYER_ID,
      type: "line",
      source: ROUTE_NETWORK_SOURCE_ID,
      filter: ["==", ["get", "name"], ""],
      ...(
        presentation.variant === "current"
          ? ROUTE_NETWORK_FOCUS_STYLE
          : routeNetworkFocusStyleForPresentation(presentation)
      ),
    },
    beforeNetworkOverlayLayer,
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
    ...ROUTE_POINTS_STYLE,
  });
}

export function syncRouteGeometryLayer(
  map,
  routeGeometry,
  dragPreview = null,
  presentationOptions = {},
) {
  const data = buildRouteGeometryFeatureCollection(routeGeometry, dragPreview);
  const variant = normalizeRouteGeometryPresentationVariant(
    presentationOptions.variant,
  );

  if (map.getSource(ROUTE_GEOMETRY_SOURCE_ID)) {
    map.getSource(ROUTE_GEOMETRY_SOURCE_ID).setData(data);
    syncRouteGeometryStyleLayers(map, variant);
    addRouteGeometryHitLayer(map);
    return;
  }

  map.addSource(ROUTE_GEOMETRY_SOURCE_ID, {
    type: "geojson",
    data,
  });

  syncRouteGeometryStyleLayers(map, variant);
  addRouteGeometryHitLayer(map);
}

function syncRouteGeometryStyleLayers(map, variant) {
  const casedStyle = routeGeometryCasingStyleForPresentation(variant);
  const lineStyle =
    routeGeometryLineStyleForPresentation(variant) || ROUTE_GEOMETRY_LINE_STYLE;
  const beforeInteractiveLayer = [
    ROUTE_GEOMETRY_HIT_LAYER_ID,
    ROUTE_POINTS_LAYER_ID,
    DATA_MARKERS_CIRCLE_LAYER_ID,
    DATA_MARKERS_LAYER_ID,
  ].find((id) => map.getLayer(id));

  if (map.getLayer(ROUTE_GEOMETRY_CASING_LAYER_ID)) {
    map.removeLayer(ROUTE_GEOMETRY_CASING_LAYER_ID);
  }

  if (casedStyle) {
    map.addLayer(
      {
        id: ROUTE_GEOMETRY_CASING_LAYER_ID,
        type: "line",
        source: ROUTE_GEOMETRY_SOURCE_ID,
        ...casedStyle,
      },
      map.getLayer(ROUTE_GEOMETRY_LAYER_ID)
        ? ROUTE_GEOMETRY_LAYER_ID
        : beforeInteractiveLayer,
    );
  }

  if (map.getLayer(ROUTE_GEOMETRY_LAYER_ID)) {
    map.removeLayer(ROUTE_GEOMETRY_LAYER_ID);
  }

  map.addLayer({
    id: ROUTE_GEOMETRY_LAYER_ID,
    type: "line",
    source: ROUTE_GEOMETRY_SOURCE_ID,
    ...lineStyle,
  }, beforeInteractiveLayer);
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

const SEGMENT_HIGHLIGHT_SOURCE_ID = "react-segment-highlight";
const SEGMENT_HIGHLIGHT_LAYER_ID = "react-segment-highlight-line";

export function syncSegmentHighlightLayer(map, points) {
  const data = buildSegmentHighlightFeatureCollection(points);

  if (map.getSource(SEGMENT_HIGHLIGHT_SOURCE_ID)) {
    map.getSource(SEGMENT_HIGHLIGHT_SOURCE_ID).setData(data);
    return;
  }

  map.addSource(SEGMENT_HIGHLIGHT_SOURCE_ID, {
    type: "geojson",
    data,
  });

  // Draw above the main route line. Use ROUTE_POINTS_LAYER_ID as the "before"
  // layer if it exists, so the highlight renders below the route point circles.
  const beforePointLayer = map.getLayer(ROUTE_POINTS_LAYER_ID)
    ? ROUTE_POINTS_LAYER_ID
    : undefined;

  map.addLayer(
    {
      id: SEGMENT_HIGHLIGHT_LAYER_ID,
      type: "line",
      source: SEGMENT_HIGHLIGHT_SOURCE_ID,
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": "#b5742e",
        "line-width": 7,
        "line-opacity": 0.85,
      },
    },
    beforePointLayer,
  );
}

export function clearSegmentHighlightLayer(map) {
  if (!map) return;
  if (map.getLayer(SEGMENT_HIGHLIGHT_LAYER_ID)) {
    map.removeLayer(SEGMENT_HIGHLIGHT_LAYER_ID);
  }
  if (map.getSource(SEGMENT_HIGHLIGHT_SOURCE_ID)) {
    map.removeSource(SEGMENT_HIGHLIGHT_SOURCE_ID);
  }
}

const RECOMMENDED_ROUTES_SOURCE_ID = "react-recommended-routes";
const RECOMMENDED_ROUTES_LAYER_ID = "react-recommended-routes-line";

export function syncRecommendedRoutesLayer(map, routes) {
  const data = buildRecommendedRoutesFeatureCollection(routes);

  if (map.getSource(RECOMMENDED_ROUTES_SOURCE_ID)) {
    map.getSource(RECOMMENDED_ROUTES_SOURCE_ID).setData(data);
    return;
  }

  // Don't add the source/layer if there's nothing to show yet.
  if (data.features.length === 0) return;

  map.addSource(RECOMMENDED_ROUTES_SOURCE_ID, {
    type: "geojson",
    data,
  });

  // Draw ABOVE the CW network but below the built route, waypoints, and data
  // markers (so those stay on top / tappable). Insert before the first of these
  // that exists; if none exist, append on top (still above the network).
  const beforeLayer = [
    ROUTE_GEOMETRY_LAYER_ID,
    ROUTE_POINTS_LAYER_ID,
    DATA_MARKERS_CIRCLE_LAYER_ID,
    DATA_MARKERS_LAYER_ID,
  ].find((id) => map.getLayer(id));

  map.addLayer(
    {
      id: RECOMMENDED_ROUTES_LAYER_ID,
      type: "line",
      source: RECOMMENDED_ROUTES_SOURCE_ID,
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": ["get", "color"],
        "line-width": [
          "case",
          ["get", "hovered"], 6,
          ["==", ["get", "tier"], "ghost"], 2,
          3.5,
        ],
        "line-opacity": [
          "case",
          ["get", "hovered"], 1,
          ["==", ["get", "tier"], "ghost"], 0.25,
          0.9,
        ],
      },
    },
    beforeLayer,
  );
}

export function clearRecommendedRoutesLayer(map) {
  if (!map) return;
  if (map.getLayer(RECOMMENDED_ROUTES_LAYER_ID)) {
    map.removeLayer(RECOMMENDED_ROUTES_LAYER_ID);
  }
  if (map.getSource(RECOMMENDED_ROUTES_SOURCE_ID)) {
    map.removeSource(RECOMMENDED_ROUTES_SOURCE_ID);
  }
}

// Show or hide the built-route layers (geometry line + hit target + points).
// Used to suppress the user's route while a recommended route is being previewed.
export function setBuiltRouteVisibility(map, visible) {
  if (!map) return;
  const visibility = visible ? "visible" : "none";
  const layerIds = [
    ROUTE_GEOMETRY_CASING_LAYER_ID,
    ROUTE_GEOMETRY_LAYER_ID,
    ROUTE_GEOMETRY_HIT_LAYER_ID,
    ROUTE_POINTS_LAYER_ID,
  ];
  for (const id of layerIds) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, "visibility", visibility);
    }
  }
}

export function buildRecommendedRoutesFeatureCollection(routes) {
  if (!Array.isArray(routes) || routes.length === 0) {
    return { type: "FeatureCollection", features: [] };
  }

  const features = [];
  for (const route of routes) {
    if (!Array.isArray(route?.geometry) || route.geometry.length < 2) continue;
    const coordinates = route.geometry
      .map((point) => [Number(point.lng), Number(point.lat)])
      .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
    if (coordinates.length < 2) continue;
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates },
      properties: {
        hovered: Boolean(route.hovered),
        tier: route.tier === "ghost" ? "ghost" : "bright",
        color: route.color || DISCOVER_ROUTE_PALETTE[0],
      },
    });
  }

  return { type: "FeatureCollection", features };
}

function buildSegmentHighlightFeatureCollection(points) {
  const coordinates = Array.isArray(points)
    ? points
        .map((point) => [Number(point.lng), Number(point.lat)])
        .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))
    : [];

  if (coordinates.length < 2) {
    return { type: "FeatureCollection", features: [] };
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates },
        properties: {},
      },
    ],
  };
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

  if (!map.getLayer(DATA_MARKERS_CIRCLE_LAYER_ID)) {
    map.addLayer({
      id: DATA_MARKERS_CIRCLE_LAYER_ID,
      type: "circle",
      source: DATA_MARKERS_SOURCE_ID,
      ...DATA_MARKERS_CIRCLE_STYLE,
    });
  }

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

  // Register per-type emoji marker images (POI types render emoji via
  // icon-image, not text-field — astral glyphs crash Mapbox).
  registerPoiEmojiImages(map);
}

export function syncVideoCursorLayer(map, cursor, options = {}) {
  if (!map || !map.isStyleLoaded()) return;

  const layerData = buildVideoCursorLayerData(
    cursor,
    options.routeGeometry,
    options.variant,
  );
  const hasCursor = layerData.cursor.features.length > 0;
  if (!map.getSource(VIDEO_CURSOR_SOURCE_ID) && !hasCursor) {
    syncVideoCursorPulseAnimation(map, false);
    return;
  }

  syncVideoCursorSource(map, VIDEO_CURSOR_PROGRESS_SOURCE_ID, layerData.progress);
  syncVideoCursorSource(map, VIDEO_CURSOR_TRAIL_SOURCE_ID, layerData.trail);
  syncVideoCursorSource(map, VIDEO_CURSOR_SOURCE_ID, layerData.cursor);
  ensureVideoCursorLayers(map);
  const pulseProfile = videoCursorPulseProfileForVariant(layerData.variant);
  syncVideoCursorPulseAnimation(
    map,
    hasCursor && Boolean(options.playing) ? pulseProfile : null,
  );
}

export function clearVideoCursorLayer(map) {
  if (!map) return;
  syncVideoCursorPulseAnimation(map, false);

  [
    VIDEO_CURSOR_SYMBOL_LAYER_ID,
    VIDEO_CURSOR_LAYER_ID,
    VIDEO_CURSOR_NAV_CIRCLE_LAYER_ID,
    VIDEO_CURSOR_HALO_LAYER_ID,
    VIDEO_CURSOR_PULSE_LAYER_ID,
    VIDEO_CURSOR_TRAIL_LAYER_ID,
    VIDEO_CURSOR_PROGRESS_LAYER_ID,
  ].forEach((layerId) => {
    if (map.getLayer?.(layerId)) {
      map.removeLayer(layerId);
    }
  });

  [
    VIDEO_CURSOR_SOURCE_ID,
    VIDEO_CURSOR_TRAIL_SOURCE_ID,
    VIDEO_CURSOR_PROGRESS_SOURCE_ID,
  ].forEach((sourceId) => {
    if (map.getSource?.(sourceId)) {
      map.removeSource(sourceId);
    }
  });
}

export function buildVideoCursorLayerData(
  cursor,
  routeGeometry,
  variantInput = VIDEO_CURSOR_DEFAULT_VARIANT,
) {
  const point = normalizePoint(cursor);
  const variant = normalizeVideoCursorVariant(variantInput);
  if (!point) {
    return emptyVideoCursorLayerData(variant);
  }

  const routeArc = buildVideoCursorRouteArc(routeGeometry);
  const fraction = clampUnit(Number(cursor?.fraction));
  const headDistance = routeArc && Number.isFinite(fraction)
    ? routeArc.totalDistMeters * fraction
    : null;
  const bearing = Number.isFinite(Number(cursor?.bearing))
    ? normalizeBearing(Number(cursor.bearing))
    : routeArc && Number.isFinite(headDistance)
      ? bearingAtRouteDistance(routeArc, headDistance)
      : 0;
  const properties = videoCursorPropertiesForVariant(variant, bearing);

  const cursorData = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [point.lng, point.lat],
        },
        properties,
      },
    ],
  };

  return {
    variant,
    cursor: cursorData,
    trail: buildVideoCursorTrailData(routeArc, headDistance, variant),
    progress: buildVideoCursorProgressData(routeArc, headDistance, variant),
  };
}

export function normalizeVideoCursorVariant(value) {
  const key = String(value ?? "").trim();
  if (VIDEO_CURSOR_OPTION_VARIANTS.has(key)) {
    return VIDEO_CURSOR_OPTION_VARIANTS.get(key);
  }
  return VIDEO_CURSOR_VARIANT_NAMES.has(key)
    ? key
    : VIDEO_CURSOR_DEFAULT_VARIANT;
}

function emptyVideoCursorLayerData(variant) {
  return {
    variant,
    cursor: EMPTY_FEATURE_COLLECTION,
    trail: EMPTY_FEATURE_COLLECTION,
    progress: EMPTY_FEATURE_COLLECTION,
  };
}

function videoCursorPropertiesForVariant(variant, bearing) {
  const base = {
    bearing,
    showHalo: false,
    showPulse: false,
    showNavCircle: false,
    showCore: false,
    showSymbol: false,
    coreRadius: 0,
    coreColor: "#0f766e",
    coreStrokeWidth: 0,
    pulseRadius: 0,
    pulseColor: "#f97316",
    pulseOpacity: 0,
    symbol: "",
    symbolColor: "#0f172a",
    symbolSize: 0,
  };

  if (variant === VIDEO_CURSOR_VARIANTS.CHEVRON_TRAIL) {
    return {
      ...base,
      showHalo: true,
      showSymbol: true,
      symbol: "▲",
      symbolSize: 20,
    };
  }

  if (
    variant === VIDEO_CURSOR_VARIANTS.PROGRESS_HEAD
    || variant === VIDEO_CURSOR_VARIANTS.PROGRESS_HEAD_PULSE
  ) {
    return {
      ...base,
      showPulse: variant === VIDEO_CURSOR_VARIANTS.PROGRESS_HEAD_PULSE,
      showCore: true,
      showSymbol: true,
      coreRadius: 5.6,
      coreColor: "#f97316",
      coreStrokeWidth: 2,
      pulseRadius: 13,
      pulseColor: "#f97316",
      pulseOpacity: 0.13,
      symbol: "▲",
      symbolSize: 15,
      symbolColor: "#ffffff",
    };
  }

  if (variant === VIDEO_CURSOR_VARIANTS.NAV_CIRCLE) {
    return {
      ...base,
      showNavCircle: true,
      showSymbol: true,
      symbol: "▲",
      symbolSize: 15,
      symbolColor: "#ffffff",
    };
  }

  if (variant === VIDEO_CURSOR_VARIANTS.PULSE_RING) {
    return {
      ...base,
      showPulse: true,
      showCore: true,
      coreRadius: 6.2,
      coreColor: "#f97316",
      coreStrokeWidth: 2.5,
      pulseRadius: 23,
      pulseColor: "#f97316",
      pulseOpacity: 0.18,
    };
  }

  if (variant === VIDEO_CURSOR_VARIANTS.DOT) {
    return {
      ...base,
      showCore: true,
      coreRadius: 8.5,
      coreColor: "#ff3d3d",
      coreStrokeWidth: 3,
    };
  }

  return {
    ...base,
    showHalo: true,
    showSymbol: true,
    symbol: "▲",
    symbolSize: 20,
  };
}

function buildVideoCursorTrailData(routeArc, headDistance, variant) {
  if (
    variant !== VIDEO_CURSOR_VARIANTS.CHEVRON_TRAIL
    || !routeArc
    || !Number.isFinite(headDistance)
  ) {
    return EMPTY_FEATURE_COLLECTION;
  }

  const trailMeters = Math.min(Math.max(routeArc.totalDistMeters * 0.025, 45), 140);
  const startDistance = Math.max(0, headDistance - trailMeters);
  return videoCursorLineData(routeArc, startDistance, headDistance);
}

function buildVideoCursorProgressData(routeArc, headDistance, variant) {
  if (
    variant !== VIDEO_CURSOR_VARIANTS.PROGRESS_HEAD
    && variant !== VIDEO_CURSOR_VARIANTS.PROGRESS_HEAD_PULSE
    || !routeArc
    || !Number.isFinite(headDistance)
  ) {
    return EMPTY_FEATURE_COLLECTION;
  }

  return videoCursorLineData(routeArc, 0, headDistance);
}

function videoCursorLineData(routeArc, startDistance, endDistance) {
  const coordinates = sliceVideoCursorRouteCoordinates(
    routeArc,
    startDistance,
    endDistance,
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
    : EMPTY_FEATURE_COLLECTION;
}

function buildVideoCursorRouteArc(routeGeometry) {
  const points = Array.isArray(routeGeometry)
    ? routeGeometry.map(normalizePoint).filter(Boolean)
    : [];
  if (points.length < 2) return null;

  const cumDist = new Float64Array(points.length);
  let totalDistMeters = 0;
  for (let i = 1; i < points.length; i++) {
    const distance = getDistance(points[i - 1], points[i]);
    totalDistMeters += Number.isFinite(distance) && distance > 0 ? distance : 0;
    cumDist[i] = totalDistMeters;
  }

  return totalDistMeters > 0 ? { points, cumDist, totalDistMeters } : null;
}

function sliceVideoCursorRouteCoordinates(routeArc, startDistance, endDistance) {
  const start = clampDistance(routeArc, startDistance);
  const end = clampDistance(routeArc, endDistance);
  if (end <= start) return [];

  const coordinates = [videoCursorPointAtDistance(routeArc, start)];
  for (let i = 1; i < routeArc.points.length - 1; i++) {
    if (routeArc.cumDist[i] > start && routeArc.cumDist[i] < end) {
      coordinates.push([routeArc.points[i].lng, routeArc.points[i].lat]);
    }
  }
  coordinates.push(videoCursorPointAtDistance(routeArc, end));

  return coordinates.filter((coordinate, index, all) => {
    if (index === 0) return true;
    const previous = all[index - 1];
    return coordinate[0] !== previous[0] || coordinate[1] !== previous[1];
  });
}

function videoCursorPointAtDistance(routeArc, distanceMeters) {
  const target = clampDistance(routeArc, distanceMeters);
  let segmentIndex = 0;

  while (
    segmentIndex < routeArc.cumDist.length - 2
    && routeArc.cumDist[segmentIndex + 1] < target
  ) {
    segmentIndex++;
  }

  const a = routeArc.points[segmentIndex];
  const b = routeArc.points[segmentIndex + 1];
  const segmentStart = routeArc.cumDist[segmentIndex];
  const segmentLength = routeArc.cumDist[segmentIndex + 1] - segmentStart;
  const fraction = segmentLength > 0
    ? (target - segmentStart) / segmentLength
    : 0;

  return [
    a.lng + (b.lng - a.lng) * fraction,
    a.lat + (b.lat - a.lat) * fraction,
  ];
}

function bearingAtRouteDistance(routeArc, headDistance) {
  const sampleMeters = Math.min(
    Math.max(routeArc.totalDistMeters * 0.006, 12),
    55,
  );
  const before = videoCursorPointAtDistance(routeArc, headDistance - sampleMeters);
  const after = videoCursorPointAtDistance(routeArc, headDistance + sampleMeters);
  return bearingBetweenCoordinates(before, after);
}

function bearingBetweenCoordinates(from, to) {
  const [fromLng, fromLat] = from;
  const [toLng, toLat] = to;
  const dx = (toLng - fromLng) * Math.cos(((fromLat + toLat) / 2) * Math.PI / 180);
  const dy = toLat - fromLat;
  if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) return 0;
  return normalizeBearing(Math.atan2(dx, dy) * 180 / Math.PI);
}

function clampUnit(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function clampDistance(routeArc, distanceMeters) {
  if (!Number.isFinite(distanceMeters)) return 0;
  return Math.max(0, Math.min(routeArc.totalDistMeters, distanceMeters));
}

function normalizeBearing(value) {
  return ((value % 360) + 360) % 360;
}

function syncVideoCursorSource(map, sourceId, data) {
  if (map.getSource(sourceId)) {
    map.getSource(sourceId).setData(data);
    return;
  }
  map.addSource(sourceId, {
    type: "geojson",
    data,
  });
}

function ensureVideoCursorLayers(map) {
  const beforePointLayer = map.getLayer(ROUTE_POINTS_LAYER_ID)
    ? ROUTE_POINTS_LAYER_ID
    : undefined;

  addVideoCursorLayer(
    map,
    {
      id: VIDEO_CURSOR_PROGRESS_LAYER_ID,
      type: "line",
      source: VIDEO_CURSOR_PROGRESS_SOURCE_ID,
      ...VIDEO_CURSOR_PROGRESS_STYLE,
    },
    beforePointLayer,
  );
  addVideoCursorLayer(
    map,
    {
      id: VIDEO_CURSOR_TRAIL_LAYER_ID,
      type: "line",
      source: VIDEO_CURSOR_TRAIL_SOURCE_ID,
      ...VIDEO_CURSOR_TRAIL_STYLE,
    },
    beforePointLayer,
  );
  addVideoCursorLayer(map, {
    id: VIDEO_CURSOR_PULSE_LAYER_ID,
    type: "circle",
    source: VIDEO_CURSOR_SOURCE_ID,
    ...VIDEO_CURSOR_PULSE_STYLE,
  });
  addVideoCursorLayer(map, {
    id: VIDEO_CURSOR_HALO_LAYER_ID,
    type: "circle",
    source: VIDEO_CURSOR_SOURCE_ID,
    ...VIDEO_CURSOR_HALO_STYLE,
  });
  addVideoCursorLayer(map, {
    id: VIDEO_CURSOR_NAV_CIRCLE_LAYER_ID,
    type: "circle",
    source: VIDEO_CURSOR_SOURCE_ID,
    ...VIDEO_CURSOR_NAV_CIRCLE_STYLE,
  });
  addVideoCursorLayer(map, {
    id: VIDEO_CURSOR_LAYER_ID,
    type: "circle",
    source: VIDEO_CURSOR_SOURCE_ID,
    ...VIDEO_CURSOR_STYLE,
  });
  addVideoCursorLayer(map, {
    id: VIDEO_CURSOR_SYMBOL_LAYER_ID,
    type: "symbol",
    source: VIDEO_CURSOR_SOURCE_ID,
    ...VIDEO_CURSOR_SYMBOL_STYLE,
  });
}

function addVideoCursorLayer(map, layer, beforeLayerId) {
  if (map.getLayer(layer.id)) return;
  map.addLayer(layer, beforeLayerId);
}

function videoCursorPulseProfileForVariant(variant) {
  if (variant === VIDEO_CURSOR_VARIANTS.PULSE_RING) {
    return {
      key: VIDEO_CURSOR_VARIANTS.PULSE_RING,
      startRadius: 16,
      endRadius: 33,
      maxOpacity: 0.26,
    };
  }

  if (variant === VIDEO_CURSOR_VARIANTS.PROGRESS_HEAD_PULSE) {
    return {
      key: VIDEO_CURSOR_VARIANTS.PROGRESS_HEAD_PULSE,
      startRadius: 9,
      endRadius: 17,
      maxOpacity: 0.18,
    };
  }

  return null;
}

function syncVideoCursorPulseAnimation(map, profile) {
  const existing = map.__videoCursorPulseAnimation;
  if (!profile) {
    if (existing) {
      existing.cancel(existing.frame);
      delete map.__videoCursorPulseAnimation;
    }
    if (map.getLayer?.(VIDEO_CURSOR_PULSE_LAYER_ID)) {
      map.setPaintProperty?.(
        VIDEO_CURSOR_PULSE_LAYER_ID,
        "circle-radius",
        VIDEO_CURSOR_PULSE_STYLE.paint["circle-radius"],
      );
      map.setPaintProperty?.(
        VIDEO_CURSOR_PULSE_LAYER_ID,
        "circle-opacity",
        VIDEO_CURSOR_PULSE_STYLE.paint["circle-opacity"],
      );
    }
    return;
  }
  if (existing?.profileKey === profile.key) return;
  if (existing) {
    existing.cancel(existing.frame);
    delete map.__videoCursorPulseAnimation;
  }

  const raf = typeof window !== "undefined" && window.requestAnimationFrame
    ? window.requestAnimationFrame.bind(window)
    : null;
  const cancel = typeof window !== "undefined" && window.cancelAnimationFrame
    ? window.cancelAnimationFrame.bind(window)
    : null;
  if (!raf || !cancel) return;

  const state = { frame: null, cancel, profileKey: profile.key };
  const tick = (now) => {
    if (!map.getLayer?.(VIDEO_CURSOR_PULSE_LAYER_ID)) {
      syncVideoCursorPulseAnimation(map, null);
      return;
    }
    const phase = ((now % 1400) / 1400);
    map.setPaintProperty?.(
      VIDEO_CURSOR_PULSE_LAYER_ID,
      "circle-radius",
      profile.startRadius + phase * (profile.endRadius - profile.startRadius),
    );
    map.setPaintProperty?.(
      VIDEO_CURSOR_PULSE_LAYER_ID,
      "circle-opacity",
      profile.maxOpacity * (1 - phase),
    );
    state.frame = raf(tick);
  };

  map.__videoCursorPulseAnimation = state;
  state.frame = raf(tick);
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
