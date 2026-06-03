#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROAD_TYPES = ["paved", "dirt", "road"];

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printUsage();
  process.exit(0);
}

const sourcePath = resolve(process.cwd(), options.source);
const geojson = JSON.parse(await readFile(sourcePath, "utf8"));
const stats = calculateNetworkLengthByRoadType(geojson, {
  activeOnly: options.activeOnly,
});

printReport({
  source: options.source,
  activeOnly: options.activeOnly,
  stats,
});

export function calculateNetworkLengthByRoadType(geojson, { activeOnly = true } = {}) {
  const totals = new Map();
  const features = Array.isArray(geojson?.features) ? geojson.features : [];
  let includedFeatures = 0;
  let skippedFeatures = 0;

  for (const feature of features) {
    if (activeOnly && feature?.properties?.status && feature.properties.status !== "active") {
      skippedFeatures += 1;
      continue;
    }

    const roadType = normalizeRoadType(feature?.properties?.roadType);
    const meters = geometryLengthMeters(feature?.geometry);
    if (meters <= 0) {
      skippedFeatures += 1;
      continue;
    }

    const current = totals.get(roadType) || { meters: 0, featureCount: 0 };
    current.meters += meters;
    current.featureCount += 1;
    totals.set(roadType, current);
    includedFeatures += 1;
  }

  const orderedTypes = [
    ...ROAD_TYPES,
    ...[...totals.keys()].filter((type) => !ROAD_TYPES.includes(type)).sort(),
  ];
  const byType = orderedTypes
    .filter((type) => totals.has(type) || ROAD_TYPES.includes(type))
    .map((type) => ({
      roadType: type,
      meters: totals.get(type)?.meters || 0,
      kilometers: (totals.get(type)?.meters || 0) / 1000,
      featureCount: totals.get(type)?.featureCount || 0,
    }));
  const totalMeters = byType.reduce((sum, item) => sum + item.meters, 0);

  return {
    byType,
    totalMeters,
    totalKilometers: totalMeters / 1000,
    includedFeatures,
    skippedFeatures,
  };
}

function normalizeRoadType(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "unknown";
}

function geometryLengthMeters(geometry) {
  if (!geometry) return 0;
  if (geometry.type === "LineString") return lineLengthMeters(geometry.coordinates);
  if (geometry.type === "MultiLineString") {
    return (geometry.coordinates || []).reduce(
      (sum, line) => sum + lineLengthMeters(line),
      0,
    );
  }
  return 0;
}

function lineLengthMeters(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return 0;
  let meters = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    meters += haversineMeters(coordinates[index - 1], coordinates[index]);
  }
  return meters;
}

function haversineMeters(a, b) {
  const lon1 = Number(a?.[0]);
  const lat1 = Number(a?.[1]);
  const lon2 = Number(b?.[0]);
  const lat2 = Number(b?.[1]);
  if (![lon1, lat1, lon2, lat2].every(Number.isFinite)) return 0;

  const radiusMeters = 6371e3;
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const deltaPhi = toRadians(lat2 - lat1);
  const deltaLambda = toRadians(lon2 - lon1);
  const h =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return 2 * radiusMeters * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function parseArgs(args) {
  const parsed = {
    source: "public-data/bike_roads.geojson",
    activeOnly: true,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--source") {
      parsed.source = args[++index];
      if (!parsed.source) throw new Error("--source requires a path");
    } else if (arg === "--all-statuses") {
      parsed.activeOnly = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function printReport({ source, activeOnly, stats }) {
  console.log(`Source: ${source}`);
  console.log(`Scope: ${activeOnly ? "active features only" : "all feature statuses"}`);
  console.log("");
  console.log("Road type  Features  Kilometers  Meters");
  console.log("---------  --------  ----------  ------");
  for (const item of stats.byType) {
    console.log(
      [
        item.roadType.padEnd(9),
        String(item.featureCount).padStart(8),
        formatNumber(item.kilometers, 2).padStart(10),
        formatNumber(item.meters, 0).padStart(6),
      ].join("  "),
    );
  }
  console.log("---------  --------  ----------  ------");
  console.log(
    [
      "total".padEnd(9),
      String(stats.includedFeatures).padStart(8),
      formatNumber(stats.totalKilometers, 2).padStart(10),
      formatNumber(stats.totalMeters, 0).padStart(6),
    ].join("  "),
  );
  if (stats.skippedFeatures > 0) {
    console.log("");
    console.log(`Skipped features: ${stats.skippedFeatures}`);
  }
}

function formatNumber(value, digits) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function printUsage() {
  console.log(`Usage: node scripts/network-length-by-road-type.mjs [options]

Options:
  --source <path>    GeoJSON source file. Default: public-data/bike_roads.geojson
  --all-statuses     Include deprecated/legacy features when present.
  -h, --help         Show this help.
`);
}
