#!/usr/bin/env node
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { createReadStream, watch } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, extname, isAbsolute, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createVideoSync } from "../src/components/featured/videoSync.js";
import sharp from "sharp";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
  createRouteManager,
  restoreRouteFromParam,
} from "@cycleways/core/routing/routeActions.js";
import {
  loadFeaturedAssetsFromDisk,
  getBaseRoutingDecodeAssets,
  loadRoutePolylineForSlug,
  invalidateFeaturedAssetCache,
  buildFeaturedRouteSnapshots,
  readFeaturedRouteSnapshot,
  routeStateFromFeaturedSnapshot,
  snapshotMatchesRouteToken,
} from "../scripts/lib/featuredRouteSnapshotBuilder.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "..");
const editorRoot = resolve(repoRoot, "editor");
const iconsRoot = resolve(repoRoot, "icons");
const sourcePath = resolve(repoRoot, "data/map-source.geojson");
const tokenPath = resolve(repoRoot, "mapbox-token.js");
const buildDir = resolve(repoRoot, "build");
const dataDir = resolve(repoRoot, "data");
const publicDataDir = resolve(repoRoot, "public-data");
const buildPublicDataDir = resolve(buildDir, "public-data");
const osmBuildDir = resolve(buildDir, "osm");
const osmRawWaysPath = resolve(osmBuildDir, "osm-raw-ways.geojson");
const osmIntersectionsPath = resolve(osmBuildDir, "osm-intersections.geojson");
const osmBaseGraphPath = resolve(osmBuildDir, "osm-base-graph.json");
const osmElevatedBaseGraphPath = resolve(osmBuildDir, "osm-base-graph-elevated.json");
const reportPath = resolve(buildDir, "report.json");
const buildManifestPath = resolve(buildPublicDataDir, "map-manifest.json");
const osmGraphEdgesPath = resolve(osmBuildDir, "osm-base-edges.geojson");
const osmMatchSummaryPath = resolve(osmBuildDir, "cw-osm-match-summary.json");
const osmMatchPreviewPath = resolve(osmBuildDir, "cw-osm-match-preview.geojson");
const osmMatchesPath = resolve(osmBuildDir, "cw-osm-matches.json");
const cwBaseOverlayPath = resolve(dataDir, "cw-base-overlay.json");
const manualBaseEdgesPath = resolve(dataDir, "manual-base-edges.geojson");
const poiTypesModulePath = resolve(repoRoot, "packages/core/src/data/poiTypes.js");
const videoSyncModulePath = resolve(repoRoot, "src/components/featured/videoSync.js");
const coreSrcRoot = resolve(repoRoot, "packages/core/src");
const promotedManifestPath = resolve(publicDataDir, "map-manifest.json");
const videoKeyframesDraftDir = resolve(editorRoot, ".drafts/route-videos");
const videoKeyframesPublicDir = resolve(publicDataDir, "route-videos");
const routeCatalogDraftPath = resolve(editorRoot, ".drafts/route-catalog.json");
const routeCatalogPublicPath = resolve(publicDataDir, "route-catalog.json");
const featuredRoutesDir = resolve(publicDataDir, "featured-routes");
const poiImagesDir = resolve(publicDataDir, "poi-images");
const imagesDir = resolve(repoRoot, "public/images");
const placesPath = resolve(repoRoot, "data/places.json");
const regionZonesPath = resolve(repoRoot, "data/region-zones.json");
const port = Number(process.env.EDITOR_PORT || 8899);
const devReloadEnabled = process.env.EDITOR_CLIENT_RELOAD === "1";
let requestCounter = 0;
let buildCounter = 0;
let osmGraphCounter = 0;
let promoteCounter = 0;
let atomicWriteCounter = 0;
const devReloadClients = new Set();

const qualityKeys = ["overall", "safety", "comfort", "scenery"];
const dataMarkerOptionalStringFields = [
  "id",
  "name",
  "description",
  "photo",
  "thumbnail",
  "website",
  "phone",
  "hours",
];

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasGalleryImage(marker) {
  if (Array.isArray(marker?.images)) {
    return marker.images.some((entry) => entry && hasText(entry.photo));
  }
  return hasText(marker.photo) || hasText(marker.thumbnail);
}

const POI_IMAGE_PUBLIC_PATH = "public-data/poi-images";
const POI_IMAGE_MAX_WIDTH = 1600;
const POI_IMAGE_THUMB_WIDTH = 480;

// Map an authored, stable POI id onto a filesystem-safe slug. Throws when the
// id has no usable characters so we never write an empty or traversal filename.
export function sanitizePoiImageId(id) {
  const slug = String(id ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) {
    throw new Error("POI image id must contain at least one letter or digit");
  }
  return slug;
}

// Resize and re-encode an uploaded photo into a serving-sized WebP plus a small
// thumbnail, both written under public-data/poi-images. Returns the canonical
// web paths the editor stores on the marker. Phone photos are routinely 5-8MB;
// this keeps committed assets small enough for the git repo.
export async function processPoiImage({ id, buffer }, options = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error("POI image upload is empty");
  }
  const safeId = sanitizePoiImageId(id);
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 8);
  const baseName = `${safeId}-${hash}`;
  const outputDir = options.outputDir || poiImagesDir;
  const publicPath = options.publicPath || POI_IMAGE_PUBLIC_PATH;
  await mkdir(outputDir, { recursive: true });

  const photoBuffer = await sharp(buffer)
    .rotate()
    .resize({ width: POI_IMAGE_MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  const thumbBuffer = await sharp(buffer)
    .rotate()
    .resize({ width: POI_IMAGE_THUMB_WIDTH, withoutEnlargement: true })
    .webp({ quality: 72 })
    .toBuffer();

  await writeFile(join(outputDir, `${baseName}.webp`), photoBuffer);
  await writeFile(join(outputDir, `${baseName}-thumb.webp`), thumbBuffer);

  return {
    photo: `${publicPath}/${baseName}.webp`,
    thumbnail: `${publicPath}/${baseName}-thumb.webp`,
    bytes: { photo: photoBuffer.length, thumbnail: thumbBuffer.length },
  };
}

function isRemoteImagePath(value) {
  return /^(https?:)?\/\//i.test(value) || value.startsWith("data:");
}

// Resolve a marker image reference to an absolute path on disk, or null for
// remote/data URLs (which we cannot and should not check locally).
function localImagePathToAbsolute(value, baseDir) {
  if (typeof value !== "string" || value.trim() === "" || isRemoteImagePath(value)) {
    return null;
  }
  return resolve(baseDir, value.replace(/^\/+/, ""));
}

function collectSourceImagePaths(source) {
  const paths = [];
  const features = Array.isArray(source?.features) ? source.features : [];
  for (const feature of features) {
    const data = feature?.properties?.data;
    if (!Array.isArray(data)) continue;
    for (const marker of data) {
      for (const field of ["photo", "thumbnail"]) {
        const value = marker?.[field];
        if (typeof value === "string" && value.trim() !== "") paths.push(value);
      }
      if (Array.isArray(marker?.images)) {
        for (const entry of marker.images) {
          for (const field of ["photo", "thumbnail"]) {
            const value = entry?.[field];
            if (typeof value === "string" && value.trim() !== "") paths.push(value);
          }
        }
      }
    }
  }
  return paths;
}

// Return the local POI image references in the source that do not resolve to a
// file on disk. Remote URLs are skipped. Used to block promote on broken refs.
export async function findMissingSourceImages(source, baseDir = repoRoot) {
  const missing = [];
  const seen = new Set();
  for (const imagePath of collectSourceImagePaths(source)) {
    if (seen.has(imagePath)) continue;
    seen.add(imagePath);
    const absolute = localImagePathToAbsolute(imagePath, baseDir);
    if (!absolute) continue;
    const fileStat = await statOrNull(absolute);
    if (!fileStat || !fileStat.isFile()) {
      missing.push(imagePath);
    }
  }
  return missing;
}

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".ico", "image/x-icon"],
]);

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendText(response, status, text) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(text);
}

function sendJavaScript(response, status, text) {
  response.writeHead(status, {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(text);
}

function sendHtml(response, status, text) {
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(text);
}

function formatLogDetail(detail) {
  if (detail === undefined || detail === null) {
    return "";
  }
  if (typeof detail === "string") {
    return ` ${detail}`;
  }
  try {
    return ` ${JSON.stringify(detail)}`;
  } catch {
    return ` ${String(detail)}`;
  }
}

function log(level, message, detail) {
  const line = `[${new Date().toISOString()}] [${level}] ${message}${formatLogDetail(detail)}`;
  if (level === "error" || level === "warn") {
    console.error(line);
    return;
  }
  console.log(line);
}

function logApi(requestId, message, detail) {
  log("info", `api#${requestId} ${message}`, detail);
}

function repoRelative(path) {
  return relative(repoRoot, path) || ".";
}

function summarizeSource(source) {
  const features = Array.isArray(source?.features) ? source.features : [];
  let active = 0;
  let deprecated = 0;
  let dataMarkers = 0;
  let qualityRecords = 0;

  for (const feature of features) {
    const properties = feature?.properties || {};
    const status = properties.status || "active";
    if (status === "deprecated" || properties.deprecated) {
      deprecated += 1;
    } else if (feature?.geometry?.type === "LineString") {
      active += 1;
    }
    dataMarkers += Array.isArray(properties.data) ? properties.data.length : 0;
    if (properties.quality !== undefined) {
      qualityRecords += 1;
    }
  }

  return {
    records: features.length,
    active,
    deprecated,
    dataMarkers,
    qualityRecords,
  };
}

function summarizeReport(report) {
  const validation = report?.validation || {};
  const elevation = report?.elevation || {};
  const topology = validation.topology || {};
  return {
    version: report?.outputs?.runtime?.version,
    features: validation.featureCount,
    segmentRecords: validation.segmentsCount,
    newSegments: (validation.newSegments || []).length,
    routeWarnings: (validation.routeCompatibilityWarnings || []).length,
    placeholderSegmentNames: (validation.placeholderSegmentNames || []).length,
    activeSplitNumberedNames: (validation.activeSplitNumberedNames || []).length,
    elevation: {
      skip: elevation.skipElevation,
      lookups: elevation.lookups,
      cacheHits: elevation.cacheHits,
      skipped: elevation.skipped,
      failures: elevation.failures,
    },
    topology: {
      components: topology.connectedComponents,
      orphanEndpoints: topology.orphanEndpointCount,
    },
    baseRouting: {
      nodes: validation.baseRouting?.graphNodes,
      edges: validation.baseRouting?.graphEdges,
      cyclewaysEdges: validation.baseRouting?.cyclewaysEdges,
      unresolvedSegments: validation.baseRouting?.unresolvedSegments,
      warnings: (validation.baseRouting?.warnings || []).length,
      blockers: (validation.baseRouting?.blockers || []).length,
    },
  };
}

function sendDevReloadEvent(response, event, payload) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function handleDevReloadEvents(request, response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  response.write(": connected\n\n");
  devReloadClients.add(response);
  request.on("close", () => {
    devReloadClients.delete(response);
  });
}

function broadcastDevReload(reason) {
  if (devReloadClients.size === 0) return;
  log("info", "dev reload broadcast", { reason, clients: devReloadClients.size });
  for (const client of devReloadClients) {
    try {
      sendDevReloadEvent(client, "reload", { reason });
    } catch {
      devReloadClients.delete(client);
    }
  }
}

function injectDevReloadClient(html) {
  const script = `
<script>
(() => {
  let source = null;
  let reconnectTimer = null;

  function connect() {
    source = new EventSource("/api/dev/events");
    source.addEventListener("reload", () => {
      window.location.reload();
    });
    source.addEventListener("error", () => {
      source.close();
      if (reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 1000);
    });
  }

  connect();
})();
</script>`;
  if (html.includes("</body>")) {
    return html.replace("</body>", `${script}\n  </body>`);
  }
  return `${html}\n${script}\n`;
}

function startDevReloadWatcher() {
  if (!devReloadEnabled) return;

  let reloadTimer = null;
  const clientFilePattern = /\.(css|html|js)$/;
  const ignoredFiles = new Set(["server.mjs", "dev-server.mjs"]);
  try {
    const watcher = watch(editorRoot, { persistent: false }, (_eventType, filename) => {
      if (!filename) return;
      const fileName = String(filename);
      if (ignoredFiles.has(fileName) || !clientFilePattern.test(fileName)) return;
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => broadcastDevReload(fileName), 120);
    });
    watcher.unref?.();
    log("info", "dev reload watcher enabled", {
      editorRoot: repoRelative(editorRoot),
    });
  } catch (error) {
    log("warn", "dev reload watcher could not start", error instanceof Error ? error.message : String(error));
  }
}

function createLineLogger(level, prefix, append) {
  let pending = "";
  return {
    write(chunk) {
      const text = chunk.toString();
      append(text);
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) {
          log(level, `${prefix} ${line}`);
        }
      }
    },
    flush() {
      if (pending.trim()) {
        log(level, `${prefix} ${pending}`);
      }
      pending = "";
    },
  };
}

