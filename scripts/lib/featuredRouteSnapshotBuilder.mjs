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
  buildShareInfo,
  createRouteManager,
  restoreRouteFromParam,
} from "@cycleways/core/routing/routeActions.js";
import { decodeRoutePayload } from "@cycleways/core/utils/route-encoding.js";
import { mergeBaseRoutingShards } from "@cycleways/core/routing/baseRoutingShards.js";
import { decodeCompactBaseRoutingShard } from "@cycleways/core/routing/compactBaseRoutingShard.js";
import { decodeMessagePack } from "@cycleways/core/routing/messagePack.js";
import { createShardedRouteSession } from "@cycleways/core/routing/shardedRouteSession.js";
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

const cachedFeaturedAssets = new Map();
export async function loadFeaturedAssetsFromDisk({
  publicDataRoot = publicDataDir,
  manifest = null,
} = {}) {
  const resolvedManifest = manifest || JSON.parse(
    await readFile(resolve(publicDataRoot, "map-manifest.json"), "utf-8"),
  );
  const cacheKey = `${publicDataRoot}:${resolvedManifest.version || "unversioned"}`;
  if (cachedFeaturedAssets.has(cacheKey)) return cachedFeaturedAssets.get(cacheKey);
  const geoJsonData = JSON.parse(
    await readFile(resolve(publicDataRoot, resolvedManifest.bikeRoads), "utf-8"),
  );
  const segmentsData = JSON.parse(
    await readFile(resolve(publicDataRoot, resolvedManifest.segments), "utf-8"),
  );
  const value = { geoJsonData, segmentsData };
  cachedFeaturedAssets.set(cacheKey, value);
  return value;
}

