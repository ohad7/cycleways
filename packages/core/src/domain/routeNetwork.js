// Platform-agnostic cycleway-network appearance logic. Both the web Mapbox-GL
// layer and the React Native @rnmapbox map consume these:
// prepareRouteNetworkFeatures bakes appearance properties into each feature, so
// both platforms can render the network from this single source.
import {
  ROUTE_NETWORK_BUCKETS,
  routeNetworkColorForBucket,
  routeNetworkPresentation,
} from "../map/networkPresentation.js";

export function getRouteFeatureBucket(feature) {
  const roadType = feature.properties?.roadType;
  const originalColor =
    feature.properties?.stroke ||
    feature.properties?.["stroke-color"] ||
    "#0288d1";

  if (originalColor === "#0288d1" || originalColor === "rgb(2, 136, 209)") {
    return ROUTE_NETWORK_BUCKETS.PRIMARY;
  }

  if (
    roadType === "road" ||
    originalColor === "#8f2424" ||
    originalColor === "rgb(143, 36, 36)" ||
    originalColor === "#e6ee9c" ||
    originalColor === "rgb(230, 238, 156)"
  ) {
    return ROUTE_NETWORK_BUCKETS.ROAD;
  }

  return ROUTE_NETWORK_BUCKETS.TRAIL;
}

export function getRouteFeatureColor(feature, presentationOptions = {}) {
  return routeNetworkColorForBucket(
    getRouteFeatureBucket(feature),
    presentationOptions,
  );
}

export function prepareRouteNetworkFeatures(geoJsonData, presentationOptions = {}) {
  const presentation = routeNetworkPresentation(presentationOptions);
  return (geoJsonData?.features || [])
    .filter((feature) => feature?.geometry?.type === "LineString")
    .map((feature) => {
      const routeBucket = getRouteFeatureBucket(feature);
      return {
        ...feature,
        properties: {
          ...feature.properties,
          name: feature.properties?.name || "Unnamed Route",
          routeBucket,
          routeColor: presentation.colors[routeBucket],
          routeWidth: 3,
          routeOpacity: 1,
          routeCasingColor: presentation.casingColor,
          routeCasingOpacity: presentation.casingOpacity,
          routeShadowColor: presentation.shadowColor,
          routeShadowOpacity: presentation.shadowOpacity,
          routeColorScheme: presentation.colorScheme,
        },
      };
    });
}

export function publicRouteNetworkGeoJson(geoJsonData, networkJunctionsData = null) {
  const segmentFeatures = Array.isArray(geoJsonData?.features) ? geoJsonData.features : [];
  const junctionFeatures = Array.isArray(networkJunctionsData?.publicGeometry?.features)
    ? networkJunctionsData.publicGeometry.features
    : [];
  return {
    type: "FeatureCollection",
    features: [...segmentFeatures, ...junctionFeatures],
  };
}