function isInside(parent, child) {
  const rel = relative(parent, child);
  return rel && !rel.startsWith("..") && !rel.startsWith("/");
}

function resolveManifestPath(root, manifestPath) {
  if (typeof manifestPath !== "string" || manifestPath.trim() === "" || isAbsolute(manifestPath)) {
    throw new Error(`Invalid manifest path: ${manifestPath}`);
  }
  const resolved = resolve(root, manifestPath);
  if (!isInside(root, resolved)) {
    throw new Error(`Manifest path escapes repository root: ${manifestPath}`);
  }
  return resolved;
}

const nodeRequire = createRequire(import.meta.url);

// loadFeaturedAssetsFromDisk / getBaseRoutingDecodeAssets / loadRouteStateForSlug
// / loadRoutePolylineForSlug now live in the shared featured-route snapshot
// builder and are imported above. The editor passes its draft route-catalog as
// the highest-priority token source so in-progress edits keep decoding.
const routePolylineForSlug = (slug) =>
  loadRoutePolylineForSlug(slug, { draftCatalogPath: routeCatalogDraftPath, log });

export async function promoteKeyframesDraft({ slug, draftsDir, publicDir, routePolyline }) {
  const draftPath = resolve(draftsDir, `${slug}.json`);
  let raw;
  try {
    raw = await readFile(draftPath, "utf-8");
  } catch (err) {
    if (err?.code === "ENOENT") {
      throw new Error(`No video-sync draft exists for "${slug}". Save draft before promoting.`);
    }
    throw err;
  }
  const draft = JSON.parse(raw);

  validateKeyframesDraft(draft, routePolyline);

  await mkdir(publicDir, { recursive: true });
  const targetPath = resolve(publicDir, `${slug}.json`);
  const tmpTarget = `${targetPath}.tmp`;
  await writeFile(tmpTarget, JSON.stringify(draft, null, 2));
  await rename(tmpTarget, targetPath);

  const indexPath = resolve(publicDir, "index.json");
  let index;
  try {
    index = JSON.parse(await readFile(indexPath, "utf-8"));
  } catch {
    index = { version: 1, routes: {} };
  }
  index.routes = index.routes || {};
  index.routes[slug] = `${slug}.json`;
  const tmpIndex = `${indexPath}.tmp`;
  await writeFile(tmpIndex, JSON.stringify(index, null, 2));
  await rename(tmpIndex, indexPath);

  await unlink(draftPath);
  return { ok: true, targetPath, indexPath };
}

const PASSES_NEAR_METERS = 500;
const ROUTE_CIRCULAR_ENDPOINT_THRESHOLD_METERS = 100;

function haversineMetersClassify(a, b) {
  const R = 6371000;
  const DEG = Math.PI / 180;
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function nearestDistanceToPolyline(point, polyline) {
  return nearestPointOnPolyline(point, polyline).distanceM;
}

function nearestPointOnPolyline(point, polyline) {
  let best = Infinity;
  let bestProgress = 0;
  let progress = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const segmentMeters = haversineMetersClassify(a, b);
    const DEG = Math.PI / 180;
    const cosLat = Math.cos(((a.lat + b.lat) / 2) * DEG);
    const ax = a.lng * cosLat, ay = a.lat;
    const bx = b.lng * cosLat, by = b.lat;
    const px = point.lng * cosLat, py = point.lat;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const projLat = a.lat + (b.lat - a.lat) * t;
    const projLng = a.lng + (b.lng - a.lng) * t;
    const d = haversineMetersClassify(point, { lat: projLat, lng: projLng });
    if (d < best) {
      best = d;
      bestProgress = progress + segmentMeters * t;
    }
    progress += segmentMeters;
  }
  return { distanceM: best, routeProgressMeters: bestProgress };
}

function placeMatchRadius(place) {
  const radius = Number(place?.matchRadiusM);
  return Number.isFinite(radius) && radius > 0 ? radius : PASSES_NEAR_METERS;
}

function nearbyPlaceIdsForPoint(point, places, maxMeters = PASSES_NEAR_METERS) {
  return places
    .filter((place) => {
      const radius = Number.isFinite(Number(place?.matchRadiusM))
        ? Number(place.matchRadiusM)
        : maxMeters;
      return haversineMetersClassify(place, point) <= radius;
    })
    .map((place) => place.id);
}

function placePolygon(place) {
  if (Array.isArray(place?.polygon)) return place.polygon;
  return null;
}

function routeProgressForPolygon(polyline, polygon) {
  let progress = 0;
  for (let i = 0; i < polyline.length; i++) {
    const point = polyline[i];
    if (pointInPolygon(point, polygon)) return progress;
    if (i < polyline.length - 1) {
      progress += haversineMetersClassify(point, polyline[i + 1]);
    }
  }
  return null;
}

function placeSegmentMatches(place, selectedSegments) {
  const includes = Array.isArray(place?.segmentNameIncludes)
    ? place.segmentNameIncludes
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    : [];
  if (includes.length === 0) return [];
  return selectedSegments.filter((segmentName) =>
    includes.some((needle) => String(segmentName || "").includes(needle)),
  );
}

function classifyPlaceMatches(places, geometry, selectedSegments = []) {
  return (places || [])
    .map((place) => {
      if (!place?.id) return null;
      const nearest = Number.isFinite(place.lat) && Number.isFinite(place.lng)
        ? nearestPointOnPolyline(place, geometry)
        : { distanceM: Infinity, routeProgressMeters: null };
      const polygon = placePolygon(place);
      const polygonProgress =
        polygon && Array.isArray(polygon)
          ? routeProgressForPolygon(geometry, polygon)
          : null;
      const matchedSegments = placeSegmentMatches(place, selectedSegments);
      const radius = placeMatchRadius(place);

      if (polygonProgress !== null) {
        return {
          id: place.id,
          relation: "passes_through",
          matchType: "polygon",
          distanceM: 0,
          routeProgressMeters: Math.round(polygonProgress),
        };
      }

      if (matchedSegments.length > 0) {
        return {
          id: place.id,
          relation: "passes_through",
          matchType: "segment",
          segmentNames: matchedSegments,
          distanceM: Number.isFinite(nearest.distanceM) ? Math.round(nearest.distanceM) : null,
          routeProgressMeters: Number.isFinite(nearest.routeProgressMeters)
            ? Math.round(nearest.routeProgressMeters)
            : null,
        };
      }

      if (nearest.distanceM <= radius) {
        return {
          id: place.id,
          relation: "near",
          matchType: "radius",
          distanceM: Math.round(nearest.distanceM),
          routeProgressMeters: Math.round(nearest.routeProgressMeters),
        };
      }

      return null;
    })
    .filter(Boolean)
    .sort((a, b) => {
      const ap = Number.isFinite(a.routeProgressMeters)
        ? a.routeProgressMeters
        : Number.POSITIVE_INFINITY;
      const bp = Number.isFinite(b.routeProgressMeters)
        ? b.routeProgressMeters
        : Number.POSITIVE_INFINITY;
      if (ap !== bp) return ap - bp;
      return String(a.id).localeCompare(String(b.id));
    });
}

function pointInPolygon(point, polygon) {
  const x = point.lng, y = point.lat;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function centroidOf(polyline) {
  let sumLat = 0, sumLng = 0;
  for (const p of polyline) {
    sumLat += p.lat;
    sumLng += p.lng;
  }
  return { lat: sumLat / polyline.length, lng: sumLng / polyline.length };
}

function distanceKmOf(polyline) {
  let total = 0;
  for (let i = 1; i < polyline.length; i++) {
    total += haversineMetersClassify(polyline[i - 1], polyline[i]);
  }
  return total / 1000;
}

function geoJsonLineDistanceMeters(feature) {
  const geometry = feature?.geometry;
  const lines =
    geometry?.type === "LineString"
      ? [geometry.coordinates]
      : geometry?.type === "MultiLineString"
        ? geometry.coordinates
        : [];
  let total = 0;
  for (const line of lines) {
    if (!Array.isArray(line)) continue;
    for (let i = 1; i < line.length; i++) {
      const prev = line[i - 1];
      const current = line[i];
      if (!Array.isArray(prev) || !Array.isArray(current)) continue;
      total += haversineMetersClassify(
        { lng: Number(prev[0]), lat: Number(prev[1]) },
        { lng: Number(current[0]), lat: Number(current[1]) },
      );
    }
  }
  return total;
}

function routeShapeOf(polyline) {
  const start = polyline[0];
  const end = polyline[polyline.length - 1];
  const endpointDistanceM = Math.round(haversineMetersClassify(start, end));
  return {
    type:
      endpointDistanceM <= ROUTE_CIRCULAR_ENDPOINT_THRESHOLD_METERS
        ? "circular"
        : "one_way",
    endpointDistanceM,
  };
}

function elevationDeltas(polyline) {
  let gain = 0, loss = 0;
  for (let i = 1; i < polyline.length; i++) {
    const dz = (polyline[i].elevation ?? 0) - (polyline[i - 1].elevation ?? 0);
    if (dz > 0) gain += dz;
    else loss -= dz;
  }
  return { elevationGainM: Math.round(gain), elevationLossM: Math.round(loss) };
}

function difficultyOf(distanceKm, elevationGainM) {
  if (elevationGainM > 500 || distanceKm > 40) return "hard";
  if (elevationGainM >= 150 || distanceKm >= 20) return "moderate";
  return "easy";
}

function surfaceTypeOf(roadMix) {
  const pavedShare = (Number(roadMix?.paved) || 0) + (Number(roadMix?.road) || 0);
  const dirtShare = Number(roadMix?.dirt) || 0;
  if (pavedShare >= 0.8) return "paved";
  if (dirtShare >= 0.8) return "dirt";
  return "mixed";
}

function normalizeRoadType(value) {
  if (value === "paved" || value === "dirt" || value === "road") return value;
  return "paved";
}

function buildSegmentFeatureLookup(geoJsonData) {
  const lookup = new Map();
  const features = Array.isArray(geoJsonData?.features) ? geoJsonData.features : [];
  for (const feature of features) {
    const name = feature?.properties?.name;
    if (typeof name !== "string" || !name) continue;
    lookup.set(name, {
      roadType: normalizeRoadType(feature.properties?.roadType),
      distanceM: geoJsonLineDistanceMeters(feature),
      quality: feature.properties?.quality,
    });
  }
  return lookup;
}

function catalogDecodedRouteFromState(routeState, segmentsData, segmentFeatureLookup) {
  if (!routeState || !Array.isArray(routeState.geometry) || routeState.geometry.length < 2) {
    return null;
  }
  const counts = { paved: 0, dirt: 0, road: 0 };
  let qualitySum = 0;
  let qualityWeight = 0;
  for (const segName of routeState.selectedSegments || []) {
    const segData = segmentsData[segName] || {};
    const featureData = segmentFeatureLookup.get(segName) || {};
    const rt = normalizeRoadType(segData.roadType || featureData.roadType);
    const weight =
      Number.isFinite(featureData.distanceM) && featureData.distanceM > 0
        ? featureData.distanceM
        : 1;
    counts[rt] += weight;
    const q = segData?.quality?.overall ?? featureData?.quality?.overall;
    if (Number.isFinite(q)) {
      qualitySum += q * weight;
      qualityWeight += weight;
    }
  }
  const total = counts.paved + counts.dirt + counts.road;
  const roadTypeFractions = total > 0
    ? { paved: counts.paved / total, dirt: counts.dirt / total, road: counts.road / total }
    : { paved: 1, dirt: 0, road: 0 };
  const qualityScore = qualityWeight > 0 ? qualitySum / qualityWeight : 0;
  return {
    geometry: routeState.geometry,
    selectedSegments: Array.isArray(routeState.selectedSegments)
      ? routeState.selectedSegments
      : [],
    roadTypeFractions,
    qualityScore,
  };
}

async function loadFeaturedRouteSnapshotFallbacks() {
  const snapshots = new Map();
  let files = [];
  try {
    files = await readdir(featuredRoutesDir);
  } catch {
    return snapshots;
  }
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const slugFromFile = file.replace(/\.json$/, "");
    const snapshot = await readJsonOrNull(resolve(featuredRoutesDir, file));
    const slug = typeof snapshot?.slug === "string" && snapshot.slug
      ? snapshot.slug
      : slugFromFile;
    snapshots.set(slug, snapshot);
  }
  return snapshots;
}

