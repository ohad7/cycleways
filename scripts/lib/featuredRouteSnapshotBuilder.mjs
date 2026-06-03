// Shared featured-route snapshot decode + projection.
//
// The Node-side filesystem decode path is the source of truth for turning a
// featured route token into a full route state. It is used by:
//   - editor/server.mjs  (video-keyframe polyline, route-catalog recompute)
//   - scripts/build-featured-route-snapshots.mjs  (public snapshot generation)
//
// Keep this module dependency-light and platform-agnostic (Node only). It must
// NOT duplicate decode logic that already lives in @cycleways/core.
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createRouteManager,
  restoreRouteFromParam,
} from "@cycleways/core/routing/routeActions.js";
import { decodeRoutePayload } from "@cycleways/core/utils/route-encoding.js";
import { mergeBaseRoutingShards } from "@cycleways/core/routing/baseRoutingShards.js";
import { decodeCompactBaseRoutingShard } from "@cycleways/core/routing/compactBaseRoutingShard.js";
import { decodeMessagePack } from "@cycleways/core/routing/messagePack.js";
import { dataMarkerFeaturesFromActiveDataPoints } from "@cycleways/core/data/dataMarkers.js";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const publicDataDir = resolve(repoRoot, "public-data");
const promotedManifestPath = resolve(publicDataDir, "map-manifest.json");
const routeCatalogPublicPath = resolve(publicDataDir, "route-catalog.json");
const featuredRoutesDir = resolve(publicDataDir, "featured-routes");

const nodeRequire = createRequire(import.meta.url);

const SNAPSHOT_SCHEMA_VERSION = 1;

function defaultLog(level, ...args) {
  if (level === "warn") console.warn(...args);
  else if (level === "error") console.error(...args);
  else console.log(...args);
}

async function readJsonOrNull(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf-8"));
  } catch {
    return null;
  }
}

// --- Asset loading (lifted from editor/server.mjs, deduplicated here) -------

let cachedFeaturedAssets = null;
export async function loadFeaturedAssetsFromDisk() {
  if (cachedFeaturedAssets) return cachedFeaturedAssets;
  const manifestRaw = await readFile(promotedManifestPath, "utf-8");
  const manifest = JSON.parse(manifestRaw);
  const geoJsonData = JSON.parse(
    await readFile(resolve(publicDataDir, manifest.bikeRoads), "utf-8"),
  );
  const segmentsData = JSON.parse(
    await readFile(resolve(publicDataDir, manifest.segments), "utf-8"),
  );
  cachedFeaturedAssets = { geoJsonData, segmentsData };
  return cachedFeaturedAssets;
}

// Base-graph routes (hybrid_route_v6 / base_route_v4 tokens) need the base
// routing network + cw-base index to decode, just like the web app. Merge all
// shards once and cache, so catalog recompute/promote and keyframe polyline
// decoding handle base-graph routes (not only segment-based ones).
let cachedBaseRoutingDecode = null;
export async function getBaseRoutingDecodeAssets({ log = defaultLog } = {}) {
  if (cachedBaseRoutingDecode) return cachedBaseRoutingDecode;
  let baseRoutingNetwork = null;
  let cwBaseIndex = null;
  try {
    const shardsDir = resolve(publicDataDir, "base-routing-shards");
    const shardManifest = JSON.parse(
      await readFile(resolve(shardsDir, "manifest.json"), "utf-8"),
    );
    const shards = await Promise.all(
      (shardManifest.shards || []).map(async (entry) => {
        const buf = await readFile(resolve(shardsDir, entry.path));
        if (entry.format === "msgpack") return decodeMessagePack(buf);
        if (entry.format === "compact") return decodeCompactBaseRoutingShard(buf);
        return JSON.parse(new TextDecoder().decode(buf));
      }),
    );
    const network = mergeBaseRoutingShards(shards);
    network.graphVersion = shardManifest.generatedAt || "";
    if (Array.isArray(network.edges) && network.edges.length > 0) {
      baseRoutingNetwork = network;
    }
  } catch (err) {
    log("warn", `base routing shards unavailable for route decode: ${err.message}`);
  }
  try {
    cwBaseIndex = JSON.parse(
      await readFile(resolve(publicDataDir, "cw-base-index.json"), "utf-8"),
    );
  } catch (err) {
    log("warn", `cw-base-index unavailable for route decode: ${err.message}`);
  }
  cachedBaseRoutingDecode = { baseRoutingNetwork, cwBaseIndex };
  return cachedBaseRoutingDecode;
}