// Base-graph routes (hybrid_route_v6 / base_route_v4 tokens) need the base
// routing network + cw-base index to decode, just like the web app. Merge all
// shards once and cache, so catalog recompute/promote and keyframe polyline
// decoding handle base-graph routes (not only segment-based ones).
const cachedBaseRoutingDecode = new Map();
export async function getBaseRoutingDecodeAssets({
  log = defaultLog,
  publicDataRoot = publicDataDir,
  manifest = null,
} = {}) {
  const resolvedManifest = manifest || JSON.parse(
    await readFile(resolve(publicDataRoot, "map-manifest.json"), "utf-8"),
  );
  const cacheKey = `${publicDataRoot}:${resolvedManifest.version || "unversioned"}`;
  if (cachedBaseRoutingDecode.has(cacheKey)) return cachedBaseRoutingDecode.get(cacheKey);
  let baseRoutingNetwork = null;
  let cwBaseIndex = null;
  let legacyCwBaseIndex = null;
  let legacyRoutingCompatibility = null;
  let routeAnchorCompatibility = null;
  let shardManifest = null;
  let shardsDir = null;
  try {
    const shardManifestPath = resolve(publicDataRoot, resolvedManifest.baseRoutingShards);
    shardsDir = resolve(shardManifestPath, "..");
    shardManifest = JSON.parse(
      await readFile(shardManifestPath, "utf-8"),
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
    network.graphVersion = shardManifest.graphVersion || shardManifest.generatedAt || "";
    network.policyId = shardManifest.policyId || null;
    network.policyDigest = shardManifest.policyDigest || null;
    network.routingContract = shardManifest.routingContract || null;
    if (Array.isArray(network.edges) && network.edges.length > 0) {
      baseRoutingNetwork = network;
    }
  } catch (err) {
    log("warn", `base routing shards unavailable for route decode: ${err.message}`);
  }
  try {
    cwBaseIndex = JSON.parse(
      await readFile(resolve(publicDataRoot, resolvedManifest.cwBaseIndex), "utf-8"),
    );
  } catch (err) {
    log("warn", `cw-base-index unavailable for route decode: ${err.message}`);
  }
  try {
    const legacy = resolvedManifest.legacyRoutingCompatibility;
    if (legacy?.cwBaseIndex) {
      const bytes = await readFile(resolve(publicDataRoot, legacy.cwBaseIndex));
      const actual = createHash("sha256").update(bytes).digest("hex");
      if (actual !== legacy.cwBaseIndexSha256) {
        throw new Error("legacy CW base index hash mismatch");
      }
      legacyCwBaseIndex = JSON.parse(bytes.toString("utf-8"));
      const metadataBytes = await readFile(resolve(publicDataRoot, legacy.metadata));
      const metadataActual = createHash("sha256").update(metadataBytes).digest("hex");
      if (metadataActual !== legacy.metadataSha256) {
        throw new Error("legacy routing compatibility metadata hash mismatch");
      }
      legacyRoutingCompatibility = {
        manifest: legacy,
        cwBaseIndex: legacyCwBaseIndex,
        metadata: JSON.parse(metadataBytes.toString("utf-8")),
      };
    }
  } catch (err) {
    log("warn", `legacy cw-base-index unavailable for route decode: ${err.message}`);
  }
  try {
    const anchorCompatibility = resolvedManifest.routeAnchorCompatibility;
    if (anchorCompatibility?.path) {
      const bytes = await readFile(resolve(publicDataRoot, anchorCompatibility.path));
      const actual = createHash("sha256").update(bytes).digest("hex");
      if (anchorCompatibility.sha256 && actual !== anchorCompatibility.sha256) {
        throw new Error("route-anchor compatibility hash mismatch");
      }
      routeAnchorCompatibility = JSON.parse(bytes.toString("utf-8"));
    }
  } catch (err) {
    log("warn", `route-anchor compatibility unavailable for route decode: ${err.message}`);
  }
  const value = {
    baseRoutingNetwork,
    cwBaseIndex,
    legacyCwBaseIndex,
    legacyRoutingCompatibility,
    routeAnchorCompatibility,
    shardManifest,
    shardsDir,
  };
  cachedBaseRoutingDecode.set(cacheKey, value);
  return value;
}

// Clear the module-scope decode caches. The long-lived editor must call this
// after a promote so that subsequent decodes read freshly promoted assets
// (segments/bike-roads/base-routing shards) instead of stale cached copies.
export function invalidateFeaturedAssetCache() {
  cachedFeaturedAssets.clear();
  cachedBaseRoutingDecode.clear();
}

async function resolveRouteTokenForSlug(slug, {
  draftCatalogPath = null,
  routeCatalogPath = routeCatalogPublicPath,
  log = defaultLog,
} = {}) {
  // First try an optional draft catalog (for in-progress editor edits), then
  // the promoted one, and fall back to the .meta.js seed for legacy routes.
  const entry = await resolveRouteCatalogEntryForSlug(slug, {
    draftCatalogPath,
    routeCatalogPath,
  });
  let routeToken = entry?.route || null;
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

async function resolveRouteCatalogEntryForSlug(slug, {
  draftCatalogPath = null,
  routeCatalogPath = routeCatalogPublicPath,
} = {}) {
  const draft = draftCatalogPath ? await readJsonOrNull(draftCatalogPath) : null;
  const promoted = await readJsonOrNull(routeCatalogPath);
  const lookup = (cat) => cat?.entries?.find((e) => e.slug === slug) || null;
  return lookup(draft) || lookup(promoted) || null;
}

// Decode a slug's route token to the full route-state snapshot (the shape
// produced by snapshotRouteManager / emptyRouteSnapshot, including the full
// activeDataPoints objects). Returns the decoded routeToken/routeFormat too.
export async function loadRouteStateForSlug(slug, {
  draftCatalogPath = null,
  routeCatalogPath = routeCatalogPublicPath,
  publicDataRoot = publicDataDir,
  manifest = null,
  allowSnapshotFallback = true,
  includeCurrentShareInfo = false,
  snapshotDir = featuredRoutesDir,
  log = defaultLog,
} = {}) {
  const routeToken = await resolveRouteTokenForSlug(slug, {
    draftCatalogPath,
    routeCatalogPath,
    log,
  });
  const RouteManagerClass = nodeRequire(resolve(repoRoot, "packages/core/route-manager.js"));
  const { geoJsonData, segmentsData } = await loadFeaturedAssetsFromDisk({
    publicDataRoot,
    manifest,
  });
  const {
    baseRoutingNetwork,
    cwBaseIndex,
    legacyCwBaseIndex,
    legacyRoutingCompatibility,
    routeAnchorCompatibility,
    shardManifest,
    shardsDir,
  } = await getBaseRoutingDecodeAssets({
    log,
    publicDataRoot,
    manifest,
  });
  let routeState = null;
  let managerForShare = null;
  let decodeSource = null;
  let decodeError = null;
  try {
    const strictTraversal = Number(shardManifest?.sourceRoutingSchemaVersion) === 3 &&
      shardManifest?.routingContract?.strictTraversalPolicy === true;
    if (strictTraversal) {
      const loadShard = async (entry) => {
        const bytes = await readFile(resolve(shardsDir, entry.path));
        if (entry.format === "msgpack") return decodeMessagePack(bytes);
        if (entry.format === "compact") return decodeCompactBaseRoutingShard(bytes);
        return JSON.parse(new TextDecoder().decode(bytes));
      };
      const session = await createShardedRouteSession(
        RouteManagerClass,
        geoJsonData,
        segmentsData,
        shardManifest,
        loadShard,
        { cwBaseIndex, legacyRoutingCompatibility, routeAnchorCompatibility },
      );
      routeState = await session.restoreRouteParam(routeToken);
      managerForShare = session.manager;
    } else {
      const manager = await createRouteManager(
        RouteManagerClass,
        geoJsonData,
        segmentsData,
        baseRoutingNetwork,
      );
      const payload = decodeRoutePayload(routeToken);
      const restoreCwBaseIndex = payload.type === "hybrid_route_v6"
        ? legacyCwBaseIndex
        : cwBaseIndex;
      routeState = restoreRouteFromParam(manager, routeToken, segmentsData, restoreCwBaseIndex);
      managerForShare = manager;
    }
    if (routeState) decodeSource = "live";
  } catch (err) {
    decodeError = err;
  }
  if (!routeState && allowSnapshotFallback) {
    const fallbackSnapshot = await readFeaturedRouteSnapshot(slug, { snapshotDir });
    if (fallbackSnapshot && snapshotMatchesRouteToken(fallbackSnapshot, routeToken)) {
      const fallbackState = routeStateFromFeaturedSnapshot(fallbackSnapshot);
      if (Array.isArray(fallbackState.geometry) && fallbackState.geometry.length >= 2) {
        routeState = fallbackState;
        decodeSource = "existing_snapshot";
        log(
          "warn",
          `route "${slug}" failed live decode; using existing snapshot fallback for matching route token`,
        );
      }
    }
  }
  if (!routeState) {
    const detail = decodeError instanceof Error ? `: ${decodeError.message}` : "";
    throw new Error(`route "${slug}" failed to decode${detail}`);
  }
  // Decode the payload again only to read its `.type`. restoreRouteFromParam
  // does not surface the format, and decodeRoutePayload is a cheap pure parse
  // (no routing/manager work), so the second call is intentional and harmless.
  const routeFormat = decodeRoutePayload(routeToken).type;
  const currentShareInfo = includeCurrentShareInfo && managerForShare
    ? buildShareInfo(
        routeState,
        segmentsData,
        managerForShare,
        { href: "https://www.cycleways.app/" },
        cwBaseIndex,
      )
    : null;
  return {
    routeState,
    routeToken,
    routeFormat,
    decodeSource,
    currentShareInfo,
  };
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

export function routeTokenHash(routeToken) {
  return `sha256:${sha256Hex(String(routeToken || ""))}`;
}

export async function readFeaturedRouteSnapshot(slug, {
  snapshotDir = featuredRoutesDir,
} = {}) {
  if (typeof slug !== "string" || slug.length === 0) return null;
  return readJsonOrNull(resolve(snapshotDir, `${slug}.json`));
}

export function snapshotMatchesRouteToken(snapshot, routeToken) {
  return snapshot?.source?.routeTokenHash === routeTokenHash(routeToken);
}

export function routeStateFromFeaturedSnapshot(snapshot) {
  const route = snapshot?.route || {};
  const pois = snapshot?.pois || {};
  return {
    geometry: Array.isArray(route.geometry) ? route.geometry : [],
    distance: Number(route.distance) || 0,
    elevationGain: Number(route.elevationGain) || 0,
    elevationLoss: Number(route.elevationLoss) || 0,
    selectedSegments: Array.isArray(route.selectedSegments) ? route.selectedSegments : [],
    activeDataPoints: Array.isArray(pois.activeDataPoints) ? pois.activeDataPoints : [],
  };
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
  displayImage = null,
  routeState,
  routeToken,
  routeFormat,
  manifest,
  generatedAt = new Date().toISOString(),
  decodeSource = null,
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
      routeTokenHash: routeTokenHash(routeToken),
      routeFormat,
      mapVersion,
      assetHashes,
      ...(decodeSource ? { decodeSource } : {}),
    },
    route: {
      ...(displayImage ? { displayImage } : {}),
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
  routeCatalogPath = routeCatalogPublicPath,
  publicDataRoot = publicDataDir,
  allowSnapshotFallback = true,
  snapshotDir = featuredRoutesDir,
  generatedAt,
  log = defaultLog,
} = {}) {
  const resolvedManifest = manifest || (await readJsonOrNull(promotedManifestPath));
  if (!resolvedManifest) throw new Error("map-manifest.json not found");
  const { routeState, routeToken, routeFormat, decodeSource } = await loadRouteStateForSlug(slug, {
    draftCatalogPath,
    routeCatalogPath,
    publicDataRoot,
    manifest: resolvedManifest,
    allowSnapshotFallback,
    snapshotDir,
    log,
  });
  if (decodeSource === "existing_snapshot") {
    const existing = await readFeaturedRouteSnapshot(slug, { snapshotDir });
    if (existing && snapshotMatchesRouteToken(existing, routeToken)) {
      return existing;
    }
  }
  const entry = await resolveRouteCatalogEntryForSlug(slug, {
    draftCatalogPath,
    routeCatalogPath,
  });
  return buildSnapshotFromRouteState({
    slug,
    displayImage: entry?.routeMapImage || null,
    routeState,
    routeToken,
    routeFormat,
    manifest: resolvedManifest,
    generatedAt,
    decodeSource: decodeSource === "existing_snapshot" ? decodeSource : null,
  });
}

async function writeSnapshotAtomic(slug, snapshot, {
  outputDir = featuredRoutesDir,
} = {}) {
  await mkdir(outputDir, { recursive: true });
  const target = resolve(outputDir, `${slug}.json`);
  const existing = await readJsonOrNull(target);

  // Builds should be idempotent. `generatedAt` describes when the snapshot's
  // contents changed, not every time an otherwise identical build ran.
  if (existing && typeof existing.generatedAt === "string") {
    const candidateWithExistingTimestamp = {
      ...snapshot,
      generatedAt: existing.generatedAt,
    };
    if (JSON.stringify(candidateWithExistingTimestamp) === JSON.stringify(existing)) {
      return { target, changed: false };
    }
  }

  const tmp = `${target}.tmp`;
  await writeFile(tmp, `${JSON.stringify(snapshot, null, 2)}\n`);
  try {
    await rename(tmp, target);
  } catch (err) {
    // Don't leak the tmp file if rename fails (e.g. cross-device, permissions).
    await rm(tmp, { force: true });
    throw err;
  }
  return { target, changed: true };
}

async function listSnapshotSlugs(snapshotDir = featuredRoutesDir) {
  let files = [];
  try {
    files = await readdir(snapshotDir);
  } catch {
    return [];
  }
  return files
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

export async function readRouteCatalogSlugs({
  routeCatalogPath = routeCatalogPublicPath,
  draftCatalogPath = null,
} = {}) {
  const catalog = (draftCatalogPath ? await readJsonOrNull(draftCatalogPath) : null) ||
    await readJsonOrNull(routeCatalogPath);
  const entries = Array.isArray(catalog?.entries) ? catalog.entries : [];
  return entries
    .map((e) => e?.slug)
    .filter((slug) => typeof slug === "string" && slug.length > 0);
}

export async function readFeaturedCatalogSlugs() {
  return readRouteCatalogSlugs();
}

// Generate (and write) snapshots for every catalog route entry, then delete
// orphaned snapshot files for routes no longer present in the route catalog.
export async function buildFeaturedRouteSnapshots({
  draftCatalogPath = null,
  routeCatalogPath = routeCatalogPublicPath,
  publicDataRoot = publicDataDir,
  manifest = null,
  outputDir = featuredRoutesDir,
  allowSnapshotFallback = true,
  strict = false,
  generatedAt,
  log = defaultLog,
} = {}) {
  const resolvedManifest = manifest || await readJsonOrNull(
    resolve(publicDataRoot, "map-manifest.json"),
  );
  if (!resolvedManifest) throw new Error("map-manifest.json not found");
  const routeSlugs = await readRouteCatalogSlugs({
    routeCatalogPath,
    draftCatalogPath,
  });
  const written = [];
  const errors = [];
  const prepared = [];
  for (const slug of routeSlugs) {
    try {
      const snapshot = await buildSnapshotForSlug(slug, {
        manifest: resolvedManifest,
        draftCatalogPath,
        routeCatalogPath,
        publicDataRoot,
        allowSnapshotFallback,
        snapshotDir: outputDir,
        generatedAt,
        log,
      });
      prepared.push({ slug, snapshot });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ slug, error: message });
      log("error", `route snapshot: failed for ${slug}: ${message}`);
    }
  }
  if (strict && errors.length > 0) {
    throw new Error(
      `Featured route snapshot preflight failed: ${errors.map(({ slug, error }) => `${slug}: ${error}`).join("; ")}`,
    );
  }
  for (const { slug, snapshot } of prepared) {
    try {
      const { target, changed } = await writeSnapshotAtomic(slug, snapshot, { outputDir });
      if (changed) {
        written.push({ slug, path: target });
        log("info", `route snapshot: wrote ${slug} (${snapshot.route.geometry.length} coords)`);
      } else {
        log("info", `route snapshot: unchanged ${slug}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ slug, error: message });
      log("error", `route snapshot: failed for ${slug}: ${message}`);
    }
  }
  if (strict && errors.length > 0) {
    throw new Error(
      `Featured route snapshot write failed: ${errors.map(({ slug, error }) => `${slug}: ${error}`).join("; ")}`,
    );
  }

  // Orphan cleanup: drop snapshots for routes no longer in the catalog.
  const routeSet = new Set(routeSlugs);
  const removed = [];
  for (const slug of await listSnapshotSlugs(outputDir)) {
    if (!routeSet.has(slug)) {
      await rm(resolve(outputDir, `${slug}.json`), { force: true });
      removed.push(slug);
      log("info", `route snapshot: removed orphan ${slug}`);
    }
  }

  return { written, removed, errors };
}

// Validate snapshots without rewriting them. Returns a list of failure strings.
export async function checkFeaturedRouteSnapshots({
  draftCatalogPath = null,
  routeCatalogPath = routeCatalogPublicPath,
  publicDataRoot = publicDataDir,
  snapshotDir = featuredRoutesDir,
  log = defaultLog,
} = {}) {
  const failures = [];
  const manifest = await readJsonOrNull(resolve(publicDataRoot, "map-manifest.json"));
  if (!manifest) {
    return { failures: ["map-manifest.json not found"], orphans: [] };
  }
  const { mapVersion } = loadManifestSource(manifest);
  const routeSlugs = await readRouteCatalogSlugs({
    routeCatalogPath,
    draftCatalogPath,
  });
  const routeSet = new Set(routeSlugs);

  for (const slug of routeSlugs) {
    const snapshot = await readJsonOrNull(resolve(snapshotDir, `${slug}.json`));
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
      routeToken = await resolveRouteTokenForSlug(slug, {
        draftCatalogPath,
        routeCatalogPath,
        log,
      });
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
  const orphans = (await listSnapshotSlugs(snapshotDir)).filter((slug) => !routeSet.has(slug));
  for (const slug of orphans) {
    failures.push(`${slug}: orphan snapshot (slug no longer featured)`);
  }

  return { failures, orphans };
}