function routeStateFromMatchingSnapshotFallback({ token, entry, snapshotsBySlug }) {
  const slug = typeof entry?.slug === "string" ? entry.slug : "";
  if (!slug) return null;
  const snapshot = snapshotsBySlug.get(slug);
  if (!snapshot || !snapshotMatchesRouteToken(snapshot, token)) return null;
  const routeState = routeStateFromFeaturedSnapshot(snapshot);
  return Array.isArray(routeState.geometry) && routeState.geometry.length >= 2
    ? routeState
    : null;
}

function styleOf({ difficulty, roadMix, qualityScore, distanceKm }) {
  const roadFrac = roadMix?.road ?? 0;
  const dirtFrac = roadMix?.dirt ?? 0;
  if (difficulty === "easy" && roadFrac < 0.1 && qualityScore >= 3) return "family";
  if (qualityScore >= 4) return "scenic";
  if (difficulty === "hard" || distanceKm > 30) return "sporty";
  if (dirtFrac >= 0.5) return "adventurous";
  return "scenic";
}

async function readJsonOrNull(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf-8"));
  } catch {
    return null;
  }
}

const ROUTE_CATALOG_SLUG_RE = /^[a-z][a-z0-9-]*$/;

function validateRouteEndpoint(point, label) {
  if (point === undefined || point === null) return;
  if (typeof point !== "object") throw new Error(`${label} must be an object`);
  if (!point.name || typeof point.name !== "string") {
    throw new Error(`${label} is missing a name`);
  }
  if (point.description !== undefined && typeof point.description !== "string") {
    throw new Error(`${label} description must be a string`);
  }
  const images = Array.isArray(point.images) ? point.images : [];
  if (images.length === 0) throw new Error(`${label} must have at least one image`);
  for (const [i, img] of images.entries()) {
    if (!img || typeof img !== "object" || typeof img.photo !== "string" || !img.photo) {
      throw new Error(`${label} image ${i} is missing a photo`);
    }
    if (img.thumbnail !== undefined && typeof img.thumbnail !== "string") {
      throw new Error(`${label} image ${i} has an invalid thumbnail`);
    }
  }
}

function validateCatalogImage(image, label) {
  if (image === undefined || image === null) return;
  if (typeof image !== "object" || Array.isArray(image)) {
    throw new Error(`${label} must be an object`);
  }
  if (typeof image.photo !== "string" || !image.photo.trim()) {
    throw new Error(`${label} is missing a photo`);
  }
  if (image.thumbnail !== undefined && typeof image.thumbnail !== "string") {
    throw new Error(`${label} has an invalid thumbnail`);
  }
  if (image.alt !== undefined && typeof image.alt !== "string") {
    throw new Error(`${label} has an invalid alt`);
  }
}

export function validateCatalogDraft(catalog) {
  if (!catalog || !Array.isArray(catalog.entries)) {
    throw new Error("catalog.entries must be an array");
  }
  const seen = new Set();
  for (const entry of catalog.entries) {
    if (!entry || typeof entry !== "object") throw new Error("entry must be an object");
    if (!ROUTE_CATALOG_SLUG_RE.test(String(entry.slug))) {
      throw new Error(`invalid slug: ${entry.slug}`);
    }
    if (seen.has(entry.slug)) throw new Error(`duplicate slug: ${entry.slug}`);
    seen.add(entry.slug);
    if (!entry.name || !entry.summary) {
      throw new Error(`entry ${entry.slug} missing name or summary`);
    }
    if (typeof entry.route !== "string" || entry.route.length === 0) {
      throw new Error(`entry ${entry.slug} missing route token`);
    }
    if (entry.description !== undefined && typeof entry.description !== "string") {
      throw new Error(`entry ${entry.slug} description must be a string`);
    }
    validateCatalogImage(entry.heroImage, `entry ${entry.slug} heroImage`);
    validateRouteEndpoint(entry.start, `entry ${entry.slug} start point`);
    validateRouteEndpoint(entry.end, `entry ${entry.slug} end point`);
  }
}

async function seedCatalogFromFeaturedMeta() {
  const featuredDir = resolve(repoRoot, "src/featured");
  const entries = [];
  let files = [];
  try {
    files = await readdir(featuredDir);
  } catch {
    return { version: 1, entries };
  }
  for (const file of files) {
    if (!file.endsWith(".meta.js")) continue;
    const slug = file.replace(/\.meta\.js$/, "");
    try {
      const mod = await import(pathToFileURL(resolve(featuredDir, file)).href);
      const meta = mod.meta;
      if (!meta || !meta.route) continue;
      entries.push({
        slug: meta.slug || slug,
        name: meta.name || slug,
        summary: meta.summary || "",
        route: meta.route,
        notes: "",
        featured: true,
      });
    } catch (err) {
      log("warn", `seed: failed to import ${file}`, err.message);
    }
  }
  return { version: 1, entries };
}

export function recomputeCatalogMetadata(draft, refs) {
  const { places, zones, decodeRoute } = refs;
  validateCatalogDraft(draft);
  const entries = draft.entries.map((entry) => {
    const decoded = decodeRoute(entry.route, entry);
    if (!decoded) {
      throw new Error(`entry ${entry.slug}: route token failed to decode`);
    }
    const computed = classifyRoute(decoded, { places, zones });
    return { ...entry, ...computed };
  });
  return { version: 1, entries };
}

export async function buildLiveDecodeRoute() {
  const RouteManagerClass = nodeRequire(resolve(repoRoot, "packages/core/route-manager.js"));
  const { geoJsonData, segmentsData } = await loadFeaturedAssetsFromDisk();
  const segmentFeatureLookup = buildSegmentFeatureLookup(geoJsonData);
  const { baseRoutingNetwork, cwBaseIndex } = await getBaseRoutingDecodeAssets({ log });
  const snapshotsBySlug = await loadFeaturedRouteSnapshotFallbacks();
  const manager = await createRouteManager(
    RouteManagerClass,
    geoJsonData,
    segmentsData,
    baseRoutingNetwork,
  );
  return function decodeRoute(token, entry = null) {
    const routeToken = String(token || "").trim();
    let routeState = null;
    let decodeError = null;
    try {
      routeState = restoreRouteFromParam(manager, routeToken, segmentsData, cwBaseIndex);
    } catch (err) {
      decodeError = err;
    }
    let decoded = catalogDecodedRouteFromState(routeState, segmentsData, segmentFeatureLookup);
    if (decoded) return decoded;

    const fallbackState = routeStateFromMatchingSnapshotFallback({
      token: routeToken,
      entry,
      snapshotsBySlug,
    });
    decoded = catalogDecodedRouteFromState(fallbackState, segmentsData, segmentFeatureLookup);
    if (decoded) {
      log(
        "warn",
        `route catalog decode: ${entry?.slug || "route"} used existing snapshot fallback`,
      );
      return { ...decoded, decodeSource: "existing_snapshot" };
    }

    if (decodeError instanceof Error) {
      log(
        "warn",
        `route catalog decode failed for ${entry?.slug || "route"}: ${decodeError.message}`,
      );
    }
    return null;
  };
}

function catalogImageEntries(marker) {
  if (Array.isArray(marker?.images)) {
    return marker.images
      .filter((entry) => entry && typeof entry === "object" && hasText(entry.photo))
      .map((entry) => ({
        photo: entry.photo.trim(),
        thumbnail: hasText(entry.thumbnail) ? entry.thumbnail.trim() : entry.photo.trim(),
        alt: hasText(entry.alt) ? entry.alt.trim() : "",
      }));
  }
  if (hasText(marker?.photo)) {
    const photo = marker.photo.trim();
    return [
      {
        photo,
        thumbnail: hasText(marker.thumbnail) ? marker.thumbnail.trim() : photo,
        alt: hasText(marker.alt) ? marker.alt.trim() : "",
      },
    ];
  }
  return [];
}

export function routeCatalogImageCandidatesFromSnapshot(snapshot, segmentsData) {
  const selectedSegments = Array.isArray(snapshot?.selectedSegments)
    ? snapshot.selectedSegments
    : [];
  const segmentOrder = new Map();
  selectedSegments.forEach((segmentName, index) => {
    if (!segmentOrder.has(segmentName)) segmentOrder.set(segmentName, index);
  });

  const activeById = new Map();
  const activeDataPoints = Array.isArray(snapshot?.activeDataPoints)
    ? snapshot.activeDataPoints
    : [];
  activeDataPoints.forEach((point) => {
    if (hasText(point?.id)) activeById.set(point.id, point);
  });

  const candidates = [];
  const seen = new Set();
  selectedSegments.forEach((segmentName, selectedIndex) => {
    const segmentInfo = segmentsData?.[segmentName];
    const dataPoints = Array.isArray(segmentInfo?.data) ? segmentInfo.data : [];
    dataPoints.forEach((dataPoint, dataPointIndex) => {
      const stableId = hasText(dataPoint?.id)
        ? dataPoint.id
        : `${segmentName}-${dataPointIndex}`;
      const activePoint = activeById.get(stableId);
      catalogImageEntries(dataPoint).forEach((image, imageIndex) => {
        const key = `${image.photo}\n${image.thumbnail}`;
        if (seen.has(key)) return;
        seen.add(key);
        const progress = Number(activePoint?.routeProgressMeters);
        candidates.push({
          id: `${stableId}:${imageIndex}`,
          photo: image.photo,
          thumbnail: image.thumbnail,
          alt: image.alt || dataPoint?.name || segmentName,
          label: dataPoint?.name || segmentName,
          segmentName,
          dataPointId: stableId,
          imageIndex,
          routeProgressMeters: Number.isFinite(progress) ? progress : null,
          segmentOrder: segmentOrder.get(segmentName) ?? selectedIndex,
          dataPointIndex,
        });
      });
    });
  });

  candidates.sort((a, b) => {
    const ap =
      a.routeProgressMeters === null ? Number.POSITIVE_INFINITY : Number(a.routeProgressMeters);
    const bp =
      b.routeProgressMeters === null ? Number.POSITIVE_INFINITY : Number(b.routeProgressMeters);
    const aHasProgress = Number.isFinite(ap) && a.routeProgressMeters !== null;
    const bHasProgress = Number.isFinite(bp) && b.routeProgressMeters !== null;
    if (aHasProgress || bHasProgress) {
      if (!aHasProgress) return 1;
      if (!bHasProgress) return -1;
      if (ap !== bp) return ap - bp;
    }
    if (a.segmentOrder !== b.segmentOrder) return a.segmentOrder - b.segmentOrder;
    if (a.dataPointIndex !== b.dataPointIndex) return a.dataPointIndex - b.dataPointIndex;
    return a.imageIndex - b.imageIndex;
  });

  return candidates.map(({ segmentOrder, dataPointIndex, ...candidate }) => candidate);
}

export async function routeCatalogImageCandidatesForRoute(routeToken, { slug = null } = {}) {
  const token = String(routeToken || "").trim();
  if (!token) {
    throw new Error("route token is required");
  }
  const RouteManagerClass = nodeRequire(resolve(repoRoot, "packages/core/route-manager.js"));
  const { geoJsonData, segmentsData } = await loadFeaturedAssetsFromDisk();
  const { baseRoutingNetwork, cwBaseIndex } = await getBaseRoutingDecodeAssets({ log });
  const manager = await createRouteManager(
    RouteManagerClass,
    geoJsonData,
    segmentsData,
    baseRoutingNetwork,
  );
  let snapshot = null;
  let decodeError = null;
  try {
    snapshot = restoreRouteFromParam(manager, token, segmentsData, cwBaseIndex);
  } catch (err) {
    decodeError = err;
  }
  if (!snapshot || !Array.isArray(snapshot.selectedSegments)) {
    const fallback = slug ? await readFeaturedRouteSnapshot(slug) : null;
    if (fallback && snapshotMatchesRouteToken(fallback, token)) {
      snapshot = routeStateFromFeaturedSnapshot(fallback);
      log("warn", `route catalog image candidates: ${slug} used existing snapshot fallback`);
    }
  }
  if (!snapshot || !Array.isArray(snapshot.selectedSegments)) {
    const detail = decodeError instanceof Error ? `: ${decodeError.message}` : "";
    throw new Error(`route token failed to decode${detail}`);
  }
  return routeCatalogImageCandidatesFromSnapshot(snapshot, segmentsData);
}