async function resolveRouteTokenForSlug(slug, {
  draftCatalogPath = null,
  log = defaultLog,
} = {}) {
  // First try an optional draft catalog (for in-progress editor edits), then
  // the promoted one, and fall back to the .meta.js seed for legacy routes.
  let routeToken = null;
  const draft = draftCatalogPath ? await readJsonOrNull(draftCatalogPath) : null;
  const promoted = await readJsonOrNull(routeCatalogPublicPath);
  const lookup = (cat) => cat?.entries?.find((e) => e.slug === slug)?.route;
  routeToken = lookup(draft) || lookup(promoted) || null;
  if (!routeToken) {
    try {
      const metaModulePath = resolve(repoRoot, `src/featured/${slug}.meta.js`);
      const metaModule = await import(pathToFileURL(metaModulePath).href);
      routeToken = metaModule.meta?.route || null;
    } catch {}
  }
  if (typeof routeToken !== "string" || routeToken.length === 0) {
    throw new Error(`featured route "${slug}" not found in catalog or meta`);
  }
  return routeToken;
}

// Decode a slug's route token to the full route-state snapshot (the shape
// produced by snapshotRouteManager / emptyRouteSnapshot, including the full
// activeDataPoints objects). Returns the decoded routeToken/routeFormat too.
export async function loadRouteStateForSlug(slug, {
  draftCatalogPath = null,
  log = defaultLog,
} = {}) {
  const routeToken = await resolveRouteTokenForSlug(slug, { draftCatalogPath, log });
  const RouteManagerClass = nodeRequire(resolve(repoRoot, "packages/core/route-manager.js"));
  const { geoJsonData, segmentsData } = await loadFeaturedAssetsFromDisk();
  const { baseRoutingNetwork, cwBaseIndex } = await getBaseRoutingDecodeAssets({ log });
  const manager = await createRouteManager(
    RouteManagerClass,
    geoJsonData,
    segmentsData,
    baseRoutingNetwork,
  );
  const routeState = restoreRouteFromParam(manager, routeToken, segmentsData, cwBaseIndex);
  if (!routeState) throw new Error(`route "${slug}" failed to decode`);
  const routeFormat = decodeRoutePayload(routeToken).type;
  return { routeState, routeToken, routeFormat };
}

// Thin wrapper preserving the original editor/server.mjs contract: returns just
// the route polyline (geometry) for a slug.
export async function loadRoutePolylineForSlug(slug, options = {}) {
  const { routeState } = await loadRouteStateForSlug(slug, options);
  return routeState.geometry;
}

// --- Snapshot projection ----------------------------------------------------

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

function computeBounds(geometry) {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const point of geometry) {
    const lng = point?.lng;
    const lat = point?.lat;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  if (!Number.isFinite(west)) return null;
  return { west, south, east, north };
}

function loadManifestSource(manifest) {
  const hashes = manifest?.hashes || {};
  return {
    mapVersion: manifest?.version ?? null,
    assetHashes: {
      bikeRoads: hashes.bikeRoads ?? null,
      segments: hashes.segments ?? null,
      cwBaseIndex: hashes.cwBaseIndex ?? null,
      baseRoutingShards: hashes.baseRoutingShards ?? null,
    },
  };
}

