#!/usr/bin/env node
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { createReadStream, watch } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, extname, isAbsolute, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createVideoSync } from "../src/components/featured/videoSync.js";
import { PLAYBACK_BEHAVIORS } from "../src/components/featured/playbackRamp.js";
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
  loadRouteStateForSlug,
  loadRoutePolylineForSlug,
  invalidateFeaturedAssetCache,
  buildFeaturedRouteSnapshots,
  readFeaturedRouteSnapshot,
  routeStateFromFeaturedSnapshot,
  snapshotMatchesRouteToken,
  routeTokenHash,
} from "../scripts/lib/featuredRouteSnapshotBuilder.mjs";
import { runConnectorPreview } from "./lib/connectorPreview.mjs";
import {
  appendLabel,
  latestLabels,
  readLabels,
  upsertStrategy,
} from "./lib/connectorLabelStore.mjs";
import {
  joinRoundaboutReviews,
  ROUNDABOUT_REVIEW_STATUSES,
  roundaboutReviewGeoJson,
} from "./lib/roundaboutReview.mjs";
import {
  deriveJunctionArmAttachmentCandidates,
  joinNetworkJunctionReviews,
  mergeNetworkJunctionRegistry,
  networkJunctionGeoJson,
  normalizeNetworkJunctionRegistry,
  reconcileOverlayJunctionArmAttachments,
  refreshNetworkJunctionArmAssociations,
} from "./lib/networkJunctions.mjs";
import {
  CROSSING_REVIEW_STATUSES,
  crossingIssue,
  crossingReviewGeoJson,
  joinCrossingReviews,
} from "./lib/crossingReview.mjs";
import {
  acceptAlignmentDraft,
  alignmentEvidenceDigest,
  alignmentMappingDigest,
  applyReviewedMigrationBatch,
  applyReviewedSymmetricMigrationBatch,
  clearAlignmentDraft,
  deriveReverseAlignmentDraft,
  digestCwOverlayValue,
  materializeAcceptedAlignment,
  normalizeAlignmentEdgeRefs,
  oppositeAlignmentKey,
  parseCwOverlayV2,
  publishAlignmentUnavailable,
  setAlignmentDraft,
} from "./lib/cw-overlay-v2.mjs";
import {
  directedIntervalKey,
  validateDirectionReviewAlignment,
} from "./lib/edge-pick.mjs";
import { shouldAdoptAuthoringRevisionSegment } from "./lib/direction-review-refresh.mjs";
import { normalizeDirectionReviewWorkspace } from "./lib/direction-review-workspace.mjs";
import {
  emptyDirectionReviewPendingApprovals,
  normalizeDirectionReviewPendingApprovals,
  queueDirectionReviewPendingApproval,
  settleDirectionReviewPendingApprovals,
} from "./lib/direction-review-pending.mjs";
import {
  applyManualBidirectionalReview,
  manualBidirectionalResolutionCandidate,
} from "./lib/direction-review-issues.mjs";
import {
  automaticAcceptanceBasis,
  automaticBidirectionalDecision,
  automaticMatchQualityEligible,
} from "./lib/network-auto-apply.mjs";
import { networkSegmentStatus } from "./lib/network-authoring-status.mjs";
import { repairRoundaboutReverse } from "../scripts/migrate-cw-base-overlay-v2.mjs";
import {
  BASE_GRAPH_INPUTS,
  baseGraphFreshnessReason,
  compareBaseGraphBuildInputs,
} from "./lib/base-graph-build-freshness.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "..");
const editorRoot = resolve(repoRoot, "editor");
const iconsRoot = resolve(repoRoot, "icons");
const sourcePath = resolve(repoRoot, "data/map-source.geojson");
const tokenPath = resolve(repoRoot, "mapbox-token.js");
const buildDir = resolve(repoRoot, "build");
const dataDir = resolve(repoRoot, "data");
const connectorEvalDir = process.env.CONNECTOR_EVAL_DIR
  ? resolve(process.env.CONNECTOR_EVAL_DIR)
  : resolve(dataDir, "connector-eval");
const publicDataDir = resolve(repoRoot, "public-data");
const buildPublicDataDir = resolve(buildDir, "public-data");
const osmBuildDir = resolve(buildDir, "osm");
const osmRawWaysPath = resolve(osmBuildDir, "osm-raw-ways.geojson");
const osmIntersectionsPath = resolve(osmBuildDir, "osm-intersections.geojson");
const osmBaseGraphPath = resolve(osmBuildDir, "osm-base-graph.json");
const osmBaseGraphSummaryPath = resolve(osmBuildDir, "osm-base-graph-summary.json");
const osmElevatedBaseGraphPath = resolve(osmBuildDir, "osm-base-graph-elevated.json");
const reportPath = resolve(buildDir, "report.json");
const buildManifestPath = resolve(buildPublicDataDir, "map-manifest.json");
const osmGraphEdgesPath = resolve(osmBuildDir, "osm-base-edges.geojson");
const osmMatchSummaryPath = resolve(osmBuildDir, "cw-osm-match-summary.json");
const osmMatchPreviewPath = resolve(osmBuildDir, "cw-osm-match-preview.geojson");
const osmMatchesPath = resolve(osmBuildDir, "cw-osm-matches.json");
const cwBaseOverlayPath = resolve(dataDir, "cw-base-overlay.json");
const cwBaseOverlayV2StagedPath = resolve(dataDir, "cw-base-overlay.v2.staged.json");
const cwBaseOverlayV2ProposalPath = resolve(buildDir, "cw-base-overlay-v2.proposal.json");
const cwSegmentWorkspacePath = resolve(dataDir, "cw-segment-workspace.json");
const directionReviewPendingApprovalsPath = resolve(
  editorRoot,
  ".drafts/direction-review-pending.json",
);
const bicycleTraversalPolicyAuditPath = resolve(buildDir, "bicycle-traversal-policy-audit.json");
const bicycleTraversalOverridesPath = resolve(dataDir, "bicycle-traversal-overrides.json");
const manualBaseEdgesPath = resolve(dataDir, "manual-base-edges.geojson");
const baseGraphInputPathByKey = new Map([
  ["rawOsmWays", osmRawWaysPath],
  ["osmIntersections", osmIntersectionsPath],
  ["manualBaseEdges", manualBaseEdgesPath],
  ["bicycleTraversalOverrides", bicycleTraversalOverridesPath],
]);
const roundaboutCandidatesPath = resolve(osmBuildDir, "roundabout-candidates.json");
const roundaboutReviewPath = resolve(dataDir, "roundabout-review.json");
const networkJunctionCandidatesPath = resolve(buildDir, "network-junctions/candidates.json");
const networkJunctionReviewPath = resolve(dataDir, "network-junction-review.json");
const networkJunctionRegistryPath = resolve(dataDir, "network-junctions.json");
const crossingCandidatesPath = resolve(buildDir, "crossings/candidates.json");
const crossingReviewPath = resolve(dataDir, "crossing-review.json");
const baseEdgeShareRegistryPath = resolve(dataDir, "base-edge-share-ids.json");
const overpassResponsePath = resolve(osmBuildDir, "overpass-response.json");
const overpassQueryPath = resolve(osmBuildDir, "overpass-query.ql");
const poiTypesModulePath = resolve(repoRoot, "packages/core/src/data/poiTypes.js");
const featuredEditorModulePaths = new Set([
  resolve(repoRoot, "src/components/featured/videoSync.js"),
  resolve(repoRoot, "src/components/featured/routeGeometry.js"),
  resolve(repoRoot, "src/components/featured/gpsBootstrap.js"),
]);
const coreSrcRoot = resolve(repoRoot, "packages/core/src");
const promotedManifestPath = resolve(publicDataDir, "map-manifest.json");
const videoKeyframesDraftDir = resolve(editorRoot, ".drafts/route-videos");
const videoKeyframesPublicDir = resolve(publicDataDir, "route-videos");
const routeCatalogDraftPath = resolve(editorRoot, ".drafts/route-catalog.json");
const routeCatalogPublicPath = resolve(publicDataDir, "route-catalog.json");
const featuredRoutesDir = resolve(publicDataDir, "featured-routes");
const promotionFeaturedRoutesDir = resolve(buildDir, "promotion-featured-routes");
const promotionCatalogPath = resolve(buildDir, "promotion-route-catalog.json");
const promotionManifestPath = resolve(buildDir, "promotion-map-manifest.json");
const poiImagesDir = resolve(publicDataDir, "poi-images");
const routeMapImagesDir = resolve(publicDataDir, "route-map-images");
const imagesDir = resolve(repoRoot, "public/images");
const placesPath = resolve(repoRoot, "data/places.json");
const regionZonesPath = resolve(repoRoot, "data/region-zones.json");
const port = Number(process.env.EDITOR_PORT || 8899);
const devReloadEnabled = process.env.EDITOR_CLIENT_RELOAD === "1";
let requestCounter = 0;
let buildCounter = 0;
let osmGraphCounter = 0;
let directionReviewRefreshCounter = 0;
let networkAuthoringCounter = 0;
const latestNetworkAuthoringRevisionBySegment = new Map();
let promoteCounter = 0;
let atomicWriteCounter = 0;
let directionReviewGraphCache = null;
let osmWaySourceDigestCache = null;
const devReloadClients = new Set();

async function currentPromotedRouteCatalogPath() {
  const manifest = await readJsonOrNull(promotedManifestPath);
  return manifest?.routeCatalog
    ? resolveManifestPath(publicDataDir, manifest.routeCatalog)
    : routeCatalogPublicPath;
}

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
const ROUTE_MAP_IMAGE_PUBLIC_PATH = "public-data/route-map-images";
const ROUTE_MAP_IMAGE_MAX_WIDTH = 1200;
const ROUTE_MAP_IMAGE_THUMB_WIDTH = 640;

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