export async function promoteCatalogDraft({ draftPath, publicPath, places, zones, decodeRoute }) {
  const draft = JSON.parse(await readFile(draftPath, "utf-8"));
  const enriched = recomputeCatalogMetadata(draft, { places, zones, decodeRoute });
  await mkdir(dirname(publicPath), { recursive: true });
  const tmp = `${publicPath}.tmp`;
  await writeFile(tmp, JSON.stringify(enriched, null, 2));
  await rename(tmp, publicPath);
  await unlink(draftPath);
  return { ok: true, publicPath, entryCount: enriched.entries.length };
}

export function classifyRoute(input, refs) {
  const { geometry, roadTypeFractions, qualityScore } = input;
  const selectedSegments = Array.isArray(input.selectedSegments)
    ? input.selectedSegments
    : [];
  if (!Array.isArray(geometry) || geometry.length < 2) {
    throw new Error("classifyRoute: geometry must have at least 2 points");
  }
  const distanceKm = distanceKmOf(geometry);
  const { elevationGainM, elevationLossM } = elevationDeltas(geometry);
  const routeShape = routeShapeOf(geometry);
  const difficulty = difficultyOf(distanceKm, elevationGainM);
  const roadMix = {
    paved: roadTypeFractions?.paved ?? 0,
    dirt: roadTypeFractions?.dirt ?? 0,
    road: roadTypeFractions?.road ?? 0,
  };
  const surfaceType = surfaceTypeOf(roadMix);
  const style = styleOf({
    difficulty,
    roadMix,
    qualityScore: qualityScore ?? 0,
    distanceKm,
  });
  const centroid = centroidOf(geometry);
  const regionId =
    refs.zones.find((z) => pointInPolygon(centroid, z.polygon))?.id ?? "unknown";
  const placeMatches = classifyPlaceMatches(refs.places, geometry, selectedSegments);
  const passesNear = placeMatches.map((match) => match.id);
  const startPlaceIds =
    routeShape.type === "circular"
      ? passesNear
      : nearbyPlaceIdsForPoint(geometry[0], refs.places);
  return {
    distanceKm: Math.round(distanceKm * 10) / 10,
    elevationGainM,
    elevationLossM,
    regionId,
    passesNear,
    placeMatches,
    startPlaceIds,
    difficulty,
    style,
    routeShape,
    surfaceType,
    roadMix,
    qualityScore: qualityScore ?? 0,
  };
}

export function validateKeyframesDraft(draft, routePolyline, maxMeters = 80) {
  if (!draft || typeof draft !== "object") {
    throw new Error("draft must be an object");
  }
  const { youtubeId, videoDuration, keyframes } = draft;
  if (typeof youtubeId !== "string" || !youtubeId) {
    throw new Error("draft.youtubeId required");
  }
  if (typeof videoDuration !== "number" || videoDuration <= 0) {
    throw new Error("draft.videoDuration must be a positive number");
  }
  if (!Array.isArray(keyframes) || keyframes.length < 2) {
    throw new Error("draft.keyframes must have at least 2 entries");
  }
  // createVideoSync enforces schema + sort + boundary t-values + route validity.
  let sync;
  try {
    sync = createVideoSync({
      keyframes,
      videoDuration,
      routeGeometry: routePolyline,
    });
  } catch (err) {
    throw new Error(`videoSync rejected draft: ${err.message}`);
  }
  for (const kf of keyframes) {
    const snap = sync.snapClickToRoute(
      { lat: kf.lat, lng: kf.lng ?? kf.lon },
      maxMeters,
    );
    if (!snap) {
      throw new Error(
        `keyframe at t=${kf.t} is too far from route (>${maxMeters}m)`,
      );
    }
  }
}

async function readRequestJson(request, limitBytes = 25 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limitBytes) {
      throw new Error("Request body is too large");
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

function backfillDeprecatedRouteAnchors(source) {
  if (!source || !Array.isArray(source.features)) return;
  for (const feature of source.features) {
    const props = feature?.properties;
    if (!props || typeof props !== "object") continue;
    const isDeprecated =
      props.deprecated === true || props.status === "deprecated";
    if (!isDeprecated) continue;
    if (Array.isArray(props.routeAnchors) && props.routeAnchors.length > 0) continue;
    if (props.middle && typeof props.middle === "object") continue;
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length === 0) continue;
    // Sample up to 3 points along the LineString: first, middle, last.
    const n = coords.length;
    const picks = n === 1 ? [0] : n === 2 ? [0, 1] : [0, Math.floor(n / 2), n - 1];
    const anchors = picks
      .map((i) => coords[i])
      .filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))
      .map((c) => [c[0], c[1]]);
    if (anchors.length > 0) {
      props.routeAnchors = anchors;
    }
  }
}

export function validateSourceGeojson(source) {
  if (!source || source.type !== "FeatureCollection" || !Array.isArray(source.features)) {
    throw new Error("Source must be a GeoJSON FeatureCollection");
  }

  const ids = new Set();
  const names = new Set();

  for (const [index, feature] of source.features.entries()) {
    if (!feature || feature.type !== "Feature") {
      throw new Error(`Feature ${index} is not a GeoJSON Feature`);
    }
    if (!feature.properties || typeof feature.properties !== "object") {
      throw new Error(`Feature ${index} is missing properties`);
    }

    const { id, name } = feature.properties;
    if (id !== undefined && id !== null) {
      if (!Number.isInteger(id)) {
        throw new Error(`Feature ${index} has a non-integer id`);
      }
      if (ids.has(id)) {
        throw new Error(`Duplicate segment id ${id}`);
      }
      ids.add(id);
    }
    if (name) {
      if (names.has(name)) {
        throw new Error(`Duplicate segment name ${name}`);
      }
      names.add(name);
    }

    const status = feature.properties.status || "active";
    const activeLine =
      feature.geometry?.type === "LineString" &&
      !feature.properties.deprecated &&
      !["deprecated", "draft", "legacy"].includes(status);
    validateQuality(feature.properties.quality, name || index, activeLine);

    if (feature.properties.data !== undefined) {
      if (!Array.isArray(feature.properties.data)) {
        throw new Error(`Feature ${name || index} has non-array data markers`);
      }
      for (const [markerIndex, marker] of feature.properties.data.entries()) {
        if (!marker || typeof marker !== "object" || Array.isArray(marker)) {
          throw new Error(`Feature ${name || index} data marker ${markerIndex} is invalid`);
        }
        if (typeof marker.type !== "string" || marker.type.trim() === "") {
          throw new Error(`Feature ${name || index} data marker ${markerIndex} is missing a type`);
        }
        if (marker.information !== undefined && typeof marker.information !== "string") {
          throw new Error(`Feature ${name || index} data marker ${markerIndex} has invalid information`);
        }
        for (const field of dataMarkerOptionalStringFields) {
          if (marker[field] !== undefined && typeof marker[field] !== "string") {
            throw new Error(`Feature ${name || index} data marker ${markerIndex} has invalid ${field}`);
          }
        }
        if (marker.gallery !== undefined && typeof marker.gallery !== "boolean") {
          throw new Error(`Feature ${name || index} data marker ${markerIndex} has invalid gallery flag`);
        }
        if (marker.images !== undefined) {
          if (!Array.isArray(marker.images)) {
            throw new Error(`Feature ${name || index} data marker ${markerIndex} has non-array images`);
          }
          for (const [imageIndex, entry] of marker.images.entries()) {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
              throw new Error(`Feature ${name || index} data marker ${markerIndex} image ${imageIndex} is invalid`);
            }
            if (!hasText(entry.photo)) {
              throw new Error(`Feature ${name || index} data marker ${markerIndex} image ${imageIndex} is missing a photo`);
            }
            if (entry.thumbnail !== undefined && typeof entry.thumbnail !== "string") {
              throw new Error(`Feature ${name || index} data marker ${markerIndex} image ${imageIndex} has invalid thumbnail`);
            }
          }
        }
        if (marker.gallery === true && !hasGalleryImage(marker)) {
          throw new Error(`Feature ${name || index} data marker ${markerIndex} is in the gallery but has no image`);
        }
        if (hasGalleryImage(marker)) {
          if (!hasText(marker.id)) {
            throw new Error(`Feature ${name || index} data marker ${markerIndex} with an image is missing a stable id`);
          }
          if (!hasText(marker.name) && !hasText(marker.information)) {
            throw new Error(`Feature ${name || index} data marker ${markerIndex} with an image is missing a name or short description`);
          }
        }
        const location = marker.location;
        if (
          !Array.isArray(location) ||
          location.length < 2 ||
          typeof location[0] !== "number" ||
          typeof location[1] !== "number" ||
          location[0] < -90 ||
          location[0] > 90 ||
          location[1] < -180 ||
          location[1] > 180
        ) {
          throw new Error(`Feature ${name || index} data marker ${markerIndex} has invalid location`);
        }
      }
    }

    if (feature.properties.routeAnchors !== undefined) {
      if (!Array.isArray(feature.properties.routeAnchors)) {
        throw new Error(`Feature ${name || index} has non-array routeAnchors`);
      }
      for (const [anchorIndex, anchor] of feature.properties.routeAnchors.entries()) {
        if (
          !Array.isArray(anchor) ||
          anchor.length < 2 ||
          typeof anchor[0] !== "number" ||
          typeof anchor[1] !== "number" ||
          anchor[0] < -180 ||
          anchor[0] > 180 ||
          anchor[1] < -90 ||
          anchor[1] > 90
        ) {
          throw new Error(`Feature ${name || index} route anchor ${anchorIndex} must be [lng, lat]`);
        }
      }
    }

    if (feature.geometry === null) {
      continue;
    }
    if (feature.geometry?.type !== "LineString") {
      throw new Error(`Feature ${name || index} must be LineString or null geometry`);
    }
    const coords = feature.geometry.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) {
      throw new Error(`Feature ${name || index} must have at least two coordinates`);
    }
    for (const coord of coords) {
      if (
        !Array.isArray(coord) ||
        coord.length < 2 ||
        typeof coord[0] !== "number" ||
        typeof coord[1] !== "number"
      ) {
        throw new Error(`Feature ${name || index} has invalid coordinates`);
      }
    }
  }
}

function emptyCwBaseOverlay() {
  return {
    schemaVersion: 1,
    description: "CycleWays segment mappings onto the OSM/manual base graph.",
    updatedAt: null,
    segments: {},
  };
}

function emptyManualBaseEdges() {
  return {
    type: "FeatureCollection",
    features: [],
  };
}

function normalizeCwBaseOverlay(overlay) {
  if (!overlay || typeof overlay !== "object" || Array.isArray(overlay)) {
    throw new Error("Overlay must be an object");
  }
  const segments = overlay.segments || {};
  if (!segments || typeof segments !== "object" || Array.isArray(segments)) {
    throw new Error("Overlay segments must be an object keyed by segment id");
  }

  for (const [key, mapping] of Object.entries(segments)) {
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
      throw new Error(`Overlay mapping ${key} must be an object`);
    }
    if (!Number.isInteger(mapping.segmentId)) {
      throw new Error(`Overlay mapping ${key} is missing integer segmentId`);
    }
    if (String(mapping.segmentId) !== String(key)) {
      throw new Error(`Overlay mapping key ${key} does not match segmentId ${mapping.segmentId}`);
    }
    if (!["accepted_auto_match", "accepted_edge_set", "manual_base_edge_needed", "needs_edit"].includes(mapping.status)) {
      throw new Error(`Overlay mapping ${key} has unsupported status ${mapping.status}`);
    }
    if (mapping.segmentName !== undefined && typeof mapping.segmentName !== "string") {
      throw new Error(`Overlay mapping ${key} has invalid segmentName`);
    }
    if (!Array.isArray(mapping.edgeRefs)) {
      throw new Error(`Overlay mapping ${key} edgeRefs must be an array`);
    }
    for (const [index, edgeRef] of mapping.edgeRefs.entries()) {
      if (!edgeRef || typeof edgeRef !== "object" || Array.isArray(edgeRef)) {
        throw new Error(`Overlay mapping ${key} edgeRef ${index} must be an object`);
      }
      if (typeof edgeRef.edgeId !== "string" || edgeRef.edgeId.trim() === "") {
        throw new Error(`Overlay mapping ${key} edgeRef ${index} is missing edgeId`);
      }
      for (const fractionKey of ["fromFraction", "toFraction"]) {
        const value = edgeRef[fractionKey];
        if (typeof value !== "number" || value < 0 || value > 1) {
          throw new Error(`Overlay mapping ${key} edgeRef ${index} has invalid ${fractionKey}`);
        }
      }
      if (edgeRef.sequenceIndex !== undefined && !Number.isInteger(edgeRef.sequenceIndex)) {
        throw new Error(`Overlay mapping ${key} edgeRef ${index} has invalid sequenceIndex`);
      }
      if (edgeRef.direction !== undefined && !["forward", "reverse", "unknown"].includes(edgeRef.direction)) {
        throw new Error(`Overlay mapping ${key} edgeRef ${index} has invalid direction`);
      }
    }
  }

  return {
    schemaVersion: 1,
    description:
      typeof overlay.description === "string"
        ? overlay.description
        : "CycleWays segment mappings onto the OSM/manual base graph.",
    updatedAt: new Date().toISOString(),
    segments,
  };
}

