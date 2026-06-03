import { getJsonAsset } from "../platform/assets.js";
import { emptyRouteSnapshot } from "../routing/routeSnapshot.js";

const FEATURED_ROUTES_BASE_PATH = "public-data/featured-routes";
const SUPPORTED_SCHEMA_VERSION = 1;

function featuredRouteSnapshotPath(slug) {
  return `${FEATURED_ROUTES_BASE_PATH}/${slug}.json`;
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
  const snapshot = await getJsonAsset(featuredRouteSnapshotPath(slug), options);
  return validateSnapshot(snapshot, slug);
}

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
