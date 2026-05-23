import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import {
  loadBaseRoutingShardSubset,
  mergeBaseRoutingShards,
} from "../src/routing/baseRoutingShards.js";
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

const mapManifestPath = resolve(process.cwd(), options.manifest);
const shardManifestPath = resolve(process.cwd(), options.shardManifest);
const mapManifestRoot = dirname(mapManifestPath);
const shardManifestRoot = dirname(shardManifestPath);
const [mapManifest, shardManifest] = await Promise.all([
  readJson(mapManifestPath),
  readJson(shardManifestPath),
]);

const loadShard = (entry) => {
  const shardSource = selectShardSource(entry, options.shardFormat);
  return readShard(
    resolve(shardManifestRoot, shardSource.path),
    shardSource.format,
  );
};

const [geoJsonData, segmentsData, referenceNetwork, subset] = await Promise.all([
  readJson(resolve(mapManifestRoot, mapManifest.bikeRoads)),
  readJson(resolve(mapManifestRoot, mapManifest.segments)),
  loadAllShards(shardManifest, loadShard),
  loadBaseRoutingShardSubset(
    shardManifest,
    options.points,
    loadShard,
    { paddingShards: options.paddingShards },
  ),
]);

const [referenceRoute, shardRoute] = await Promise.all([
  routeFromPoints(geoJsonData, segmentsData, referenceNetwork, options.points),
  routeFromPoints(geoJsonData, segmentsData, subset.network, options.points),
]);
const comparison = compareRoutes(referenceRoute, shardRoute);

console.log(
  JSON.stringify(
    {
      referenceGraph: {
        manifest: mapManifestPath,
        source: "all-routing-shards",
        nodes: referenceNetwork.nodes?.length || 0,
        edges: referenceNetwork.edges?.length || 0,
        route: referenceRoute,
      },
      shardGraph: {
        manifest: shardManifestPath,
        selectedShards: subset.entries.map((entry) => entry.id),
        selectedShardCompactBytes: subset.entries.reduce(
          (total, entry) => total + (Number(entry.compactBytes) || 0),
          0,
        ),
        selectedShardMessagePackBytes: subset.entries.reduce(
          (total, entry) => total + (Number(entry.messagePackBytes) || 0),
          0,
        ),
        selectedShardCompactBinaryBytes: subset.entries.reduce(
          (total, entry) => total + (Number(entry.compactBinaryBytes) || 0),
          0,
        ),
        shardFormat: options.shardFormat,
        loadedNodes: subset.network.nodes.length,
        loadedEdges: subset.network.edges.length,
        route: shardRoute,
      },
      comparison,
    },
    null,
    2,
  ),
);

if (options.strict && !comparison.matches) {
  process.exitCode = 1;
}

async function routeFromPoints(geoJsonData, segmentsData, network, points) {
  const manager = new RouteManager();
  await manager.load(geoJsonData, segmentsData, network);
  const snappedPoints = points.map((point) => manager.snapToNetwork(point));
  const rejectedPointIndex = snappedPoints.findIndex((point) => !point);
  if (rejectedPointIndex >= 0) {
    return {
      failure: `Waypoint ${rejectedPointIndex + 1} did not snap.`,
      snappedPoints: snappedPoints.map(routePointSummary),
      traversals: [],
    };
  }

  manager.recalculateRoute(snappedPoints);
  const routeInfo = manager.getRouteInfo();
  const diagnostics = manager.getBaseRouteDiagnostics();
  return {
    failure: routeInfo.failure || null,
    distanceMeters: routeInfo.distance || 0,
    weightedCostMeters: routeInfo.cost || 0,
    cyclewaysDistanceMeters: routeInfo.cyclewaysDistance || 0,
    nonCyclewaysDistanceMeters: routeInfo.nonCyclewaysDistance || 0,
    snappedPoints: snappedPoints.map(routePointSummary),
    traversals: (diagnostics?.traversals || []).map((traversal) => ({
      edgeId: traversal.edgeId,
      direction: traversal.direction,
    })),
  };
}

async function loadAllShards(manifest, loadShard) {
  return mergeBaseRoutingShards(await Promise.all((manifest.shards || []).map(loadShard)));
}

