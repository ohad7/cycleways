// Pure "near me" helpers for Discover: distance from a one-shot location fix
// to a route's start, derived from the route's start places (places.json
// coordinates). Routes without a resolvable start place get null / sort last.
import { getDistance } from "../utils/distance.js";
import { routeStartPlaceIds } from "./catalog.js";

export function distanceToRouteStartMeters(entry, placeById, fix) {
  if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return null;
  let best = null;
  for (const id of routeStartPlaceIds(entry)) {
    const place = placeById?.get?.(id);
    if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) continue;
    const d = getDistance({ lat: fix.lat, lng: fix.lng }, { lat: place.lat, lng: place.lng });
    if (best === null || d < best) best = d;
  }
  return best;
}

export function formatDistanceFromUser(meters) {
  if (!Number.isFinite(meters)) return "";
  if (meters < 1000) return `כ-${Math.round(meters)} מ׳ ממך`;
  return `כ-${(meters / 1000).toFixed(1)} ק"מ ממך`;
}

export function sortByDistanceFromUser(entries, placeById, fix) {
  const list = Array.isArray(entries) ? entries : [];
  if (!fix) return list;
  return list
    .map((entry, index) => ({
      entry,
      index,
      d: distanceToRouteStartMeters(entry, placeById, fix),
    }))
    .sort((a, b) => {
      if (a.d === null && b.d === null) return a.index - b.index;
      if (a.d === null) return 1;
      if (b.d === null) return -1;
      return a.d - b.d || a.index - b.index;
    })
    .map((item) => item.entry);
}
