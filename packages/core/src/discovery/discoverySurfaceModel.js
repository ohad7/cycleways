import {
  catalogFilter,
  placeOptionsForEntries,
  routeDifficultyLabel,
  routeDisplayImage,
  routeMapImage,
  routePassesThroughPlaceIds,
  routeShapeLabel,
  routeStartPlaceIds,
  routeSurfaceLabel,
} from "../data/catalog.js";
import {
  distanceToRouteStartMeters,
  formatDistanceFromUser,
  sortByDistanceFromUser,
} from "../data/nearMe.js";
import { discoverRouteColor } from "../map/discoverRouteColors.js";

export function createPlaceById(places) {
  const map = new Map();
  for (const place of Array.isArray(places) ? places : []) {
    if (place?.id) map.set(place.id, place);
  }
  return map;
}

export function hasActiveDiscoverFilters(filters) {
  if (!filters) return false;
  return Object.values(filters).some(
    (value) => value instanceof Set && value.size > 0,
  );
}

export function selectDiscoverRoutes(entries, filters) {
  const list = Array.isArray(entries) ? entries : [];
  if (!hasActiveDiscoverFilters(filters)) {
    return { mode: "all", routes: list };
  }
  return { mode: "results", routes: catalogFilter(list, filters) };
}

export function buildDiscoveryFilterOptions(entries, placeById) {
  return {
    startPlaceOptions: placeOptionsForEntries(
      entries,
      placeById,
      routeStartPlaceIds,
    ),
    throughPlaceOptions: placeOptionsForEntries(
      entries,
      placeById,
      routePassesThroughPlaceIds,
    ),
  };
}

export function buildDiscoveryRoutes({
  entries,
  filters,
  locationFix,
  nearMeSort = false,
  placeById,
} = {}) {
  const selected = selectDiscoverRoutes(entries, filters);
  const routes =
    nearMeSort && locationFix
      ? sortByDistanceFromUser(selected.routes, placeById, locationFix)
      : selected.routes;
  return { ...selected, routes };
}

export function featuredDiscoveryRoutes(entries, limit = 3) {
  const routes = (Array.isArray(entries) ? entries : []).filter(
    (entry) => entry?.featured,
  );
  return Number.isFinite(limit) && limit > 0 ? routes.slice(0, limit) : routes;
}

export function routePlaceNames(entry, placeById, limit = 3) {
  return (entry?.passesNear || [])
    .map((id) => placeById?.get?.(id)?.name)
    .filter(Boolean)
    .slice(0, limit);
}

export function formatRouteKm(km) {
  const value = Number(km);
  return Number.isFinite(value) ? `${value.toFixed(1)} ק״מ` : "";
}

export function formatRouteElevation(meters) {
  const value = Number(meters);
  return Number.isFinite(value) ? `${Math.round(value)} מ׳ טיפוס` : "";
}

export function routeCardViewModel(
  entry,
  { index = 0, locationFix = null, placeById = null } = {},
) {
  const image = routeMapImage(entry) || routeDisplayImage(entry);
  const distanceFromUserMeters = distanceToRouteStartMeters(
    entry,
    placeById,
    locationFix,
  );
  const stats = [
    formatRouteKm(entry?.distanceKm),
    formatRouteElevation(entry?.elevationGainM),
    routeDifficultyLabel(entry),
    routeSurfaceLabel(entry),
    routeShapeLabel(entry),
  ].filter(Boolean);

  return {
    slug: entry?.slug || "",
    name: entry?.name || "מסלול",
    route: entry?.route || "",
    summary: entry?.summary || "",
    featured: Boolean(entry?.featured),
    image,
    stats,
    placeNames: routePlaceNames(entry, placeById),
    color: discoverRouteColor(index),
    distanceFromUserLabel: formatDistanceFromUser(distanceFromUserMeters),
    entry,
  };
}

export function buildRouteCardViewModels(
  entries,
  { locationFix = null, placeById = null } = {},
) {
  return (Array.isArray(entries) ? entries : []).map((entry, index) =>
    routeCardViewModel(entry, { index, locationFix, placeById }),
  );
}

export function buildRecommendedRouteOverlays({
  brightSlugs = [],
  ghostSlugs = [],
  geometriesBySlug = {},
  hoveredSlug = null,
  orderedSlugs = [],
  peekMode = false,
} = {}) {
  const bright = new Set(brightSlugs);
  const drawSlugs = peekMode ? brightSlugs : [...brightSlugs, ...ghostSlugs];
  return drawSlugs
    .map((slug) => {
      const geometry = geometriesBySlug?.[slug];
      if (!Array.isArray(geometry) || geometry.length < 2) return null;
      const index = orderedSlugs.indexOf(slug);
      return {
        slug,
        geometry,
        hovered: !peekMode && slug === hoveredSlug,
        tier: peekMode || bright.has(slug) ? "bright" : "ghost",
        color: discoverRouteColor(index >= 0 ? index : 0),
      };
    })
    .filter(Boolean);
}
