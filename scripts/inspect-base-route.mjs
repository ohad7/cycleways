import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { loadBaseRoutingShardSubset } from "../src/routing/baseRoutingShards.js";
import { decodeCompactBaseRoutingShard } from "../src/routing/compactBaseRoutingShard.js";
import { decodeMessagePack } from "../src/routing/messagePack.js";

const require = createRequire(import.meta.url);
const RouteManager = require("../route-manager.js");

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printUsage();
  process.exit(0);
}

if (options.points.length < 2) {
  printUsage();
  throw new Error("Pass at least two --point lat,lng waypoints.");
}

const manifestPath = resolve(process.cwd(), options.manifest);
const manifestRoot = dirname(manifestPath);
const manifest = await readJson(manifestPath);
if (!manifest.baseRoutingShards) {
  throw new Error(`${manifestPath} does not reference routing shards.`);
}
const shardManifestPath = resolve(manifestRoot, manifest.baseRoutingShards);
const shardManifestRoot = dirname(shardManifestPath);
const shardManifest = await readJson(shardManifestPath);

const [geoJsonData, segmentsData, subset] = await Promise.all([
  readJson(resolve(manifestRoot, manifest.bikeRoads)),
  readJson(resolve(manifestRoot, manifest.segments)),
  loadBaseRoutingShardSubset(
    shardManifest,
    options.points,
    (entry) => {
      const shardSource = selectShardSource(entry);
      return readShard(
        resolve(shardManifestRoot, shardSource.path),
        shardSource.format,
      );
    },
    { paddingShards: options.paddingShards },
  ),
]);

const manager = new RouteManager();
await manager.load(geoJsonData, segmentsData, subset.network);

const snappedPoints = options.points.map((point, index) => {
  const snapped = manager.snapToNetwork(point);
  if (!snapped) {
    throw new Error(
      `Waypoint ${index + 1} is outside the base graph snap threshold: ${point.lat},${point.lng}`,
    );
  }
  return snapped;
});

manager.recalculateRoute(snappedPoints);
const routeInfo = manager.getRouteInfo();
const diagnostics = manager.getBaseRouteDiagnostics();

console.log(
  JSON.stringify(
    {
      manifest: {
        path: manifestPath,
        version: manifest.version || "stable",
        baseRoutingShards: manifest.baseRoutingShards,
        baseRoutingSchemaVersion: subset.network.schemaVersion || null,
        loadedShards: subset.entries.map((entry) => entry.id),
        loadedNodes: subset.network.nodes.length,
        loadedEdges: subset.network.edges.length,
      },
      points: snappedPoints.map((point, index) => ({
        input: options.points[index],
        snapped: routePointSummary(point),
      })),
      route: {
        failure: routeInfo.failure || null,
        distanceMeters: routeInfo.distance || 0,
        weightedCostMeters: routeInfo.cost || 0,
        elevationGainMeters: routeInfo.elevationGain || 0,
        elevationLossMeters: routeInfo.elevationLoss || 0,
        cyclewaysDistanceMeters: routeInfo.cyclewaysDistance || 0,
        nonCyclewaysDistanceMeters: routeInfo.nonCyclewaysDistance || 0,
        cyclewaysSegments: routeInfo.segments || [],
      },
      diagnostics,
    },
    null,
    2,
  ),
);

function parseArgs(args) {
  const parsed = {
    help: false,
    manifest: "public-data/map-manifest.json",
    paddingShards: 1,
    points: [],
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--manifest") {
      parsed.manifest = requireValue(args, ++index, arg);
      continue;
    }
    if (arg === "--padding-shards") {
      parsed.paddingShards = Number(requireValue(args, ++index, arg));
      if (!Number.isFinite(parsed.paddingShards) || parsed.paddingShards < 0) {
        throw new Error("--padding-shards must be a non-negative number.");
      }
      continue;
    }
    if (arg === "--point") {
      parsed.points.push(parsePoint(requireValue(args, ++index, arg)));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function parsePoint(value) {
  const [latValue, lngValue, ...rest] = value.split(",");
  const lat = Number(latValue);
  const lng = Number(lngValue);
  if (
    rest.length > 0 ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    throw new Error(`Invalid --point value: ${value}`);
  }
  return { lat, lng };
}

function requireValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function routePointSummary(point) {
  return {
    lat: point.lat,
    lng: point.lng,
    distanceMeters: point.distanceMeters,
    baseEdgeId: point.baseEdgeId,
    baseEdgeDistanceMeters: point.baseEdgeDistanceMeters,
    segmentName: point.segmentName,
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readShard(path, format) {
  if (format === "compact" || format === "cwb") {
    return decodeCompactBaseRoutingShard(await readFile(path));
  }
  if (format === "msgpack") {
    return decodeMessagePack(await readFile(path));
  }
  return readJson(path);
}

function selectShardSource(entry) {
  const format = entry?.format || "json";
  if (format === "compact" || format === "cwb") {
    return { format: "compact", path: entry.path };
  }
  return { format, path: entry.path };
}

function printUsage() {
  console.log(`Inspect a route through the promoted routing shards.

Usage:
  npm run route:inspect -- --point <lat,lng> --point <lat,lng> [--point <lat,lng> ...]

Options:
  --manifest <path>  Map manifest to inspect. Defaults to public-data/map-manifest.json.
  --padding-shards <n>  Point-corridor shard padding. Defaults to 1.
  --point <lat,lng>  Route waypoint. Pass at least two in route order.
`);
}