function compareRoutes(referenceRoute, shardRoute) {
  const referenceTraversalKeys = traversalKeys(referenceRoute);
  const shardTraversalKeys = traversalKeys(shardRoute);
  return {
    matches:
      !referenceRoute.failure &&
      !shardRoute.failure &&
      arraysEqual(referenceTraversalKeys, shardTraversalKeys),
    referenceFailure: referenceRoute.failure || null,
    shardFailure: shardRoute.failure || null,
    distanceDeltaMeters:
      (shardRoute.distanceMeters || 0) - (referenceRoute.distanceMeters || 0),
    weightedCostDeltaMeters:
      (shardRoute.weightedCostMeters || 0) -
      (referenceRoute.weightedCostMeters || 0),
    sameTraversalSequence: arraysEqual(referenceTraversalKeys, shardTraversalKeys),
    referenceTraversalSequence: referenceTraversalKeys,
    shardTraversalSequence: shardTraversalKeys,
  };
}

function traversalKeys(route) {
  return (route.traversals || []).map(
    (traversal) => `${traversal.edgeId}:${traversal.direction}`,
  );
}

function arraysEqual(first, second) {
  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

function routePointSummary(point) {
  if (!point) return null;
  return {
    lat: point.lat,
    lng: point.lng,
    baseEdgeId: point.baseEdgeId,
    baseEdgeDistanceMeters: point.baseEdgeDistanceMeters,
    distanceMeters: point.distanceMeters,
  };
}

function parseArgs(args) {
  const parsed = {
    help: false,
    manifest: "public-data/map-manifest.json",
    shardManifest: "public-data/base-routing-shards/manifest.json",
    shardFormat: "default",
    paddingShards: 1,
    points: [],
    strict: false,
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
    if (arg === "--shard-manifest") {
      parsed.shardManifest = requireValue(args, ++index, arg);
      continue;
    }
    if (arg === "--padding-shards") {
      parsed.paddingShards = Number(requireValue(args, ++index, arg));
      if (!Number.isFinite(parsed.paddingShards) || parsed.paddingShards < 0) {
        throw new Error("--padding-shards must be a non-negative number.");
      }
      continue;
    }
    if (arg === "--shard-format") {
      parsed.shardFormat = requireValue(args, ++index, arg);
      if (
        !["default", "json", "msgpack", "compact", "cwb"].includes(
          parsed.shardFormat,
        )
      ) {
        throw new Error(
          "--shard-format must be default, json, msgpack, compact, or cwb.",
        );
      }
      continue;
    }
    if (arg === "--point") {
      parsed.points.push(parsePoint(requireValue(args, ++index, arg)));
      continue;
    }
    if (arg === "--strict") {
      parsed.strict = true;
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
  if (rest.length > 0 || !Number.isFinite(lat) || !Number.isFinite(lng)) {
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

function selectShardSource(entry, format) {
  if (format === "default") {
    return {
      format: entry?.format || "json",
      path: entry?.path,
    };
  }
  if (format === "compact" || format === "cwb") {
    const compactPath =
      entry?.formats?.compact?.path ||
      (entry?.format === "compact" ? entry?.path : null);
    if (!compactPath) {
      throw new Error(`Shard ${entry?.id || ""} has no compact path.`);
    }
    return { format: "compact", path: compactPath };
  }
  if (format === "msgpack") {
    const messagePackPath =
      entry?.formats?.msgpack?.path || entry?.messagePackPath;
    if (!messagePackPath) {
      throw new Error(`Shard ${entry?.id || ""} has no MessagePack path.`);
    }
    return { format: "msgpack", path: messagePackPath };
  }
  const jsonPath =
    entry?.formats?.json?.path ||
    (entry?.format === "json" || !entry?.format ? entry?.path : null);
  if (!jsonPath) {
    throw new Error(`Shard ${entry?.id || ""} has no JSON path.`);
  }
  return { format: "json", path: jsonPath };
}

function printUsage() {
  console.log(`Compare one local routing-shard leg with the all-shards graph.

Usage:
  npm run route:compare-shards -- --point <lat,lng> --point <lat,lng> [options]

Options:
  --manifest <path>        Map manifest. Defaults to public-data/map-manifest.json.
  --shard-manifest <path>  Routing shard manifest. Defaults to public-data/base-routing-shards/manifest.json.
  --shard-format <format>  default, compact, json, or msgpack. Defaults to default.
  --padding-shards <n>     Point-corridor shard padding. Defaults to 1.
  --point <lat,lng>        Test waypoint. Pass at least two in route order.
  --strict                 Exit non-zero when traversal sequences do not match.
`);
}
