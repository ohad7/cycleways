export const EARTH_RADIUS_M = 6371000;
export const DEG = Math.PI / 180;

export function haversineMeters(a, b) {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function buildCumulativeDistances(polyline) {
  const result = [0];
  for (let i = 1; i < polyline.length; i++) {
    result.push(result[i - 1] + haversineMeters(polyline[i - 1], polyline[i]));
  }
  return result;
}

export function projectPointToRouteCandidates(
  point,
  polyline,
  cumulativeDistances,
  options = {},
) {
  const maxDistanceMeters = Number.isFinite(options.maxDistanceMeters)
    ? options.maxDistanceMeters
    : Infinity;
  const candidates = [];

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const cosLat = Math.cos(((a.lat + b.lat) / 2) * DEG);
    const ax = a.lng * cosLat;
    const ay = a.lat;
    const bx = b.lng * cosLat;
    const by = b.lat;
    const px = point.lng * cosLat;
    const py = point.lat;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));

    const lat = a.lat + (b.lat - a.lat) * t;
    const lng = a.lng + (b.lng - a.lng) * t;
    const distanceMeters = haversineMeters(point, { lat, lng });
    if (distanceMeters > maxDistanceMeters) continue;

    const segLen = cumulativeDistances[i + 1] - cumulativeDistances[i];
    const along = cumulativeDistances[i] + t * segLen;
    const total = cumulativeDistances[cumulativeDistances.length - 1];
    candidates.push({
      index: i,
      t,
      fraction: total > 0 ? along / total : 0,
      distanceMeters,
      lat,
      lng,
    });
  }

  candidates.sort(
    (a, b) =>
      (a.distanceMeters - b.distanceMeters) ||
      (a.fraction - b.fraction) ||
      (a.index - b.index),
  );
  return candidates;
}

// Returns { index, fraction (0..1 along the route), distanceMeters }.
export function nearestPointOnPolyline(point, polyline, cumulativeDistances) {
  const [best] = projectPointToRouteCandidates(point, polyline, cumulativeDistances);
  if (!best) {
    return { index: 0, fraction: 0, distanceMeters: Infinity };
  }
  return {
    index: best.index,
    fraction: best.fraction,
    distanceMeters: best.distanceMeters,
  };
}

export function pointAtFraction(polyline, cumulativeDistances, fraction) {
  const f = Math.max(0, Math.min(1, fraction));
  const total = cumulativeDistances[cumulativeDistances.length - 1];
  const target = total * f;
  let lo = 0;
  let hi = cumulativeDistances.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumulativeDistances[mid] <= target) lo = mid;
    else hi = mid;
  }
  const segLen = cumulativeDistances[hi] - cumulativeDistances[lo];
  const segT = segLen > 0 ? (target - cumulativeDistances[lo]) / segLen : 0;
  const a = polyline[lo];
  const b = polyline[hi];
  return {
    lat: a.lat + (b.lat - a.lat) * segT,
    lng: a.lng + (b.lng - a.lng) * segT,
    fraction: f,
  };
}
