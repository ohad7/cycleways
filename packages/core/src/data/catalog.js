import { primaryPoiImage } from "./poiTypes.js";
import { getJsonAsset, resolveAssetPath } from "../platform/assets.js";
import { assetPathWithVersion, loadMapManifest } from "./mapAssets.js";

const ROUTE_CATALOG_PATH = "public-data/route-catalog.json";
const EMPTY_ROUTE_CATALOG = { version: 1, entries: [] };
let catalogPromise = null;

export async function loadRouteCatalogWithAssetLoader(loadJsonAsset = getJsonAsset, options = {}) {
  const { manifest = null, ...assetOptions } = options;
  const catalogPath = manifest?.routeCatalog
    ? resolveAssetPath(manifest.routeCatalog, "public-data/map-manifest.json")
    : ROUTE_CATALOG_PATH;
  const catalog = await loadJsonAsset(
    assetPathWithVersion(catalogPath, manifest?.version),
    assetOptions,
  );
  return catalog && typeof catalog === "object" ? catalog : EMPTY_ROUTE_CATALOG;
}

export function loadCatalog() {
  if (catalogPromise) return catalogPromise;
  catalogPromise = loadMapManifest()
    .then((manifest) => loadRouteCatalogWithAssetLoader(getJsonAsset, { manifest }))
    .catch((err) => {
      console.warn("loadCatalog failed", err);
      return EMPTY_ROUTE_CATALOG;
    });
  return catalogPromise;
}

export const loadRouteCatalog = loadCatalog;

export async function loadRouteCatalogEntries() {
  const catalog = await loadRouteCatalog();
  return Array.isArray(catalog?.entries) ? catalog.entries : [];
}

export function findCatalogEntryBySlug(catalog, slug) {
  return catalog?.entries?.find((e) => e.slug === slug) || null;
}

export const findRouteCatalogEntryBySlug = findCatalogEntryBySlug;

export function routeShapeType(entry) {
  const shape = entry?.routeShape;
  const value = typeof shape === "string" ? shape : shape?.type;
  if (value === "circular" || value === "loop") return "circular";
  if (value === "one_way" || value === "one-way" || value === "point_to_point") {
    return "one_way";
  }
  return null;
}

export function routeShapeLabel(entry) {
  const type = routeShapeType(entry);
  if (type === "circular") return "מעגלי";
  if (type === "one_way") return "חד כיווני";
  return "";
}

function normalizedPlaceIds(value) {
  if (Array.isArray(value)) {
    return value.filter((id) => typeof id === "string" && id.length > 0);
  }
  if (typeof value === "string" && value.length > 0) return [value];
  return [];
}

export function routePassesThroughPlaceIds(entry) {
  return normalizedPlaceIds(entry?.passesNear);
}

export function routeStartPlaceIds(entry) {
  const explicit = [
    ...normalizedPlaceIds(entry?.startPlaceIds),
    ...normalizedPlaceIds(entry?.startPlaceId),
    ...normalizedPlaceIds(entry?.start?.placeIds),
    ...normalizedPlaceIds(entry?.start?.placeId),
  ];
  if (explicit.length > 0) return [...new Set(explicit)];
  if (routeShapeType(entry) === "circular") return routePassesThroughPlaceIds(entry);
  return [];
}

export function routeDifficultyLabel(entryOrDifficulty) {
  const difficulty =
    typeof entryOrDifficulty === "string"
      ? entryOrDifficulty
      : entryOrDifficulty?.difficulty;
  if (difficulty === "easy") return "קל";
  if (difficulty === "moderate") return "בינוני";
  if (difficulty === "hard") return "קשה";
  return difficulty || "";
}