async function readCwBaseOverlay() {
  try {
    return JSON.parse(await readFile(cwBaseOverlayPath, "utf-8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return emptyCwBaseOverlay();
    }
    throw error;
  }
}

function normalizeManualBaseEdges(geojson) {
  if (!geojson || geojson.type !== "FeatureCollection" || !Array.isArray(geojson.features)) {
    throw new Error("Manual base edges must be a GeoJSON FeatureCollection");
  }

  const ids = new Set();
  for (const [index, feature] of geojson.features.entries()) {
    if (!feature || feature.type !== "Feature") {
      throw new Error(`Manual base edge ${index} is not a GeoJSON Feature`);
    }
    const geometry = feature.geometry || {};
    if (geometry.type !== "LineString" || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) {
      throw new Error(`Manual base edge ${index} must be a LineString with at least two coordinates`);
    }
    for (const coord of geometry.coordinates) {
      if (
        !Array.isArray(coord) ||
        coord.length < 2 ||
        typeof coord[0] !== "number" ||
        typeof coord[1] !== "number" ||
        coord[0] < -180 ||
        coord[0] > 180 ||
        coord[1] < -90 ||
        coord[1] > 90
      ) {
        throw new Error(`Manual base edge ${index} has invalid coordinates`);
      }
    }

    const properties = feature.properties || (feature.properties = {});
    const manualEdgeId = properties.manualEdgeId || properties.id || feature.id;
    if (typeof manualEdgeId !== "string" || manualEdgeId.trim() === "") {
      throw new Error(`Manual base edge ${index} is missing manualEdgeId`);
    }
    if (ids.has(manualEdgeId)) {
      throw new Error(`Duplicate manual base edge id ${manualEdgeId}`);
    }
    ids.add(manualEdgeId);
    properties.manualEdgeId = manualEdgeId;
    properties.id = properties.id || manualEdgeId;
    properties.source = "manual";

    if (
      properties.linkedSegmentId !== undefined &&
      properties.linkedSegmentId !== null &&
      !Number.isInteger(properties.linkedSegmentId)
    ) {
      throw new Error(`Manual base edge ${manualEdgeId} has invalid linkedSegmentId`);
    }
    if (properties.linkedSegmentName !== undefined && typeof properties.linkedSegmentName !== "string") {
      throw new Error(`Manual base edge ${manualEdgeId} has invalid linkedSegmentName`);
    }
  }

  return {
    type: "FeatureCollection",
    features: geojson.features,
  };
}

async function readManualBaseEdges() {
  try {
    return JSON.parse(await readFile(manualBaseEdgesPath, "utf-8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return emptyManualBaseEdges();
    }
    throw error;
  }
}

function validateQuality(quality, featureLabel, required) {
  if (quality === undefined || quality === null) {
    if (required) {
      throw new Error(`Feature ${featureLabel} is missing quality`);
    }
    return;
  }

  if (typeof quality !== "object" || Array.isArray(quality)) {
    throw new Error(`Feature ${featureLabel} quality must be an object`);
  }

  for (const key of Object.keys(quality)) {
    if (!qualityKeys.includes(key)) {
      throw new Error(`Feature ${featureLabel} quality has unsupported field ${key}`);
    }
  }

  for (const key of qualityKeys) {
    const value = quality[key];
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      throw new Error(`Feature ${featureLabel} quality.${key} must be an integer from 1 to 5`);
    }
  }
}

async function serveStatic(request, response, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/" || pathname === "/editor") {
    pathname = "/editor/";
  }
  if (pathname === "/editor/") {
    pathname = "/editor/index.html";
  }

  const filePath = resolve(repoRoot, `.${pathname}`);
  const allowedEditorFile = isInside(editorRoot, filePath) || filePath === resolve(editorRoot, "index.html");
  const allowedIconFile = isInside(iconsRoot, filePath);
  const allowedTokenFile = filePath === tokenPath;
  const allowedPoiTypesFile = filePath === poiTypesModulePath;
  // The Video Sync editor reuses the production interpolator directly from
  // src/, so serve that single shared module read-only.
  const allowedVideoSyncFile = filePath === videoSyncModulePath;
  // The editor loads shared core ES modules directly from source (e.g.
  // data/poiTypes.js, map/emojiMarkerImage.js), so serve the read-only
  // packages/core/src tree.
  const allowedCoreFile = isInside(coreSrcRoot, filePath);
  // POI image previews: uploads live under public-data/poi-images and seed
  // placeholders under public/images. Serve those read-only so the editor's
  // image thumbnails resolve.
  const allowedImageFile =
    isInside(poiImagesDir, filePath) || isInside(imagesDir, filePath);
  if (
    !allowedEditorFile &&
    !allowedIconFile &&
    !allowedTokenFile &&
    !allowedPoiTypesFile &&
    !allowedVideoSyncFile &&
    !allowedCoreFile &&
    !allowedImageFile
  ) {
    sendText(response, 404, "Not found");
    return;
  }

  if (allowedTokenFile) {
    await serveTokenFile(response);
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      sendText(response, 404, "Not found");
      return;
    }
    if (devReloadEnabled && filePath === resolve(editorRoot, "index.html")) {
      const html = await readFile(filePath, "utf-8");
      sendHtml(response, 200, injectDevReloadClient(html));
      return;
    }
    response.writeHead(200, {
      "Content-Type": mimeTypes.get(extname(filePath)) || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    sendText(response, 404, "Not found");
  }
}

async function serveTokenFile(response) {
  try {
    const fileStat = await stat(tokenPath);
    if (fileStat.isFile()) {
      response.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store",
      });
      createReadStream(tokenPath).pipe(response);
      return;
    }
  } catch {
    // Fall through to an environment/localStorage-friendly stub.
  }

  const token = process.env.MAPBOX_TOKEN || process.env.CYCLEWAYS_MAPBOX_TOKEN || "";
  if (token) {
    sendJavaScript(
      response,
      200,
      `window.CYCLEWAYS_MAPBOX_TOKEN = ${JSON.stringify(token)};\n`,
    );
    return;
  }

  sendJavaScript(
    response,
    200,
    [
      "window.CYCLEWAYS_MAPBOX_TOKEN = window.CYCLEWAYS_MAPBOX_TOKEN || '';",
      "console.warn('Mapbox token file not found. Copy mapbox-token.example.js to mapbox-token.js or set localStorage cycleways.mapboxToken.');",
      "",
    ].join("\n"),
  );
}

async function statOrNull(pathname) {
  try {
    return await stat(pathname);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function isStaleAgainst(targetStat, inputStat) {
  return Boolean(inputStat && (!targetStat || targetStat.mtimeMs + 1000 < inputStat.mtimeMs));
}

async function fileDigest(pathname) {
  const digest = createHash("sha256");
  const contents = await readFile(pathname);
  digest.update(contents);
  return digest.digest("hex");
}

async function elevatedGraphMatchesBaseGraph() {
  const elevatedGraph = JSON.parse(await readFile(osmElevatedBaseGraphPath, "utf-8"));
  const sourceDigest = elevatedGraph?.metadata?.elevation?.sourceGraphDigest;
  if (typeof sourceDigest !== "string") {
    return false;
  }
  return sourceDigest === await fileDigest(osmBaseGraphPath);
}

async function runBuildDependencyStep(buildId, label, command, args) {
  const startedAt = Date.now();
  log("info", `build#${buildId} ${label} started`, {
    command: `${command} ${args.join(" ")}`,
  });

  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const stdoutLogger = createLineLogger("info", `build#${buildId} ${label} stdout`, (text) => {
      stdout += text;
    });
    const stderrLogger = createLineLogger("info", `build#${buildId} ${label} stderr`, (text) => {
      stderr += text;
    });
    const heartbeat = setInterval(() => {
      log("info", `build#${buildId} ${label} still running`, {
        elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
        stdoutBytes: stdout.length,
        stderrBytes: stderr.length,
      });
    }, 10000);
    heartbeat.unref();

    child.stdout.on("data", (chunk) => {
      stdoutLogger.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrLogger.write(chunk);
    });
    child.on("error", (error) => {
      clearInterval(heartbeat);
      stdoutLogger.flush();
      stderrLogger.flush();
      log("error", `build#${buildId} ${label} failed to start`, error.message);
      rejectPromise(error);
    });
    child.on("close", (code) => {
      clearInterval(heartbeat);
      stdoutLogger.flush();
      stderrLogger.flush();
      const durationSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (code !== 0) {
        log("error", `build#${buildId} ${label} failed`, {
          exitCode: code,
          durationSeconds,
        });
        rejectPromise(new Error(stderr || stdout || `${label} failed with exit code ${code}`));
        return;
      }
      log("info", `build#${buildId} ${label} finished`, {
        durationSeconds,
      });
      resolvePromise({ stdout, stderr, durationSeconds });
    });
  });
}

async function ensureCurrentBaseRoutingArtifacts(buildId, payload) {
  const graphInputs = [
    ["raw OSM ways", osmRawWaysPath],
    ["OSM intersections", osmIntersectionsPath],
    ["manual base edges", manualBaseEdgesPath],
  ];
  const inputStats = await Promise.all(
    graphInputs.map(async ([label, pathname]) => ({
      label,
      pathname,
      stat: await statOrNull(pathname),
    })),
  );
  let graphStat = await statOrNull(osmBaseGraphPath);
  const staleGraphInputs = inputStats.filter((input) => isStaleAgainst(graphStat, input.stat));
  if (!graphStat || staleGraphInputs.length > 0) {
    log("info", `build#${buildId} refreshing base graph before Build`, {
      reason: !graphStat
        ? "missing base graph"
        : `stale relative to ${staleGraphInputs.map((input) => input.label).join(", ")}`,
    });
    await runBuildDependencyStep(buildId, "base graph refresh", "npm", ["run", "osm:graph"]);
    graphStat = await statOrNull(osmBaseGraphPath);
  }
  if (!graphStat) {
    throw new Error("Base graph refresh did not produce build/osm/osm-base-graph.json.");
  }

  let elevatedStat = await statOrNull(osmElevatedBaseGraphPath);
  let elevatedDigestMatches = false;
  if (elevatedStat && !isStaleAgainst(elevatedStat, graphStat)) {
    elevatedDigestMatches = await elevatedGraphMatchesBaseGraph().catch(() => false);
  }
  if (!elevatedStat || isStaleAgainst(elevatedStat, graphStat) || !elevatedDigestMatches) {
    const elevationArgs = ["processing/build_osm_base_graph_elevation.py"];
    if (payload.elevationUrl) {
      elevationArgs.push("--elevation-url", String(payload.elevationUrl));
    }
    log("info", `build#${buildId} refreshing elevated base graph before Build`, {
      reason: !elevatedStat
        ? "missing elevated base graph"
        : isStaleAgainst(elevatedStat, graphStat)
          ? "stale relative to base graph"
          : "source digest does not match base graph",
    });
    try {
      await runBuildDependencyStep(buildId, "base graph elevation refresh", "python3", elevationArgs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Base graph elevation refresh failed before Build. Make sure the local elevation service is running, then try Build again.\n\n${message}`,
      );
    }
    elevatedStat = await statOrNull(osmElevatedBaseGraphPath);
  }
  if (!elevatedStat) {
    throw new Error("Base graph elevation refresh did not produce build/osm/osm-base-graph-elevated.json.");
  }
}

async function handleBuild(payload) {
  payload = payload || {};
  const buildId = ++buildCounter;
  const startedAt = Date.now();
  const args = [
    "processing/build_map.py",
    "--input-geojson",
    "data/map-source.geojson",
    "--out-dir",
    "build",
    "--verbose",
  ];

  if (payload.elevationUrl) {
    args.push("--elevation-url", String(payload.elevationUrl));
  }

  log("info", `build#${buildId} started`, {
    mode: "full-elevation",
    command: `python3 ${args.join(" ")}`,
  });

  await ensureCurrentBaseRoutingArtifacts(buildId, payload);

  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("python3", args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const stdoutLogger = createLineLogger("info", `build#${buildId} stdout`, (text) => {
      stdout += text;
    });
    const stderrLogger = createLineLogger("info", `build#${buildId} stderr`, (text) => {
      stderr += text;
    });
    const heartbeat = setInterval(() => {
      log("info", `build#${buildId} still running`, {
        elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
        stdoutBytes: stdout.length,
        stderrBytes: stderr.length,
      });
    }, 10000);
    heartbeat.unref();

    child.stdout.on("data", (chunk) => {
      stdoutLogger.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrLogger.write(chunk);
    });
    child.on("error", (error) => {
      clearInterval(heartbeat);
      stdoutLogger.flush();
      stderrLogger.flush();
      log("error", `build#${buildId} failed to start`, error.message);
      rejectPromise(error);
    });
    child.on("close", (code) => {
      clearInterval(heartbeat);
      stdoutLogger.flush();
      stderrLogger.flush();
      const durationSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (code !== 0) {
        log("error", `build#${buildId} failed`, {
          exitCode: code,
          durationSeconds,
        });
        rejectPromise(new Error(stderr || stdout || `Build failed with exit code ${code}`));
        return;
      }
      log("info", `build#${buildId} finished`, {
        durationSeconds,
      });
      resolvePromise({ buildId, stdout, stderr, durationSeconds });
    });
  });
}

