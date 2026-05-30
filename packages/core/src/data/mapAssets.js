import { getJsonAsset, resolveAssetPath } from "../platform/assets.js";

const MAP_MANIFEST_PATH = "public-data/map-manifest.json";

const DEFAULT_MAP_ASSETS = {
  bikeRoads: "bike_roads.geojson",
  segments: "segments.json",
  cwBaseIndex: null,
  assetBasePath: MAP_MANIFEST_PATH,
};

function assetPathWithVersion(filePath, version) {
  if (!version) {
    return filePath;
  }
  const [path, query = ""] = String(filePath).split("?");
  const params = new URLSearchParams(query);
  params.set("v", version);
  return `${path}?${params.toString()}`;
}

export async function loadMapManifest(options = {}) {
  try {
    const manifest = await getJsonAsset(`${MAP_MANIFEST_PATH}?t=${Date.now()}`, {
      cache: "no-store",
      ...options,
    });
    if (!manifest.bikeRoads || !manifest.segments) {
      throw new Error("map-manifest.json is missing map asset paths");
    }
    return {
      ...manifest,
      assetBasePath: MAP_MANIFEST_PATH,
      usingFallback: false,
    };
  } catch (error) {
    if (options.signal?.aborted || error?.name === "AbortError") {
      throw error;
    }
    console.warn("Could not load public-data/map-manifest.json, using stable map files:", error);
    return {
      ...DEFAULT_MAP_ASSETS,
      usingFallback: true,
    };
  }
}

export async function loadMapAssets(options = {}) {
  const { baseRoutingMode = "shards", ...fetchOptions } = options;
  const manifest = await loadMapManifest(fetchOptions);
  const manifestBasePath = manifest.assetBasePath || MAP_MANIFEST_PATH;
  const useRoutingShards =
    baseRoutingMode === "shards" && Boolean(manifest.baseRoutingShards);
  const baseRoutingShardManifestPath = useRoutingShards
    ? resolveAssetPath(manifest.baseRoutingShards, manifestBasePath)
    : null;
  const [
    segmentsData,
    geoJsonData,
    cwBaseIndexData,
    baseRoutingShardManifestData,
  ] = await Promise.all([
    getJsonAsset(manifest.segments, { basePath: manifestBasePath, ...fetchOptions }),
    getJsonAsset(manifest.bikeRoads, { basePath: manifestBasePath, ...fetchOptions }),
    manifest.cwBaseIndex
      ? getJsonAsset(assetPathWithVersion(manifest.cwBaseIndex, manifest.version), {
          basePath: manifestBasePath,
          ...fetchOptions,
        })
      : Promise.resolve(null),
    useRoutingShards
      ? getJsonAsset(
          assetPathWithVersion(manifest.baseRoutingShards, manifest.version),
          { basePath: manifestBasePath, ...fetchOptions },
        )
      : Promise.resolve(null),
  ]);

  return {
    manifest,
    segmentsData,
    geoJsonData,
    cwBaseIndexData,
    baseRoutingNetworkData: null,
    baseRoutingShardManifestData,
    baseRoutingShardManifestPath,
    baseRoutingMode: useRoutingShards ? "shards" : "legacy",
  };
}

export function summarizeMapAssets({
  manifest,
  segmentsData,
  geoJsonData,
  baseRoutingNetworkData,
  baseRoutingShardManifestData,
  baseRoutingMode,
  cwBaseIndexData,
}) {
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
    baseRoutingFile: null,
    baseRoutingEdges: baseRoutingNetworkData?.edges?.length || 0,
    baseRoutingMode: baseRoutingMode || "shards",
    baseRoutingShardManifestFile: manifest.baseRoutingShards || null,
    baseRoutingShards: baseRoutingShardManifestData?.shards?.length || 0,
    cwBaseIndexFile: manifest.cwBaseIndex || null,
    cwBaseIndexSegments: Object.keys(cwBaseIndexData?.segments || {}).length,
  };
}
