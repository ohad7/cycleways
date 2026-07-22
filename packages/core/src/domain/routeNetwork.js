// Platform-agnostic cycleway-network appearance logic. Both the web Mapbox-GL
// layer and the React Native @rnmapbox map consume these:
// prepareRouteNetworkFeatures bakes appearance properties into each feature, so
// both platforms can render the network from this single source.
import {
  ROUTE_NETWORK_BUCKETS,
  routeNetworkColorForBucket,
  routeNetworkPresentation,
} from "../map/networkPresentation.js";
import {
  CW_NETWORK_DETAIL_FADE_START_ZOOM,
  CW_NETWORK_DETAIL_FULL_ZOOM,
  CW_NETWORK_DETAIL_ROLES,
} from "../map/cwNetworkDetail.js";

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

function coordinatesAreExactReverse(first, second) {
  if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length) {
    return false;
  }
  return first.every((coordinate, index) => {
    const opposite = second[second.length - index - 1];
    return (
      Array.isArray(coordinate) &&
      Array.isArray(opposite) &&
      Number(coordinate[0]) === Number(opposite[0]) &&
      Number(coordinate[1]) === Number(opposite[1])
    );
  });
}

export function normalizeCwAlignmentFeatures(cwAlignmentGeometry = null) {
  const input = Array.isArray(cwAlignmentGeometry?.features)
    ? cwAlignmentGeometry.features.filter(
        (feature) => feature?.geometry?.type === "LineString",
      )
    : [];
  const grouped = new Map();
  for (const feature of input) {
    const segmentId = Number(feature?.properties?.segmentId);
    if (!Number.isFinite(segmentId)) continue;
    const features = grouped.get(segmentId) || [];
    features.push(feature);
    grouped.set(segmentId, features);
  }

  const normalized = [];
  for (const [segmentId, features] of [...grouped.entries()].sort(
    ([first], [second]) => first - second,
  )) {
    const alreadyShared = features.find(
      (feature) => feature?.properties?.physicalDirectionality === "bidirectional",
    );
    if (alreadyShared) {
      normalized.push({
        ...alreadyShared,
        properties: {
          ...alreadyShared.properties,
          segmentId,
          showDirectionArrow: false,
        },
      });
      continue;
    }

    const aToB = features.find(
      (feature) => feature?.properties?.alignmentKey === "aToB",
    );
    const bToA = features.find(
      (feature) => feature?.properties?.alignmentKey === "bToA",
    );
    if (
      aToB &&
      bToA &&
      coordinatesAreExactReverse(
        aToB.geometry?.coordinates,
        bToA.geometry?.coordinates,
      )
    ) {
      normalized.push({
        ...aToB,
        properties: {
          ...aToB.properties,
          segmentId,
          alignmentKey: "both",
          alignmentKeys: "aToB,bToA",
          aToBMappingDigest: aToB.properties?.mappingDigest || null,
          bToAMappingDigest: bToA.properties?.mappingDigest || null,
          physicalDirectionality: "bidirectional",
          showDirectionArrow: false,
        },
      });
      continue;
    }

    for (const feature of features) {
      normalized.push({
        ...feature,
        properties: {
          ...feature.properties,
          segmentId,
          physicalDirectionality:
            feature.properties?.physicalDirectionality || "directional",
          showDirectionArrow: true,
        },
      });
    }
  }
  return normalized;
}

export function publicRouteNetworkGeoJson(
  geoJsonData,
  networkJunctionsData = null,
  cwAlignmentGeometry = null,
) {
  const segmentFeatures = Array.isArray(geoJsonData?.features) ? geoJsonData.features : [];
  const junctionFeatures = Array.isArray(networkJunctionsData?.publicGeometry?.features)
    ? networkJunctionsData.publicGeometry.features
    : [];
  const alignmentFeatures = normalizeCwAlignmentFeatures(cwAlignmentGeometry);
  const alignedSegmentIds = new Set(
    alignmentFeatures.map((feature) => Number(feature.properties?.segmentId)),
  );
  const sourceBySegmentId = new Map(
    segmentFeatures
      .map((feature) => [Number(feature?.properties?.id), feature])
      .filter(([segmentId]) => Number.isFinite(segmentId)),
  );

  const logicalFeatures = segmentFeatures.map((feature) => {
    const segmentId = Number(feature?.properties?.id);
    const hasPhysicalDetail = alignedSegmentIds.has(segmentId);
    return {
      ...feature,
      properties: {
        ...feature.properties,
        networkRole: "logical-segment",
        networkDetailRole: hasPhysicalDetail
          ? CW_NETWORK_DETAIL_ROLES.LOGICAL_OVERVIEW
          : CW_NETWORK_DETAIL_ROLES.ALWAYS,
        ...(hasPhysicalDetail
          ? { interactionMaxZoom: CW_NETWORK_DETAIL_FULL_ZOOM }
          : {}),
      },
    };
  });

  const physicalFeatures = alignmentFeatures.map((feature) => {
    const segmentId = Number(feature.properties?.segmentId);
    const sourceProperties = sourceBySegmentId.get(segmentId)?.properties || {};
    return {
      ...feature,
      properties: {
        ...sourceProperties,
        ...feature.properties,
        id: segmentId,
        name: feature.properties?.segmentName || sourceProperties.name,
        networkRole: "alignment",
        networkDetailRole: CW_NETWORK_DETAIL_ROLES.PHYSICAL_DETAIL,
        interactionMinZoom: CW_NETWORK_DETAIL_FADE_START_ZOOM,
      },
    };
  });

  const publicJunctionFeatures = junctionFeatures.map((feature) => ({
    ...feature,
    properties: {
      ...feature.properties,
      networkRole: "junction",
      networkDetailRole: CW_NETWORK_DETAIL_ROLES.ALWAYS,
    },
  }));
  return {
    type: "FeatureCollection",
    features: [...logicalFeatures, ...publicJunctionFeatures, ...physicalFeatures],
  };
}