// Project a decoded route state into the public, page-oriented snapshot schema.
export function buildSnapshotFromRouteState({
  slug,
  routeState,
  routeToken,
  routeFormat,
  manifest,
  generatedAt = new Date().toISOString(),
}) {
  const geometry = Array.isArray(routeState.geometry) ? routeState.geometry : [];
  const activeDataPoints = Array.isArray(routeState.activeDataPoints)
    ? routeState.activeDataPoints
    : [];
  const { mapVersion, assetHashes } = loadManifestSource(manifest);
  const dataMarkerFeatures = dataMarkerFeaturesFromActiveDataPoints(activeDataPoints);
  const activeDataPointIds = activeDataPoints
    .map((p) => p?.id)
    .filter((id) => typeof id === "string" && id.length > 0);

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    slug,
    generatedAt,
    source: {
      routeTokenHash: `sha256:${sha256Hex(routeToken)}`,
      routeFormat,
      mapVersion,
      assetHashes,
    },
    route: {
      geometry,
      bounds: computeBounds(geometry),
      distance: routeState.distance || 0,
      elevationGain: routeState.elevationGain || 0,
      elevationLoss: routeState.elevationLoss || 0,
      selectedSegments: Array.isArray(routeState.selectedSegments)
        ? routeState.selectedSegments
        : [],
    },
    pois: {
      activeDataPoints,
      dataMarkerFeatures,
      activeDataPointIds,
    },
  };
}

// Build the snapshot for a single featured slug end-to-end.
export async function buildSnapshotForSlug(slug, {
  manifest,
  draftCatalogPath = null,
  generatedAt,
  log = defaultLog,
} = {}) {
  const resolvedManifest = manifest || (await readJsonOrNull(promotedManifestPath));
  if (!resolvedManifest) throw new Error("map-manifest.json not found");
  const { routeState, routeToken, routeFormat } = await loadRouteStateForSlug(slug, {
    draftCatalogPath,
    log,
  });
  return buildSnapshotFromRouteState({
    slug,
    routeState,
    routeToken,
    routeFormat,
    manifest: resolvedManifest,
    generatedAt,
  });
}

async function writeSnapshotAtomic(slug, snapshot) {
  await mkdir(featuredRoutesDir, { recursive: true });
  const target = resolve(featuredRoutesDir, `${slug}.json`);
  const tmp = `${target}.tmp`;
  await writeFile(tmp, `${JSON.stringify(snapshot, null, 2)}\n`);
  await rename(tmp, target);
  return target;
}

