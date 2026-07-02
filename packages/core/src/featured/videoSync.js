import {
  buildCumulativeDistances,
  nearestPointOnPolyline,
  pointAtFraction,
} from "../domain/routeGeometryMath.js";

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
  for (const keyframe of keyframes) {
    if (
      keyframe.fraction != null &&
      (
        typeof keyframe.fraction !== "number" ||
        !Number.isFinite(keyframe.fraction) ||
        keyframe.fraction < 0 ||
        keyframe.fraction > 1
      )
    ) {
      throw new Error("videoSync keyframe fraction must be between 0 and 1");
    }
  }
}

// Convert legacy `lon` to `lng` if present (keyframe JSON uses `lon`).
function normalizeKeyframe(k) {
  return { t: k.t, lat: k.lat, lng: k.lng ?? k.lon, fraction: k.fraction };
}

export function createVideoSync(input) {
  assertValid(input);
  const { videoDuration, routeGeometry } = input;
  const keyframes = input.keyframes.map(normalizeKeyframe);

  const cumulative = buildCumulativeDistances(routeGeometry);

  const byTime = keyframes.map((k) => {
    if (Number.isFinite(k.fraction)) {
      return { t: k.t, fraction: k.fraction };
    }
    const snap = nearestPointOnPolyline(k, routeGeometry, cumulative);
    return { t: k.t, fraction: snap.fraction };
  });

  if (byTime[0].t > 0) {
    byTime.unshift({ t: 0, fraction: 0 });
  } else {
    byTime[0] = { ...byTime[0], fraction: 0 };
  }

  const lastIndex = byTime.length - 1;
  if (byTime[lastIndex].t < videoDuration) {
    byTime.push({ t: videoDuration, fraction: 1 });
  } else {
    byTime[lastIndex] = { ...byTime[lastIndex], fraction: 1 };
  }

  // For positionToTime we need byTime sorted by fraction. Defensive copy + sort.
  const byFraction = byTime
    .map(({ t, fraction }) => ({ t, fraction }))
    .sort((a, b) => (a.fraction - b.fraction) || (a.t - b.t));

  function positionToTime(fraction) {
    const clamped = Math.max(0, Math.min(1, fraction));
    if (clamped <= byFraction[0].fraction) return byFraction[0].t;
    if (clamped >= byFraction[byFraction.length - 1].fraction) {
      return byFraction[byFraction.length - 1].t;
    }

    let lo = -1;
    let hi = byFraction.length;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (byFraction[mid].fraction >= clamped) hi = mid;
      else lo = mid;
    }
    const a = byFraction[Math.max(0, hi - 1)];
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