export function routeSurfaceType(entry) {
  const explicit = entry?.surfaceType || entry?.surface;
  if (explicit === "paved" || explicit === "asphalt") return "paved";
  if (explicit === "mixed" || explicit === "paved_dirt" || explicit === "paved/dirt") {
    return "mixed";
  }
  if (explicit === "dirt" || explicit === "gravel" || explicit === "offroad") return "dirt";

  const roadMix = entry?.roadMix;
  if (!roadMix || typeof roadMix !== "object") return null;
  const pavedShare = (Number(roadMix.paved) || 0) + (Number(roadMix.road) || 0);
  const dirtShare = Number(roadMix.dirt) || 0;
  if (pavedShare >= 0.8) return "paved";
  if (dirtShare >= 0.8) return "dirt";
  if (pavedShare > 0 || dirtShare > 0) return "mixed";
  return null;
}

export function routeSurfaceLabel(entry) {
  const type = routeSurfaceType(entry);
  if (type === "paved") return "סלול";
  if (type === "mixed") return "סלול/שטח";
  if (type === "dirt") return "שטח";
  return "";
}

function normalizedCatalogImage(image) {
  if (!image || typeof image !== "object") return null;
  const photo = typeof image.photo === "string" ? image.photo.trim() : "";
  if (!photo) return null;
  const thumbnail =
    typeof image.thumbnail === "string" && image.thumbnail.trim()
      ? image.thumbnail.trim()
      : photo;
  const alt = typeof image.alt === "string" ? image.alt.trim() : "";
  return { photo, thumbnail, alt };
}

export function routeDisplayImage(entry, snapshot = null) {
  const hero = normalizedCatalogImage(entry?.heroImage);
  if (hero) return hero;

  const start = primaryPoiImage(entry?.start);
  if (start) return { ...start, alt: entry?.start?.name || entry?.name || "" };

  const end = primaryPoiImage(entry?.end);
  if (end) return { ...end, alt: entry?.end?.name || entry?.name || "" };

  const snapshotImage =
    normalizedCatalogImage(snapshot?.displayImage) ||
    normalizedCatalogImage(snapshot?.route?.displayImage);
  if (snapshotImage) return snapshotImage;

  const activeDataPoints = Array.isArray(snapshot?.pois?.activeDataPoints)
    ? snapshot.pois.activeDataPoints
    : [];
  const orderedPoints = activeDataPoints.slice().sort((a, b) => {
    const ap = Number.isFinite(a?.routeProgressMeters)
      ? a.routeProgressMeters
      : Number.POSITIVE_INFINITY;
    const bp = Number.isFinite(b?.routeProgressMeters)
      ? b.routeProgressMeters
      : Number.POSITIVE_INFINITY;
    if (ap !== bp) return ap - bp;
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  });
  for (const point of orderedPoints) {
    const image = primaryPoiImage(point);
    if (image) return { ...image, alt: point.name || entry?.name || "" };
  }

  return null;
}

export function routeCardImage(entry, snapshot = null) {
  const routeMap = routeMapImage(entry);
  if (routeMap) return routeMap;

  const snapshotImage =
    normalizedCatalogImage(snapshot?.route?.displayImage) ||
    normalizedCatalogImage(snapshot?.displayImage);
  if (snapshotImage) return snapshotImage;

  return routeDisplayImage(entry, snapshot);
}

export function routeMapImage(entry) {
  return normalizedCatalogImage(entry?.routeMapImage);
}

// Logical asset path of a catalog entry's display thumbnail (preferring the
// small -thumb variant), or null. Mirrors the web Discover card's
// routeDisplayImage fallback chain (heroImage -> start/end POI photo -> ...) so
// routes without an explicit heroImage (e.g. סובב בית הלל) still get a photo.
// Used by the native Discover cards AND the offline asset-sync bundler to agree
// on which image to ship/look up (apps/mobile ROUTE_IMAGES map).
export function routeThumbnailPath(entry) {
  const image = routeDisplayImage(entry);
  const t = image?.thumbnail || image?.photo;
  return typeof t === "string" && t.length > 0 ? t : null;
}
