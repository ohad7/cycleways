#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  invalidateFeaturedAssetCache,
  loadRouteStateForSlug,
} from "./lib/featuredRouteSnapshotBuilder.mjs";
import { decodeRoutePayload } from "../packages/core/src/utils/route-encoding.js";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicDataRoot = path.join(repoRoot, "build/public-data");
const catalogPath = path.join(repoRoot, "public-data/route-catalog.json");
const draftPath = path.join(repoRoot, "editor/.drafts/route-catalog.json");
const reportPath = path.join(repoRoot, "build/featured-route-current-graph-migration.json");
const reviewGeoJsonPath = path.join(
  repoRoot,
  "build/featured-route-current-graph-migration.geojson",
);
const materialReviewGeoJsonPath = path.join(
  repoRoot,
  "build/featured-route-material-review.geojson",
);

function radians(value) {
  return (Number(value) * Math.PI) / 180;
}

function sampled(points, limit = 250) {
  if (!Array.isArray(points) || points.length <= limit) return points || [];
  return Array.from({ length: limit }, (_, index) =>
    points[Math.round((index * (points.length - 1)) / (limit - 1))],
  );
}

function pointToSegmentDistanceMeters(point, start, end) {
  const earthRadius = 6371000;
  const latitudeScale = Math.PI * earthRadius / 180;
  const longitudeScale = latitudeScale * Math.cos(radians(point.lat));
  const startX = (Number(start.lng) - Number(point.lng)) * longitudeScale;
  const startY = (Number(start.lat) - Number(point.lat)) * latitudeScale;
  const endX = (Number(end.lng) - Number(point.lng)) * longitudeScale;
  const endY = (Number(end.lat) - Number(point.lat)) * latitudeScale;
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const squaredLength = deltaX * deltaX + deltaY * deltaY;
  const fraction = squaredLength > 0
    ? Math.max(0, Math.min(1, -(startX * deltaX + startY * deltaY) / squaredLength))
    : 0;
  return Math.hypot(startX + fraction * deltaX, startY + fraction * deltaY);
}

function approximateDeviationMeters(left, right) {
  const from = sampled(left);
  const to = sampled(right);
  if (from.length === 0 || to.length === 0) return null;
  const directional = (source, target) => {
    let maximum = 0;
    for (const point of source) {
      let minimum = Infinity;
      for (let index = 0; index < target.length - 1; index += 1) {
        minimum = Math.min(
          minimum,
          pointToSegmentDistanceMeters(point, target[index], target[index + 1]),
        );
      }
      maximum = Math.max(maximum, minimum);
    }
    return maximum;
  };
  return Math.max(directional(from, right), directional(to, left));
}

function lineFeature(slug, kind, geometry, properties = {}) {
  return {
    type: "Feature",
    properties: {
      slug,
      kind,
      stroke: kind === "previous" ? "#d62728" : "#16833f",
      "stroke-width": kind === "previous" ? 4 : 6,
      "stroke-opacity": kind === "previous" ? 0.75 : 0.9,
      ...properties,
    },
    geometry: {
      type: "LineString",
      coordinates: (geometry || []).map((point) => [Number(point.lng), Number(point.lat)]),
    },
  };
}

