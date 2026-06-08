// Return the points whose cumulative distance (meters) falls within
// [startM, endM]. Inclusive of the boundary points. Format-agnostic: `points`
// is whatever the route geometry holds; only `cumMeters` indices are compared.
export function routeSliceForRange(points, cumMeters, startM, endM) {
  if (!Array.isArray(points) || points.length < 2) return [];
  if (!Array.isArray(cumMeters) || cumMeters.length !== points.length) return [];
  if (!(endM > startM)) return [];
  const out = [];
  for (let i = 0; i < points.length; i += 1) {
    if (cumMeters[i] >= startM && cumMeters[i] <= endM) out.push(points[i]);
  }
  return out.length >= 2 ? out : [];
}
