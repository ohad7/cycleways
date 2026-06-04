import { primaryPoiImage } from "./poiTypes.js";

let catalogPromise = null;

export function loadCatalog() {
  if (catalogPromise) return catalogPromise;
  const base = (import.meta.env?.BASE_URL || "/").replace(/\/?$/, "/");
  catalogPromise = fetch(`${base}public-data/route-catalog.json`)
    .then((r) => (r.ok ? r.json() : { version: 1, entries: [] }))
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

export function findCatalogEntryBySlug(catalog, slug) {
  return catalog?.entries?.find((e) => e.slug === slug) || null;
}

export const findRouteCatalogEntryBySlug = findCatalogEntryBySlug;

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