async function main() {
  const [catalog, manifest] = await Promise.all([
    readFile(catalogPath, "utf8").then(JSON.parse),
    readFile(path.join(publicDataRoot, "map-manifest.json"), "utf8").then(JSON.parse),
  ]);
  const currentCwBaseIndex = JSON.parse(
    await readFile(path.join(publicDataRoot, manifest.cwBaseIndex), "utf8"),
  );
  const currentCwSegmentIds = new Set(
    Object.keys(currentCwBaseIndex.segments || {}).map(Number),
  );
  invalidateFeaturedAssetCache();
  const migratedEntries = [];
  const comparisons = [];
  const features = [];
  const historicalRecoveryBySlug = new Map();
  for (const entry of catalog.entries || []) {
    const { routeState, currentShareInfo } = await loadRouteStateForSlug(entry.slug, {
      routeCatalogPath: catalogPath,
      publicDataRoot,
      manifest,
      allowSnapshotFallback: false,
      includeCurrentShareInfo: true,
      log: () => {},
    });
    if (!currentShareInfo?.param) {
      throw new Error(`Could not encode a current-graph token for ${entry.slug}`);
    }
    historicalRecoveryBySlug.set(entry.slug, routeState.requiresReview === true);
    migratedEntries.push({ ...entry, route: currentShareInfo.param });
  }

  let migratedCatalog = { ...catalog, entries: migratedEntries };
  await mkdir(path.dirname(draftPath), { recursive: true });
  await writeFile(draftPath, `${JSON.stringify(migratedCatalog, null, 2)}\n`);

  // Fraction quantization can move a reconstructed anchor onto an adjacent
  // edge at an exact boundary. Re-encode only those candidates that do not yet
  // replay exactly, and require convergence rather than publishing a fallback.
  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;
    const nextEntries = [];
    for (const entry of migratedCatalog.entries || []) {
      const { routeState, currentShareInfo } = await loadRouteStateForSlug(entry.slug, {
        routeCatalogPath: draftPath,
        publicDataRoot,
        manifest,
        allowSnapshotFallback: false,
        includeCurrentShareInfo: true,
        log: () => {},
      });
      const replacement = routeState.requiresReview === true
        ? currentShareInfo?.param
        : entry.route;
      if (!replacement) {
        throw new Error(`Current token did not converge for ${entry.slug}`);
      }
      changed ||= replacement !== entry.route;
      nextEntries.push({ ...entry, route: replacement });
    }
    migratedCatalog = { ...migratedCatalog, entries: nextEntries };
    await writeFile(draftPath, `${JSON.stringify(migratedCatalog, null, 2)}\n`);
    if (!changed) break;
  }

  const originalBySlug = new Map((catalog.entries || []).map((entry) => [entry.slug, entry]));
  for (const entry of migratedCatalog.entries || []) {
    const { routeState, routeFormat } = await loadRouteStateForSlug(entry.slug, {
      routeCatalogPath: draftPath,
      publicDataRoot,
      manifest,
      allowSnapshotFallback: false,
      log: () => {},
    });
    const previousSnapshot = JSON.parse(
      await readFile(
        path.join(repoRoot, "public-data/featured-routes", `${entry.slug}.json`),
        "utf8",
      ),
    );
    const previousGeometry = previousSnapshot.route?.geometry || [];
    const previousDistance = Number(previousSnapshot.route?.distance) || 0;
    const currentDistance = Number(routeState.distance) || 0;
    const distanceDeltaMeters = currentDistance - previousDistance;
    const distanceDeltaPercent = previousDistance
      ? (distanceDeltaMeters / previousDistance) * 100
      : null;
    const approximateMaxDeviationMeters = approximateDeviationMeters(
      previousGeometry,
      routeState.geometry,
    );
    const previousPayload = decodeRoutePayload(originalBySlug.get(entry.slug)?.route || "");
    const historicalSegmentIds = [...new Set((previousPayload.segmentIds || []).map(Number))];
    const visitedCurrentSegmentIds = new Set(
      (routeState.routingValidation?.traversalSlices || []).flatMap((slice) =>
        (slice.cwMembership || []).map((membership) => Number(membership.segmentId)),
      ),
    );
    const missingCurrentSegmentIds = historicalSegmentIds.filter(
      (segmentId) =>
        currentCwSegmentIds.has(segmentId) && !visitedCurrentSegmentIds.has(segmentId),
    );
    const materialChange =
      Math.abs(distanceDeltaMeters) > 100 ||
      Math.abs(distanceDeltaPercent || 0) > 1 ||
      Number(approximateMaxDeviationMeters) > 100 ||
      missingCurrentSegmentIds.length > 0;
    comparisons.push({
      slug: entry.slug,
      previousToken: originalBySlug.get(entry.slug)?.route || null,
      currentToken: entry.route,
      currentFormat: routeFormat,
      previousDistanceMeters: previousDistance,
      currentDistanceMeters: currentDistance,
      distanceDeltaMeters,
      distanceDeltaPercent,
      approximateMaxDeviationMeters,
      historicalSegmentIds,
      missingCurrentSegmentIds,
      materialChange,
      currentFingerprint: routeState.routingValidation?.contentFingerprint || null,
      recoveredHistoricalToken: historicalRecoveryBySlug.get(entry.slug) === true,
      exactCurrentPolicy: routeState.requiresReview !== true && !routeState.routeFailure,
    });
    features.push(
      lineFeature(entry.slug, "previous", previousGeometry, { materialChange }),
      lineFeature(entry.slug, "current", routeState.geometry, { materialChange }),
    );
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    stagedMapVersion: manifest.version,
    sourceCatalog: path.relative(repoRoot, catalogPath),
    draftCatalog: path.relative(repoRoot, draftPath),
    reviewGeoJson: path.relative(repoRoot, reviewGeoJsonPath),
    materialReviewGeoJson: path.relative(repoRoot, materialReviewGeoJsonPath),
    summary: {
      routes: comparisons.length,
      historicalTokensRecovered: comparisons.filter((item) => item.recoveredHistoricalToken).length,
      materialChanges: comparisons.filter((item) => item.materialChange).length,
      exactCurrentPolicy: comparisons.filter((item) => item.exactCurrentPolicy).length,
    },
    routes: comparisons,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(
    reviewGeoJsonPath,
    `${JSON.stringify({ type: "FeatureCollection", features }, null, 2)}\n`,
  );
  await writeFile(
    materialReviewGeoJsonPath,
    `${JSON.stringify({
      type: "FeatureCollection",
      features: features.filter((feature) => feature.properties?.materialChange === true),
    }, null, 2)}\n`,
  );
  console.log(JSON.stringify({ report: reportPath, draft: draftPath, ...report.summary }));
}

await main();
