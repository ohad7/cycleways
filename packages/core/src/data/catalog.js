import { primaryPoiImage } from "./poiTypes.js";
import { getJsonAsset } from "../platform/assets.js";

let catalogPromise = null;
let placesPromise = null;

export const DISCOVERY_FILTER_GROUPS = [
  {
    axis: "difficulty",
    label: "רמת קושי",
    options: [
      { value: "easy", label: "קל" },
      { value: "moderate", label: "בינוני" },
      { value: "hard", label: "קשה" },
    ],
  },
  {
    axis: "surface",
    label: "משטח",
    options: [
      { value: "paved", label: "סלול" },
      { value: "mixed", label: "שטח/סלול" },
      { value: "dirt", label: "שטח" },
    ],
  },
  {
    axis: "distance",
    label: "אורך",
    options: [
      { value: "short", label: "עד 10 ק״מ" },
      { value: "medium", label: "10-25 ק״מ" },
      { value: "long", label: "25 ק״מ ומעלה" },
    ],
  },
];

export function createEmptyCatalogFilters() {
  return {
    difficulty: new Set(),
    surface: new Set(),
    distance: new Set(),
    startLocation: new Set(),
    throughLocation: new Set(),
  };
}

export function loadCatalog() {
  if (catalogPromise) return catalogPromise;
  catalogPromise = getJsonAsset("public-data/route-catalog.json")
    .catch((err) => {
      console.warn("loadCatalog failed", err);
      return { version: 1, entries: [] };
    });
  return catalogPromise;
}

export const loadRouteCatalog = loadCatalog;

export async function loadRouteCatalogEntries() {
  const catalog = await loadRouteCatalog();
  return Array.isArray(catalog?.entries) ? catalog.entries : [];
}

export function loadPlacesData() {
  if (placesPromise) return placesPromise;
  placesPromise = getJsonAsset("data/places.json").catch((err) => {
    console.warn("loadPlaces failed", err);
    return { version: 1, places: [] };
  });
  return placesPromise;
}

export async function loadPlaces() {
  const data = await loadPlacesData();
  return Array.isArray(data?.places) ? data.places : [];
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

export const DISTANCE_BUCKETS = ["short", "medium", "long"];
export const DIFFICULTY_BUCKETS = ["easy", "moderate", "hard"];

export function distanceBucketOf(km) {
  const value = Number(km);
  if (value < 10) return "short";
  if (value <= 25) return "medium";
  return "long";
}

function hasMembers(set) {
  return set && typeof set.size === "number" && set.size > 0;
}

export function catalogFilter(catalog, filters) {
  const f = filters || {};
  const filtered = (catalog || []).filter((entry) => {
    if (f.place && f.place !== "any") {
      if (!routePassesThroughPlaceIds(entry).includes(f.place)) {
        return false;
      }
    }
    if (hasMembers(f.startLocation)) {
      const starts = routeStartPlaceIds(entry);
      if (!starts.some((id) => f.startLocation.has(id))) return false;
    }
    if (hasMembers(f.throughLocation)) {
      const through = routePassesThroughPlaceIds(entry);
      if (!through.some((id) => f.throughLocation.has(id))) return false;
    }
    if (hasMembers(f.region) && !f.region.has(entry.regionId)) return false;
    if (hasMembers(f.difficulty) && !f.difficulty.has(entry.difficulty)) return false;
    if (hasMembers(f.style) && !f.style.has(entry.style)) return false;
    if (hasMembers(f.surface) && !f.surface.has(routeSurfaceType(entry))) return false;
    if (hasMembers(f.distance)) {
      const bucket = distanceBucketOf(entry.distanceKm);
      if (!f.distance.has(bucket)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0));
  return filtered;
}

export function placeOptionsForEntries(entries, placeById, placeIdsForEntry) {
  const counts = new Map();
  for (const entry of entries || []) {
    for (const id of placeIdsForEntry(entry)) {
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  return Array.from(counts.keys())
    .map((id) => ({
      value: id,
      label: placeById.get(id)?.name || id,
      count: counts.get(id) || 0,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "he"));
}