async function listSnapshotSlugs() {
  let files = [];
  try {
    files = await readdir(featuredRoutesDir);
  } catch {
    return [];
  }
  return files
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

export async function readFeaturedCatalogSlugs() {
  const catalog = await readJsonOrNull(routeCatalogPublicPath);
  const entries = Array.isArray(catalog?.entries) ? catalog.entries : [];
  return entries.filter((e) => e?.featured === true).map((e) => e.slug);
}

// Generate (and write) snapshots for every featured catalog entry, then delete
// orphaned snapshot files for routes no longer marked featured.
export async function buildFeaturedRouteSnapshots({
  draftCatalogPath = null,
  generatedAt,
  log = defaultLog,
} = {}) {
  const manifest = await readJsonOrNull(promotedManifestPath);
  if (!manifest) throw new Error("map-manifest.json not found");
  const featuredSlugs = await readFeaturedCatalogSlugs();
  const written = [];
  const errors = [];
  for (const slug of featuredSlugs) {
    try {
      const snapshot = await buildSnapshotForSlug(slug, {
        manifest,
        draftCatalogPath,
        generatedAt,
        log,
      });
      const target = await writeSnapshotAtomic(slug, snapshot);
      written.push({ slug, path: target });
      log("info", `featured snapshot: wrote ${slug} (${snapshot.route.geometry.length} coords)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ slug, error: message });
      log("error", `featured snapshot: failed for ${slug}: ${message}`);
    }
  }

  // Orphan cleanup: drop snapshots for routes no longer featured.
  const featuredSet = new Set(featuredSlugs);
  const removed = [];
  for (const slug of await listSnapshotSlugs()) {
    if (!featuredSet.has(slug)) {
      await rm(resolve(featuredRoutesDir, `${slug}.json`), { force: true });
      removed.push(slug);
      log("info", `featured snapshot: removed orphan ${slug}`);
    }
  }

  return { written, removed, errors };
}

// Validate snapshots without rewriting them. Returns a list of failure strings.
export async function checkFeaturedRouteSnapshots({
  draftCatalogPath = null,
  log = defaultLog,
} = {}) {
  const failures = [];
  const manifest = await readJsonOrNull(promotedManifestPath);
  if (!manifest) {
    return { failures: ["map-manifest.json not found"], orphans: [] };
  }
  const { mapVersion } = loadManifestSource(manifest);
  const featuredSlugs = await readFeaturedCatalogSlugs();
  const featuredSet = new Set(featuredSlugs);

  for (const slug of featuredSlugs) {
    const snapshot = await readJsonOrNull(resolve(featuredRoutesDir, `${slug}.json`));
    if (!snapshot) {
      failures.push(`${slug}: snapshot file is missing`);
      continue;
    }
    if (snapshot.slug !== slug) {
      failures.push(`${slug}: snapshot.slug "${snapshot.slug}" does not match`);
    }
    if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
      failures.push(`${slug}: schemaVersion ${snapshot.schemaVersion} != ${SNAPSHOT_SCHEMA_VERSION}`);
    }
    // routeTokenHash must match the current token.
    let routeToken = null;
    try {
      routeToken = await resolveRouteTokenForSlug(slug, { draftCatalogPath, log });
    } catch (err) {
      failures.push(`${slug}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (routeToken) {
      const expectedHash = `sha256:${sha256Hex(routeToken)}`;
      if (snapshot.source?.routeTokenHash !== expectedHash) {
        failures.push(`${slug}: routeTokenHash is stale`);
      }
    }
    if (snapshot.source?.mapVersion !== mapVersion) {
      failures.push(
        `${slug}: mapVersion "${snapshot.source?.mapVersion}" != manifest "${mapVersion}"`,
      );
    }
    const geometry = snapshot.route?.geometry;
    if (!Array.isArray(geometry) || geometry.length < 2) {
      failures.push(`${slug}: geometry must have at least 2 coordinates`);
    }
    const bounds = snapshot.route?.bounds;
    if (
      !bounds ||
      !Number.isFinite(bounds.west) ||
      !Number.isFinite(bounds.south) ||
      !Number.isFinite(bounds.east) ||
      !Number.isFinite(bounds.north) ||
      bounds.west > bounds.east ||
      bounds.south > bounds.north
    ) {
      failures.push(`${slug}: bounds are invalid`);
    }
    // activeDataPointIds consistent with activeDataPoints.
    const activeDataPoints = Array.isArray(snapshot.pois?.activeDataPoints)
      ? snapshot.pois.activeDataPoints
      : [];
    const activeIds = Array.isArray(snapshot.pois?.activeDataPointIds)
      ? snapshot.pois.activeDataPointIds
      : [];
    const expectedIds = activeDataPoints
      .map((p) => p?.id)
      .filter((id) => typeof id === "string" && id.length > 0);
    if (
      expectedIds.length !== activeIds.length ||
      expectedIds.some((id, i) => id !== activeIds[i])
    ) {
      failures.push(`${slug}: activeDataPointIds are inconsistent with activeDataPoints`);
    }
  }

  // Orphans are failures in --check mode.
  const orphans = (await listSnapshotSlugs()).filter((slug) => !featuredSet.has(slug));
  for (const slug of orphans) {
    failures.push(`${slug}: orphan snapshot (slug no longer featured)`);
  }

  return { failures, orphans };
}
