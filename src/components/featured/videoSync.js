const EARTH_RADIUS_M = 6371000;
const DEG = Math.PI / 180;

function assertValid({ keyframes, videoDuration, routeGeometry }) {
  if (!Array.isArray(keyframes) || keyframes.length < 2) {
    throw new Error("videoSync requires at least 2 keyframes");
  }
  for (let i = 1; i < keyframes.length; i++) {
    if (keyframes[i].t <= keyframes[i - 1].t) {
      throw new Error("videoSync keyframes must be sorted by t (strictly increasing)");
    }
  }
  if (keyframes[0].t < 0) {
    throw new Error("videoSync first keyframe must have t >= 0");
  }
  if (keyframes[keyframes.length - 1].t > videoDuration) {
    throw new Error("videoSync last keyframe t must be <= videoDuration");
  }
  if (!Array.isArray(routeGeometry) || routeGeometry.length < 2) {
    throw new Error("videoSync route geometry must have at least 2 points");
  }
}

function haversineMeters(a, b) {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// Returns { index, fraction (0..1 along the route), distanceMeters }
function nearestPointOnPolyline(point, polyline, cumulativeDistances) {
  let best = { index: 0, t: 0, dist: Infinity };
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    // Approximate local plane: scale lng by cos(lat) for projection.
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
    const projLat = a.lat + (b.lat - a.lat) * t;
    const projLng = a.lng + (b.lng - a.lng) * t;
    const d = haversineMeters(point, { lat: projLat, lng: projLng });
    if (d < best.dist) {
      best = { index: i, t, dist: d };
    }
  }
  const segLen =
    cumulativeDistances[best.index + 1] - cumulativeDistances[best.index];
  const along = cumulativeDistances[best.index] + best.t * segLen;
  const total = cumulativeDistances[cumulativeDistances.length - 1];
  return {
    index: best.index,
    fraction: total > 0 ? along / total : 0,
    distanceMeters: best.dist,
  };
}

function pointAtFraction(polyline, cumulativeDistances, fraction) {
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

function buildCumulativeDistances(polyline) {
  const result = [0];
  for (let i = 1; i < polyline.length; i++) {
    result.push(result[i - 1] + haversineMeters(polyline[i - 1], polyline[i]));
  }
  return result;
}

// Convert legacy `lon` to `lng` if present (keyframe JSON uses `lon`).
function normalizeKeyframe(k) {
  return { t: k.t, lat: k.lat, lng: k.lng ?? k.lon };
}

export function createVideoSync(input) {
  assertValid(input);
  const { videoDuration, routeGeometry } = input;
  const keyframes = input.keyframes.map(normalizeKeyframe);

  const cumulative = buildCumulativeDistances(routeGeometry);

  const byTime = keyframes.map((k) => {
    const snap = nearestPointOnPolyline(k, routeGeometry, cumulative);
    return { t: k.t, fraction: snap.fraction };
  });

  // For positionToTime we need byTime sorted by fraction. Defensive copy + sort.
  const byFraction = byTime
    .map(({ t, fraction }) => ({ t, fraction }))
    .sort((a, b) => a.fraction - b.fraction);

  function positionToTime(fraction) {
    const clamped = Math.max(0, Math.min(1, fraction));
    let lo = 0;
    let hi = byFraction.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (byFraction[mid].fraction <= clamped) lo = mid;
      else hi = mid;
    }
    const a = byFraction[lo];
    const b = byFraction[hi];
    const span = b.fraction - a.fraction;
    let localT = span > 0 ? (clamped - a.fraction) / span : 0;
    localT = Math.max(0, Math.min(1, localT));
    return a.t + (b.t - a.t) * localT;
  }

  function timeToPosition(t) {
    const clamped = Math.max(0, Math.min(videoDuration, t));
    let lo = 0;
    let hi = byTime.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (byTime[mid].t <= clamped) lo = mid;
      else hi = mid;
    }
    const a = byTime[lo];
    const b = byTime[hi];
    const span = b.t - a.t;
    let localT = span > 0 ? (clamped - a.t) / span : 0;
    // Clamp so extrapolation can't happen when the requested time is outside
    // the keyframe range (e.g., video plays before first keyframe or after last).
    localT = Math.max(0, Math.min(1, localT));
    const fraction = a.fraction + (b.fraction - a.fraction) * localT;
    return pointAtFraction(routeGeometry, cumulative, fraction);
  }

  function snapClickToRoute(latLng, maxMeters = 80) {
    const snap = nearestPointOnPolyline(latLng, routeGeometry, cumulative);
    if (snap.distanceMeters > maxMeters) return null;
    return { fraction: snap.fraction, distanceMeters: snap.distanceMeters };
  }

  return {
    timeToPosition,
    positionToTime,
    snapClickToRoute,
  };
}
