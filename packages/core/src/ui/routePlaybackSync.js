import {
  buildCumulativeDistances,
  nearestPointOnPolyline,
  pointAtFraction,
} from "../domain/routeGeometryMath.js";

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function clampTime(value, duration) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(duration, number));
}

export function createLinearRoutePlaybackSync({
  durationSeconds,
  routeGeometry,
}) {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("route playback duration must be a positive number");
  }
  if (!Array.isArray(routeGeometry) || routeGeometry.length < 2) {
    throw new Error("route playback geometry must have at least 2 points");
  }

  const cumulative = buildCumulativeDistances(routeGeometry);

  function timeToPosition(timeSeconds) {
    const t = clampTime(timeSeconds, duration);
    const fraction = duration > 0 ? t / duration : 0;
    return pointAtFraction(routeGeometry, cumulative, fraction);
  }

  function positionToTime(routeFraction) {
    return clamp01(routeFraction) * duration;
  }

  function snapClickToRoute(latLng, maxMeters = 80) {
    const snap = nearestPointOnPolyline(latLng, routeGeometry, cumulative);
    if (snap.distanceMeters > maxMeters) return null;
    const position = pointAtFraction(routeGeometry, cumulative, snap.fraction);
    return {
      lat: position.lat,
      lng: position.lng,
      fraction: snap.fraction,
      distanceMeters: snap.distanceMeters,
    };
  }

  return {
    durationSeconds: duration,
    timeToPosition,
    positionToTime,
    snapClickToRoute,
  };
}

export function createVariableSpeedRoutePlaybackSync({
  baseDurationSeconds,
  routeGeometry,
  routeDistanceMeters,
  cueSlides = [],
  cueMaxFraction = 0,
  cueMaxMeters = 0,
  fastRate = 2,
}) {
  const baseDuration = Number(baseDurationSeconds);
  if (!Number.isFinite(baseDuration) || baseDuration <= 0) {
    throw new Error("route playback base duration must be a positive number");
  }
  if (!Array.isArray(routeGeometry) || routeGeometry.length < 2) {
    throw new Error("route playback geometry must have at least 2 points");
  }

  const timeline = buildVariableSpeedTimeline({
    baseDurationSeconds: baseDuration,
    routeDistanceMeters,
    cueFractions: cueSlides
      .map((slide) => Number(slide?.routeFraction))
      .filter(Number.isFinite),
    cueMaxFraction,
    cueMaxMeters,
    fastRate,
  });
  const cumulative = buildCumulativeDistances(routeGeometry);

  function timeToPosition(timeSeconds) {
    const fraction = timeline.timeToFraction(timeSeconds);
    return pointAtFraction(routeGeometry, cumulative, fraction);
  }

  function positionToTime(routeFraction) {
    return timeline.fractionToTime(routeFraction);
  }

  function snapClickToRoute(latLng, maxMeters = 80) {
    const snap = nearestPointOnPolyline(latLng, routeGeometry, cumulative);
    if (snap.distanceMeters > maxMeters) return null;
    const position = pointAtFraction(routeGeometry, cumulative, snap.fraction);
    return {
      lat: position.lat,
      lng: position.lng,
      fraction: snap.fraction,
      distanceMeters: snap.distanceMeters,
    };
  }

  return {
    durationSeconds: timeline.durationSeconds,
    timeline,
    timeToPosition,
    positionToTime,
    snapClickToRoute,
  };
}

