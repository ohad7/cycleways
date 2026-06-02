// Pure data transform: segments → GeoJSON features for data markers.
// No Mapbox dependency — safe for the platform-agnostic shared set.
import { poiColor, poiEmoji, poiIcon, poiLabel, primaryPoiImage } from "./poiTypes.js";

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

      const dataPointId =
        typeof dataPoint.id === "string" && dataPoint.id.length > 0
          ? dataPoint.id
          : `${segmentName}-${index}`;
      const type = dataPoint.type || "warning";
      const primary = primaryPoiImage(dataPoint);
      features.push({
        type: "Feature",
        id: dataPointId,
        geometry: {
          type: "Point",
          coordinates: [lng, lat],
        },
        properties: {
          dataPointId,
          type,
          name: dataPoint.name || "",
          information: dataPoint.information || "",
          description: dataPoint.description || "",
          photo: primary?.photo || "",
          thumbnail: primary?.thumbnail || "",
          gallery: dataPoint.gallery,
          segmentName,
          emoji: dataPoint.emoji || poiEmoji(type),
          label: poiLabel(type),
          color: poiColor(type),
          icon: dataPoint.icon || poiIcon(type),
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
