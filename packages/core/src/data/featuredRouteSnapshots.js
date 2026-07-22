import { getJsonAsset, resolveAssetPath } from "../platform/assets.js";
import { assetPathWithVersion, loadMapManifest } from "./mapAssets.js";
import { emptyRouteSnapshot } from "../routing/routeSnapshot.js";

const FEATURED_ROUTES_BASE_PATH = "public-data/featured-routes";
const SUPPORTED_SCHEMA_VERSION = 1;

function featuredRouteSnapshotPath(slug, manifest = null) {
  const base = manifest?.featuredRoutesBase || FEATURED_ROUTES_BASE_PATH.replace(/^public-data\//, "");
  return resolveAssetPath(`${base}/${slug}.json`, "public-data/map-manifest.json");
}

function validateSnapshot(snapshot, slug) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error(`featured route snapshot "${slug}" is not an object`);
  }
  if (snapshot.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `featured route snapshot "${slug}" has unsupported schemaVersion ${snapshot.schemaVersion}`,
    );
  }
  if (snapshot.slug !== slug) {
    throw new Error(
      `featured route snapshot slug mismatch: requested "${slug}", got "${snapshot.slug}"`,
    );
  }
  const geometry = snapshot.route?.geometry;
  if (!Array.isArray(geometry) || geometry.length < 2) {
    throw new Error(
      `featured route snapshot "${slug}" has fewer than 2 geometry coordinates`,
    );
  }
  if (!snapshot.source || typeof snapshot.source !== "object") {
    throw new Error(`featured route snapshot "${slug}" is missing source metadata`);
  }
  return snapshot;
}

export async function loadFeaturedRouteSnapshot(slug, options = {}) {
  if (!slug) {
    throw new Error("loadFeaturedRouteSnapshot requires a slug");
  }
  const { manifest: suppliedManifest = null, ...assetOptions } = options;
  const manifest = suppliedManifest || await loadMapManifest(assetOptions);
  const snapshot = await getJsonAsset(
    assetPathWithVersion(
      featuredRouteSnapshotPath(slug, manifest),
      manifest?.version,
    ),
    assetOptions,
  );
  const validated = validateSnapshot(snapshot, slug);
  if (
    manifest?.version &&
    validated.source?.mapVersion !== manifest.version
  ) {
    throw new Error(
      `featured route snapshot "${slug}" targets map ${validated.source?.mapVersion}, expected ${manifest.version}`,
    );
  }
  return validated;
}

export const loadRouteSnapshot = loadFeaturedRouteSnapshot;

export function snapshotToRouteState(snapshot) {
  const route = snapshot?.route || {};
  const pois = snapshot?.pois || {};
  return {
    ...emptyRouteSnapshot(),
    geometry: Array.isArray(route.geometry) ? route.geometry : [],
    selectedSegments: Array.isArray(route.selectedSegments)
      ? route.selectedSegments
      : [],
    distance: Number.isFinite(route.distance) ? route.distance : 0,
    elevationGain: Number.isFinite(route.elevationGain) ? route.elevationGain : 0,
    elevationLoss: Number.isFinite(route.elevationLoss) ? route.elevationLoss : 0,
    activeDataPoints: Array.isArray(pois.activeDataPoints)
      ? pois.activeDataPoints
      : [],
    points: [],
    routeFailure: null,
  };
}

export const routeSnapshotToRouteState = snapshotToRouteState;