async function handleOsmGraphRecalculate() {
  const graphId = ++osmGraphCounter;
  const startedAt = Date.now();
  const args = ["run", "osm:graph"];

  log("info", `osm-graph#${graphId} started`, {
    command: `npm ${args.join(" ")}`,
  });

  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("npm", args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const stdoutLogger = createLineLogger("info", `osm-graph#${graphId} stdout`, (text) => {
      stdout += text;
    });
    const stderrLogger = createLineLogger("info", `osm-graph#${graphId} stderr`, (text) => {
      stderr += text;
    });
    const heartbeat = setInterval(() => {
      log("info", `osm-graph#${graphId} still running`, {
        elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
        stdoutBytes: stdout.length,
        stderrBytes: stderr.length,
      });
    }, 10000);
    heartbeat.unref();

    child.stdout.on("data", (chunk) => {
      stdoutLogger.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrLogger.write(chunk);
    });
    child.on("error", (error) => {
      clearInterval(heartbeat);
      stdoutLogger.flush();
      stderrLogger.flush();
      log("error", `osm-graph#${graphId} failed to start`, error.message);
      rejectPromise(error);
    });
    child.on("close", (code) => {
      clearInterval(heartbeat);
      stdoutLogger.flush();
      stderrLogger.flush();
      const durationSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (code !== 0) {
        log("error", `osm-graph#${graphId} failed`, {
          exitCode: code,
          durationSeconds,
        });
        rejectPromise(new Error(stderr || stdout || `OSM graph recalculation failed with exit code ${code}`));
        return;
      }
      log("info", `osm-graph#${graphId} finished`, {
        durationSeconds,
      });
      resolvePromise({ graphId, stdout, stderr, durationSeconds });
    });
  });
}

