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
      "circle-radius": 4,
      "circle-color": "#ff4444",
      "circle-stroke-width": 2,
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