export function buildVariableSpeedTimeline({
  baseDurationSeconds,
  routeDistanceMeters,
  cueFractions = [],
  cueMaxFraction = 0,
  cueMaxMeters = 0,
  fastRate = 2,
} = {}) {
  const baseDuration = Number(baseDurationSeconds);
  if (!Number.isFinite(baseDuration) || baseDuration <= 0) {
    throw new Error("route playback base duration must be a positive number");
  }

  const fast = Math.max(1, Number(fastRate) || 1);
  const threshold = cueWindowThreshold({
    routeDistanceMeters,
    cueMaxFraction,
    cueMaxMeters,
  });
  const cueWindows = mergedCueWindows(cueFractions, threshold);
  const routeSegments = routePlaybackSegments(cueWindows, fast);
  let elapsed = 0;
  const timedSegments = routeSegments.map((segment) => {
    const duration = baseDuration * (segment.endFraction - segment.startFraction) / segment.rate;
    const timed = {
      ...segment,
      startTime: elapsed,
      endTime: elapsed + duration,
      duration,
    };
    elapsed += duration;
    return timed;
  });

  return {
    durationSeconds: elapsed,
    cueWindows,
    segments: timedSegments,
    timeToFraction(timeSeconds) {
      const time = clampTime(timeSeconds, elapsed);
      if (time >= elapsed) return 1;
      const segment = timedSegments.find((candidate) =>
        time >= candidate.startTime && time <= candidate.endTime
      ) || timedSegments[0];
      if (!segment || segment.duration <= 0) return 0;
      const local = (time - segment.startTime) / segment.duration;
      return segment.startFraction +
        local * (segment.endFraction - segment.startFraction);
    },
    fractionToTime(routeFraction) {
      const fraction = clamp01(routeFraction);
      if (fraction >= 1) return elapsed;
      const segment = timedSegments.find((candidate) =>
        fraction >= candidate.startFraction && fraction <= candidate.endFraction
      ) || timedSegments[0];
      if (!segment) return 0;
      const span = segment.endFraction - segment.startFraction;
      const local = span > 0 ? (fraction - segment.startFraction) / span : 0;
      return segment.startTime + local * segment.duration;
    },
  };
}

function cueWindowThreshold({
  routeDistanceMeters,
  cueMaxFraction,
  cueMaxMeters,
}) {
  const maxFraction = Number(cueMaxFraction);
  const maxMeters = Number(cueMaxMeters);
  const distanceMeters = Number(routeDistanceMeters);
  const fractionThreshold = Number.isFinite(maxFraction) && maxFraction > 0
    ? maxFraction
    : 0;
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    return fractionThreshold;
  }
  if (!Number.isFinite(maxMeters) || maxMeters <= 0) {
    return fractionThreshold;
  }
  return Math.min(fractionThreshold, maxMeters / distanceMeters);
}

function mergedCueWindows(cueFractions, threshold) {
  if (!Number.isFinite(threshold) || threshold <= 0) return [];
  const windows = cueFractions
    .map((fraction) => clamp01(fraction))
    .map((fraction) => ({
      startFraction: Math.max(0, fraction - threshold),
      endFraction: Math.min(1, fraction + threshold),
    }))
    .filter((window) => window.endFraction > window.startFraction)
    .sort((a, b) => a.startFraction - b.startFraction);

  const merged = [];
  for (const window of windows) {
    const previous = merged[merged.length - 1];
    if (previous && window.startFraction <= previous.endFraction) {
      previous.endFraction = Math.max(previous.endFraction, window.endFraction);
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
}

function routePlaybackSegments(cueWindows, fastRate) {
  const segments = [];
  let cursor = 0;
  for (const window of cueWindows) {
    if (window.startFraction > cursor) {
      segments.push({
        startFraction: cursor,
        endFraction: window.startFraction,
        rate: fastRate,
      });
    }
    segments.push({
      startFraction: window.startFraction,
      endFraction: window.endFraction,
      rate: 1,
    });
    cursor = window.endFraction;
  }
  if (cursor < 1) {
    segments.push({
      startFraction: cursor,
      endFraction: 1,
      rate: fastRate,
    });
  }
  return mergeAdjacentSegments(segments.length ? segments : [{
    startFraction: 0,
    endFraction: 1,
    rate: fastRate,
  }]);
}

function mergeAdjacentSegments(segments) {
  const merged = [];
  for (const segment of segments) {
    if (segment.endFraction <= segment.startFraction) continue;
    const previous = merged[merged.length - 1];
    if (previous && previous.rate === segment.rate) {
      previous.endFraction = segment.endFraction;
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}