async function handleOsmSegmentRecalculate(payload) {
  const graphId = ++osmGraphCounter;
  const startedAt = Date.now();
  const feature = payload?.feature;
  validateSourceGeojson({ type: "FeatureCollection", features: [feature] });
  const segmentId = feature.properties.id;
  const tmpPrefix = resolve(osmBuildDir, `.selected-segment-${segmentId}-${Date.now()}-${graphId}`);
  const segmentPath = `${tmpPrefix}.geojson`;
  const outPath = `${tmpPrefix}.json`;
  const args = [
    "processing/match_cycleways_to_osm_graph.py",
    "--graph-edges",
    "build/osm/osm-base-edges.geojson",
    "--single-segment-geojson",
    repoRelative(segmentPath),
    "--single-out-json",
    repoRelative(outPath),
  ];

  await mkdir(osmBuildDir, { recursive: true });
  await writeJsonAtomic(segmentPath, feature);

  log("info", `osm-segment#${graphId} started`, {
    segmentId,
    command: `python3 ${args.join(" ")}`,
  });

  try {
    const result = await new Promise((resolvePromise, rejectPromise) => {
      const child = spawn("python3", args, {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      const stdoutLogger = createLineLogger("info", `osm-segment#${graphId} stdout`, (text) => {
        stdout += text;
      });
      const stderrLogger = createLineLogger("info", `osm-segment#${graphId} stderr`, (text) => {
        stderr += text;
      });
      const heartbeat = setInterval(() => {
        log("info", `osm-segment#${graphId} still running`, {
          segmentId,
          elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
          stdoutBytes: stdout.length,
          stderrBytes: stderr.length,
        });
      }, 10000);
      heartbeat.unref();

      child.stdout.on("data", (chunk) => {
        stdoutLogger.write(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderrLogger.write(chunk);
      });
      child.on("error", (error) => {
        clearInterval(heartbeat);
        stdoutLogger.flush();
        stderrLogger.flush();
        log("error", `osm-segment#${graphId} failed to start`, error.message);
        rejectPromise(error);
      });
      child.on("close", (code) => {
        clearInterval(heartbeat);
        stdoutLogger.flush();
        stderrLogger.flush();
        const durationSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
        if (code !== 0) {
          log("error", `osm-segment#${graphId} failed`, {
            segmentId,
            exitCode: code,
            durationSeconds,
          });
          rejectPromise(new Error(stderr || stdout || `Segment recalculation failed with exit code ${code}`));
          return;
        }
        log("info", `osm-segment#${graphId} finished`, {
          segmentId,
          durationSeconds,
        });
        resolvePromise({ graphId, segmentId, stdout, stderr, durationSeconds });
      });
    });
    const match = JSON.parse(await readFile(outPath, "utf-8"));
    return { ...result, match };
  } finally {
    await unlink(segmentPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

function recomputeMatchSummaryTotals(summary) {
  const segments = Array.isArray(summary.segments) ? summary.segments : [];
  const confidenceCounts = {};
  let totalDistanceM = 0;
  let matchedDistanceM = 0;
  let gapCount = 0;

  for (const segment of segments) {
    const confidence = segment.confidence || "none";
    confidenceCounts[confidence] = (confidenceCounts[confidence] || 0) + 1;
    const distanceMeters = Number(segment.distanceMeters) || 0;
    const coverageRatio = Number(segment.coverageRatio) || 0;
    totalDistanceM += distanceMeters;
    matchedDistanceM += distanceMeters * coverageRatio;
    gapCount += Number(segment.gapCount) || 0;
  }

  return {
    ...summary,
    sourceSegments: segments.length,
    coverageRatio: totalDistanceM ? Number((matchedDistanceM / totalDistanceM).toFixed(4)) : 0,
    totalKm: Number((totalDistanceM / 1000).toFixed(1)),
    matchedKm: Number((matchedDistanceM / 1000).toFixed(1)),
    unmatchedKm: Number(((totalDistanceM - matchedDistanceM) / 1000).toFixed(1)),
    confidenceCounts,
    gapCount,
  };
}

async function persistOsmSegmentMatch(payload) {
  const segmentId = Number(payload?.segmentId);
  const summary = payload?.summary;
  const preview = payload?.preview || { type: "FeatureCollection", features: [] };
  if (!Number.isInteger(segmentId)) {
    throw new Error("segmentId is required");
  }
  if (!summary || Number(summary.segmentId) !== segmentId) {
    throw new Error("summary.segmentId must match segmentId");
  }
  if (!preview || preview.type !== "FeatureCollection" || !Array.isArray(preview.features)) {
    throw new Error("preview must be a GeoJSON FeatureCollection");
  }

  await mkdir(osmBuildDir, { recursive: true });
  const existingSummary = JSON.parse(await readFile(osmMatchSummaryPath, "utf-8"));
  const nextSegments = [
    ...(existingSummary.segments || []).filter((segment) => Number(segment.segmentId) !== segmentId),
    summary,
  ].sort((a, b) => Number(a.segmentId ?? 0) - Number(b.segmentId ?? 0));
  const nextSummary = recomputeMatchSummaryTotals({
    ...existingSummary,
    generatedAt: new Date().toISOString(),
    segments: nextSegments,
  });

  let existingPreview = { type: "FeatureCollection", features: [] };
  try {
    existingPreview = JSON.parse(await readFile(osmMatchPreviewPath, "utf-8"));
  } catch {
    existingPreview = { type: "FeatureCollection", features: [] };
  }
  const nextPreview = {
    type: "FeatureCollection",
    features: [
      ...(existingPreview.features || []).filter(
        (feature) => Number(feature.properties?.segmentId) !== segmentId,
      ),
      ...preview.features,
    ],
  };

  let existingMatches = { generatedAt: nextSummary.generatedAt, segments: [] };
  try {
    existingMatches = JSON.parse(await readFile(osmMatchesPath, "utf-8"));
  } catch {
    existingMatches = { generatedAt: nextSummary.generatedAt, segments: [] };
  }
  const nextMatches = {
    ...existingMatches,
    generatedAt: nextSummary.generatedAt,
    segments: [
      ...(existingMatches.segments || []).filter((segment) => Number(segment.segmentId) !== segmentId),
      summary,
    ].sort((a, b) => Number(a.segmentId ?? 0) - Number(b.segmentId ?? 0)),
  };

  await writeJsonAtomic(osmMatchSummaryPath, nextSummary);
  await writeJsonAtomic(osmMatchPreviewPath, nextPreview);
  await writeJsonAtomic(osmMatchesPath, nextMatches);

  return {
    summary: nextSummary,
    preview: nextPreview,
    matches: nextMatches,
  };
}

function validationBlockers(report) {
  const validation = report?.validation || {};
  const elevation = report?.elevation || {};
  const blockers = [];

  if (!elevation.skipElevation && (elevation.failures || 0) > 0) {
    blockers.push(`${elevation.failures} elevation lookup failures`);
  }

  if ((validation.duplicateFeatureNames || []).length > 0) {
    blockers.push("duplicate feature names");
  }
  if (Object.keys(validation.duplicateIds || {}).length > 0) {
    blockers.push("duplicate segment IDs");
  }
  if ((validation.invalidDataMarkers || []).length > 0) {
    blockers.push("invalid data markers");
  }
  if ((validation.invalidQuality || []).length > 0) {
    blockers.push("invalid quality records");
  }
  if ((validation.activeMissingMiddle || []).length > 0) {
    blockers.push("active segments missing middle points");
  }
  if ((validation.placeholderSegmentNames || []).length > 0) {
    blockers.push("active segments with placeholder names");
  }
  if ((validation.activeSplitNumberedNames || []).length > 0) {
    blockers.push("active split children with numbered names");
  }
  if ((validation.routeCompatibilityWarnings || []).length > 0) {
    blockers.push(`${validation.routeCompatibilityWarnings.length} route compatibility warnings`);
  }
  const baseRouting = validation.baseRouting || {};
  if ((baseRouting.blockers || []).length > 0) {
    blockers.push(`${baseRouting.blockers.length} base routing blockers`);
  }
  if ((baseRouting.warnings || []).length > 0) {
    blockers.push(`${baseRouting.warnings.length} base routing warnings`);
  }
  if ((baseRouting.unresolvedSegments || 0) > 0) {
    blockers.push(`${baseRouting.unresolvedSegments} unresolved base routing segments`);
  }
  const displayFallbacks = validation.cyclewaysDisplayGeometry?.sourceFallbackSegments || 0;
  if (displayFallbacks > 0) {
    blockers.push(`${displayFallbacks} public CycleWays display geometry fallbacks`);
  }

  return blockers;
}

async function copyFileAtomic(source, target) {
  await mkdir(dirname(target), { recursive: true });
  const tmpPath = uniqueAtomicTmpPath(target);
  try {
    await copyFile(source, tmpPath);
    await rename(tmpPath, target);
  } catch (error) {
    await unlink(tmpPath).catch(() => {});
    throw error;
  }
}

async function copyDirectoryAtomic(source, target) {
  await mkdir(dirname(target), { recursive: true });
  const tmpPath = uniqueAtomicTmpPath(target);
  try {
    await rm(tmpPath, { recursive: true, force: true });
    await cp(source, tmpPath, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
    await rename(tmpPath, target);
  } catch (error) {
    await rm(tmpPath, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function uniqueAtomicTmpPath(target) {
  atomicWriteCounter += 1;
  return `${target}.${process.pid}.${Date.now()}.${atomicWriteCounter}.tmp`;
}

async function writeJsonAtomic(target, value) {
  await mkdir(dirname(target), { recursive: true });
  const tmpPath = uniqueAtomicTmpPath(target);
  try {
    await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
    await rename(tmpPath, target);
  } catch (error) {
    await unlink(tmpPath).catch(() => {});
    throw error;
  }
}

async function writeJsonAtomicIfChanged(target, value) {
  const nextContent = `${JSON.stringify(value, null, 2)}\n`;
  let currentContent = null;
  try {
    currentContent = await readFile(target, "utf-8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (currentContent === nextContent) {
    return false;
  }

  await mkdir(dirname(target), { recursive: true });
  const tmpPath = uniqueAtomicTmpPath(target);
  try {
    await writeFile(tmpPath, nextContent, "utf-8");
    await rename(tmpPath, target);
    return true;
  } catch (error) {
    await unlink(tmpPath).catch(() => {});
    throw error;
  }
}

async function existingVersionedFiles(directory, pattern) {
  try {
    const names = await readdir(directory);
    return names
      .filter((name) => pattern.test(name))
      .map((name) => resolve(directory, name));
  } catch {
    return [];
  }
}

async function cleanupOldPublicArtifacts(promoteId, dryRun) {
  const candidates = [
    ...(await existingVersionedFiles(repoRoot, /^bike_roads\.[0-9a-f]{12}\.geojson$/)),
    ...(await existingVersionedFiles(repoRoot, /^segments\.[0-9a-f]{12}\.json$/)),
    ...(await existingVersionedFiles(repoRoot, /^base-routing-network\.[0-9a-f]{12}\.json$/)),
    ...(await existingVersionedFiles(repoRoot, /^base-routing-shards\.[0-9a-f]{12}$/)),
    ...(await existingVersionedFiles(repoRoot, /^base-routing-shards$/)),
    ...(await existingVersionedFiles(repoRoot, /^bike_roads_v18\.geojson$/)),
    ...(await existingVersionedFiles(repoRoot, /^segments\.json$/)),
    ...(await existingVersionedFiles(repoRoot, /^base-routing-network\.json$/)),
    ...(await existingVersionedFiles(repoRoot, /^map-manifest\.json$/)),
    ...(await existingVersionedFiles(resolve(repoRoot, "exports"), /^map\.[0-9a-f]{12}\.kml$/)),
    ...(await existingVersionedFiles(resolve(repoRoot, "exports"), /^map\.kml$/)),
    ...(await existingVersionedFiles(publicDataDir, /^bike_roads\.[0-9a-f]{12}\.geojson$/)),
    ...(await existingVersionedFiles(publicDataDir, /^segments\.[0-9a-f]{12}\.json$/)),
    ...(await existingVersionedFiles(publicDataDir, /^base-routing-network\.[0-9a-f]{12}\.json$/)),
    ...(await existingVersionedFiles(publicDataDir, /^base-routing-network\.json$/)),
    ...(await existingVersionedFiles(resolve(publicDataDir, "exports"), /^map\.[0-9a-f]{12}\.kml$/)),
  ];

  for (const filePath of candidates) {
    log("info", `promote#${promoteId} removing old public artifact`, {
      path: repoRelative(filePath),
      dryRun,
    });
    if (!dryRun) {
      await rm(filePath, { recursive: true, force: true });
    }
  }

  return candidates;
}

export function buildPromoteTargets(manifest) {
  return [
    {
      label: "public manifest",
      source: buildManifestPath,
      target: promotedManifestPath,
    },
    {
      label: "public geojson",
      source: resolveManifestPath(buildPublicDataDir, manifest.bikeRoads),
      target: resolveManifestPath(publicDataDir, manifest.bikeRoads),
    },
    {
      label: "public segments",
      source: resolveManifestPath(buildPublicDataDir, manifest.segments),
      target: resolveManifestPath(publicDataDir, manifest.segments),
    },
    {
      label: "public CW base index",
      source: resolveManifestPath(buildPublicDataDir, manifest.cwBaseIndex),
      target: resolveManifestPath(publicDataDir, manifest.cwBaseIndex),
    },
    {
      label: "public kml",
      source: resolveManifestPath(buildPublicDataDir, manifest.kml),
      target: resolveManifestPath(publicDataDir, manifest.kml),
    },
    {
      kind: "directory",
      label: "base routing shards",
      source: dirname(resolveManifestPath(buildPublicDataDir, manifest.baseRoutingShards)),
      target: dirname(resolveManifestPath(publicDataDir, manifest.baseRoutingShards)),
    },
  ];
}

async function handlePromote(payload = {}) {
  const promoteId = ++promoteCounter;
  log("info", `promote#${promoteId} started`, {
    dryRun: Boolean(payload.dryRun),
    allowSkippedElevation: Boolean(payload.allowSkippedElevation),
  });

  const report = JSON.parse(await readFile(reportPath, "utf-8"));
  const manifest = JSON.parse(await readFile(buildManifestPath, "utf-8"));
  const sourceStat = await stat(sourcePath);
  const reportStat = await stat(reportPath);

  if (reportStat.mtimeMs + 1000 < sourceStat.mtimeMs) {
    throw new Error("Build is stale. Run Build after saving the source, then promote.");
  }

  for (const routingInput of [
    osmBaseGraphPath,
    osmElevatedBaseGraphPath,
    cwBaseOverlayPath,
    manualBaseEdgesPath,
  ]) {
    const routingInputStat = await stat(routingInput);
    if (reportStat.mtimeMs + 1000 < routingInputStat.mtimeMs) {
      throw new Error(
        `Build is stale. ${repoRelative(routingInput)} changed after Build. Rebuild before promoting.`,
      );
    }
  }

  if (report.elevation?.skipElevation && !payload.allowSkippedElevation) {
    throw new Error("Promote requires a full build. Uncheck skip elevation, run Build, then promote.");
  }

  if (!report.elevation?.skipElevation && (report.elevation?.failures || 0) > 0) {
    throw new Error(
      `Promote blocked by ${report.elevation.failures} elevation lookup failures. Run a successful full build first.`,
    );
  }

  const blockers = validationBlockers(report);
  if (blockers.length > 0) {
    throw new Error(`Promote blocked by validation: ${blockers.join(", ")}`);
  }

  const sourceForImages = JSON.parse(await readFile(sourcePath, "utf-8"));
  const missingImages = await findMissingSourceImages(sourceForImages, repoRoot);
  if (missingImages.length > 0) {
    throw new Error(
      `Promote blocked: ${missingImages.length} POI image file(s) are referenced but missing: ${missingImages.join(", ")}`,
    );
  }
  if (!manifest.baseRoutingShards) {
    throw new Error("Promote requires a base routing shard manifest in the build manifest.");
  }
  if (!manifest.cwBaseIndex) {
    throw new Error("Promote requires a CW base index in the build manifest.");
  }

  log("info", `promote#${promoteId} checks passed`, {
    version: manifest.version,
    warnings: (report.validation?.routeCompatibilityWarnings || []).length,
  });

  const targets = buildPromoteTargets(manifest);

  for (const target of targets) {
    await stat(target.source);
  }

  log("info", `promote#${promoteId} artifacts verified`, {
    targets: targets.map((target) => ({
      label: target.label,
      source: repoRelative(target.source),
      target: repoRelative(target.target),
    })),
  });

  let removed = [];
  if (!payload.dryRun) {
    for (const target of targets) {
      log("info", `promote#${promoteId} copying ${target.label}`, {
        source: repoRelative(target.source),
        target: repoRelative(target.target),
      });
      if (target.kind === "directory") {
        await copyDirectoryAtomic(target.source, target.target);
      } else {
        await copyFileAtomic(target.source, target.target);
      }
    }
    // Promoted assets changed on disk; drop the long-lived decode caches so
    // featured-route decoding (keyframe polyline, catalog, Phase 2 snapshots)
    // reads the freshly promoted data instead of stale cached copies.
    invalidateFeaturedAssetCache();
  }
  removed = await cleanupOldPublicArtifacts(promoteId, Boolean(payload.dryRun));

  // Promoting map data changes the geometry/POIs featured snapshots are built
  // from, so regenerate them here too (the route-catalog promote does the same).
  // Without this, featured pages would render stale snapshots after a map promote.
  let snapshots = null;
  if (!payload.dryRun) {
    try {
      snapshots = await buildFeaturedRouteSnapshots({ log });
    } catch (err) {
      log("error", `promote#${promoteId} featured snapshot rebuild failed`, {
        message: err?.message,
      });
      snapshots = { written: [], removed: [], errors: [{ slug: null, message: err?.message || String(err) }] };
    }
  }

  log("info", `promote#${promoteId} finished`, {
    dryRun: Boolean(payload.dryRun),
    version: manifest.version,
    removed: removed.length,
  });

  return {
    dryRun: Boolean(payload.dryRun),
    version: manifest.version,
    manifest: promotedManifestPath,
    promoted: targets.map((target) => ({
      label: target.label,
      source: target.source,
      target: target.target,
    })),
    removed: removed.map((filePath) => repoRelative(filePath)),
    warnings: report.validation?.routeCompatibilityWarnings || [],
    snapshots,
  };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const requestId = ++requestCounter;
  const startedAt = Date.now();

  try {
    if (request.method === "GET" && url.pathname === "/api/dev/events" && devReloadEnabled) {
      handleDevReloadEvents(request, response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/source") {
      logApi(requestId, "GET /api/source started");
      const source = JSON.parse(await readFile(sourcePath, "utf-8"));
      backfillDeprecatedRouteAnchors(source);
      logApi(requestId, "GET /api/source loaded", summarizeSource(source));
      sendJson(response, 200, source);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/osm/recalculate") {
      logApi(requestId, "POST /api/osm/recalculate started");
      const result = await handleOsmGraphRecalculate();
      let graphSummary = null;
      let matchSummary = null;
      try {
        graphSummary = JSON.parse(await readFile(resolve(osmBuildDir, "osm-base-graph-summary.json"), "utf-8"));
      } catch {
        graphSummary = null;
      }
      try {
        matchSummary = JSON.parse(await readFile(osmMatchSummaryPath, "utf-8"));
      } catch {
        matchSummary = null;
      }
      logApi(requestId, "POST /api/osm/recalculate finished", {
        durationMs: Date.now() - startedAt,
        graphId: result.graphId,
        graphEdges: graphSummary?.edges,
        sourceSegments: matchSummary?.sourceSegments,
      });
      sendJson(response, 200, { ok: true, ...result, graphSummary, matchSummary });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/osm/recalculate-segment") {
      logApi(requestId, "POST /api/osm/recalculate-segment started");
      const payload = await readRequestJson(request);
      let result;
      try {
        result = await handleOsmSegmentRecalculate(payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("warn", `api#${requestId} POST /api/osm/recalculate-segment failed`, message);
        sendJson(response, 400, { ok: false, error: message });
        return;
      }
      logApi(requestId, "POST /api/osm/recalculate-segment finished", {
        durationMs: Date.now() - startedAt,
        segmentId: result.segmentId,
        coverageRatio: result.match?.summary?.coverageRatio,
        confidence: result.match?.summary?.confidence,
      });
      sendJson(response, 200, { ok: true, ...result });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/osm/persist-segment-match") {
      logApi(requestId, "POST /api/osm/persist-segment-match started");
      const payload = await readRequestJson(request);
      let result;
      try {
        result = await persistOsmSegmentMatch(payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("warn", `api#${requestId} POST /api/osm/persist-segment-match failed`, message);
        sendJson(response, 400, { ok: false, error: message });
        return;
      }
      logApi(requestId, "POST /api/osm/persist-segment-match saved", {
        durationMs: Date.now() - startedAt,
        segmentId: payload.segmentId,
      });
      sendJson(response, 200, { ok: true, ...result });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/osm/graph-edges") {
      logApi(requestId, "GET /api/osm/graph-edges started");
      const graphEdges = JSON.parse(await readFile(osmGraphEdgesPath, "utf-8"));
      const [graphStat, manualStat] = await Promise.all([
        stat(osmGraphEdgesPath),
        stat(manualBaseEdgesPath).catch(() => null),
      ]);
      graphEdges.metadata = {
        ...(graphEdges.metadata || {}),
        graphEdgesModifiedAt: graphStat.mtime.toISOString(),
        manualBaseEdgesModifiedAt: manualStat?.mtime?.toISOString() || null,
        graphStaleBecauseManualBaseEdgesChanged: Boolean(manualStat && manualStat.mtimeMs > graphStat.mtimeMs),
      };
      logApi(requestId, "GET /api/osm/graph-edges loaded", {
        features: graphEdges.features?.length || 0,
        stale: graphEdges.metadata.graphStaleBecauseManualBaseEdgesChanged,
      });
      sendJson(response, 200, graphEdges);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/osm/match-summary") {
      logApi(requestId, "GET /api/osm/match-summary started");
      const summary = JSON.parse(await readFile(osmMatchSummaryPath, "utf-8"));
      logApi(requestId, "GET /api/osm/match-summary loaded", {
        sourceSegments: summary.sourceSegments,
        coverageRatio: summary.coverageRatio,
        gapCount: summary.gapCount,
      });
      sendJson(response, 200, summary);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/osm/match-preview") {
      logApi(requestId, "GET /api/osm/match-preview started");
      const preview = JSON.parse(await readFile(osmMatchPreviewPath, "utf-8"));
      logApi(requestId, "GET /api/osm/match-preview loaded", {
        features: preview.features?.length || 0,
      });
      sendJson(response, 200, preview);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/cw-base-overlay") {
      logApi(requestId, "GET /api/cw-base-overlay started");
      const overlay = await readCwBaseOverlay();
      logApi(requestId, "GET /api/cw-base-overlay loaded", {
        mappings: Object.keys(overlay.segments || {}).length,
      });
      sendJson(response, 200, overlay);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/manual-base-edges") {
      logApi(requestId, "GET /api/manual-base-edges started");
      const manualBaseEdges = await readManualBaseEdges();
      logApi(requestId, "GET /api/manual-base-edges loaded", {
        features: manualBaseEdges.features?.length || 0,
      });
      sendJson(response, 200, manualBaseEdges);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/cw-base-overlay") {
      logApi(requestId, "POST /api/cw-base-overlay started");
      let overlay;
      try {
        overlay = normalizeCwBaseOverlay(await readRequestJson(request));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("warn", `api#${requestId} POST /api/cw-base-overlay validation failed`, message);
        sendJson(response, 400, { ok: false, error: message });
        return;
      }
      await writeJsonAtomic(cwBaseOverlayPath, overlay);
      logApi(requestId, "POST /api/cw-base-overlay saved", {
        path: repoRelative(cwBaseOverlayPath),
        mappings: Object.keys(overlay.segments || {}).length,
      });
      sendJson(response, 200, { ok: true, path: cwBaseOverlayPath, overlay });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/manual-base-edges") {
      logApi(requestId, "POST /api/manual-base-edges started");
      let manualBaseEdges;
      try {
        manualBaseEdges = normalizeManualBaseEdges(await readRequestJson(request));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("warn", `api#${requestId} POST /api/manual-base-edges validation failed`, message);
        sendJson(response, 400, { ok: false, error: message });
        return;
      }
      await writeJsonAtomic(manualBaseEdgesPath, manualBaseEdges);
      logApi(requestId, "POST /api/manual-base-edges saved", {
        path: repoRelative(manualBaseEdgesPath),
        features: manualBaseEdges.features?.length || 0,
      });
      sendJson(response, 200, { ok: true, path: manualBaseEdgesPath, manualBaseEdges });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/source") {
      logApi(requestId, "POST /api/source started");
      const source = await readRequestJson(request);
      backfillDeprecatedRouteAnchors(source);
      try {
        validateSourceGeojson(source);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("warn", `api#${requestId} POST /api/source validation failed`, message);
        sendJson(response, 400, { ok: false, error: message });
        return;
      }
      logApi(requestId, "POST /api/source validated", summarizeSource(source));
      const changed = await writeJsonAtomicIfChanged(sourcePath, source);
      logApi(requestId, "POST /api/source saved", {
        path: repoRelative(sourcePath),
        changed,
        durationMs: Date.now() - startedAt,
      });
      sendJson(response, 200, { ok: true, path: sourcePath, changed });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/poi-image") {
      logApi(requestId, "POST /api/poi-image started");
      // Phone photos can be several MB; allow extra headroom for base64 inflation.
      const payload = await readRequestJson(request, 40 * 1024 * 1024);
      const rawData = typeof payload.data === "string" ? payload.data : "";
      const base64 = rawData.replace(/^data:[^;]+;base64,/, "");
      if (!base64) {
        sendJson(response, 400, { ok: false, error: "missing image data" });
        return;
      }
      let result;
      try {
        const buffer = Buffer.from(base64, "base64");
        result = await processPoiImage({ id: payload.id, buffer });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("warn", `api#${requestId} POST /api/poi-image failed`, message);
        sendJson(response, 400, { ok: false, error: message });
        return;
      }
      logApi(requestId, "POST /api/poi-image stored", {
        photo: result.photo,
        thumbnail: result.thumbnail,
        bytes: result.bytes,
        durationMs: Date.now() - startedAt,
      });
      sendJson(response, 200, { ok: true, ...result });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/build") {
      logApi(requestId, "POST /api/build started");
      const payload = await readRequestJson(request);
      const result = await handleBuild(payload);
      let report = null;
      try {
        report = JSON.parse(await readFile(reportPath, "utf-8"));
      } catch {
        report = null;
      }
      if (report) {
        logApi(requestId, "POST /api/build report", summarizeReport(report));
      }
      logApi(requestId, "POST /api/build finished", {
        durationMs: Date.now() - startedAt,
        buildId: result.buildId,
      });
      sendJson(response, 200, { ok: true, ...result, report });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/promote") {
      logApi(requestId, "POST /api/promote started");
      const payload = await readRequestJson(request);
      const result = await handlePromote(payload);
      logApi(requestId, "POST /api/promote finished", {
        durationMs: Date.now() - startedAt,
        version: result.version,
        dryRun: result.dryRun,
      });
      sendJson(response, 200, { ok: true, ...result });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/report") {
      logApi(requestId, "GET /api/report started");
      const report = JSON.parse(await readFile(reportPath, "utf-8"));
      logApi(requestId, "GET /api/report loaded", summarizeReport(report));
      sendJson(response, 200, report);
      return;
    }

    if (url.pathname.startsWith("/api/video-keyframes/")) {
      const parts = url.pathname.split("/").filter(Boolean);
      // /api/video-keyframes/<slug>/draft  (PUT save / GET fetch)
      if (parts.length === 4 && parts[3] === "draft") {
        const slug = parts[2];
        if (request.method === "PUT") {
          const payload = await readRequestJson(request);
          await mkdir(videoKeyframesDraftDir, { recursive: true });
          const draftPath = resolve(videoKeyframesDraftDir, `${slug}.json`);
          await writeFile(draftPath, JSON.stringify(payload, null, 2));
          sendJson(response, 200, { ok: true, path: repoRelative(draftPath) });
          return;
        }
        if (request.method === "GET") {
          const draftPath = resolve(videoKeyframesDraftDir, `${slug}.json`);
          try {
            const raw = await readFile(draftPath, "utf-8");
            sendJson(response, 200, JSON.parse(raw));
            return;
          } catch {}
          // Fall back to the promoted file so the editor can resume after a
          // promote (which removes the draft by design).
          const promotedPath = resolve(videoKeyframesPublicDir, `${slug}.json`);
          try {
            const raw = await readFile(promotedPath, "utf-8");
            sendJson(response, 200, JSON.parse(raw));
          } catch {
            sendJson(response, 404, { ok: false });
          }
          return;
        }
      }
      // /api/video-keyframes/<slug>/promote  (POST)
      if (parts.length === 4 && parts[3] === "promote" && request.method === "POST") {
        const slug = parts[2];
        try {
          const routePolyline = await routePolylineForSlug(slug);
          const result = await promoteKeyframesDraft({
            slug,
            draftsDir: videoKeyframesDraftDir,
            publicDir: videoKeyframesPublicDir,
            routePolyline,
          });
          sendJson(response, 200, result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sendJson(response, 400, { ok: false, error: message });
        }
        return;
      }
      // /api/video-keyframes/<slug>/route-polyline  (GET)
      if (parts.length === 4 && parts[3] === "route-polyline" && request.method === "GET") {
        const slug = parts[2];
        try {
          const polyline = await routePolylineForSlug(slug);
          sendJson(response, 200, polyline);
        } catch (err) {
          sendJson(response, 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }
    }

    if (url.pathname.startsWith("/api/route-catalog/")) {
      const parts = url.pathname.split("/").filter(Boolean);
      // /api/route-catalog/draft  (GET load with fallbacks, PUT save)
      if (parts.length === 3 && parts[2] === "draft") {
        if (request.method === "GET") {
          const draft = await readJsonOrNull(routeCatalogDraftPath);
          if (draft) {
            sendJson(response, 200, draft);
            return;
          }
          const promoted = await readJsonOrNull(routeCatalogPublicPath);
          if (promoted) {
            sendJson(response, 200, promoted);
            return;
          }
          const seed = await seedCatalogFromFeaturedMeta();
          sendJson(response, 200, seed);
          return;
        }
        if (request.method === "PUT") {
          const body = await readRequestJson(request);
          try {
            validateCatalogDraft(body);
          } catch (err) {
            sendJson(response, 400, { ok: false, error: err.message });
            return;
          }
          await mkdir(dirname(routeCatalogDraftPath), { recursive: true });
          await writeFile(routeCatalogDraftPath, JSON.stringify(body, null, 2));
          sendJson(response, 200, { ok: true });
          return;
        }
      }
      // /api/route-catalog/places  (GET)
      if (parts.length === 3 && parts[2] === "places" && request.method === "GET") {
        const places = await readJsonOrNull(placesPath);
        sendJson(response, 200, places || { version: 1, places: [] });
        return;
      }
      // /api/route-catalog/recompute  (POST)
      if (parts.length === 3 && parts[2] === "recompute" && request.method === "POST") {
        const body = await readRequestJson(request);
        try {
          validateCatalogDraft(body);
        } catch (err) {
          sendJson(response, 400, { ok: false, error: err.message });
          return;
        }
        const places = (await readJsonOrNull(placesPath))?.places || [];
        const zones = (await readJsonOrNull(regionZonesPath))?.zones || [];
        const decodeRoute = await buildLiveDecodeRoute();
        try {
          const enriched = recomputeCatalogMetadata(body, { places, zones, decodeRoute });
          sendJson(response, 200, enriched);
        } catch (err) {
          sendJson(response, 400, { ok: false, error: err.message });
        }
        return;
      }
      // /api/route-catalog/image-candidates  (POST)
      if (parts.length === 3 && parts[2] === "image-candidates" && request.method === "POST") {
        const body = await readRequestJson(request);
        try {
          const candidates = await routeCatalogImageCandidatesForRoute(body?.route, {
            slug: body?.slug,
          });
          sendJson(response, 200, { ok: true, candidates });
        } catch (err) {
          sendJson(response, 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }
      // /api/route-catalog/promote  (POST)
      if (parts.length === 3 && parts[2] === "promote" && request.method === "POST") {
        const places = (await readJsonOrNull(placesPath))?.places || [];
        const zones = (await readJsonOrNull(regionZonesPath))?.zones || [];
        const decodeRoute = await buildLiveDecodeRoute();
        try {
          const result = await promoteCatalogDraft({
            draftPath: routeCatalogDraftPath,
            publicPath: routeCatalogPublicPath,
            places,
            zones,
            decodeRoute,
          });
          // The promoted catalog determines the recommended route set. Drop the
          // long-lived decode caches so snapshots regenerate against the freshly
          // promoted catalog/assets, then rebuild every route snapshot (with
          // orphan cleanup handled inside the builder).
          invalidateFeaturedAssetCache();
          let snapshots;
          try {
            snapshots = await buildFeaturedRouteSnapshots({ log });
          } catch (snapshotErr) {
            snapshots = {
              written: [],
              removed: [],
              errors: [
                {
                  slug: null,
                  error:
                    snapshotErr instanceof Error
                      ? snapshotErr.message
                      : String(snapshotErr),
                },
              ],
            };
          }
          sendJson(response, 200, { ...result, snapshots });
        } catch (err) {
          sendJson(response, 400, { ok: false, error: err.message });
        }
        return;
      }
    }

    if (request.method === "GET" && url.pathname === "/api/featured-slugs") {
      // Source of truth is the catalog (draft first, then promoted). Fall back
      // to legacy .meta.js enumeration if neither exists.
      const draft = await readJsonOrNull(routeCatalogDraftPath);
      const promoted = await readJsonOrNull(routeCatalogPublicPath);
      const source = draft || promoted;
      if (source && Array.isArray(source.entries)) {
        sendJson(response, 200, source.entries.map((e) => e.slug));
        return;
      }
      try {
        const dir = resolve(repoRoot, "src/featured");
        const entries = await readdir(dir);
        const slugs = entries
          .filter((f) => f.endsWith(".meta.js"))
          .map((f) => f.replace(/\.meta\.js$/, ""));
        sendJson(response, 200, slugs);
      } catch {
        sendJson(response, 200, []);
      }
      return;
    }

    if (request.method === "GET") {
      await serveStatic(request, response, url);
      return;
    }

    sendText(response, 405, "Method not allowed");
  } catch (error) {
    log("error", `api#${requestId} ${request.method} ${url.pathname} failed`, {
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Only listen when run directly (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  server.listen(port, "127.0.0.1", () => {
    console.log(`Map editor running at http://127.0.0.1:${port}/editor/`);
    startDevReloadWatcher();
  });
}
