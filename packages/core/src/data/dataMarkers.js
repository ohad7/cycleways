// Pure data transform: segments → GeoJSON features for data markers.
// No Mapbox dependency — safe for the platform-agnostic shared set.

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

export function namespacedDataMarkerIconName(iconName, namespace) {
  if (!namespace || typeof iconName !== "string" || iconName.length === 0) {
    return iconName;
  }
  return `${namespace}-${iconName}`;
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

export function dataMarkerFeatureCollection(
  dataMarkerFeatures,
  activeDataPointIds = [],
  options = {},
) {
  const activeIds = new Set(activeDataPointIds);
  const features = Array.isArray(dataMarkerFeatures)
    ? dataMarkerFeatures
    : [];
  const iconNamespace = options?.iconNamespace;

  return {
    type: "FeatureCollection",
    features: features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        icon: namespacedDataMarkerIconName(
          feature.properties?.icon,
          iconNamespace,
        ),
        active: activeIds.has(feature.properties?.dataPointId),
      },
    })),
  };
}
