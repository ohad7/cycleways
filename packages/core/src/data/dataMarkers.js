// Pure data transform: segments → GeoJSON features for data markers.
// No Mapbox dependency — safe for the platform-agnostic shared set.
import {
  poiColor,
  poiEmoji,
  poiLabel,
  poiMarkerIconName,
  primaryPoiImage,
} from "./poiTypes.js";

export function namespacedDataMarkerIconName(iconName, namespace) {
  if (!namespace || typeof iconName !== "string" || iconName.length === 0) {
    return iconName;
  }
  return `${namespace}-${iconName}`;
}

// The stable identifier for a segment's data point: its own `id` when present,
// otherwise a positional fallback. Shared so map markers and any UI listing the
// same data points (e.g. the segment card chips) derive identical ids and can
// be linked by hover.
export function dataPointId(segmentName, dataPoint, index) {
  return typeof dataPoint?.id === "string" && dataPoint.id.length > 0
    ? dataPoint.id
    : `${segmentName}-${index}`;
}

// Project a single data point into the GeoJSON feature shape that
// syncDataMarkerLayers expects. `location` is the resolved [lat, lng] pair and
// `dataPointId` / `segmentName` are the already-resolved identifiers.
function dataMarkerFeature(dataPoint, { dataPointId, location, segmentName }) {
  const [lat, lng] = location;
  const type = dataPoint.type || "warning";
  const primary = primaryPoiImage(dataPoint);
  return {
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
      icon: dataPoint.icon || poiMarkerIconName(type),
    },
  };
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

      const id = dataPointId(segmentName, dataPoint, index);
      features.push(
        dataMarkerFeature(dataPoint, { dataPointId: id, location, segmentName }),
      );
    });
  });

  return features;
}

// Project active route data points (as returned by getActiveRouteDataPoints)
// into the same GeoJSON feature shape, restricted to on-route POIs. Used by the
// featured-route snapshot builder, which deliberately drops off-route markers.
export function dataMarkerFeaturesFromActiveDataPoints(activeDataPoints) {
  const features = [];

  (Array.isArray(activeDataPoints) ? activeDataPoints : []).forEach(
    (dataPoint, index) => {
      const location = dataPoint?.location;
      if (!Array.isArray(location) || location.length < 2) return;

      const [lat, lng] = location;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      const dataPointId =
        typeof dataPoint.id === "string" && dataPoint.id.length > 0
          ? dataPoint.id
          : `${dataPoint.segmentName || "active"}-${index}`;
      features.push(
        dataMarkerFeature(dataPoint, {
          dataPointId,
          location,
          segmentName: dataPoint.segmentName,
        }),
      );
    },
  );

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