export async function processRouteMapImage(
  { slug, buffer, source = {}, alt = "" },
  options = {},
) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error("Route map image upload is empty");
  }
  const safeSlug = String(slug || "").trim();
  if (!ROUTE_CATALOG_SLUG_RE.test(safeSlug)) {
    throw new Error("Route map image slug must be lowercase kebab-case");
  }
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 8);
  const baseName = `${safeSlug}-map-${hash}`;
  const outputDir = options.outputDir || routeMapImagesDir;
  const publicPath = options.publicPath || ROUTE_MAP_IMAGE_PUBLIC_PATH;
  await mkdir(outputDir, { recursive: true });

  const photoBuffer = await sharp(buffer)
    .rotate()
    .resize({ width: ROUTE_MAP_IMAGE_MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  const thumbBuffer = await sharp(buffer)
    .rotate()
    .resize({ width: ROUTE_MAP_IMAGE_THUMB_WIDTH, withoutEnlargement: true })
    .webp({ quality: 76 })
    .toBuffer();

  await writeFile(join(outputDir, `${baseName}.webp`), photoBuffer);
  await writeFile(join(outputDir, `${baseName}-thumb.webp`), thumbBuffer);

  return {
    photo: `${publicPath}/${baseName}.webp`,
    thumbnail: `${publicPath}/${baseName}-thumb.webp`,
    alt: typeof alt === "string" && alt.trim() ? alt.trim() : `Route map ${safeSlug}`,
    source: source && typeof source === "object" && !Array.isArray(source) ? source : {},
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

function collectCatalogImagePaths(catalog) {
  const paths = [];
  const entries = Array.isArray(catalog?.entries) ? catalog.entries : [];
  const addImage = (image) => {
    if (!image || typeof image !== "object") return;
    for (const field of ["photo", "thumbnail"]) {
      const value = image?.[field];
      if (typeof value === "string" && value.trim() !== "") paths.push(value);
    }
  };
  const addEndpoint = (point) => {
    if (!point || typeof point !== "object") return;
    if (Array.isArray(point.images)) point.images.forEach(addImage);
  };
  for (const entry of entries) {
    addImage(entry?.heroImage);
    addImage(entry?.routeMapImage);
    addEndpoint(entry?.start);
    addEndpoint(entry?.end);
  }
  return paths;
}

export async function findMissingCatalogImages(catalog, baseDir = repoRoot) {
  const missing = [];
  const seen = new Set();
  for (const imagePath of collectCatalogImagePaths(catalog)) {
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
    segmentSpans: Array.isArray(routeState.segmentSpans)
      ? routeState.segmentSpans.map((span) => ({ ...span }))
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
    if (entry.intro !== undefined && typeof entry.intro !== "string") {
      throw new Error(`entry ${entry.slug} intro must be a string`);
    }
    if (entry.description !== undefined && typeof entry.description !== "string") {
      throw new Error(`entry ${entry.slug} description must be a string`);
    }
    validateCatalogImage(entry.heroImage, `entry ${entry.slug} heroImage`);
    validateCatalogImage(entry.routeMapImage, `entry ${entry.slug} routeMapImage`);
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
        intro: meta.intro || "",
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

export async function routeCatalogPreviewForRoute(routeToken, { slug = null } = {}) {
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
  if (!snapshot || !Array.isArray(snapshot.geometry) || snapshot.geometry.length < 2) {
    const fallback = slug ? await readFeaturedRouteSnapshot(slug) : null;
    if (fallback && snapshotMatchesRouteToken(fallback, token)) {
      snapshot = routeStateFromFeaturedSnapshot(fallback);
      log("warn", `route catalog preview: ${slug} used existing snapshot fallback`);
    }
  }
  if (!snapshot || !Array.isArray(snapshot.geometry) || snapshot.geometry.length < 2) {
    const detail = decodeError instanceof Error ? `: ${decodeError.message}` : "";
    throw new Error(`route token failed to decode${detail}`);
  }
  const manifest = await readJsonOrNull(promotedManifestPath);
  return {
    geometry: snapshot.geometry,
    source: {
      type: "mapbox-screenshot",
      routeTokenHash: routeTokenHash(token),
      mapVersion: manifest?.version ?? null,
    },
  };
}

export async function promoteCatalogDraft({ draftPath, publicPath, places, zones, decodeRoute }) {
  const draft = JSON.parse(await readFile(draftPath, "utf-8"));
  const enriched = recomputeCatalogMetadata(draft, { places, zones, decodeRoute });
  const missingImages = await findMissingCatalogImages(enriched, repoRoot);
  if (missingImages.length > 0) {
    throw new Error(
      `Route catalog promote blocked: ${missingImages.length} image file(s) are referenced but missing: ${missingImages.join(", ")}`,
    );
  }
  await mkdir(dirname(publicPath), { recursive: true });
  const tmp = `${publicPath}.tmp`;
  await writeFile(tmp, JSON.stringify(enriched, null, 2));
  await rename(tmp, publicPath);
  await unlink(draftPath);
  return { ok: true, publicPath, entryCount: enriched.entries.length };
}

async function preparePromotionCatalog({
  sourcePath,
  publicDataRoot,
  manifest,
}) {
  const draft = JSON.parse(await readFile(sourcePath, "utf-8"));
  validateCatalogDraft(draft);
  invalidateFeaturedAssetCache();
  const { geoJsonData, segmentsData } = await loadFeaturedAssetsFromDisk({
    publicDataRoot,
    manifest,
  });
  const segmentFeatureLookup = buildSegmentFeatureLookup(geoJsonData);
  const places = (await readJsonOrNull(placesPath))?.places || [];
  const zones = (await readJsonOrNull(regionZonesPath))?.zones || [];
  const entries = [];
  for (const entry of draft.entries) {
    const { routeState } = await loadRouteStateForSlug(entry.slug, {
      routeCatalogPath: sourcePath,
      publicDataRoot,
      manifest,
      allowSnapshotFallback: false,
      log,
    });
    if (!routeState || routeState.requiresReview) {
      throw new Error(
        `entry ${entry.slug}: promotion requires an exact current-policy route token`,
      );
    }
    const decoded = catalogDecodedRouteFromState(
      routeState,
      segmentsData,
      segmentFeatureLookup,
    );
    if (!decoded) {
      throw new Error(`entry ${entry.slug}: route token failed staged decode`);
    }
    entries.push({
      ...entry,
      ...classifyRoute(decoded, { places, zones }),
    });
  }
  const catalog = { version: 1, entries };
  const missingImages = await findMissingCatalogImages(catalog, repoRoot);
  if (missingImages.length > 0) {
    throw new Error(
      `Route catalog promote blocked: ${missingImages.length} image file(s) are referenced but missing: ${missingImages.join(", ")}`,
    );
  }
  await writeJsonAtomic(promotionCatalogPath, catalog);
  return catalog;
}

async function snapshotDigestIndex(directory) {
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".json"))
    .sort();
  const hashes = {};
  for (const name of names) {
    hashes[name.replace(/\.json$/, "")] = await fileDigest(resolve(directory, name));
  }
  return hashes;
}

async function preparePromotionRelease({
  manifest,
  publicDataRoot,
  catalogSourcePath,
}) {
  const catalog = await preparePromotionCatalog({
    sourcePath: catalogSourcePath,
    publicDataRoot,
    manifest,
  });
  const catalogDigest = await fileDigest(promotionCatalogPath);
  const immutableCatalogName = `route-catalog.${catalogDigest.slice(0, 12)}.json`;
  const immutableCatalogPath = resolve(buildPublicDataDir, immutableCatalogName);
  await copyFileAtomic(promotionCatalogPath, immutableCatalogPath);

  await rm(promotionFeaturedRoutesDir, { recursive: true, force: true });
  invalidateFeaturedAssetCache();
  const snapshots = await buildFeaturedRouteSnapshots({
    routeCatalogPath: immutableCatalogPath,
    publicDataRoot,
    manifest,
    outputDir: promotionFeaturedRoutesDir,
    allowSnapshotFallback: false,
    strict: true,
    log,
  });
  const snapshotHashes = await snapshotDigestIndex(promotionFeaturedRoutesDir);
  const snapshotIndexDigest = createHash("sha256")
    .update(JSON.stringify(snapshotHashes))
    .digest("hex");
  const immutableSnapshotsName = `featured-routes.${snapshotIndexDigest.slice(0, 12)}`;
  const immutableSnapshotsPath = resolve(buildPublicDataDir, immutableSnapshotsName);
  await copyDirectoryAtomic(promotionFeaturedRoutesDir, immutableSnapshotsPath);

  const shardManifest = JSON.parse(
    await readFile(
      resolveManifestPath(publicDataRoot, manifest.baseRoutingShards),
      "utf-8",
    ),
  );
  const mapAssetHashes = Object.fromEntries(
    Object.entries(manifest.hashes || {}).filter(
      ([key]) => key !== "routeCatalog" && key !== "featuredRouteSnapshots",
    ),
  );
  const releaseIndex = {
    schemaVersion: 1,
    mapVersion: manifest.version,
    policyId: shardManifest.routingContract?.policyId || null,
    policyDigest: shardManifest.routingContract?.policyDigest || null,
    routingContextDigest:
      shardManifest.routingContract?.routingContextDigest || null,
    baseEdgeShareRegistryDigest:
      shardManifest.routingContract?.baseEdgeShareRegistryDigest || null,
    mapAssetHashes,
    routeCatalogSha256: catalogDigest,
    featuredRouteSnapshotHashes: snapshotHashes,
  };
  const releaseBundleDigest = createHash("sha256")
    .update(JSON.stringify(releaseIndex))
    .digest("hex");
  const releaseManifest = {
    ...manifest,
    routeCatalog: immutableCatalogName,
    featuredRoutesBase: immutableSnapshotsName,
    releaseBundleDigest,
    releaseIndex,
    hashes: {
      ...mapAssetHashes,
      routeCatalog: catalogDigest,
      featuredRouteSnapshots: snapshotIndexDigest,
    },
  };
  await writeJsonAtomic(promotionManifestPath, releaseManifest);
  return {
    catalog,
    snapshots,
    releaseManifest,
    immutableCatalogPath,
    immutableSnapshotsPath,
  };
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
  const { youtubeId, videoDuration, keyframes, playbackBehavior } = draft;
  if (typeof youtubeId !== "string" || !youtubeId) {
    throw new Error("draft.youtubeId required");
  }
  if (
    playbackBehavior !== undefined &&
    !PLAYBACK_BEHAVIORS.includes(playbackBehavior)
  ) {
    throw new Error(
      `draft.playbackBehavior must be one of: ${PLAYBACK_BEHAVIORS.join(", ")}`,
    );
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

async function readJsonFileOrNull(path) {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function sourceGeometryDigestForCoordinates(coordinates) {
  const normalized = (coordinates || [])
    .filter((coordinate) => Array.isArray(coordinate) && coordinate.length >= 2)
    .map((coordinate) =>
      coordinate.slice(0, 2).map((value) => {
        const text = Number(value).toFixed(7).replace(/0+$/, "").replace(/\.$/, "");
        return text === "-0" || text === "" ? "0" : text;
      }),
    );
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

async function readOsmWaySourceDigestMap() {
  const sourceStat = await stat(osmRawWaysPath);
  const cacheKey = `${sourceStat.mtimeMs}:${sourceStat.size}`;
  if (osmWaySourceDigestCache?.cacheKey === cacheKey) {
    return osmWaySourceDigestCache.byWayId;
  }
  const raw = JSON.parse(await readFile(osmRawWaysPath, "utf-8"));
  const byWayId = new Map();
  for (const feature of raw.features || []) {
    const wayId = Number(feature?.properties?.osmId);
    const coordinates = feature?.geometry?.coordinates;
    if (!Number.isInteger(wayId) || wayId <= 0 || !Array.isArray(coordinates)) continue;
    byWayId.set(wayId, sourceGeometryDigestForCoordinates(coordinates));
  }
  osmWaySourceDigestCache = { cacheKey, byWayId };
  return byWayId;
}

function emptyBicycleTraversalOverrides() {
  return {
    schemaVersion: 1,
    policyId: "il-bicycle-v1",
    description: "Reviewed whole-source-way bicycle traversal overrides.",
    overrides: [],
  };
}

async function readBicycleTraversalOverrides() {
  return (await readJsonFileOrNull(bicycleTraversalOverridesPath)) || emptyBicycleTraversalOverrides();
}

async function normalizeBicycleTraversalOverrides(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Bicycle traversal overrides must be an object");
  }
  if (Number(value.schemaVersion) !== 1 || value.policyId !== "il-bicycle-v1") {
    throw new Error("Bicycle traversal overrides require schemaVersion 1 and policyId il-bicycle-v1");
  }
  if (!Array.isArray(value.overrides)) {
    throw new Error("Bicycle traversal overrides must contain an overrides array");
  }
  const sourceDigests = await readOsmWaySourceDigestMap();
  const states = new Set(["allowed", "prohibited", "conditional", "unknown"]);
  const seen = new Set();
  const overrides = value.overrides.map((raw, index) => {
    const osmWayId = Number(raw?.osmWayId);
    if (!Number.isInteger(osmWayId) || osmWayId <= 0) {
      throw new Error(`Traversal override ${index} requires a positive osmWayId`);
    }
    if (seen.has(osmWayId)) throw new Error(`Duplicate traversal override for OSM way ${osmWayId}`);
    seen.add(osmWayId);
    const currentDigest = sourceDigests.get(osmWayId);
    if (!currentDigest) throw new Error(`Traversal override references missing OSM way ${osmWayId}`);
    if (raw.sourceGeometryDigest !== currentDigest) {
      throw new Error(`Traversal override for OSM way ${osmWayId} has stale source geometry`);
    }
    if (
      !raw.states ||
      typeof raw.states !== "object" ||
      Array.isArray(raw.states) ||
      !states.has(raw.states.forward) ||
      !states.has(raw.states.reverse) ||
      Object.keys(raw.states).some((key) => !["forward", "reverse"].includes(key))
    ) {
      throw new Error(`Traversal override for OSM way ${osmWayId} requires forward and reverse states`);
    }
    const normalized = {
      osmWayId,
      sourceGeometryDigest: currentDigest,
      states: { forward: raw.states.forward, reverse: raw.states.reverse },
    };
    for (const field of ["rationale", "evidence", "reviewer", "reviewedAt"]) {
      if (typeof raw[field] !== "string" || raw[field].trim() === "") {
        throw new Error(`Traversal override for OSM way ${osmWayId} requires ${field}`);
      }
      normalized[field] = raw[field].trim();
    }
    if (typeof raw.updatedAt === "string" && raw.updatedAt.trim()) {
      normalized.updatedAt = raw.updatedAt.trim();
    }
    return normalized;
  });
  overrides.sort((left, right) => left.osmWayId - right.osmWayId);
  return {
    schemaVersion: 1,
    policyId: "il-bicycle-v1",
    description:
      typeof value.description === "string" && value.description.trim()
        ? value.description.trim()
        : emptyBicycleTraversalOverrides().description,
    overrides,
  };
}

async function readDirectionReviewOverlay() {
  const staged = await readJsonFileOrNull(cwBaseOverlayV2StagedPath);
  if (staged) {
    return {
      source: "staged",
      readOnly: false,
      overlay: parseCwOverlayV2(staged),
    };
  }
  const proposal = await readJsonFileOrNull(cwBaseOverlayV2ProposalPath);
  if (proposal) {
    return { source: "migration-proposal", readOnly: true, overlay: parseCwOverlayV2(proposal) };
  }
  return null;
}

function requireStagedV2Profile() {
  // Overlay V2 is now the editor's mutable mapping authority. The old
  // CW_OVERLAY_PROFILE switch remains a build/runtime compatibility concern,
  // not a requirement for local authoring writes.
}

function compactBicycleTraversal(value) {
  if (!value || typeof value !== "object") return null;
  return {
    policyId: value.policyId || null,
    policyDigest: value.policyDigest || null,
    forward: value.forward || "unknown",
    reverse: value.reverse || "unknown",
    forwardReason: value.forwardReason || "missing_policy_evidence",
    reverseReason: value.reverseReason || "missing_policy_evidence",
  };
}

async function readDirectionReviewGraphContext() {
  const [graphStat, auditStat] = await Promise.all([
    stat(osmBaseGraphPath),
    stat(bicycleTraversalPolicyAuditPath),
  ]);
  const cacheKey = `${graphStat.mtimeMs}:${graphStat.size}:${auditStat.mtimeMs}:${auditStat.size}`;
  if (directionReviewGraphCache?.cacheKey === cacheKey) return directionReviewGraphCache;

  const [graphBytes, auditBytes] = await Promise.all([
    readFile(osmBaseGraphPath),
    readFile(bicycleTraversalPolicyAuditPath),
  ]);
  const graph = JSON.parse(graphBytes);
  const audit = JSON.parse(auditBytes);
  const edgeLookup = new Map();
  for (const edge of graph.edges || []) {
    const edgeId = String(edge?.id || "");
    if (!edgeId) continue;
    edgeLookup.set(edgeId, {
      id: edgeId,
      edgeId,
      source: edge.source || "osm",
      fromNodeId: edge.fromNodeId ? String(edge.fromNodeId) : null,
      toNodeId: edge.toNodeId ? String(edge.toNodeId) : null,
      coordinates: Array.isArray(edge.coordinates) ? edge.coordinates : [],
      tags: edge.tags && typeof edge.tags === "object" ? edge.tags : {},
      bicycleTraversal: compactBicycleTraversal(edge.bicycleTraversalShadow),
    });
  }
  directionReviewGraphCache = {
    cacheKey,
    graphDigest: createHash("sha256").update(graphBytes).digest("hex"),
    policyDigest: audit.policyDigest,
    policyId: audit.policy?.policyId,
    edgeLookup,
  };
  return directionReviewGraphCache;
}

function reverseAlignmentRefs(refs) {
  return normalizeAlignmentEdgeRefs(refs)
    .reverse()
    .map((ref, sequenceIndex) => ({
      ...ref,
      direction: ref.direction === "reverse" ? "forward" : "reverse",
      sequenceIndex,
    }));
}

function directionReviewRecordRefs(segment, alignmentKey, record) {
  if (record?.realization?.type === "explicit") {
    return normalizeAlignmentEdgeRefs(record.realization.edgeRefs);
  }
  if (record?.realization?.type === "reverseOf") {
    const target = segment.alignments?.[record.realization.alignmentKey]?.published;
    if (target?.realization?.type === "explicit") {
      return reverseAlignmentRefs(target.realization.edgeRefs);
    }
  }
  if (record?.candidate?.kind === "exact-reverse") {
    const targetKey = record.candidate.reverseOfAlignmentKey || oppositeAlignmentKey(alignmentKey);
    const targetSlot = segment.alignments?.[targetKey];
    const target = targetSlot?.published || targetSlot?.draft;
    if (target?.realization?.type === "explicit") {
      return reverseAlignmentRefs(target.realization.edgeRefs);
    }
  }
  return [];
}

function directionReviewDistanceMeters(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return Infinity;
  const radians = (value) => (Number(value) * Math.PI) / 180;
  const dLat = radians(b[1] - a[1]);
  const dLng = radians(b[0] - a[0]);
  const lat1 = radians(a[1]);
  const lat2 = radians(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function directionReviewOrientedCoordinates(ref, edge) {
  const coords = (edge?.coordinates || []).map((coordinate) => coordinate.slice());
  return ref?.direction === "reverse" ? coords.reverse() : coords;
}

function directionReviewContinuityGaps(refs, edgeLookup) {
  const gaps = [];
  for (let index = 0; index < refs.length - 1; index++) {
    const leftRef = refs[index];
    const rightRef = refs[index + 1];
    const left = edgeLookup.get(String(leftRef.edgeId));
    const right = edgeLookup.get(String(rightRef.edgeId));
    if (!left || !right) continue;
    const leftCoords = directionReviewOrientedCoordinates(leftRef, left);
    const rightCoords = directionReviewOrientedCoordinates(rightRef, right);
    const distanceMeters = directionReviewDistanceMeters(
      leftCoords[leftCoords.length - 1],
      rightCoords[0],
    );
    const leftEndNode = leftRef.direction === "reverse" ? left.fromNodeId : left.toNodeId;
    const rightStartNode = rightRef.direction === "reverse" ? right.toNodeId : right.fromNodeId;
    if ((leftEndNode && rightStartNode && leftEndNode !== rightStartNode) || distanceMeters > 12) {
      gaps.push({
        sequenceIndex: index,
        fromEdgeId: String(leftRef.edgeId),
        toEdgeId: String(rightRef.edgeId),
        distanceMeters,
        fromNodeId: leftEndNode,
        toNodeId: rightStartNode,
      });
    }
  }
  return gaps;
}

function directionReviewEndpointValidation(segment, alignmentKey, refs, edgeLookup) {
  if (refs.length === 0) return { ok: true };
  const first = edgeLookup.get(String(refs[0].edgeId));
  const last = edgeLookup.get(String(refs[refs.length - 1].edgeId));
  const firstCoords = directionReviewOrientedCoordinates(refs[0], first);
  const lastCoords = directionReviewOrientedCoordinates(refs[refs.length - 1], last);
  if (firstCoords.length === 0 || lastCoords.length === 0) return { ok: false };
  const start = firstCoords[0];
  const end = lastCoords[lastCoords.length - 1];
  const startEndpoint = alignmentKey === "aToB" ? segment.endpoints.a : segment.endpoints.b;
  const endEndpoint = alignmentKey === "aToB" ? segment.endpoints.b : segment.endpoints.a;
  const distances = {
    start: directionReviewDistanceMeters(start, startEndpoint.coordinate),
    end: directionReviewDistanceMeters(end, endEndpoint.coordinate),
  };
  return {
    ok: distances.start <= Number(startEndpoint.zoneMeters) && distances.end <= Number(endEndpoint.zoneMeters),
    terminals: { start, end },
    distances,
    startZoneMeters: Number(startEndpoint.zoneMeters),
    endZoneMeters: Number(endEndpoint.zoneMeters),
  };
}

function directionReviewDirectedOwners(overlay) {
  const owners = new Map();
  for (const segment of Object.values(overlay.segments || {})) {
    for (const alignmentKey of ["aToB", "bToA"]) {
      for (const ref of materializeAcceptedAlignment(segment, alignmentKey) || []) {
        owners.set(directedIntervalKey(ref), {
          segmentId: segment.segmentId,
          segmentName: segment.segmentName,
          alignmentKey,
        });
      }
    }
  }
  return owners;
}

async function validateDirectionReviewRefs(overlay, segment, alignmentKey, refs) {
  const context = await readDirectionReviewGraphContext();
  return validateDirectionReviewRefsWithContext(
    overlay,
    segment,
    alignmentKey,
    refs,
    context,
    directionReviewDirectedOwners(overlay),
  );
}

function validateDirectionReviewRefsWithContext(
  overlay,
  segment,
  alignmentKey,
  refs,
  context,
  directedOwners,
) {
  const normalizedRefs = normalizeAlignmentEdgeRefs(refs);
  return validateDirectionReviewAlignment({
    segmentId: segment.segmentId,
    alignmentKey,
    edgeRefs: normalizedRefs,
    edgeLookup: context.edgeLookup,
    directedOwners,
    continuityGaps: directionReviewContinuityGaps(normalizedRefs, context.edgeLookup),
    endpointValidation: directionReviewEndpointValidation(
      segment,
      alignmentKey,
      normalizedRefs,
      context.edgeLookup,
    ),
    evidenceCurrent:
      context.graphDigest === overlay.graphDigest &&
      context.policyDigest === overlay.policyDigest,
  });
}

function directionReviewEvidenceDigest(refs, context) {
  return alignmentEvidenceDigest(refs, context.edgeLookup, context.policyDigest);
}

async function directionReviewEvidenceDigests(overlay, segmentIds) {
  const context = await readDirectionReviewGraphContext();
  const selected = new Set((segmentIds || []).map(Number));
  const evidenceDigests = {};
  for (const segment of Object.values(overlay.segments || {})) {
    if (!selected.has(segment.segmentId)) continue;
    for (const alignmentKey of ["aToB", "bToA"]) {
      const slot = segment.alignments?.[alignmentKey];
      const record = slot?.published || slot?.draft;
      const refs = directionReviewRecordRefs(segment, alignmentKey, record);
      if (refs.length === 0) continue;
      evidenceDigests[String(segment.segmentId)] ||= {};
      evidenceDigests[String(segment.segmentId)][alignmentKey] =
        directionReviewEvidenceDigest(refs, context);
    }
  }
  return evidenceDigests;
}

function networkAuthoringDirectedOwners(overlay, excludedSegmentId) {
  const owners = new Map();
  for (const segment of Object.values(overlay.segments || {})) {
    if (Number(segment.segmentId) === Number(excludedSegmentId)) continue;
    for (const alignmentKey of ["aToB", "bToA"]) {
      for (const ref of materializeAcceptedAlignment(segment, alignmentKey) || []) {
        owners.set(directedIntervalKey(ref), {
          segmentId: segment.segmentId,
          segmentName: segment.segmentName,
          alignmentKey,
        });
      }
    }
  }
  return owners;
}

function networkAuthoringPolicyLookup(context) {
  const lookup = new Map();
  for (const edge of context.edgeLookup.values()) {
    for (const direction of ["forward", "reverse"]) {
      const state = edge.bicycleTraversal?.[direction] || "unknown";
      if (state === "allowed") continue;
      lookup.set(`${edge.edgeId}|${direction}`, {
        state,
        reason:
          edge.bicycleTraversal?.[`${direction}Reason`] ||
          "missing_policy_evidence",
      });
    }
  }
  return lookup;
}

function networkAuthoringEndpointScore(validation) {
  const distances = validation?.endpointDistancesMeters || {};
  const start = Number(distances.start);
  const end = Number(distances.end);
  return (Number.isFinite(start) ? start : Number.POSITIVE_INFINITY) +
    (Number.isFinite(end) ? end : Number.POSITIVE_INFINITY);
}

function networkAuthoringRefsEqual(left, right) {
  return JSON.stringify(normalizeAlignmentEdgeRefs(left || [])) ===
    JSON.stringify(normalizeAlignmentEdgeRefs(right || []));
}

function networkAuthoringIntentionalAsymmetry(segment) {
  const aRefs = materializeAcceptedAlignment(segment, "aToB");
  const bRefs = materializeAcceptedAlignment(segment, "bToA");
  if (!aRefs?.length || !bRefs?.length) return false;
  if (networkAuthoringRefsEqual(reverseAlignmentRefs(aRefs), bRefs)) return false;
  const bases = ["aToB", "bToA"].map(
    (alignmentKey) =>
      segment.alignments?.[alignmentKey]?.published?.review?.acceptanceBasis || "",
  );
  return bases.some((basis) => !String(basis).startsWith("automatic-"));
}

function networkAuthoringSegmentShell(feature, previous) {
  const coordinates = feature.geometry.coordinates.map((coordinate) =>
    coordinate.slice(0, 2),
  );
  const sourceGeometryDigest = digestCwOverlayValue(coordinates);
  return {
    ...(previous ? structuredClone(previous) : {}),
    segmentId: Number(feature.properties.id),
    segmentName: String(feature.properties.name || feature.properties.id),
    lifecycleStatus: String(feature.properties.status || "active"),
    navigable: true,
    sourceGeometryDigest,
    endpoints: {
      a: {
        coordinate: coordinates[0],
        zoneMeters: Number(previous?.endpoints?.a?.zoneMeters || 30),
        labels: { key: "A" },
      },
      b: {
        coordinate: coordinates.at(-1),
        zoneMeters: Number(previous?.endpoints?.b?.zoneMeters || 30),
        labels: { key: "B" },
      },
    },
    // Keep the last published path while evaluating a revised source shape.
    // A failed proposal is surfaced as a draft/issue, but does not destroy the
    // last routeable mapping. A successful proposal replaces both directions.
    alignments: previous
      ? structuredClone(previous.alignments)
      : {
          aToB: { published: null, draft: null },
          bToA: { published: null, draft: null },
        },
  };
}

async function reconcileNetworkAuthoringJunctionAttachments(
  overlay,
  segmentId,
  context,
) {
  let candidates;
  try {
    candidates = JSON.parse(await readFile(networkJunctionCandidatesPath, "utf-8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { overlay, applied: [], removed: [], issues: [] };
    }
    throw error;
  }
  const derived = deriveJunctionArmAttachmentCandidates({
    overlay,
    graph: { edges: [...context.edgeLookup.values()] },
    junctions: candidates.junctions || [],
    segmentIds: [segmentId],
  });
  return reconcileOverlayJunctionArmAttachments(overlay, derived, {
    segmentIds: [segmentId],
  });
}

function networkAuthoringReview({
  overlay,
  segment,
  alignmentKey,
  realization,
  refs,
  intent,
  revision,
  context,
  roundaboutRepair = null,
}) {
  const mappingDigest = alignmentMappingDigest(
    segment.segmentId,
    alignmentKey,
    realization,
  );
  const acceptanceBasis = automaticAcceptanceBasis({ intent, roundaboutRepair });
  return {
    disposition: "accepted",
    realization,
    mappingDigest,
    review: {
      reviewer: intent === "explicit-selection" ? "ohad" : "editor-automatic",
      reviewedAt: new Date().toISOString().slice(0, 10),
      batchId: `network-authoring-${segment.segmentId}-${revision}`,
      rationale: roundaboutRepair
        ? "Validated authoring path with a deterministic legal roundabout reverse repair"
        : intent === "explicit-selection"
          ? "Explicit curator edge selection with a mechanically validated exact reverse"
          : "High-confidence full-coverage automatic match with a mechanically validated exact reverse",
      acceptanceBasis,
      automated: intent !== "explicit-selection",
      graphDigest: overlay.graphDigest,
      policyDigest: overlay.policyDigest,
      sourceGeometryDigest: segment.sourceGeometryDigest,
      mappingDigest,
      evidenceDigest: directionReviewEvidenceDigest(refs, context),
    },
  };
}

function networkAuthoringDraft({ refs, candidate, validation }) {
  const realization = refs?.length
    ? { type: "explicit", edgeRefs: normalizeAlignmentEdgeRefs(refs) }
    : null;
  return {
    disposition: "needs_review",
    ...(realization ? { realization } : {}),
    ...(realization
      ? { mappingDigest: alignmentMappingDigest(candidate.segmentId, candidate.alignmentKey, realization) }
      : {}),
    candidate: {
      kind: candidate.kind,
      sourceRevision: candidate.sourceRevision,
      ...(candidate.roundaboutRepairs
        ? { repairs: candidate.roundaboutRepairs }
        : {}),
    },
    validation,
  };
}

function networkAuthoringValidationWithDecision(validation, decision) {
  if (decision.outcome === "apply" || decision.code === "access_precedence") {
    return validation;
  }
  if ((validation?.reasons || []).some((reason) => reason.code === decision.code)) {
    return validation;
  }
  return {
    ...(validation || {}),
    ok: false,
    status: "invalid",
    reasons: [
      ...(validation?.reasons || []),
      { code: decision.code, reason: decision.message },
    ],
  };
}

async function writeNetworkAuthoringCompatibilityMapping({
  segment,
  refs,
  intent,
  match,
}) {
  const previous = await readCwBaseOverlay();
  const next = normalizeCwBaseOverlay({
    ...previous,
    segments: {
      ...(previous.segments || {}),
      [String(segment.segmentId)]: {
        segmentId: segment.segmentId,
        segmentName: segment.segmentName,
        status: intent === "explicit-selection" ? "accepted_edge_set" : "accepted_auto_match",
        source: intent === "explicit-selection" ? "edge_pick" : "v2_compatibility_projection",
        confidence: match?.confidence || (intent === "explicit-selection" ? "manual" : "high"),
        coverageRatio: Number(match?.coverageRatio ?? 1),
        avgDistanceMeters: match?.avgDistanceMeters ?? null,
        gapCount: Number(match?.gapCount || 0),
        failureClass: match?.failureClass || null,
        edgeRefs: normalizeAlignmentEdgeRefs(refs),
        updatedAt: new Date().toISOString(),
      },
    },
  });
  await writeJsonAtomic(cwBaseOverlayPath, next);
  return next;
}

async function applyNetworkAuthoringSegmentMetadata(payload) {
  const segmentId = Number(payload?.segmentId);
  const requestedRevision = Number(payload?.revision || ++networkAuthoringCounter);
  if (!Number.isInteger(segmentId)) throw new Error("Network metadata authoring requires a segmentId");
  if (!Number.isFinite(requestedRevision)) throw new Error("Network metadata authoring requires a revision");

  const previousRevision = latestNetworkAuthoringRevisionBySegment.get(segmentId) || 0;
  if (requestedRevision <= previousRevision) {
    return { superseded: true, segmentId, revision: requestedRevision };
  }
  latestNetworkAuthoringRevisionBySegment.set(segmentId, requestedRevision);

  const [source, stagedValue, proposalValue, compatibilityValue] = await Promise.all([
    readJsonFileOrNull(sourcePath),
    readJsonFileOrNull(cwBaseOverlayV2StagedPath),
    readJsonFileOrNull(cwBaseOverlayV2ProposalPath),
    readCwBaseOverlay(),
  ]);
  const sourceFeature = source?.features?.find(
    (feature) => Number(feature?.properties?.id) === segmentId,
  );
  if (!sourceFeature?.geometry || sourceFeature.geometry.type !== "LineString") {
    throw new Error(`Source segment ${segmentId} was not found; save the source first`);
  }

  const overlay = parseCwOverlayV2(stagedValue || proposalValue);
  const previousSegment = overlay.segments?.[String(segmentId)];
  if (!previousSegment) {
    return {
      superseded: false,
      skipped: true,
      reason: "mapping-not-created",
      segmentId,
      revision: requestedRevision,
      overlay,
      compatibilityOverlay: compatibilityValue,
    };
  }

  const nextOverlay = structuredClone(overlay);
  const nextSegment = nextOverlay.segments[String(segmentId)];
  nextSegment.segmentName = String(sourceFeature.properties?.name || segmentId);
  nextSegment.lifecycleStatus = String(sourceFeature.properties?.status || "active");
  nextSegment.navigable = !["deprecated", "legacy", "draft"].includes(nextSegment.lifecycleStatus);

  const nextCompatibility = normalizeCwBaseOverlay({
    ...compatibilityValue,
    segments: compatibilityValue.segments?.[String(segmentId)]
      ? {
          ...compatibilityValue.segments,
          [String(segmentId)]: {
            ...compatibilityValue.segments[String(segmentId)],
            segmentName: nextSegment.segmentName,
            updatedAt: new Date().toISOString(),
          },
        }
      : compatibilityValue.segments,
  });
  const parsed = parseCwOverlayV2(nextOverlay);
  if (latestNetworkAuthoringRevisionBySegment.get(segmentId) !== requestedRevision) {
    return { superseded: true, segmentId, revision: requestedRevision };
  }

  try {
    await writeJsonAtomic(cwBaseOverlayV2StagedPath, parsed);
    if (compatibilityValue.segments?.[String(segmentId)]) {
      await writeJsonAtomic(cwBaseOverlayPath, nextCompatibility);
    }
  } catch (error) {
    await Promise.all([
      stagedValue
        ? writeJsonAtomic(cwBaseOverlayV2StagedPath, stagedValue)
        : unlink(cwBaseOverlayV2StagedPath).catch(() => {}),
      writeJsonAtomic(cwBaseOverlayPath, compatibilityValue),
    ]).catch((rollbackError) => {
      log("error", "network metadata rollback failed", rollbackError?.message || String(rollbackError));
    });
    throw error;
  }

  return {
    superseded: false,
    segmentId,
    revision: requestedRevision,
    status: networkSegmentStatus(nextSegment),
    overlay: parsed,
    compatibilityOverlay: nextCompatibility,
  };
}

async function applyNetworkAuthoringSegment(payload) {
  const intent = payload?.intent === "explicit-selection"
    ? "explicit-selection"
    : "automatic-match";
  const segmentId = Number(payload?.segmentId ?? payload?.feature?.properties?.id);
  const requestedRevision = Number(payload?.revision || ++networkAuthoringCounter);
  if (!Number.isInteger(segmentId)) throw new Error("Network authoring requires a segmentId");
  if (!Number.isFinite(requestedRevision)) throw new Error("Network authoring requires a revision");

  const previousRevision = latestNetworkAuthoringRevisionBySegment.get(segmentId) || 0;
  if (requestedRevision <= previousRevision) {
    return { superseded: true, segmentId, revision: requestedRevision };
  }
  latestNetworkAuthoringRevisionBySegment.set(segmentId, requestedRevision);

  const [source, stagedValue, proposalValue, context] = await Promise.all([
    readJsonFileOrNull(sourcePath),
    readJsonFileOrNull(cwBaseOverlayV2StagedPath),
    readJsonFileOrNull(cwBaseOverlayV2ProposalPath),
    readDirectionReviewGraphContext(),
  ]);
  const sourceFeature = source?.features?.find(
    (feature) => Number(feature?.properties?.id) === segmentId,
  );
  if (!sourceFeature?.geometry || sourceFeature.geometry.type !== "LineString") {
    throw new Error(`Active source segment ${segmentId} was not found; save the source first`);
  }
  const suppliedDigest = payload?.feature?.geometry?.coordinates
    ? digestCwOverlayValue(
        payload.feature.geometry.coordinates.map((coordinate) => coordinate.slice(0, 2)),
      )
    : null;
  const currentDigest = digestCwOverlayValue(
    sourceFeature.geometry.coordinates.map((coordinate) => coordinate.slice(0, 2)),
  );
  if (suppliedDigest && suppliedDigest !== currentDigest) {
    const error = new Error(`Segment ${segmentId} source changed after this authoring request`);
    error.status = 409;
    error.code = "SOURCE_REVISION_SUPERSEDED";
    throw error;
  }

  const overlay = parseCwOverlayV2(stagedValue || proposalValue);
  if (
    overlay.graphDigest !== context.graphDigest ||
    overlay.policyDigest !== context.policyDigest
  ) {
    const error = new Error("Base-network evidence changed; refresh authoring evidence and retry");
    error.status = 409;
    error.code = "BASE_EVIDENCE_SUPERSEDED";
    throw error;
  }
  const previousSegment = overlay.segments?.[String(segmentId)] || null;
  const segment = networkAuthoringSegmentShell(sourceFeature, previousSegment);
  const refs = normalizeAlignmentEdgeRefs(payload?.edgeRefs || []);
  if (refs.length === 0) throw new Error("Network authoring requires at least one base edge");
  if (intent === "automatic-match" && !automaticMatchQualityEligible(payload?.match)) {
    // Continue so the blocked result is recorded as an inspectable proposal.
  }

  const owners = networkAuthoringDirectedOwners(overlay, segmentId);
  const aValidation = validateDirectionReviewRefsWithContext(
    overlay,
    segment,
    "aToB",
    refs,
    context,
    owners,
  );
  const bValidation = validateDirectionReviewRefsWithContext(
    overlay,
    segment,
    "bToA",
    refs,
    context,
    owners,
  );
  const forwardKey = aValidation.ok || networkAuthoringEndpointScore(aValidation) <= networkAuthoringEndpointScore(bValidation)
    ? "aToB"
    : "bToA";
  const oppositeKey = oppositeAlignmentKey(forwardKey);
  let forwardRefs = refs;
  let forwardValidation = forwardKey === "aToB" ? aValidation : bValidation;
  let forwardJunctionRepair = null;
  if (!forwardValidation.ok) {
    const repair = repairRoundaboutReverse(
      forwardRefs,
      forwardValidation,
      context.edgeLookup,
      networkAuthoringPolicyLookup(context),
    );
    if (repair?.edgeRefs?.length) {
      const repairedValidation = validateDirectionReviewRefsWithContext(
        overlay,
        segment,
        forwardKey,
        repair.edgeRefs,
        context,
        owners,
      );
      if (repairedValidation.ok) {
        forwardJunctionRepair = repair;
        forwardRefs = normalizeAlignmentEdgeRefs(repair.edgeRefs);
        forwardValidation = repairedValidation;
      }
    }
  }
  const reverseRefs = reverseAlignmentRefs(forwardRefs);
  let oppositeRefs = reverseRefs;
  let reverseValidation = validateDirectionReviewRefsWithContext(
    overlay,
    segment,
    oppositeKey,
    reverseRefs,
    context,
    owners,
  );
  let roundaboutRepair = null;
  if (!reverseValidation.ok) {
    const repair = repairRoundaboutReverse(
      reverseRefs,
      reverseValidation,
      context.edgeLookup,
      networkAuthoringPolicyLookup(context),
    );
    if (repair?.edgeRefs?.length) {
      const repairedValidation = validateDirectionReviewRefsWithContext(
        overlay,
        segment,
        oppositeKey,
        repair.edgeRefs,
        context,
        owners,
      );
      if (repairedValidation.ok) {
        roundaboutRepair = repair;
        oppositeRefs = normalizeAlignmentEdgeRefs(repair.edgeRefs);
        reverseValidation = repairedValidation;
      }
    }
  }

  const decision = automaticBidirectionalDecision({
    intent,
    match: payload?.match,
    forwardValidation,
    reverseValidation,
    intentionalAsymmetry: networkAuthoringIntentionalAsymmetry(previousSegment),
    competingPathCount: Number(payload?.match?.competingPathCount || 0),
    roundaboutRepair,
  });

  segment.migration = {
    ...(segment.migration || {}),
    classification: forwardJunctionRepair || roundaboutRepair
      ? "roundabout_reverse_candidate"
      : decision.outcome === "apply"
        ? "symmetric_candidate"
        : decision.code === "access_precedence"
          ? "access_precedence_needed"
          : "unresolved",
    sourceSchemaVersion: 2,
    sourceMappingOrigin: "network-authoring-v2",
    authoringRevision: requestedRevision,
    lastOutcome: decision.outcome,
    lastOutcomeCode: decision.code,
  };

  if (decision.outcome === "apply") {
    const explicitRealization = { type: "explicit", edgeRefs: forwardRefs };
    const explicitPublished = networkAuthoringReview({
      overlay,
      segment,
      alignmentKey: forwardKey,
      realization: explicitRealization,
      refs: forwardRefs,
      intent,
      revision: requestedRevision,
      context,
      roundaboutRepair: forwardJunctionRepair,
    });
    const oppositeRealization = roundaboutRepair
      ? { type: "explicit", edgeRefs: oppositeRefs }
      : {
          type: "reverseOf",
          alignmentKey: forwardKey,
          referencedMappingDigest: explicitPublished.mappingDigest,
        };
    const oppositePublished = networkAuthoringReview({
      overlay,
      segment,
      alignmentKey: oppositeKey,
      realization: oppositeRealization,
      refs: oppositeRefs,
      intent,
      revision: requestedRevision,
      context,
      roundaboutRepair,
    });
    segment.alignments[forwardKey] = { published: explicitPublished, draft: null };
    segment.alignments[oppositeKey] = { published: oppositePublished, draft: null };
    segment.migration.automaticPublication = roundaboutRepair
      ? "roundabout-reverse"
      : "bidirectional-authoring";
  } else {
    const forwardResult = networkAuthoringValidationWithDecision(
      forwardValidation,
      decision,
    );
    const reverseResult = networkAuthoringValidationWithDecision(
      reverseValidation,
      decision,
    );
    segment.alignments[forwardKey].draft = networkAuthoringDraft({
      refs: forwardRefs,
      candidate: {
        kind: forwardJunctionRepair
          ? "junction-repaired-existing"
          : intent === "explicit-selection" ? "manual-editor" : "automatic-match",
        segmentId,
        alignmentKey: forwardKey,
        sourceRevision: requestedRevision,
        roundaboutRepairs: forwardJunctionRepair?.repairs,
      },
      validation: forwardResult,
    });
    segment.alignments[oppositeKey].draft = networkAuthoringDraft({
      refs: oppositeRefs,
      candidate: {
        kind: roundaboutRepair ? "roundabout-repaired-reverse" : "exact-reverse",
        segmentId,
        alignmentKey: oppositeKey,
        sourceRevision: requestedRevision,
        roundaboutRepairs: roundaboutRepair?.repairs,
      },
      validation: reverseResult,
    });
  }

  const nextOverlay = structuredClone(overlay);
  nextOverlay.segments[String(segmentId)] = segment;
  const attachmentReconciliation = await reconcileNetworkAuthoringJunctionAttachments(
    nextOverlay,
    segmentId,
    context,
  );
  const parsed = parseCwOverlayV2(attachmentReconciliation.overlay);
  if (latestNetworkAuthoringRevisionBySegment.get(segmentId) !== requestedRevision) {
    return { superseded: true, segmentId, revision: requestedRevision };
  }

  const previousStaged = stagedValue;
  const previousCompatibility = await readCwBaseOverlay();
  let compatibilityOverlay = previousCompatibility;
  try {
    if (decision.outcome === "apply") {
      await validatePublishedDirectionReviewOverlay(parsed);
    }
    await writeJsonAtomic(cwBaseOverlayV2StagedPath, parsed);
    if (decision.outcome === "apply") {
      compatibilityOverlay = await writeNetworkAuthoringCompatibilityMapping({
        segment,
        refs,
        intent,
        match: payload?.match,
      });
    }
  } catch (error) {
    await Promise.all([
      previousStaged
        ? writeJsonAtomic(cwBaseOverlayV2StagedPath, previousStaged)
        : unlink(cwBaseOverlayV2StagedPath).catch(() => {}),
      writeJsonAtomic(cwBaseOverlayPath, previousCompatibility),
    ]).catch((rollbackError) => {
      log("error", "network authoring rollback failed", rollbackError?.message || String(rollbackError));
    });
    throw error;
  }

  return {
    superseded: false,
    segmentId,
    revision: requestedRevision,
    decision,
    status: networkSegmentStatus(segment, {
      transientIssue: decision.outcome === "apply"
        ? null
        : { code: decision.code, message: decision.message },
    }),
    overlay: parsed,
    compatibilityOverlay,
    junctionAttachments: attachmentReconciliation.applied,
    junctionAttachmentsRemoved: attachmentReconciliation.removed,
    junctionAttachmentIssues: attachmentReconciliation.issues,
  };
}

async function autoApplySafeDirectionReviewDrafts(overlay, { revision } = {}) {
  const next = structuredClone(overlay);
  const context = await readDirectionReviewGraphContext();
  if (
    next.graphDigest !== context.graphDigest ||
    next.policyDigest !== context.policyDigest
  ) {
    return { overlay: next, applied: [], skipped: [{ code: "stale_evidence" }] };
  }
  const applied = [];
  const skipped = [];
  const allowedExistingKinds = new Set([
    "v1-existing",
    "new-authoring",
    "authoring-revision",
    "automatic-match",
    "previous-draft",
    "previously-published",
  ]);
  const allowedOppositeKinds = new Set([
    "exact-reverse",
    "roundabout-repaired-reverse",
    "previous-draft",
  ]);

  for (const segment of Object.values(next.segments || {}).sort(
    (left, right) => Number(left.segmentId) - Number(right.segmentId),
  )) {
    if (["aToB", "bToA"].some((key) => segment.alignments?.[key]?.published)) {
      continue;
    }
    const explicitKey = ["aToB", "bToA"].find((key) => {
      const draft = segment.alignments?.[key]?.draft;
      return draft?.realization?.type === "explicit" &&
        allowedExistingKinds.has(draft?.candidate?.kind);
    });
    if (!explicitKey) continue;
    const oppositeKey = oppositeAlignmentKey(explicitKey);
    const explicitDraft = segment.alignments[explicitKey].draft;
    const oppositeDraft = segment.alignments[oppositeKey].draft;
    if (!allowedOppositeKinds.has(oppositeDraft?.candidate?.kind)) continue;
    const refs = directionReviewRecordRefs(segment, explicitKey, explicitDraft);
    const oppositeRefs = directionReviewRecordRefs(segment, oppositeKey, oppositeDraft);
    if (refs.length === 0 || oppositeRefs.length === 0) continue;

    const owners = networkAuthoringDirectedOwners(next, segment.segmentId);
    const forwardValidation = validateDirectionReviewRefsWithContext(
      next,
      segment,
      explicitKey,
      refs,
      context,
      owners,
    );
    const reverseValidation = validateDirectionReviewRefsWithContext(
      next,
      segment,
      oppositeKey,
      oppositeRefs,
      context,
      owners,
    );
    const roundaboutRepair = oppositeDraft?.candidate?.kind === "roundabout-repaired-reverse"
      ? { repairs: oppositeDraft.candidate.repairs || [] }
      : null;
    const decision = automaticBidirectionalDecision({
      intent: "migration-safe",
      forwardValidation,
      reverseValidation,
      intentionalAsymmetry: false,
      roundaboutRepair,
    });
    if (decision.outcome !== "apply") {
      skipped.push({ segmentId: segment.segmentId, code: decision.code });
      continue;
    }

    const explicitRealization = { type: "explicit", edgeRefs: refs };
    const explicitPublished = networkAuthoringReview({
      overlay: next,
      segment,
      alignmentKey: explicitKey,
      realization: explicitRealization,
      refs,
      intent: "migration-safe",
      revision: revision || `refresh-${Date.now()}`,
      context,
    });
    const reverseIsExact = networkAuthoringRefsEqual(
      reverseAlignmentRefs(refs),
      oppositeRefs,
    );
    const oppositeRealization = reverseIsExact
      ? {
          type: "reverseOf",
          alignmentKey: explicitKey,
          referencedMappingDigest: explicitPublished.mappingDigest,
        }
      : { type: "explicit", edgeRefs: oppositeRefs };
    const oppositePublished = networkAuthoringReview({
      overlay: next,
      segment,
      alignmentKey: oppositeKey,
      realization: oppositeRealization,
      refs: oppositeRefs,
      intent: "migration-safe",
      revision: revision || `refresh-${Date.now()}`,
      context,
      roundaboutRepair,
    });
    segment.alignments[explicitKey] = { published: explicitPublished, draft: null };
    segment.alignments[oppositeKey] = { published: oppositePublished, draft: null };
    segment.migration = {
      ...(segment.migration || {}),
      automaticPublication: roundaboutRepair
        ? "roundabout-reverse"
        : "bidirectional-evidence",
      lastOutcome: "apply",
      lastOutcomeCode: decision.code,
    };
    applied.push({
      segmentId: segment.segmentId,
      alignmentKeys: [explicitKey, oppositeKey],
      basis: automaticAcceptanceBasis({ intent: "migration-safe", roundaboutRepair }),
    });
  }
  return { overlay: parseCwOverlayV2(next), applied, skipped };
}

async function validatePublishedDirectionReviewOverlay(overlay) {
  const context = await readDirectionReviewGraphContext();
  const owners = directionReviewDirectedOwners(overlay);
  const seenDirectedIntervals = new Map();
  for (const segment of Object.values(overlay.segments || {})) {
    for (const alignmentKey of ["aToB", "bToA"]) {
      const published = segment.alignments?.[alignmentKey]?.published;
      if (published?.disposition !== "accepted") continue;
      const refs = materializeAcceptedAlignment(segment, alignmentKey);
      if (!Array.isArray(refs) || refs.length === 0) {
        throw new Error(`Published ${segment.segmentId} ${alignmentKey} cannot be materialized`);
      }
      for (const ref of refs) {
        const key = directedIntervalKey(ref);
        const previous = seenDirectedIntervals.get(key);
        if (
          previous &&
          (previous.segmentId !== segment.segmentId || previous.alignmentKey !== alignmentKey)
        ) {
          throw new Error(
            `Published directed interval ${key} is owned by both ${previous.segmentId} ${previous.alignmentKey} and ${segment.segmentId} ${alignmentKey}`,
          );
        }
        seenDirectedIntervals.set(key, { segmentId: segment.segmentId, alignmentKey });
      }
      const validation = validateDirectionReviewRefsWithContext(
        overlay,
        segment,
        alignmentKey,
        refs,
        context,
        owners,
      );
      if (!validation.ok) {
        const reason = validation.reasons[0];
        throw new Error(
          `Published ${segment.segmentId} ${alignmentKey} is invalid: ${reason?.reason || reason?.code || "review required"}`,
        );
      }
    }
  }
}

async function rebaseDirectionReviewState(proposalOverlay, stagedOverlay) {
  const next = structuredClone(proposalOverlay);
  const context = await readDirectionReviewGraphContext();
  const owners = directionReviewDirectedOwners(proposalOverlay);
  const preserved = {
    unavailable: 0,
    published: 0,
    evidenceBackfilled: 0,
    publishedAsDraft: 0,
    drafts: 0,
    rebasedSourceChanges: 0,
    skippedSourceChanges: 0,
    adoptedAuthoringRevisions: 0,
  };

  for (const segment of Object.values(next.segments || {})) {
    const previous = stagedOverlay?.segments?.[String(segment.segmentId)];
    if (!previous) continue;
    if (shouldAdoptAuthoringRevisionSegment(segment, previous)) {
      preserved.adoptedAuthoringRevisions += 1;
      continue;
    }
    const automaticProposal = ["aToB", "bToA"].every(
      (alignmentKey) =>
        segment.alignments?.[alignmentKey]?.published?.review?.acceptanceBasis ===
        "automatic-bidirectional-authoring",
    );
    const automaticProposalMatchesPrevious = automaticProposal && ["aToB", "bToA"].every(
      (alignmentKey) => {
        const proposalRecord = segment.alignments?.[alignmentKey]?.published;
        const previousSlot = previous.alignments?.[alignmentKey];
        const previousRecord = previousSlot?.published || previousSlot?.draft;
        const proposalRefs = directionReviewRecordRefs(segment, alignmentKey, proposalRecord);
        const previousRefs = directionReviewRecordRefs(previous, alignmentKey, previousRecord);
        if (proposalRefs.length === 0 || previousRefs.length === 0) return false;
        return alignmentMappingDigest(
          segment.segmentId,
          alignmentKey,
          { type: "explicit", edgeRefs: proposalRefs },
        ) === alignmentMappingDigest(
          segment.segmentId,
          alignmentKey,
          { type: "explicit", edgeRefs: previousRefs },
        );
      },
    );
    if (automaticProposalMatchesPrevious) continue;
    const sourceGeometryChanged = previous.sourceGeometryDigest !== segment.sourceGeometryDigest;
    let preservedSourceChangedRecord = false;
    for (const alignmentKey of ["aToB", "bToA"]) {
      const previousSlot = previous.alignments?.[alignmentKey];
      const nextSlot = segment.alignments[alignmentKey];
      if (previousSlot?.published?.disposition === "unavailable") {
        if (sourceGeometryChanged) continue;
        nextSlot.published = structuredClone(previousSlot.published);
        nextSlot.draft = null;
        preserved.unavailable += 1;
        continue;
      }

      const previousRecord = previousSlot?.published?.disposition === "accepted"
        ? previousSlot.published
        : previousSlot?.draft;
      if (!previousRecord) continue;
      const refs = directionReviewRecordRefs(previous, alignmentKey, previousRecord);
      if (refs.length === 0) continue;
      if (sourceGeometryChanged) preservedSourceChangedRecord = true;
      const validation = validateDirectionReviewRefsWithContext(
        next,
        segment,
        alignmentKey,
        refs,
        context,
        owners,
      );
      const evidenceDigest = directionReviewEvidenceDigest(refs, context);
      const previousReview = previousSlot?.published?.review ||
        previousSlot?.draft?.candidate?.previousReview;
      const wasPreviouslyAccepted =
        previousSlot?.published?.disposition === "accepted" || Boolean(previousReview);
      if (wasPreviouslyAccepted && !sourceGeometryChanged) {
        const previousEvidenceDigest = previousReview?.evidenceDigest;
        if (
          validation.ok &&
          (!previousEvidenceDigest || previousEvidenceDigest === evidenceDigest)
        ) {
          const realization = previousSlot?.published?.realization
            ? structuredClone(previousSlot.published.realization)
            : { type: "explicit", edgeRefs: normalizeAlignmentEdgeRefs(refs) };
          const mappingDigest = alignmentMappingDigest(
            segment.segmentId,
            alignmentKey,
            realization,
          );
          nextSlot.published = {
            disposition: "accepted",
            realization,
            mappingDigest,
            review: structuredClone(previousReview),
          };
          nextSlot.published.review = {
            ...nextSlot.published.review,
            graphDigest: next.graphDigest,
            policyDigest: next.policyDigest,
            sourceGeometryDigest: segment.sourceGeometryDigest,
            mappingDigest,
            evidenceDigest,
            ...(previousRecord.review?.graphDigest !== next.graphDigest
              ? { revalidatedFromGraphDigest: previousRecord.review?.graphDigest }
              : {}),
          };
          nextSlot.draft = null;
          preserved.published += 1;
          if (!previousEvidenceDigest) preserved.evidenceBackfilled += 1;
          continue;
        }
      }
      const proposalRecord = nextSlot.draft;
      const proposalRefs = directionReviewRecordRefs(segment, alignmentKey, proposalRecord);
      const proposalMatches =
        proposalRefs.length > 0 &&
        alignmentMappingDigest(
          segment.segmentId,
          alignmentKey,
          { type: "explicit", edgeRefs: proposalRefs },
        ) === alignmentMappingDigest(
          segment.segmentId,
          alignmentKey,
          { type: "explicit", edgeRefs: refs },
        );
      nextSlot.published = null;
      nextSlot.draft = {
        disposition: "needs_review",
        realization: { type: "explicit", edgeRefs: normalizeAlignmentEdgeRefs(refs) },
        mappingDigest: undefined,
        candidate: proposalMatches && proposalRecord?.candidate
          ? structuredClone(proposalRecord.candidate)
          : {
              kind: previousSlot.published?.disposition === "accepted"
                ? "previously-published"
                : "previous-draft",
              previousCandidateKind: previousSlot.draft?.candidate?.kind,
              sourceGeometryChanged,
              previousReview: previousSlot.published?.review
                ? structuredClone(previousSlot.published.review)
                : undefined,
            },
        validation,
      };
      nextSlot.draft.mappingDigest = alignmentMappingDigest(
        segment.segmentId,
        alignmentKey,
        nextSlot.draft.realization,
      );
      if (previousSlot.published?.disposition === "accepted") preserved.publishedAsDraft += 1;
      else preserved.drafts += 1;
    }
    if (sourceGeometryChanged) {
      if (preservedSourceChangedRecord) preserved.rebasedSourceChanges += 1;
      else preserved.skippedSourceChanges += 1;
    }
  }
  return { overlay: parseCwOverlayV2(next), preserved };
}

async function backfillCurrentDirectionReviewEvidence(overlay) {
  if (!overlay) return null;
  const next = structuredClone(overlay);
  const context = await readDirectionReviewGraphContext();
  if (
    context.graphDigest !== next.graphDigest ||
    context.policyDigest !== next.policyDigest
  ) {
    return next;
  }
  for (const segment of Object.values(next.segments || {})) {
    for (const alignmentKey of ["aToB", "bToA"]) {
      const published = segment.alignments?.[alignmentKey]?.published;
      if (published?.disposition !== "accepted" || published.review?.evidenceDigest) continue;
      const refs = directionReviewRecordRefs(segment, alignmentKey, published);
      if (refs.length === 0) continue;
      published.review.evidenceDigest = directionReviewEvidenceDigest(refs, context);
    }
  }
  return parseCwOverlayV2(next);
}

async function refreshDirectionReviewEvidence(payload = {}) {
  const refreshId = ++directionReviewRefreshCounter;
  const stagedBeforeRefreshValue = await readJsonFileOrNull(cwBaseOverlayV2StagedPath);
  const stagedBeforeRefresh = stagedBeforeRefreshValue
    ? await backfillCurrentDirectionReviewEvidence(parseCwOverlayV2(stagedBeforeRefreshValue))
    : null;
  await ensureCurrentBaseTopologyArtifacts(`direction-review-${refreshId}`);
  await runBuildDependencyStep(
    `direction-review-${refreshId}`,
    "bicycle traversal policy audit",
    "python3",
    [
      "processing/bicycle_traversal_policy.py",
      "--graph",
      "build/osm/osm-base-graph.json",
      "--output",
      "build/bicycle-traversal-policy-audit.json",
      "--overlay",
      "data/routing-compat/cw-base-overlay-v1.json",
      "--cw-index",
      "data/routing-compat/cw-base-index-v1.json",
    ],
  );
  await runBuildDependencyStep(
    `direction-review-${refreshId}`,
    "CW Overlay V2 migration proposal",
    "node",
    [
      "scripts/migrate-cw-base-overlay-v2.mjs",
      "--graph",
      "build/osm/osm-base-graph.json",
    ],
  );
  directionReviewGraphCache = null;
  const proposalValue = await readJsonFileOrNull(cwBaseOverlayV2ProposalPath);
  const proposalOverlay = proposalValue ? parseCwOverlayV2(proposalValue) : null;
  if (!proposalOverlay) throw new Error("Direction Review proposal was not produced");
  const rebased = stagedBeforeRefresh
    ? await rebaseDirectionReviewState(proposalOverlay, stagedBeforeRefresh)
    : {
        overlay: proposalOverlay,
        preserved: {
          unavailable: 0,
          publishedAsDraft: 0,
          drafts: 0,
          skippedSourceChanges: 0,
          adoptedAuthoringRevisions: 0,
        },
      };
  const automatic = await autoApplySafeDirectionReviewDrafts(rebased.overlay, {
    revision: refreshId,
  });
  rebased.overlay = automatic.overlay;
  rebased.preserved.automaticallyPublished = automatic.applied.length;
  await validatePublishedDirectionReviewOverlay(rebased.overlay);
  await writeJsonAtomic(cwBaseOverlayV2StagedPath, rebased.overlay);
  const graphPatch = payload?.presentation === "incremental"
    ? await readBaseGraphEditorPatch({
        replaceSources: ["manual"],
        osmWayIds: payload?.changedOsmWayIds,
      })
    : null;
  return { refreshId, ...rebased, automatic, graphPatch };
}

async function applyDirectionReviewAlignmentAction(payload) {
  const overlay = parseCwOverlayV2(
    JSON.parse(await readFile(cwBaseOverlayV2StagedPath, "utf-8")),
  );
  const segmentId = Number(payload?.segmentId);
  const alignmentKey = payload?.alignmentKey;
  const segment = overlay.segments?.[String(segmentId)];
  if (!segment || !["aToB", "bToA"].includes(alignmentKey)) {
    throw new Error("Direction Review action requires a valid segmentId and alignmentKey");
  }

  let next = overlay;
  let validation = null;
  switch (payload.action) {
    case "save-draft": {
      const refs = normalizeAlignmentEdgeRefs(payload.edgeRefs || []);
      validation = await validateDirectionReviewRefs(overlay, segment, alignmentKey, refs);
      next = setAlignmentDraft(overlay, segmentId, alignmentKey, {
        realization: refs.length > 0 ? { type: "explicit", edgeRefs: refs } : null,
        validation,
        candidate: { kind: "manual-editor" },
      });
      break;
    }
    case "revalidate": {
      const slot = segment.alignments[alignmentKey];
      const refs = directionReviewRecordRefs(segment, alignmentKey, slot.draft);
      validation = await validateDirectionReviewRefs(overlay, segment, alignmentKey, refs);
      next = setAlignmentDraft(overlay, segmentId, alignmentKey, {
        realization: slot.draft?.realization || (refs.length > 0 ? { type: "explicit", edgeRefs: refs } : null),
        validation,
        candidate: slot.draft?.candidate || { kind: "manual-editor" },
      });
      break;
    }
    case "derive-reverse": {
      const targetKey = oppositeAlignmentKey(alignmentKey);
      const target = segment.alignments[targetKey]?.published;
      const refs = target?.realization?.type === "explicit"
        ? reverseAlignmentRefs(target.realization.edgeRefs)
        : [];
      validation = await validateDirectionReviewRefs(overlay, segment, alignmentKey, refs);
      next = deriveReverseAlignmentDraft(overlay, segmentId, alignmentKey, validation);
      break;
    }
    case "accept": {
      let working = overlay;
      let workingSegment = segment;
      let draft = workingSegment.alignments[alignmentKey].draft;
      if (!draft?.realization && draft?.candidate?.kind === "exact-reverse") {
        const targetKey = oppositeAlignmentKey(alignmentKey);
        const target = workingSegment.alignments[targetKey]?.published;
        const refs = target?.realization?.type === "explicit"
          ? reverseAlignmentRefs(target.realization.edgeRefs)
          : [];
        validation = await validateDirectionReviewRefs(working, workingSegment, alignmentKey, refs);
        working = deriveReverseAlignmentDraft(working, segmentId, alignmentKey, validation);
        workingSegment = working.segments[String(segmentId)];
        draft = workingSegment.alignments[alignmentKey].draft;
      }
      const refs = directionReviewRecordRefs(workingSegment, alignmentKey, draft);
      validation = await validateDirectionReviewRefs(working, workingSegment, alignmentKey, refs);
      working = setAlignmentDraft(working, segmentId, alignmentKey, {
        realization: draft?.realization || null,
        validation,
        candidate: draft?.candidate || { kind: "manual-editor" },
      });
      if (!validation.ok) {
        const reason = validation.reasons[0];
        throw new Error(`Alignment is not valid: ${reason?.reason || reason?.code || "review required"}`);
      }
      const context = await readDirectionReviewGraphContext();
      next = acceptAlignmentDraft(working, segmentId, alignmentKey, {
        ...payload,
        evidenceDigest: directionReviewEvidenceDigest(refs, context),
      });
      break;
    }
    case "unavailable":
      next = publishAlignmentUnavailable(overlay, segmentId, alignmentKey, payload);
      break;
    case "clear-draft":
      next = clearAlignmentDraft(overlay, segmentId, alignmentKey);
      break;
    default:
      throw new Error(`Unknown Direction Review action: ${payload?.action || "missing"}`);
  }
  return { overlay: parseCwOverlayV2(next), validation };
}

async function readDirectionReviewWorkspace() {
  const workspace = await readJsonFileOrNull(cwSegmentWorkspacePath);
  return normalizeDirectionReviewWorkspace(
    workspace || { schemaVersion: 1, nextReservedSegmentId: 1, entries: {} },
  );
}

async function readDirectionReviewPendingApprovals() {
  const value = await readJsonFileOrNull(directionReviewPendingApprovalsPath);
  return normalizeDirectionReviewPendingApprovals(
    value || emptyDirectionReviewPendingApprovals(),
  );
}

async function queueManualBidirectionalDirectionReview(payload) {
  requireStagedV2Profile();
  const overlay = parseCwOverlayV2(
    JSON.parse(await readFile(cwBaseOverlayV2StagedPath, "utf-8")),
  );
  const segmentId = Number(payload?.segmentId);
  const segment = overlay.segments?.[String(segmentId)];
  if (!segment) throw new Error(`Direction Review segment ${segmentId} does not exist`);
  const approval = manualBidirectionalResolutionCandidate(segment);
  if (!approval.eligible) {
    throw new Error("This segment has blockers beyond unknown manual-edge direction evidence");
  }
  const reviewer = String(payload?.reviewer || "").trim();
  const reviewedAt = String(payload?.reviewedAt || "").trim();
  const batchId = String(payload?.batchId || "").trim();
  if (!reviewer || !reviewedAt || !batchId) {
    throw new Error("Queued Direction Review requires reviewer, reviewedAt, and batchId");
  }
  const now = new Date().toISOString();
  const rationale =
    `Reviewer confirmed CycleWays segment #${segmentId} (${segment.segmentName}) and its referenced manual edges are rideable in both directions.`;
  const previousManualBaseEdges = normalizeManualBaseEdges(await readManualBaseEdges());
  const applied = applyManualBidirectionalReview(
    previousManualBaseEdges,
    {
      edgeIds: approval.edgeIds,
      reviewer,
      reviewedAt,
      rationale,
      evidence: `Direction Review segment #${segmentId}; batch ${batchId}`,
      updatedAt: now,
    },
  );
  const manualBaseEdges = normalizeManualBaseEdges(applied.manualBaseEdges);
  const queue = queueDirectionReviewPendingApproval(
    await readDirectionReviewPendingApprovals(),
    {
      segmentId,
      segmentName: segment.segmentName,
      sourceGeometryDigest: segment.sourceGeometryDigest,
      edgeIds: approval.edgeIds,
      alignmentMappingDigests: Object.fromEntries(
        ["aToB", "bToA"].flatMap((alignmentKey) => {
          const slot = segment.alignments?.[alignmentKey];
          const digest = slot?.draft?.mappingDigest || slot?.published?.mappingDigest;
          return digest ? [[alignmentKey, digest]] : [];
        }),
      ),
      reviewer,
      reviewedAt,
      batchId,
      queuedAt: now,
    },
  );
  await writeJsonAtomic(manualBaseEdgesPath, manualBaseEdges);
  try {
    await writeJsonAtomic(directionReviewPendingApprovalsPath, queue);
  } catch (error) {
    await writeJsonAtomic(manualBaseEdgesPath, previousManualBaseEdges);
    throw error;
  }
  directionReviewGraphCache = null;
  return { queue, manualBaseEdges, item: queue.items[String(segmentId)] };
}

async function finalizeManualBidirectionalDirectionReviews(payload = {}) {
  requireStagedV2Profile();
  const queueBefore = await readDirectionReviewPendingApprovals();
  const items = Object.values(queueBefore.items);
  if (items.length === 0) throw new Error("No manual direction reviews are queued");
  const refresh = await refreshDirectionReviewEvidence(payload);
  const completedSegmentIds = [];
  const failures = [];
  for (const item of items) {
    try {
      let overlay = parseCwOverlayV2(
        JSON.parse(await readFile(cwBaseOverlayV2StagedPath, "utf-8")),
      );
      let segment = overlay.segments?.[String(item.segmentId)];
      if (!segment) throw new Error("Segment disappeared during evidence refresh");
      if (segment.sourceGeometryDigest !== item.sourceGeometryDigest) {
        throw new Error("Segment geometry changed after it was queued; review it again");
      }
      for (const [alignmentKey, mappingDigest] of Object.entries(item.alignmentMappingDigests || {})) {
        const slot = segment.alignments?.[alignmentKey];
        const currentDigest = slot?.draft?.mappingDigest || slot?.published?.mappingDigest;
        if (currentDigest !== mappingDigest) {
          throw new Error(`${alignmentKey} mapping changed after it was queued; review it again`);
        }
      }
      const acceptanceOrder = ["aToB", "bToA"].sort((left, right) => {
        const leftExplicit = segment.alignments?.[left]?.draft?.realization?.type === "explicit" ? 0 : 1;
        const rightExplicit = segment.alignments?.[right]?.draft?.realization?.type === "explicit" ? 0 : 1;
        return leftExplicit - rightExplicit;
      });
      for (const alignmentKey of acceptanceOrder) {
        overlay = parseCwOverlayV2(
          JSON.parse(await readFile(cwBaseOverlayV2StagedPath, "utf-8")),
        );
        segment = overlay.segments?.[String(item.segmentId)];
        if (segment?.alignments?.[alignmentKey]?.published?.disposition === "accepted") continue;
        const result = await applyDirectionReviewAlignmentAction({
          segmentId: item.segmentId,
          alignmentKey,
          action: "accept",
          reviewer: item.reviewer,
          reviewedAt: item.reviewedAt,
          batchId: item.batchId,
        });
        await writeJsonAtomic(cwBaseOverlayV2StagedPath, result.overlay);
      }
      overlay = parseCwOverlayV2(
        JSON.parse(await readFile(cwBaseOverlayV2StagedPath, "utf-8")),
      );
      segment = overlay.segments?.[String(item.segmentId)];
      if (!["aToB", "bToA"].every(
        (alignmentKey) => segment?.alignments?.[alignmentKey]?.published?.disposition === "accepted",
      )) {
        throw new Error("Both directions were not accepted");
      }
      completedSegmentIds.push(item.segmentId);
    } catch (error) {
      failures.push({
        segmentId: item.segmentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const attemptedAt = new Date().toISOString();
  const queue = settleDirectionReviewPendingApprovals(queueBefore, {
    completedSegmentIds,
    failures,
    attemptedAt,
  });
  await writeJsonAtomic(directionReviewPendingApprovalsPath, queue);
  const overlay = parseCwOverlayV2(
    JSON.parse(await readFile(cwBaseOverlayV2StagedPath, "utf-8")),
  );
  return {
    queue,
    overlay,
    completedSegmentIds,
    failures,
    refreshId: refresh.refreshId,
    preserved: refresh.preserved,
  };
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
    const traversal = properties.bicycleTraversal;
    if (traversal === undefined || traversal === null) {
      properties.bicycleTraversal = {
        forward: "unknown",
        reverse: "unknown",
        reviewed: false,
      };
    } else {
      if (!traversal || typeof traversal !== "object" || Array.isArray(traversal)) {
        throw new Error(`Manual base edge ${manualEdgeId} has invalid bicycleTraversal`);
      }
      const states = new Set(["allowed", "prohibited", "conditional", "unknown"]);
      if (!states.has(traversal.forward) || !states.has(traversal.reverse)) {
        throw new Error(
          `Manual base edge ${manualEdgeId} bicycleTraversal must define forward and reverse states`,
        );
      }
      const forwardUnknown = traversal.forward === "unknown";
      const reverseUnknown = traversal.reverse === "unknown";
      if (forwardUnknown !== reverseUnknown) {
        throw new Error(
          `Manual base edge ${manualEdgeId} must review both bicycleTraversal directions together`,
        );
      }
      if (!forwardUnknown && traversal.reviewed !== true) {
        throw new Error(
          `Manual base edge ${manualEdgeId} reviewed traversal states require reviewed=true`,
        );
      }
      if (!forwardUnknown) {
        for (const field of ["reviewer", "reviewedAt", "rationale"]) {
          if (typeof traversal[field] !== "string" || traversal[field].trim() === "") {
            throw new Error(
              `Manual base edge ${manualEdgeId} reviewed traversal states require ${field}`,
            );
          }
          traversal[field] = traversal[field].trim();
        }
      } else {
        traversal.reviewed = false;
      }
    }

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
  // The Video Sync editor reuses a few production featured helpers directly
  // from src/, so serve only that small allowlist read-only.
  const allowedFeaturedEditorModule = featuredEditorModulePaths.has(filePath);
  // The editor loads shared core ES modules directly from source (e.g.
  // data/poiTypes.js, map/emojiMarkerImage.js), so serve the read-only
  // packages/core/src tree.
  const allowedCoreFile = isInside(coreSrcRoot, filePath);
  // POI image previews: uploads live under public-data/poi-images and seed
  // placeholders under public/images. Serve those read-only so the editor's
  // image thumbnails resolve.
  const allowedImageFile =
    isInside(poiImagesDir, filePath) ||
    isInside(routeMapImagesDir, filePath) ||
    isInside(imagesDir, filePath);
  if (
    !allowedEditorFile &&
    !allowedIconFile &&
    !allowedTokenFile &&
    !allowedPoiTypesFile &&
    !allowedFeaturedEditorModule &&
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

async function baseGraphInputFileSnapshot(key, pathname) {
  try {
    const contents = await readFile(pathname);
    return {
      key,
      path: repoRelative(pathname),
      exists: true,
      bytes: contents.length,
      digest: `sha256:${createHash("sha256").update(contents).digest("hex")}`,
    };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      key,
      path: repoRelative(pathname),
      exists: false,
      bytes: 0,
      digest: null,
    };
  }
}

async function currentBaseGraphBuildInputs() {
  const files = {};
  await Promise.all(
    BASE_GRAPH_INPUTS.map(async ({ key }) => {
      const pathname = baseGraphInputPathByKey.get(key);
      files[key] = await baseGraphInputFileSnapshot(key, pathname);
    }),
  );
  return { schemaVersion: 1, files };
}

async function inspectBaseGraphFreshness() {
  const graphStat = await statOrNull(osmBaseGraphPath);
  if (!graphStat) {
    return {
      fresh: false,
      comparable: false,
      reason: "missing base graph",
      mismatches: [],
    };
  }

  const [summary, currentInputs] = await Promise.all([
    readJsonFileOrNull(osmBaseGraphSummaryPath),
    currentBaseGraphBuildInputs(),
  ]);
  const comparison = compareBaseGraphBuildInputs(summary?.buildInputs, currentInputs);
  if (comparison.comparable) {
    return {
      ...comparison,
      reason: baseGraphFreshnessReason(comparison),
    };
  }

  // One-time compatibility path for graph artifacts produced before exact
  // input digests were embedded. Rebuild whenever timestamps say they are old.
  const inputStats = await Promise.all(
    BASE_GRAPH_INPUTS.map(async ({ key, label }) => ({
      key,
      label,
      stat: await statOrNull(baseGraphInputPathByKey.get(key)),
    })),
  );
  const staleInputs = inputStats.filter((input) => isStaleAgainst(graphStat, input.stat));
  return {
    comparable: false,
    fresh: staleInputs.length === 0 && Boolean(summary),
    mismatches: staleInputs,
    reason: staleInputs.length > 0
      ? `stale relative to ${staleInputs.map((input) => input.label).join(", ")}`
      : "legacy graph without input digests",
  };
}

async function readRoundaboutReviewState() {
  let candidates;
  try {
    candidates = JSON.parse(await readFile(roundaboutCandidatesPath, "utf-8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      const missing = new Error("Roundabout candidates are missing. Run npm run osm:roundabouts.");
      missing.status = 409;
      throw missing;
    }
    throw error;
  }
  let reviews;
  try {
    reviews = JSON.parse(await readFile(roundaboutReviewPath, "utf-8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    reviews = { schemaVersion: 1, reviews: {} };
  }
  let sourceFresh = false;
  try {
    const [responseDigest, queryDigest] = await Promise.all([
      fileDigest(overpassResponsePath),
      fileDigest(overpassQueryPath),
    ]);
    sourceFresh = candidates.sourceDigest === `sha256:${responseDigest}`
      && candidates.queryDigest === `sha256:${queryDigest}`;
  } catch {
    sourceFresh = false;
  }
  const joined = joinRoundaboutReviews(candidates, reviews);
  return {
    candidates,
    reviews,
    joined,
    sourceFresh,
    geojson: roundaboutReviewGeoJson(joined),
  };
}

async function readNetworkJunctionState() {
  let candidates;
  try {
    candidates = JSON.parse(await readFile(networkJunctionCandidatesPath, "utf-8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      const missing = new Error("Junction candidates are missing. Run npm run network:junctions.");
      missing.status = 409;
      throw missing;
    }
    throw error;
  }
  let reviews = { schemaVersion: 1, reviews: {} };
  try {
    reviews = JSON.parse(await readFile(networkJunctionReviewPath, "utf-8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  let registry = { schemaVersion: 1, junctions: {} };
  try {
    registry = normalizeNetworkJunctionRegistry(
      JSON.parse(await readFile(networkJunctionRegistryPath, "utf-8")),
    );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const [graph, overlayValue] = await Promise.all([
    readFile(osmBaseGraphPath, "utf-8").then(JSON.parse),
    readJsonFileOrNull(cwBaseOverlayV2StagedPath),
  ]);
  if (overlayValue) {
    candidates = mergeNetworkJunctionRegistry(candidates, graph, overlayValue, registry);
    candidates = refreshNetworkJunctionArmAssociations(candidates, overlayValue, graph);
  }
  const joined = joinNetworkJunctionReviews(candidates, reviews);
  return {
    candidates,
    reviews,
    registry,
    graph,
    overlay: overlayValue,
    joined,
    geojson: networkJunctionGeoJson(joined, graph),
  };
}

async function readCrossingReviewState() {
  let candidates;
  try {
    candidates = JSON.parse(await readFile(crossingCandidatesPath, "utf-8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      const missing = new Error("Crossing candidates are missing. Run npm run crossings:candidates.");
      missing.status = 409;
      throw missing;
    }
    throw error;
  }
  let reviews;
  try {
    reviews = JSON.parse(await readFile(crossingReviewPath, "utf-8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    reviews = { schemaVersion: 1, reviews: {}, manualCrossings: [] };
  }
  let sourceFresh = false;
  try {
    const [graphDigest, registryDigest, graphText] = await Promise.all([
      fileDigest(osmElevatedBaseGraphPath),
      fileDigest(baseEdgeShareRegistryPath),
      readFile(osmElevatedBaseGraphPath, "utf-8"),
    ]);
    const graphPolicyDigest = JSON.parse(graphText)?.metadata?.bicycleTraversalShadowPolicyDigest;
    sourceFresh = candidates.sourceGraphDigest === `sha256:${graphDigest}`
      && candidates.edgeShareRegistryDigest === `sha256:${registryDigest}`
      && candidates.traversalPolicyDigest === graphPolicyDigest;
  } catch {
    sourceFresh = false;
  }
  const joined = joinCrossingReviews(candidates, reviews);
  return {
    candidates,
    reviews,
    joined,
    sourceFresh,
    geojson: crossingReviewGeoJson(joined),
  };
}

function crossingReviewResponse(state) {
  return {
    ok: true,
    sourceFresh: state.sourceFresh,
    coverage: state.joined.coverage,
    summary: state.joined.summary,
    warnings: state.joined.warnings,
    blockingIssues: state.joined.blockingIssues,
    items: state.joined.items,
    manualItems: state.joined.manualItems,
    orphaned: state.joined.orphaned,
    geojson: state.geojson,
  };
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

async function ensureCurrentBaseTopologyArtifacts(buildId) {
  const maxAttempts = 3;
  let freshness = await inspectBaseGraphFreshness();
  if (freshness.fresh) return { rebuilt: false, freshness };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    log("info", `build#${buildId} refreshing base topology`, {
      reason: freshness.reason,
      attempt,
      maxAttempts,
    });
    await runBuildDependencyStep(buildId, "base topology refresh", "npm", ["run", "osm:topology"]);
    directionReviewGraphCache = null;
    freshness = await inspectBaseGraphFreshness();
    if (freshness.fresh) return { rebuilt: true, freshness, attempts: attempt };
    log("warn", `build#${buildId} base inputs changed while topology was rebuilding`, {
      reason: freshness.reason,
      attempt,
      maxAttempts,
    });
  }

  const error = new Error(
    `Base-network inputs kept changing while topology was rebuilding: ${freshness.reason}`,
  );
  error.status = 409;
  error.code = "BASE_EVIDENCE_SUPERSEDED";
  throw error;
}

async function ensureCurrentBaseRoutingArtifacts(buildId, payload) {
  await ensureCurrentBaseTopologyArtifacts(buildId);
  const graphStat = await statOrNull(osmBaseGraphPath);
  if (!graphStat) {
    throw new Error("Base topology refresh did not produce build/osm/osm-base-graph.json.");
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
  const stagedAuthoring = process.env.CW_OVERLAY_PROFILE === "staged-v2";
  let canonicalOverlaySchemaVersion = 1;
  try {
    canonicalOverlaySchemaVersion = Number(
      JSON.parse(await readFile(cwBaseOverlayPath, "utf-8")).schemaVersion || 1,
    );
  } catch {}
  const routingProfile = stagedAuthoring || canonicalOverlaySchemaVersion === 2
    ? "staged-v2"
    : "production-v1";
  const overlayPath = stagedAuthoring
    ? "data/cw-base-overlay.v2.staged.json"
    : "data/cw-base-overlay.json";
  const args = [
    "processing/build_map.py",
    "--input-geojson",
    "data/map-source.geojson",
    "--out-dir",
    "build",
    "--routing-profile",
    routingProfile,
    "--cw-base-overlay",
    overlayPath,
    "--verbose",
  ];

  if (payload.elevationUrl) {
    args.push("--elevation-url", String(payload.elevationUrl));
  }

  log("info", `build#${buildId} started`, {
    mode: "full-elevation",
    routingProfile,
    command: `python3 ${args.join(" ")}`,
  });

  await ensureCurrentBaseRoutingArtifacts(buildId, payload);
  await runBuildDependencyStep(buildId, "network junction refresh", "npm", ["run", "network:junctions"]);

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

function authoringRequestAbortedError() {
  const error = new Error("Obsolete authoring request cancelled");
  error.status = 499;
  error.code = "AUTHORING_REQUEST_ABORTED";
  return error;
}

async function handleOsmSegmentRecalculate(payload, { signal } = {}) {
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

  try {
    if (signal?.aborted) throw authoringRequestAbortedError();

    log("info", `osm-segment#${graphId} started`, {
      segmentId,
      command: `python3 ${args.join(" ")}`,
    });

    const result = await new Promise((resolvePromise, rejectPromise) => {
      const child = spawn("python3", args, {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      let cancelling = false;
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

      const cleanup = () => {
        clearInterval(heartbeat);
        signal?.removeEventListener("abort", abortChild);
      };
      const rejectOnce = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        rejectPromise(error);
      };
      const resolveOnce = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolvePromise(value);
      };
      const abortChild = () => {
        if (cancelling) return;
        cancelling = true;
        log("info", `osm-segment#${graphId} cancelling obsolete match`, { segmentId });
        child.kill("SIGTERM");
      };
      signal?.addEventListener("abort", abortChild, { once: true });
      if (signal?.aborted) abortChild();

      child.stdout.on("data", (chunk) => {
        stdoutLogger.write(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderrLogger.write(chunk);
      });
      child.on("error", (error) => {
        stdoutLogger.flush();
        stderrLogger.flush();
        log("error", `osm-segment#${graphId} failed to start`, error.message);
        rejectOnce(error);
      });
      child.on("close", (code) => {
        stdoutLogger.flush();
        stderrLogger.flush();
        const durationSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
        if (signal?.aborted) {
          log("info", `osm-segment#${graphId} cancelled`, { segmentId, durationSeconds });
          rejectOnce(authoringRequestAbortedError());
          return;
        }
        if (code !== 0) {
          log("error", `osm-segment#${graphId} failed`, {
            segmentId,
            exitCode: code,
            durationSeconds,
          });
          rejectOnce(new Error(stderr || stdout || `Segment recalculation failed with exit code ${code}`));
          return;
        }
        log("info", `osm-segment#${graphId} finished`, {
          segmentId,
          durationSeconds,
        });
        resolveOnce({ graphId, segmentId, stdout, stderr, durationSeconds });
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
  const roundabouts = validation.roundabouts || {};
  if ((roundabouts.blockingIssues || []).length > 0) {
    blockers.push(`${roundabouts.blockingIssues.length} roundabout review blockers`);
  }
  const crossings = validation.crossings || {};
  if ((crossings.blockingIssues || []).length > 0) {
    blockers.push(`${crossings.blockingIssues.length} crossing review blockers`);
  }
  const junctions = validation.networkJunctions || {};
  if ((junctions.blockingIssues || []).length > 0) {
    blockers.push(`${junctions.blockingIssues.length} network junction blockers`);
  }

  return blockers;
}

function cwSegmentIdsByEdgeIdFromOverlay(overlay) {
  const byEdgeId = new Map();
  const segments = overlay?.segments && typeof overlay.segments === "object"
    ? overlay.segments
    : {};
  for (const [segmentIdKey, mapping] of Object.entries(segments)) {
    const segmentId = Number(mapping?.segmentId ?? segmentIdKey);
    if (!Number.isFinite(segmentId)) continue;
    const edgeRefs = Array.isArray(mapping?.edgeRefs) ? mapping.edgeRefs : [];
    for (const ref of edgeRefs) {
      const edgeId = String(ref?.edgeId || ref?.manualEdgeId || "");
      if (!edgeId) continue;
      if (!byEdgeId.has(edgeId)) byEdgeId.set(edgeId, new Set());
      byEdgeId.get(edgeId).add(segmentId);
    }
  }
  return byEdgeId;
}

function annotateGraphEdgesWithCyclewaysMembership(graphEdges, overlay) {
  const byEdgeId = cwSegmentIdsByEdgeIdFromOverlay(overlay);
  if (byEdgeId.size === 0 || !Array.isArray(graphEdges?.features)) return graphEdges;
  return {
    ...graphEdges,
    features: graphEdges.features.map((feature) => {
      const props = feature?.properties || {};
      const edgeId = String(props.edgeId || props.id || feature?.id || "");
      const ids = edgeId ? byEdgeId.get(edgeId) : null;
      if (!ids || ids.size === 0) return feature;
      const cwSegmentIds = [...ids].sort((a, b) => a - b);
      return {
        ...feature,
        properties: {
          ...props,
          cwSegmentIds,
          cwSegmentCount: cwSegmentIds.length,
        },
      };
    }),
  };
}

async function readBaseGraphEditorPatch({
  replaceSources = ["manual"],
  osmWayIds = [],
} = {}) {
  const sourceSet = new Set(replaceSources.map(String));
  const osmWayIdSet = new Set(
    (osmWayIds || []).map(Number).filter((value) => Number.isInteger(value)),
  );
  const graphEdges = JSON.parse(await readFile(osmGraphEdgesPath, "utf-8"));
  const directionContext = await readDirectionReviewGraphContext();
  let patch = {
    type: "FeatureCollection",
    replaceSources: [...sourceSet],
    metadata: {
      ...(graphEdges.metadata || {}),
      directionReviewGraphDigest: directionContext.graphDigest,
      directionReviewPolicyDigest: directionContext.policyDigest,
      directionReviewPolicyId: directionContext.policyId,
      graphStaleBecauseManualBaseEdgesChanged: false,
      graphStaleBecauseTraversalOverridesChanged: false,
      graphStaleBecauseTopologyInputsChanged: false,
      graphStaleInputs: [],
    },
    features: (graphEdges.features || [])
      .filter((feature) => {
        const properties = feature?.properties || {};
        return sourceSet.has(String(properties.source || "osm")) ||
          osmWayIdSet.has(Number(properties.osmWayId));
      })
      .map((feature) => {
        const properties = feature?.properties || {};
        const edgeId = String(properties.edgeId || properties.id || feature?.id || "");
        const evidence = directionContext.edgeLookup.get(edgeId);
        return evidence?.bicycleTraversal
          ? {
              ...feature,
              properties: {
                ...properties,
                bicycleTraversal: evidence.bicycleTraversal,
              },
            }
          : feature;
      }),
  };
  try {
    patch = annotateGraphEdgesWithCyclewaysMembership(
      patch,
      await readCwBaseOverlay(),
    );
  } catch (error) {
    log("warn", "base graph editor patch skipped CW annotation", error?.message || String(error));
  }
  return patch;
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

async function cleanupOldPublicArtifacts(promoteId, dryRun, manifest = {}) {
  const protectedPaths = new Set(
    [
      manifest.bikeRoads,
      manifest.segments,
      manifest.cwBaseIndex,
      manifest.cwAlignmentGeometry,
      manifest.kml,
      manifest.roundabouts,
      manifest.crossings,
      manifest.networkJunctions,
      manifest.routeCatalog,
      manifest.featuredRoutesBase,
      manifest.legacyRoutingCompatibility?.cwBaseIndex,
      manifest.legacyRoutingCompatibility?.metadata,
    ]
      .filter(Boolean)
      .map((entry) => resolveManifestPath(publicDataDir, entry)),
  );
  if (manifest.baseRoutingShards) {
    protectedPaths.add(dirname(resolveManifestPath(publicDataDir, manifest.baseRoutingShards)));
  }
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
    ...(await existingVersionedFiles(publicDataDir, /^cw-base-index\.[0-9a-f]{12}\.json$/)),
    ...(await existingVersionedFiles(publicDataDir, /^cw-alignment-geometry\.[0-9a-f]{12}\.json$/)),
    ...(await existingVersionedFiles(publicDataDir, /^base-routing-shards\.[0-9a-f]{12}$/)),
    ...(await existingVersionedFiles(publicDataDir, /^route-catalog\.[0-9a-f]{12}\.json$/)),
    ...(await existingVersionedFiles(publicDataDir, /^featured-routes\.[0-9a-f]{12}$/)),
    ...(await existingVersionedFiles(publicDataDir, /^base-routing-network\.json$/)),
    ...(await existingVersionedFiles(resolve(publicDataDir, "exports"), /^map\.[0-9a-f]{12}\.kml$/)),
    ...(!manifest.roundabouts
      ? await existingVersionedFiles(publicDataDir, /^roundabouts\.json$/)
      : []),
    ...(!manifest.crossings
      ? await existingVersionedFiles(publicDataDir, /^crossings(?:\.[0-9a-f]{12})?\.json$/)
      : []),
    ...(!manifest.networkJunctions
      ? await existingVersionedFiles(publicDataDir, /^network-junctions(?:\.[0-9a-f]{12})?\.json$/)
      : []),
  ].filter((filePath) => !protectedPaths.has(filePath));

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

export function buildPromoteTargets(manifest, {
  featuredRoutesSource = null,
  manifestSource = buildManifestPath,
} = {}) {
  const targets = [
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
  if (manifest.cwAlignmentGeometry) {
    targets.push({
      label: "public CW alignment geometry",
      source: resolveManifestPath(buildPublicDataDir, manifest.cwAlignmentGeometry),
      target: resolveManifestPath(publicDataDir, manifest.cwAlignmentGeometry),
    });
  }
  if (manifest.roundabouts) {
    targets.push({
      label: "public roundabouts",
      source: resolveManifestPath(buildPublicDataDir, manifest.roundabouts),
      target: resolveManifestPath(publicDataDir, manifest.roundabouts),
    });
  }
  if (manifest.crossings) {
    targets.push({
      label: "public crossings",
      source: resolveManifestPath(buildPublicDataDir, manifest.crossings),
      target: resolveManifestPath(publicDataDir, manifest.crossings),
    });
  }
  if (manifest.networkJunctions) {
    targets.push({
      label: "public network junctions",
      source: resolveManifestPath(buildPublicDataDir, manifest.networkJunctions),
      target: resolveManifestPath(publicDataDir, manifest.networkJunctions),
    });
  }
  if (manifest.legacyRoutingCompatibility?.cwBaseIndex) {
    targets.push({
      label: "legacy routing compatibility index",
      source: resolveManifestPath(
        buildPublicDataDir,
        manifest.legacyRoutingCompatibility.cwBaseIndex,
      ),
      target: resolveManifestPath(
        publicDataDir,
        manifest.legacyRoutingCompatibility.cwBaseIndex,
      ),
    });
  }
  if (manifest.legacyRoutingCompatibility?.metadata) {
    targets.push({
      label: "legacy routing compatibility metadata",
      source: resolveManifestPath(
        buildPublicDataDir,
        manifest.legacyRoutingCompatibility.metadata,
      ),
      target: resolveManifestPath(
        publicDataDir,
        manifest.legacyRoutingCompatibility.metadata,
      ),
    });
  }
  if (manifest.routeCatalog) {
    targets.push({
      label: "versioned route catalog",
      source: resolveManifestPath(buildPublicDataDir, manifest.routeCatalog),
      target: resolveManifestPath(publicDataDir, manifest.routeCatalog),
    });
  }
  if (manifest.featuredRoutesBase) {
    targets.push({
      kind: "directory",
      label: "versioned featured route snapshots",
      source: resolveManifestPath(buildPublicDataDir, manifest.featuredRoutesBase),
      target: resolveManifestPath(publicDataDir, manifest.featuredRoutesBase),
    });
  }
  if (featuredRoutesSource) {
    targets.push({
      kind: "directory",
      label: "featured route snapshots",
      source: featuredRoutesSource,
      target: featuredRoutesDir,
    });
  }
  // The manifest is the public mutable pointer. It must be switched only after
  // every referenced immutable asset and precomputed snapshot is in place.
  targets.push({
    label: "public manifest",
    source: manifestSource,
    target: promotedManifestPath,
  });
  return targets;
}

async function runStrictTraversalPromotionAudit(
  promoteId,
  overlayPath = cwBaseOverlayV2StagedPath,
) {
  const result = await runBuildDependencyStep(
    `promote-${promoteId}`,
    "strict traversal promotion audit",
    process.execPath,
    [
      resolve(repoRoot, "scripts/audit-bicycle-traversal-promotion.mjs"),
      "--root",
      buildPublicDataDir,
      "--overlay",
      overlayPath,
      "--report-only",
    ],
  );
  let audit;
  try {
    audit = JSON.parse(result.stdout);
  } catch {
    throw new Error("Strict traversal promotion audit returned invalid output.");
  }
  if (audit.status !== "ready") {
    const counts = Object.entries(audit.blockerCounts || {})
      .map(([code, count]) => `${code}=${count}`)
      .join(", ");
    throw new Error(
      `Promote blocked by strict traversal audit${counts ? `: ${counts}` : "."}`,
    );
  }
  return audit;
}

async function runOfferedRouteCorpusAudit(
  promoteId,
  catalogPath,
  publicDataRoot = buildPublicDataDir,
) {
  const result = await runBuildDependencyStep(
    `promote-${promoteId}`,
    "offered route corpus audit",
    process.execPath,
    [
      resolve(repoRoot, "scripts/validate-offered-route-corpus.mjs"),
      "--root",
      publicDataRoot,
      "--catalog",
      catalogPath,
    ],
  );
  let audit;
  try {
    audit = JSON.parse(result.stdout);
  } catch {
    throw new Error("Offered route corpus audit returned invalid output.");
  }
  if (audit.status !== "ready") {
    const counts = Object.entries(audit.blockerCounts || {})
      .map(([code, count]) => `${code}=${count}`)
      .join(", ");
    throw new Error(
      `Promote blocked by offered route corpus${counts ? `: ${counts}` : "."}`,
    );
  }
  return audit;
}

async function runReportedRideAudit(promoteId, publicDataRoot = buildPublicDataDir) {
  const result = await runBuildDependencyStep(
    `promote-${promoteId}`,
    "reported ride coordinate audit",
    process.execPath,
    [
      resolve(repoRoot, "scripts/recreate-navigation-ride.mjs"),
      "--root",
      publicDataRoot,
    ],
  );
  const audit = JSON.parse(result.stdout);
  if (audit.status !== "ready") {
    throw new Error(
      `Promote blocked by reported ride recreation: ${(audit.blockers || []).join(", ")}`,
    );
  }
  return audit;
}

async function handlePromote(payload = {}) {
  const promoteId = ++promoteCounter;
  log("info", `promote#${promoteId} started`, {
    dryRun: Boolean(payload.dryRun),
    allowSkippedElevation: Boolean(payload.allowSkippedElevation),
  });

  const report = JSON.parse(await readFile(reportPath, "utf-8"));
  const manifest = JSON.parse(await readFile(buildManifestPath, "utf-8"));
  const strictTraversalBuild = report.validation?.baseRouting?.routingProfile === "staged-v2";
  if (!strictTraversalBuild) {
    throw new Error(
      "Legacy V1/V2 routing promotion is disabled. Build the reviewed staged-v2/V3 release.",
    );
  }
  const sourceStat = await stat(sourcePath);
  const reportStat = await stat(reportPath);
  const builtOverlayPath = report.inputs?.cwBaseOverlay
    ? resolve(String(report.inputs.cwBaseOverlay))
    : (strictTraversalBuild ? cwBaseOverlayV2StagedPath : cwBaseOverlayPath);

  if (reportStat.mtimeMs + 1000 < sourceStat.mtimeMs) {
    throw new Error("Build is stale. Run Build after saving the source, then promote.");
  }

  for (const routingInput of [
    osmBaseGraphPath,
    osmElevatedBaseGraphPath,
    builtOverlayPath,
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
  if (strictTraversalBuild) {
    if (!manifest.cwAlignmentGeometry || !manifest.legacyRoutingCompatibility) {
      throw new Error(
        "Strict traversal promote requires alignment geometry and the legacy compatibility bundle.",
      );
    }
    await runStrictTraversalPromotionAudit(promoteId, builtOverlayPath);
  }

  let catalogSourcePath = await currentPromotedRouteCatalogPath();
  let usesCatalogDraft = false;
  try {
    await stat(routeCatalogDraftPath);
    catalogSourcePath = routeCatalogDraftPath;
    usesCatalogDraft = true;
  } catch {}
  await runOfferedRouteCorpusAudit(promoteId, catalogSourcePath);
  await runReportedRideAudit(promoteId);
  const release = await preparePromotionRelease({
    manifest,
    publicDataRoot: buildPublicDataDir,
    catalogSourcePath,
  });
  const releaseManifest = release.releaseManifest;
  const snapshots = release.snapshots;

  log("info", `promote#${promoteId} checks passed`, {
    version: releaseManifest.version,
    releaseBundleDigest: releaseManifest.releaseBundleDigest,
    warnings: (report.validation?.routeCompatibilityWarnings || []).length,
  });

  const targets = buildPromoteTargets(releaseManifest, {
    manifestSource: promotionManifestPath,
  });

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
  const shareRegistry = report.validation?.baseRouting?.shareIds || {};
  const registryProposalPath = shareRegistry.proposal
    ? resolve(String(shareRegistry.proposal))
    : null;
  const releasedRegistryPath = shareRegistry.registry
    ? resolve(String(shareRegistry.registry))
    : null;
  if (!payload.dryRun) {
    // The immutable V1 authoring snapshot already lives in data/routing-compat.
    // Advance the canonical authoring pointer only after every V3 release gate
    // has passed; future ordinary builds then remain policy-enforced.
    await copyFileAtomic(builtOverlayPath, cwBaseOverlayPath);
    const registryDigest = release.releaseManifest.releaseIndex
      ?.baseEdgeShareRegistryDigest;
    const effectiveRegistryPath = Number(shareRegistry.newIds) > 0
      ? registryProposalPath
      : releasedRegistryPath;
    if (registryDigest && effectiveRegistryPath) {
      const historyPath = resolve(
        dataDir,
        "routing-registry-history",
        `${registryDigest}.json`,
      );
      try {
        await stat(historyPath);
      } catch {
        await copyFileAtomic(effectiveRegistryPath, historyPath);
      }
    }
    if (Number(shareRegistry.newIds) > 0) {
      if (!registryProposalPath || !releasedRegistryPath) {
        throw new Error("Share-ID allocation has no promotable registry proposal.");
      }
      // Advancing the high-water mark is intentionally irreversible. If a
      // later immutable copy fails, allocated IDs remain reserved and are not
      // reused by a subsequent build.
      await copyFileAtomic(registryProposalPath, releasedRegistryPath);
    }
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
    if (usesCatalogDraft) {
      await unlink(routeCatalogDraftPath);
    }
  }
  removed = await cleanupOldPublicArtifacts(
    promoteId,
    Boolean(payload.dryRun),
    releaseManifest,
  );

  log("info", `promote#${promoteId} finished`, {
    dryRun: Boolean(payload.dryRun),
    version: releaseManifest.version,
    removed: removed.length,
  });

  return {
    dryRun: Boolean(payload.dryRun),
    version: releaseManifest.version,
    releaseBundleDigest: releaseManifest.releaseBundleDigest,
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

    if (request.method === "GET" && url.pathname === "/api/roundabouts/review") {
      try {
        const state = await readRoundaboutReviewState();
        sendJson(response, 200, {
          ok: true,
          sourceFresh: state.sourceFresh,
          coverage: state.joined.coverage,
          summary: state.joined.summary,
          warnings: state.joined.warnings,
          blockingIssues: state.joined.blockingIssues,
          items: state.joined.items,
          orphaned: state.joined.orphaned,
          geojson: state.geojson,
        });
      } catch (error) {
        sendJson(response, error?.status || 500, { ok: false, error: error?.message || String(error) });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/network-junctions") {
      try {
        const state = await readNetworkJunctionState();
        sendJson(response, 200, {
          ok: true,
          summary: state.joined.summary,
          blockingIssues: state.joined.blockingIssues,
          orphaned: state.joined.orphaned,
          items: state.joined.items,
          geojson: state.geojson,
          sourceDigests: state.candidates.sourceDigests,
        });
      } catch (error) {
        sendJson(response, error?.status || 500, { ok: false, error: error?.message || String(error) });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/network-junctions") {
      try {
        const body = await readRequestJson(request);
        const state = await readNetworkJunctionState();
        const nextRegistry = structuredClone(state.registry);
        nextRegistry.schemaVersion = 1;
        nextRegistry.junctions ||= {};
        let junctionId = typeof body?.junctionId === "string" ? body.junctionId : "";
        if (body?.action === "create") {
          const internalEdgeIds = [...new Set((body.internalEdgeIds || []).map(String).filter(Boolean))];
          if (!internalEdgeIds.length) {
            throw Object.assign(new Error("Select at least one internal base edge"), { status: 400 });
          }
          const edgeById = new Map((state.graph?.edges || []).map((edge) => [String(edge.id), edge]));
          const missing = internalEdgeIds.filter((edgeId) => !edgeById.has(edgeId));
          if (missing.length) {
            throw Object.assign(new Error(`Selected base edges are not in the current graph: ${missing.join(", ")}`), { status: 400 });
          }
          const unknown = internalEdgeIds.filter((edgeId) => {
            const traversal = edgeById.get(edgeId)?.bicycleTraversalShadow || edgeById.get(edgeId)?.bicycleTraversal || {};
            return !["allowed", "prohibited", "conditional"].includes(traversal.forward)
              || !["allowed", "prohibited", "conditional"].includes(traversal.reverse);
          });
          if (unknown.length) {
            throw Object.assign(new Error(`Review direction policy before creating the junction: ${unknown.join(", ")}`), { status: 400 });
          }
          junctionId = `junction-custom-${Date.now().toString(36)}`;
          nextRegistry.junctions[junctionId] = {
            id: junctionId,
            name: String(body.name || "").trim(),
            status: "detected",
            navigationKind: String(body.navigationKind || "intersection"),
            source: { type: "custom", internalEdgeIds },
            excludedPortIds: [],
            topologyFingerprint: null,
            updatedAt: new Date().toISOString(),
            reviewer: "ohad",
          };
        } else if (body?.action === "save") {
          const candidate = state.candidates.junctions?.find((item) => item.id === junctionId);
          if (!candidate) throw Object.assign(new Error("Unknown junction"), { status: 400 });
          const previous = nextRegistry.junctions[junctionId];
          const status = String(body.status || previous?.status || "detected");
          const source = previous?.source || (candidate.kind === "custom_bicycle"
            ? { type: "custom", internalEdgeIds: candidate.internalEdgeIds }
            : { type: "derived_roundabout", roundaboutId: candidate.roundaboutId });
          nextRegistry.junctions[junctionId] = {
            id: junctionId,
            name: String(body.name ?? previous?.name ?? candidate.name ?? "").trim(),
            status,
            navigationKind: String(body.navigationKind || previous?.navigationKind || candidate.navigationKind || "intersection"),
            source,
            excludedPortIds: candidate.kind === "custom_bicycle"
              ? [...new Set((body.excludedPortIds ?? previous?.excludedPortIds ?? []).map(String).filter(Boolean))].sort()
              : [],
            topologyFingerprint: status === "published" ? candidate.topologyFingerprint : previous?.topologyFingerprint || null,
            updatedAt: new Date().toISOString(),
            reviewer: "ohad",
          };
          normalizeNetworkJunctionRegistry(nextRegistry);
          let prospective = mergeNetworkJunctionRegistry(
            state.candidates,
            state.graph,
            state.overlay,
            nextRegistry,
          );
          prospective = refreshNetworkJunctionArmAssociations(prospective, state.overlay, state.graph);
          const prospectiveCandidate = prospective.junctions.find((item) => item.id === junctionId);
          if (status === "published") {
            nextRegistry.junctions[junctionId].topologyFingerprint = prospectiveCandidate.topologyFingerprint;
            prospective = mergeNetworkJunctionRegistry(state.candidates, state.graph, state.overlay, nextRegistry);
            prospective = refreshNetworkJunctionArmAssociations(prospective, state.overlay, state.graph);
            const publishCandidate = prospective.junctions.find((item) => item.id === junctionId);
            if (!publishCandidate?.publication?.canPublish) {
              const codes = (publishCandidate?.publication?.issues || []).map((issue) => issue.code).join(", ");
              throw Object.assign(new Error(`Cannot publish junction: ${codes || "validation failed"}`), { status: 400 });
            }
          }
        } else {
          throw Object.assign(new Error("Junction action must be create or save"), { status: 400 });
        }
        const normalized = normalizeNetworkJunctionRegistry(nextRegistry);
        await writeJsonAtomic(networkJunctionRegistryPath, normalized);
        const nextState = await readNetworkJunctionState();
        sendJson(response, 200, {
          ok: true,
          junctionId,
          summary: nextState.joined.summary,
          blockingIssues: nextState.joined.blockingIssues,
          orphaned: nextState.joined.orphaned,
          items: nextState.joined.items,
          geojson: nextState.geojson,
          sourceDigests: nextState.candidates.sourceDigests,
        });
      } catch (error) {
        sendJson(response, error?.status || 500, { ok: false, error: error?.message || String(error) });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/network-junctions/review") {
      try {
        const body = await readRequestJson(request);
        const state = await readNetworkJunctionState();
        const junction = state.candidates.junctions?.find((item) => item?.id === body?.junctionId);
        const movement = junction?.movements?.find((item) => item?.id === body?.movementId);
        if (!junction || !movement) {
          throw Object.assign(new Error("Unknown junction movement"), { status: 400 });
        }
        if (body?.junctionFingerprint !== junction.fingerprint) {
          throw Object.assign(new Error("Junction topology changed; reload before saving"), { status: 409 });
        }
        if (!["selected", "unavailable", "automatic"].includes(body?.status)) {
          throw Object.assign(new Error("Movement status must be selected, unavailable, or automatic"), { status: 400 });
        }
        const nextReviews = structuredClone(state.reviews);
        nextReviews.schemaVersion = 1;
        nextReviews.reviews ||= {};
        nextReviews.reviews[junction.id] ||= { movements: {} };
        nextReviews.reviews[junction.id].movements ||= {};
        if (body.status === "automatic") {
          delete nextReviews.reviews[junction.id].movements[movement.id];
          if (Object.keys(nextReviews.reviews[junction.id].movements).length === 0) {
            delete nextReviews.reviews[junction.id];
          }
        } else {
          nextReviews.reviews[junction.id].movements[movement.id] = {
            status: body.status,
            junctionFingerprint: junction.fingerprint,
            reviewedAt: new Date().toISOString(),
            reviewer: "ohad",
            ...(body.status === "selected" ? { edgeRefs: movement.edgeRefs } : {}),
          };
        }
        await writeJsonAtomic(networkJunctionReviewPath, nextReviews);
        const nextState = await readNetworkJunctionState();
        sendJson(response, 200, {
          ok: true,
          summary: nextState.joined.summary,
          blockingIssues: nextState.joined.blockingIssues,
          orphaned: nextState.joined.orphaned,
          items: nextState.joined.items,
          geojson: nextState.geojson,
          sourceDigests: nextState.candidates.sourceDigests,
        });
      } catch (error) {
        sendJson(response, error?.status || 500, { ok: false, error: error?.message || String(error) });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/roundabouts/review") {
      try {
        const body = await readRequestJson(request);
        const state = await readRoundaboutReviewState();
        const candidate = state.candidates.roundabouts?.find((item) => item?.id === body?.id);
        if (!candidate) throw Object.assign(new Error("Unknown roundabout candidate id"), { status: 400 });
        if (body?.fingerprint !== candidate.fingerprint) {
          throw Object.assign(new Error("Candidate changed; reload before reviewing"), { status: 400 });
        }
        if (!ROUNDABOUT_REVIEW_STATUSES.has(body?.status)) {
          throw Object.assign(new Error("Review status must be accepted or rejected"), { status: 400 });
        }
        const note = typeof body?.note === "string" ? body.note.trim() : "";
        if (note.length > 1000) throw Object.assign(new Error("Review note is too long"), { status: 400 });
        const nextReviews = {
          schemaVersion: 1,
          reviews: {
            ...(state.reviews.reviews || {}),
            [candidate.id]: {
              fingerprint: candidate.fingerprint,
              status: body.status,
              note,
              reviewedAt: new Date().toISOString(),
            },
          },
        };
        await writeJsonAtomic(roundaboutReviewPath, nextReviews);
        const nextState = await readRoundaboutReviewState();
        sendJson(response, 200, {
          ok: true,
          sourceFresh: nextState.sourceFresh,
          coverage: nextState.joined.coverage,
          summary: nextState.joined.summary,
          warnings: nextState.joined.warnings,
          blockingIssues: nextState.joined.blockingIssues,
          items: nextState.joined.items,
          orphaned: nextState.joined.orphaned,
          geojson: nextState.geojson,
        });
      } catch (error) {
        sendJson(response, error?.status || 500, { ok: false, error: error?.message || String(error) });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/crossings/review") {
      try {
        sendJson(response, 200, crossingReviewResponse(await readCrossingReviewState()));
      } catch (error) {
        sendJson(response, error?.status || 500, { ok: false, error: error?.message || String(error) });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/crossings/review") {
      try {
        const body = await readRequestJson(request);
        const state = await readCrossingReviewState();
        if (!state.sourceFresh) {
          throw Object.assign(new Error("Crossing candidates are stale; regenerate before reviewing"), { status: 409 });
        }
        const candidate = state.candidates.crossings?.find((item) => item?.id === body?.id);
        if (!candidate) throw Object.assign(new Error("Unknown crossing candidate id"), { status: 400 });
        if (body?.candidateFingerprint !== candidate.fingerprint) {
          throw Object.assign(new Error("Candidate changed; reload before reviewing"), { status: 400 });
        }
        if (!CROSSING_REVIEW_STATUSES.has(body?.status)) {
          throw Object.assign(new Error("Review status must be accepted or rejected"), { status: 400 });
        }
        const note = typeof body?.note === "string" ? body.note.trim() : "";
        if (note.length > 1000) throw Object.assign(new Error("Review note is too long"), { status: 400 });
        const candidateMappingIds = new Set((candidate.mappings || []).map((mapping) => mapping.id));
        const acceptedMappingIds = body.status === "accepted"
          ? (Array.isArray(body.acceptedMappingIds) ? body.acceptedMappingIds : [...candidateMappingIds])
          : [];
        if (body.status === "accepted" && (!acceptedMappingIds.length
          || acceptedMappingIds.some((id) => !candidateMappingIds.has(id)))) {
          throw Object.assign(new Error("Accepted mappings must select current candidate mappings"), { status: 400 });
        }
        const mappingOverrides = Array.isArray(body.mappingOverrides) ? body.mappingOverrides : [];
        const nextReviews = {
          schemaVersion: 1,
          reviews: {
            ...(state.reviews.reviews || {}),
            [candidate.id]: {
              candidateFingerprint: candidate.fingerprint,
              status: body.status,
              acceptedMappingIds,
              mappingOverrides,
              note,
              reviewedAt: new Date().toISOString(),
            },
          },
          manualCrossings: state.reviews.manualCrossings || [],
        };
        const validation = joinCrossingReviews(state.candidates, nextReviews);
        const item = validation.items.find((entry) => entry.candidate?.id === candidate.id);
        if (item?.state === "invalid") {
          throw Object.assign(new Error("Crossing mapping review is invalid"), { status: 400 });
        }
        await writeJsonAtomic(crossingReviewPath, nextReviews);
        sendJson(response, 200, crossingReviewResponse(await readCrossingReviewState()));
      } catch (error) {
        sendJson(response, error?.status || 500, { ok: false, error: error?.message || String(error) });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/crossings/manual") {
      try {
        const body = await readRequestJson(request);
        const state = await readCrossingReviewState();
        if (!state.sourceFresh) {
          throw Object.assign(new Error("Crossing candidates are stale; regenerate before editing manual crossings"), { status: 409 });
        }
        const crossing = body?.crossing;
        const issue = crossingIssue(crossing);
        if (issue || !String(crossing?.id || "").startsWith("manual-crossing-")) {
          throw Object.assign(new Error(`Invalid manual crossing: ${issue || "invalid_manual_id"}`), { status: 400 });
        }
        const now = new Date().toISOString();
        const existing = (state.reviews.manualCrossings || []).find((item) => item.id === crossing.id);
        const nextCrossing = {
          ...crossing,
          audit: {
            createdAt: existing?.audit?.createdAt || crossing?.audit?.createdAt || now,
            updatedAt: now,
          },
        };
        const manualCrossings = (state.reviews.manualCrossings || []).filter((item) => item.id !== crossing.id);
        manualCrossings.push(nextCrossing);
        manualCrossings.sort((a, b) => a.id.localeCompare(b.id));
        const nextReviews = {
          schemaVersion: 1,
          reviews: state.reviews.reviews || {},
          manualCrossings,
        };
        const validation = joinCrossingReviews(state.candidates, nextReviews);
        const manualItem = validation.manualItems.find((item) => item.crossing?.id === crossing.id);
        if (manualItem?.state !== "manual") {
          throw Object.assign(new Error("Manual crossing does not pass publication validation"), { status: 400 });
        }
        await writeJsonAtomic(crossingReviewPath, nextReviews);
        sendJson(response, 200, crossingReviewResponse(await readCrossingReviewState()));
      } catch (error) {
        sendJson(response, error?.status || 500, { ok: false, error: error?.message || String(error) });
      }
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
      const abortController = new AbortController();
      const abortOnDisconnect = () => {
        if (!response.writableEnded) abortController.abort();
      };
      response.once("close", abortOnDisconnect);
      let result;
      try {
        result = await handleOsmSegmentRecalculate(payload, { signal: abortController.signal });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error?.code === "AUTHORING_REQUEST_ABORTED") {
          logApi(requestId, "POST /api/osm/recalculate-segment cancelled", {
            durationMs: Date.now() - startedAt,
            segmentId: payload?.feature?.properties?.id,
          });
          if (!response.destroyed) {
            sendJson(response, error.status || 499, { ok: false, code: error.code, error: message });
          }
          return;
        }
        log("warn", `api#${requestId} POST /api/osm/recalculate-segment failed`, message);
        sendJson(response, error?.status || 400, { ok: false, code: error?.code || null, error: message });
        return;
      } finally {
        response.off("close", abortOnDisconnect);
      }
      logApi(requestId, "POST /api/osm/recalculate-segment finished", {
        durationMs: Date.now() - startedAt,
        segmentId: result.segmentId,
        coverageRatio: result.match?.summary?.coverageRatio,
        confidence: result.match?.summary?.confidence,
        matcherPerformance: result.match?.performance,
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
      let graphEdges = JSON.parse(await readFile(osmGraphEdgesPath, "utf-8"));
      try {
        const sourceDigests = await readOsmWaySourceDigestMap();
        graphEdges = {
          ...graphEdges,
          features: (graphEdges.features || []).map((feature) => {
            const properties = feature?.properties || {};
            const osmWayId = Number(properties.osmWayId);
            const sourceGeometryDigest = sourceDigests.get(osmWayId);
            return sourceGeometryDigest
              ? { ...feature, properties: { ...properties, sourceGeometryDigest } }
              : feature;
          }),
        };
      } catch (err) {
        log("warn", `api#${requestId} GET /api/osm/graph-edges skipped source digests`, err?.message || String(err));
      }
      try {
        const directionContext = await readDirectionReviewGraphContext();
        graphEdges = {
          ...graphEdges,
          features: (graphEdges.features || []).map((feature) => {
            const properties = feature?.properties || {};
            const edgeId = String(properties.edgeId || properties.id || feature?.id || "");
            const evidence = directionContext.edgeLookup.get(edgeId);
            if (!evidence?.bicycleTraversal) return feature;
            return {
              ...feature,
              properties: {
                ...properties,
                bicycleTraversal: evidence.bicycleTraversal,
              },
            };
          }),
          metadata: {
            ...(graphEdges.metadata || {}),
            directionReviewGraphDigest: directionContext.graphDigest,
            directionReviewPolicyDigest: directionContext.policyDigest,
            directionReviewPolicyId: directionContext.policyId,
          },
        };
      } catch (err) {
        log("warn", `api#${requestId} GET /api/osm/graph-edges skipped direction evidence`, err?.message || String(err));
      }
      try {
        const overlay = JSON.parse(await readFile(cwBaseOverlayPath, "utf-8"));
        graphEdges = annotateGraphEdgesWithCyclewaysMembership(graphEdges, overlay);
      } catch (err) {
        log("warn", `api#${requestId} GET /api/osm/graph-edges skipped CW annotation`, err?.message || String(err));
      }
      const [graphStat, manualStat, overrideStat] = await Promise.all([
        stat(osmGraphEdgesPath),
        stat(manualBaseEdgesPath).catch(() => null),
        stat(bicycleTraversalOverridesPath).catch(() => null),
      ]);
      let digestComparison = null;
      try {
        digestComparison = compareBaseGraphBuildInputs(
          graphEdges.metadata?.buildInputs,
          await currentBaseGraphBuildInputs(),
        );
      } catch (error) {
        log("warn", `api#${requestId} GET /api/osm/graph-edges skipped build-input digests`, error?.message || String(error));
      }
      const staleDigestKeys = new Set(
        digestComparison?.comparable
          ? digestComparison.mismatches.map((item) => item.key)
          : [],
      );
      graphEdges.metadata = {
        ...(graphEdges.metadata || {}),
        graphEdgesModifiedAt: graphStat.mtime.toISOString(),
        manualBaseEdgesModifiedAt: manualStat?.mtime?.toISOString() || null,
        bicycleTraversalOverridesModifiedAt: overrideStat?.mtime?.toISOString() || null,
        graphStaleBecauseManualBaseEdgesChanged: digestComparison?.comparable
          ? staleDigestKeys.has("manualBaseEdges")
          : Boolean(manualStat && manualStat.mtimeMs > graphStat.mtimeMs),
        graphStaleBecauseTraversalOverridesChanged: digestComparison?.comparable
          ? staleDigestKeys.has("bicycleTraversalOverrides")
          : Boolean(overrideStat && overrideStat.mtimeMs > graphStat.mtimeMs),
        graphStaleBecauseTopologyInputsChanged: digestComparison?.comparable
          ? staleDigestKeys.has("rawOsmWays") || staleDigestKeys.has("osmIntersections")
          : false,
        graphStaleInputs: digestComparison?.comparable
          ? digestComparison.mismatches.map((item) => item.label)
          : [],
      };
      logApi(requestId, "GET /api/osm/graph-edges loaded", {
        features: graphEdges.features?.length || 0,
        stale:
          graphEdges.metadata.graphStaleBecauseManualBaseEdgesChanged ||
          graphEdges.metadata.graphStaleBecauseTraversalOverridesChanged ||
          graphEdges.metadata.graphStaleBecauseTopologyInputsChanged,
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

    if (request.method === "GET" && url.pathname === "/api/cw-base-overlay-v2") {
      const result = await readDirectionReviewOverlay();
      if (!result) {
        sendJson(response, 404, {
          ok: false,
          error: "Prepare the Direction Review proposal before opening this workspace.",
        });
        return;
      }
      sendJson(response, 200, {
        ok: true,
        profile: process.env.CW_OVERLAY_PROFILE || "production-v1",
        ...result,
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/network-authoring/segment") {
      logApi(requestId, "POST /api/network-authoring/segment started");
      try {
        const payload = await readRequestJson(request);
        const result = await applyNetworkAuthoringSegment(payload);
        const durationMs = Date.now() - startedAt;
        logApi(requestId, "POST /api/network-authoring/segment finished", {
          durationMs,
          segmentId: result.segmentId,
          superseded: Boolean(result.superseded),
          outcome: result.decision?.outcome || result.status?.key || null,
        });
        sendJson(response, 200, { ok: true, source: "staged", durationMs, ...result });
      } catch (error) {
        log("warn", `api#${requestId} POST /api/network-authoring/segment failed`, {
          durationMs: Date.now() - startedAt,
          code: error?.code || null,
          error: error instanceof Error ? error.message : String(error),
        });
        sendJson(response, error?.status || 400, {
          ok: false,
          code: error?.code || null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/network-authoring/segment-metadata") {
      logApi(requestId, "POST /api/network-authoring/segment-metadata started");
      try {
        const payload = await readRequestJson(request);
        const result = await applyNetworkAuthoringSegmentMetadata(payload);
        const durationMs = Date.now() - startedAt;
        logApi(requestId, "POST /api/network-authoring/segment-metadata finished", {
          durationMs,
          segmentId: result.segmentId,
          superseded: Boolean(result.superseded),
        });
        sendJson(response, 200, { ok: true, source: "staged", durationMs, ...result });
      } catch (error) {
        log("warn", `api#${requestId} POST /api/network-authoring/segment-metadata failed`, {
          durationMs: Date.now() - startedAt,
          code: error?.code || null,
          error: error instanceof Error ? error.message : String(error),
        });
        sendJson(response, error?.status || 400, {
          ok: false,
          code: error?.code || null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/cw-base-overlay-v2/manual-bidirectional-queue") {
      sendJson(response, 200, {
        ok: true,
        queue: await readDirectionReviewPendingApprovals(),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/cw-base-overlay-v2/manual-bidirectional-queue") {
      try {
        const result = await queueManualBidirectionalDirectionReview(await readRequestJson(request));
        sendJson(response, 200, { ok: true, ...result });
      } catch (error) {
        sendJson(response, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/cw-base-overlay-v2/manual-bidirectional-finalize") {
      try {
        const result = await finalizeManualBidirectionalDirectionReviews(await readRequestJson(request));
        sendJson(response, 200, { ok: true, source: "staged", ...result });
      } catch (error) {
        sendJson(response, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/cw-base-overlay-v2") {
      try {
        requireStagedV2Profile();
        const payload = await readRequestJson(request);
        const overlay = parseCwOverlayV2(payload?.overlay || payload);
        await validatePublishedDirectionReviewOverlay(overlay);
        await writeJsonAtomic(cwBaseOverlayV2StagedPath, overlay);
        sendJson(response, 200, { ok: true, source: "staged", overlay });
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/cw-base-overlay-v2/alignment-action") {
      try {
        requireStagedV2Profile();
        const payload = await readRequestJson(request);
        const result = await applyDirectionReviewAlignmentAction(payload);
        await writeJsonAtomic(cwBaseOverlayV2StagedPath, result.overlay);
        sendJson(response, 200, {
          ok: true,
          source: "staged",
          action: payload.action,
          validation: result.validation,
          overlay: result.overlay,
        });
      } catch (error) {
        sendJson(response, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/cw-base-overlay-v2/refresh-evidence") {
      logApi(requestId, "POST /api/cw-base-overlay-v2/refresh-evidence started");
      try {
        requireStagedV2Profile();
        const payload = await readRequestJson(request);
        const result = await refreshDirectionReviewEvidence(payload);
        const durationMs = Date.now() - startedAt;
        logApi(requestId, "POST /api/cw-base-overlay-v2/refresh-evidence finished", {
          durationMs,
          refreshId: result.refreshId,
          automatic: result.automatic?.applied?.length || 0,
        });
        sendJson(response, 200, {
          ok: true,
          source: "staged",
          durationMs,
          refreshId: result.refreshId,
          preserved: result.preserved,
          overlay: result.overlay,
          graphPatch: result.graphPatch,
        });
      } catch (error) {
        log("warn", `api#${requestId} POST /api/cw-base-overlay-v2/refresh-evidence failed`, {
          durationMs: Date.now() - startedAt,
          code: error?.code || null,
          error: error instanceof Error ? error.message : String(error),
        });
        sendJson(response, error?.status || 400, {
          ok: false,
          code: error?.code || null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/cw-base-overlay-v2/apply-migration") {
      try {
        requireStagedV2Profile();
        const payload = await readRequestJson(request);
        if (!payload?.reviewer || !payload?.reviewedAt || !payload?.batchId) {
          throw new Error("Migration apply requires reviewer, reviewedAt, and batchId");
        }
        const proposal = parseCwOverlayV2(
          JSON.parse(await readFile(cwBaseOverlayV2ProposalPath, "utf-8")),
        );
        const staged = await readJsonFileOrNull(cwBaseOverlayV2StagedPath);
        const evidenceDigests = await directionReviewEvidenceDigests(proposal, payload.segmentIds);
        const applied = applyReviewedMigrationBatch(proposal, payload.segmentIds, {
          ...payload,
          evidenceDigests,
        });
        if (staged) {
          const parsedStaged = parseCwOverlayV2(staged);
          const selected = new Set((payload.segmentIds || []).map(Number));
          for (const [segmentId, segment] of Object.entries(parsedStaged.segments)) {
            if (!selected.has(Number(segmentId))) applied.overlay.segments[segmentId] = segment;
          }
        }
        const overlay = parseCwOverlayV2(applied.overlay);
        await writeJsonAtomic(cwBaseOverlayV2StagedPath, overlay);
        sendJson(response, 200, { ok: true, applied: applied.applied, overlay });
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/cw-base-overlay-v2/apply-symmetric-batch") {
      try {
        requireStagedV2Profile();
        const payload = await readRequestJson(request);
        if (!payload?.reviewer || !payload?.reviewedAt || !payload?.batchId) {
          throw new Error("Symmetric migration requires reviewer, reviewedAt, and batchId");
        }
        const proposal = parseCwOverlayV2(
          JSON.parse(await readFile(cwBaseOverlayV2ProposalPath, "utf-8")),
        );
        const requestedIds = Array.isArray(payload.segmentIds)
          ? payload.segmentIds.map(Number).filter(Number.isInteger)
          : Object.values(proposal.segments)
              .filter((segment) => segment.migration?.classification === "symmetric_candidate")
              .map((segment) => segment.segmentId);
        const applied = applyReviewedSymmetricMigrationBatch(
          proposal,
          requestedIds,
          {
            ...payload,
            evidenceDigests: await directionReviewEvidenceDigests(proposal, requestedIds),
          },
        );
        const staged = await readJsonFileOrNull(cwBaseOverlayV2StagedPath);
        if (staged) {
          const parsedStaged = parseCwOverlayV2(staged);
          const selected = new Set(applied.applied.map((item) => Number(item.segmentId)));
          for (const [segmentId, segment] of Object.entries(parsedStaged.segments)) {
            if (!selected.has(Number(segmentId))) applied.overlay.segments[segmentId] = segment;
          }
        }
        const overlay = parseCwOverlayV2(applied.overlay);
        await validatePublishedDirectionReviewOverlay(overlay);
        await writeJsonAtomic(cwBaseOverlayV2StagedPath, overlay);
        sendJson(response, 200, {
          ok: true,
          applied: applied.applied,
          skipped: applied.skipped,
          overlay,
        });
      } catch (error) {
        sendJson(response, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/cw-segment-workspace") {
      sendJson(response, 200, await readDirectionReviewWorkspace());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/cw-segment-workspace") {
      try {
        const workspace = normalizeDirectionReviewWorkspace(await readRequestJson(request));
        await writeJsonAtomic(cwSegmentWorkspacePath, workspace);
        sendJson(response, 200, { ok: true, workspace });
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
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

    if (request.method === "GET" && url.pathname === "/api/bicycle-traversal-overrides") {
      const overrides = await readBicycleTraversalOverrides();
      sendJson(response, 200, overrides);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/bicycle-traversal-overrides") {
      try {
        const overrides = await normalizeBicycleTraversalOverrides(await readRequestJson(request));
        await writeJsonAtomic(bicycleTraversalOverridesPath, overrides);
        directionReviewGraphCache = null;
        sendJson(response, 200, { ok: true, overrides });
      } catch (error) {
        sendJson(response, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
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

    if (request.method === "POST" && url.pathname === "/api/base-edge-state") {
      logApi(requestId, "POST /api/base-edge-state started");
      let manualBaseEdges;
      let overlay;
      try {
        const payload = await readRequestJson(request);
        manualBaseEdges = normalizeManualBaseEdges(payload?.manualBaseEdges);
        overlay = normalizeCwBaseOverlay(payload?.overlay);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("warn", `api#${requestId} POST /api/base-edge-state validation failed`, message);
        sendJson(response, 400, { ok: false, error: message });
        return;
      }

      const [previousManualBaseEdges, previousOverlay] = await Promise.all([
        readManualBaseEdges(),
        readCwBaseOverlay(),
      ]);
      try {
        await writeJsonAtomic(manualBaseEdgesPath, manualBaseEdges);
        await writeJsonAtomic(cwBaseOverlayPath, overlay);
      } catch (error) {
        await Promise.all([
          writeJsonAtomic(manualBaseEdgesPath, previousManualBaseEdges),
          writeJsonAtomic(cwBaseOverlayPath, previousOverlay),
        ]).catch((rollbackError) => {
          log("error", `api#${requestId} POST /api/base-edge-state rollback failed`, rollbackError?.message || String(rollbackError));
        });
        throw error;
      }
      logApi(requestId, "POST /api/base-edge-state saved", {
        manualEdges: manualBaseEdges.features?.length || 0,
        mappings: Object.keys(overlay.segments || {}).length,
      });
      sendJson(response, 200, { ok: true, manualBaseEdges, overlay });
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

    if (request.method === "POST" && url.pathname === "/api/connector/preview") {
      logApi(requestId, "POST /api/connector/preview started");
      try {
        const body = await readRequestJson(request);
        const RouteManagerClass = nodeRequire(resolve(repoRoot, "packages/core/route-manager.js"));
        const { geoJsonData, segmentsData } = await loadFeaturedAssetsFromDisk();
        const { baseRoutingNetwork } = await getBaseRoutingDecodeAssets({ log });
        const manager = await createRouteManager(
          RouteManagerClass,
          geoJsonData,
          segmentsData,
          baseRoutingNetwork,
        );
        const result = runConnectorPreview(manager, body);
        logApi(requestId, "POST /api/connector/preview finished", {
          durationMs: Date.now() - startedAt,
          mode: body?.mode,
        });
        sendJson(response, 200, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = err && err.status === 400 ? 400 : 500;
        log("warn", `api#${requestId} POST /api/connector/preview failed`, message);
        sendJson(response, status, { error: message });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/connector/label") {
      logApi(requestId, "POST /api/connector/label started");
      try {
        const body = await readRequestJson(request);
        const labelsPath = resolve(connectorEvalDir, "labels.jsonl");
        const strategiesPath = resolve(connectorEvalDir, "strategies.json");
        const strategyHash = await upsertStrategy(strategiesPath, body.strategy);
        const record = await appendLabel(labelsPath, {
          routeSlug: body.routeSlug ?? null,
          routeStart: body.routeStart,
          origin: body.origin,
          verdict: body.verdict,
          features: body.features,
          strategyHash,
        });
        logApi(requestId, "POST /api/connector/label finished", {
          durationMs: Date.now() - startedAt,
          routeSlug: record.routeSlug,
          verdict: record.verdict,
        });
        sendJson(response, 200, { ok: true, record });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = err && err.status === 400 ? 400 : 500;
        log("warn", `api#${requestId} POST /api/connector/label failed`, message);
        sendJson(response, status, { error: message });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/connector/labels") {
      logApi(requestId, "GET /api/connector/labels started");
      try {
        const labelsPath = resolve(connectorEvalDir, "labels.jsonl");
        const records = await readLabels(labelsPath);
        const labels = latestLabels(records);
        logApi(requestId, "GET /api/connector/labels finished", {
          durationMs: Date.now() - startedAt,
          raw: records.length,
          latest: labels.length,
        });
        sendJson(response, 200, { labels, rawCount: records.length });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log("warn", `api#${requestId} GET /api/connector/labels failed`, message);
        sendJson(response, 500, { error: message });
      }
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
          const promoted = await readJsonOrNull(await currentPromotedRouteCatalogPath());
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
      // /api/route-catalog/route-preview  (POST)
      if (parts.length === 3 && parts[2] === "route-preview" && request.method === "POST") {
        const body = await readRequestJson(request);
        try {
          const preview = await routeCatalogPreviewForRoute(body?.route, {
            slug: body?.slug,
          });
          sendJson(response, 200, { ok: true, ...preview });
        } catch (err) {
          sendJson(response, 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }
      // /api/route-catalog/map-image  (POST)
      if (parts.length === 3 && parts[2] === "map-image" && request.method === "POST") {
        const body = await readRequestJson(request, 40 * 1024 * 1024);
        const rawData = typeof body.data === "string" ? body.data : "";
        const base64 = rawData.replace(/^data:[^;]+;base64,/, "");
        if (!base64) {
          sendJson(response, 400, { ok: false, error: "missing image data" });
          return;
        }
        try {
          const token = String(body.route || "").trim();
          if (!token) throw new Error("route token is required");
          const manifest = await readJsonOrNull(promotedManifestPath);
          const source = {
            type: "mapbox-screenshot",
            routeTokenHash: routeTokenHash(token),
            mapVersion: manifest?.version ?? null,
            style:
              typeof body.style === "string" && body.style.trim()
                ? body.style.trim()
                : null,
            width: Number.isFinite(Number(body.width)) ? Number(body.width) : null,
            height: Number.isFinite(Number(body.height)) ? Number(body.height) : null,
            generatedAt: new Date().toISOString(),
          };
          const result = await processRouteMapImage({
            slug: body.slug,
            buffer: Buffer.from(base64, "base64"),
            alt: body.alt,
            source,
          });
          const { bytes, ...image } = result;
          sendJson(response, 200, { ok: true, image, bytes });
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
        try {
          const manifest = JSON.parse(await readFile(promotedManifestPath, "utf-8"));
          const shardManifest = JSON.parse(
            await readFile(
              resolveManifestPath(publicDataDir, manifest.baseRoutingShards),
              "utf-8",
            ),
          );
          if (
            Number(shardManifest.sourceRoutingSchemaVersion) !== 3 ||
            shardManifest.routingContract?.strictTraversalPolicy !== true
          ) {
            throw new Error(
              "Route-catalog promotion requires the current strict V3 routing release.",
            );
          }
          await runOfferedRouteCorpusAudit(
            `catalog-${Date.now()}`,
            routeCatalogDraftPath,
            publicDataDir,
          );
          const release = await preparePromotionRelease({
            manifest,
            publicDataRoot: publicDataDir,
            catalogSourcePath: routeCatalogDraftPath,
          });
          const labels = new Set([
            "versioned route catalog",
            "versioned featured route snapshots",
            "public manifest",
          ]);
          const targets = buildPromoteTargets(release.releaseManifest, {
            manifestSource: promotionManifestPath,
          }).filter((target) => labels.has(target.label));
          for (const target of targets) {
            await stat(target.source);
          }
          for (const target of targets) {
            if (target.kind === "directory") {
              await copyDirectoryAtomic(target.source, target.target);
            } else {
              await copyFileAtomic(target.source, target.target);
            }
          }
          await unlink(routeCatalogDraftPath);
          invalidateFeaturedAssetCache();
          sendJson(response, 200, {
            ok: true,
            entryCount: release.catalog.entries.length,
            releaseBundleDigest: release.releaseManifest.releaseBundleDigest,
            snapshots: release.snapshots,
          });
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
      const promoted = await readJsonOrNull(await currentPromotedRouteCatalogPath());
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
