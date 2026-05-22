const DEFAULT_MAP_ASSETS = {
  bikeRoads: "bike_roads_v18.geojson",
  segments: "segments.json",
};

async function fetchJsonAsset(filePath, options = {}) {
  const response = await fetch(`./${filePath}`, options);
  if (!response.ok) {
    throw new Error(`${filePath}: HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function loadMapManifest(options = {}) {
  try {
    const manifest = await fetchJsonAsset(`map-manifest.json?t=${Date.now()}`, {
      cache: "no-store",
      ...options,
    });
    if (!manifest.bikeRoads || !manifest.segments) {
      throw new Error("map-manifest.json is missing map asset paths");
    }
    return {
      ...manifest,
      usingFallback: false,
    };
  } catch (error) {
    console.warn("Could not load map-manifest.json, using stable map files:", error);
    return {
      ...DEFAULT_MAP_ASSETS,
      usingFallback: true,
    };
  }
}

export async function loadMapAssets(options = {}) {
  const manifest = await loadMapManifest(options);
  const [segmentsData, geoJsonData, baseRoutingNetworkData] = await Promise.all([
    fetchJsonAsset(manifest.segments, options),
    fetchJsonAsset(manifest.bikeRoads, options),
    manifest.baseRoutingNetwork
      ? fetchJsonAsset(manifest.baseRoutingNetwork, options)
      : Promise.resolve(null),
  ]);

  return {
    manifest,
    segmentsData,
    geoJsonData,
    baseRoutingNetworkData,
  };
}

export function summarizeMapAssets({ manifest, segmentsData, geoJsonData, baseRoutingNetworkData }) {
  const features = geoJsonData?.features || [];
  const coordinateCount = features.reduce((total, feature) => {
    const coordinates = feature?.geometry?.coordinates;
    return total + (Array.isArray(coordinates) ? coordinates.length : 0);
  }, 0);

  return {
    version: manifest.version || "stable",
    bikeRoadsFile: manifest.bikeRoads,
    segmentsFile: manifest.segments,
    usingFallback: Boolean(manifest.usingFallback),
    featureCount: features.length,
    coordinateCount,
    segmentCount: Object.keys(segmentsData || {}).length,
    baseRoutingFile: manifest.baseRoutingNetwork || null,
    baseRoutingEdges: baseRoutingNetworkData?.edges?.length || 0,
  };
}
