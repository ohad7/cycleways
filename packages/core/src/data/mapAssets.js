import { getJsonAsset, resolveAssetPath } from "../platform/assets.js";

const MAP_MANIFEST_PATH = "public-data/map-manifest.json";

const DEFAULT_MAP_ASSETS = {
  bikeRoads: "bike_roads.geojson",
  segments: "segments.json",
  cwBaseIndex: null,
  cwAlignmentGeometry: null,
  legacyRoutingCompatibility: null,
  routeAnchorCompatibility: null,
  crossings: null,
  networkJunctions: null,
  assetBasePath: MAP_MANIFEST_PATH,
};

export function assetPathWithVersion(filePath, version) {
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
  const {
    baseRoutingMode = "shards",
    includeRoundabouts = false,
    includeCrossings = false,
    includeNetworkJunctions = false,
    ...fetchOptions
  } = options;
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
    roundaboutsData,
    crossingsData,
    networkJunctionsData,
    cwAlignmentGeometryData,
    legacyCwBaseIndexData,
    legacyRoutingCompatibilityMetadata,
    routeAnchorCompatibilityData,
  ] = await Promise.all([
    getJsonAsset(assetPathWithVersion(manifest.segments, manifest.version), {
      basePath: manifestBasePath,
      ...fetchOptions,
    }),
    getJsonAsset(assetPathWithVersion(manifest.bikeRoads, manifest.version), {
      basePath: manifestBasePath,
      ...fetchOptions,
    }),
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
    includeRoundabouts && manifest.roundabouts
      ? getJsonAsset(assetPathWithVersion(manifest.roundabouts, manifest.version), {
          basePath: manifestBasePath,
          ...fetchOptions,
        })
      : Promise.resolve(null),
    includeCrossings && manifest.crossings
      ? getJsonAsset(assetPathWithVersion(manifest.crossings, manifest.version), {
          basePath: manifestBasePath,
          ...fetchOptions,
        })
      : Promise.resolve(null),
    includeNetworkJunctions && manifest.networkJunctions
      ? getJsonAsset(assetPathWithVersion(manifest.networkJunctions, manifest.version), {
          basePath: manifestBasePath,
          ...fetchOptions,
        })
      : Promise.resolve(null),
    manifest.cwAlignmentGeometry
      ? getJsonAsset(
          assetPathWithVersion(manifest.cwAlignmentGeometry, manifest.version),
          { basePath: manifestBasePath, ...fetchOptions },
        )
      : Promise.resolve(null),
    manifest.legacyRoutingCompatibility?.cwBaseIndex
      ? getJsonAsset(
          assetPathWithVersion(
            manifest.legacyRoutingCompatibility.cwBaseIndex,
            manifest.version,
          ),
          { basePath: manifestBasePath, ...fetchOptions },
        )
      : Promise.resolve(null),
    manifest.legacyRoutingCompatibility?.metadata
      ? getJsonAsset(
          assetPathWithVersion(
            manifest.legacyRoutingCompatibility.metadata,
            manifest.version,
          ),
          { basePath: manifestBasePath, ...fetchOptions },
        )
      : Promise.resolve(null),
    manifest.routeAnchorCompatibility?.path
      ? getJsonAsset(
          assetPathWithVersion(
            manifest.routeAnchorCompatibility.path,
            manifest.version,
          ),
          { basePath: manifestBasePath, ...fetchOptions },
        )
      : Promise.resolve(null),
  ]);

  const legacyRoutingCompatibility = legacyCwBaseIndexData &&
    legacyRoutingCompatibilityMetadata
    ? {
        manifest: manifest.legacyRoutingCompatibility,
        cwBaseIndex: legacyCwBaseIndexData,
        metadata: legacyRoutingCompatibilityMetadata,
      }
    : null;

  return {
    manifest,
    segmentsData,
    geoJsonData,
    cwBaseIndexData,
    baseRoutingNetworkData: null,
    baseRoutingShardManifestData,
    baseRoutingShardManifestPath,
    roundaboutsData,
    crossingsData,
    networkJunctionsData,
    cwAlignmentGeometryData,
    legacyRoutingCompatibility,
    routeAnchorCompatibilityData,
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
  roundaboutsData,
  crossingsData,
  networkJunctionsData,
  cwAlignmentGeometryData,
  legacyRoutingCompatibility,
  routeAnchorCompatibilityData,
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
    cwAlignmentGeometryFeatures:
      cwAlignmentGeometryData?.features?.length || 0,
    legacyRoutingCompatibility:
      legacyRoutingCompatibility?.metadata?.releaseId || null,
    routeAnchorCompatibilityGraphVersions: Object.keys(
      routeAnchorCompatibilityData?.graphVersions || {},
    ).length,
    roundaboutsFile: manifest.roundabouts || null,
    roundabouts: Array.isArray(roundaboutsData?.roundabouts) ? roundaboutsData.roundabouts.length : 0,
    crossingsFile: manifest.crossings || null,
    crossings: Array.isArray(crossingsData?.crossings) ? crossingsData.crossings.length : 0,
    networkJunctionsFile: manifest.networkJunctions || null,
    networkJunctions: Array.isArray(networkJunctionsData?.junctions) ? networkJunctionsData.junctions.length : 0,
    // Release diagnostics only. An old manifest without a guidance summary
    // loads normally and simply reports nulls.
    guidanceSchemaVersion: manifest.guidance?.schemaVersion ?? null,
    guidanceEnforcement: manifest.guidance?.enforcement ?? null,
    guidanceReviewedSegments: manifest.guidance?.reviewedSegments ?? null,
    guidanceActiveSegments: manifest.guidance?.activeSegments ?? null,
    guidanceCoverageComplete: manifest.guidance?.coverageComplete ?? null,
    guidanceConflictCount: manifest.guidance?.conflictCount ?? null,
  };
}
