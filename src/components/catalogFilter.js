import {
  routePassesThroughPlaceIds,
  routeStartPlaceIds,
  routeSurfaceType,
} from "@cycleways/core/data/catalog.js";

const DISTANCE_BUCKETS = ["short", "medium", "long"];
const DIFFICULTY_BUCKETS = ["easy", "moderate", "hard"];

function distanceBucketOf(km) {
  if (km < 10) return "short";
  if (km <= 25) return "medium";
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

export { distanceBucketOf, DISTANCE_BUCKETS, DIFFICULTY_BUCKETS };
