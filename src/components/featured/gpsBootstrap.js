import {
  buildCumulativeDistances,
  haversineMeters,
  pointAtFraction,
  projectPointToRouteCandidates,
} from "./routeGeometry.js";

const DEFAULT_INITIAL_TIE_METERS = 15;
const DEFAULT_MAX_FORWARD_JUMP_SLACK_METERS = 120;
const LARGE_JUMP_PENALTY = 1000;
const SMALL_BACKTRACK_PENALTY = 2;

export function parseGpsCsv(csvText) {
  const rows = [];
  for (const line of String(csvText).split(/\r?\n/)) {
    const cols = line.split(",");
    if (cols.length < 3) continue;
    const timeS = Number(cols[0]);
    const lat = Number(cols[1]);
    const lon = Number(cols[2]);
    if (!Number.isFinite(timeS) || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }
    rows.push({ timeS, lat, lon });
  }
  return rows;
}

export function simplifyFractionCurve(points, epsilon) {
  const n = points.length;
  if (n <= 2) return points.slice();

  const keep = new Array(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;
  const stack = [[0, n - 1]];

  while (stack.length) {
    const [lo, hi] = stack.pop();
    if (hi - lo < 2) continue;

    const a = points[lo];
    const b = points[hi];
    const dt = b.t - a.t;
    let maxDev = -1;
    let maxIndex = -1;

    for (let i = lo + 1; i < hi; i++) {
      const p = points[i];
      const interp = dt > 0
        ? a.fraction + (b.fraction - a.fraction) * ((p.t - a.t) / dt)
        : a.fraction;
      const dev = Math.abs(p.fraction - interp);
      if (dev > maxDev) {
        maxDev = dev;
        maxIndex = i;
      }
    }

    if (maxDev > epsilon) {
      keep[maxIndex] = true;
      stack.push([lo, maxIndex], [maxIndex, hi]);
    }
  }

  return points.filter((_, index) => keep[index]);
}

function selectInitialCandidate(candidates, { routeIsClosed, initialTieMeters }) {
  if (!routeIsClosed) return candidates[0];

  const bestDistance = candidates[0].distanceMeters;
  const nearEquivalent = candidates.filter(
    (candidate) => candidate.distanceMeters <= bestDistance + initialTieMeters,
  );
  return nearEquivalent.reduce(
    (best, candidate) => (candidate.fraction < best.fraction ? candidate : best),
    nearEquivalent[0],
  );
}

function transitionCost(candidate, previous, dt, totalLengthMeters, options) {
  const deltaMeters = (candidate.fraction - previous.fraction) * totalLengthMeters;
  const maxForwardMeters =
    options.maxProgressMetersPerSecond * Math.max(0, dt) +
    options.maxForwardJumpSlackMeters;
  let cost = candidate.distanceMeters;

  if (deltaMeters < -options.maxBacktrackMeters) {
    cost += (Math.abs(deltaMeters) - options.maxBacktrackMeters) * LARGE_JUMP_PENALTY;
  } else if (deltaMeters < 0) {
    cost += Math.abs(deltaMeters) * SMALL_BACKTRACK_PENALTY;
  }

  if (deltaMeters > maxForwardMeters) {
    cost += (deltaMeters - maxForwardMeters) * LARGE_JUMP_PENALTY;
  }

  return cost;
}

function selectNextCandidate(candidates, previous, totalLengthMeters, options) {
  const dt = candidates[0].t - previous.t;
  let best = candidates[0];
  let bestCost = transitionCost(best, previous, dt, totalLengthMeters, options);

  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i];
    const cost = transitionCost(candidate, previous, dt, totalLengthMeters, options);
    if (
      cost < bestCost ||
      (cost === bestCost && candidate.distanceMeters < best.distanceMeters)
    ) {
      best = candidate;
      bestCost = cost;
    }
  }

  return best;
}

function formatSelectedProjection(fix, candidate) {
  return {
    t: fix.t,
    fraction: candidate.fraction,
    distanceMeters: candidate.distanceMeters,
  };
}

export function bootstrapKeyframesFromGps({
  csvText,
  routeGeometry,
  videoDuration,
  speedFactor = 5,
  maxErrorMeters = 10,
  maxOffRouteMeters = 60,
  maxBacktrackMeters = 35,
  maxProgressMetersPerSecond = 120,
  maxForwardJumpSlackMeters = DEFAULT_MAX_FORWARD_JUMP_SLACK_METERS,
  initialTieMeters = DEFAULT_INITIAL_TIE_METERS,
} = {}) {
  if (!Array.isArray(routeGeometry) || routeGeometry.length < 2) {
    throw new Error("routeGeometry must have at least 2 points");
  }
  if (!Number.isFinite(videoDuration) || videoDuration <= 0) {
    throw new Error("videoDuration must be a positive number");
  }
  if (!Number.isFinite(speedFactor) || speedFactor <= 0) {
    throw new Error("speedFactor must be > 0");
  }
  if (!Number.isFinite(maxErrorMeters) || maxErrorMeters < 0) {
    throw new Error("maxErrorMeters must be >= 0");
  }
  if (!Number.isFinite(maxOffRouteMeters) || maxOffRouteMeters <= 0) {
    throw new Error("maxOffRouteMeters must be > 0");
  }

  const cumulative = buildCumulativeDistances(routeGeometry);
  const totalLengthMeters = cumulative[cumulative.length - 1];
  if (!(totalLengthMeters > 0)) {
    throw new Error("routeGeometry must have positive length");
  }

  const fixes = parseGpsCsv(csvText);
  const projected = [];
  let offRouteDropped = 0;

  for (const fix of fixes) {
    const t = fix.timeS / speedFactor;
    const candidates = projectPointToRouteCandidates(
      { lat: fix.lat, lng: fix.lon },
      routeGeometry,
      cumulative,
      { maxDistanceMeters: maxOffRouteMeters },
    );
    if (candidates.length === 0) {
      offRouteDropped++;
      continue;
    }
    projected.push({
      t,
      candidates: candidates.map((candidate) => ({ ...candidate, t })),
    });
  }

  projected.sort((a, b) => a.t - b.t);

  const routeIsClosed =
    haversineMeters(routeGeometry[0], routeGeometry[routeGeometry.length - 1]) <=
    Math.max(maxOffRouteMeters, initialTieMeters);
  const selectionOptions = {
    routeIsClosed,
    initialTieMeters,
    maxBacktrackMeters,
    maxProgressMetersPerSecond,
    maxForwardJumpSlackMeters,
  };

  let beyondDurationDropped = 0;
  let nonIncreasingDropped = 0;
  let ambiguousFixes = 0;
  let continuityCorrections = 0;
  let lastT = -Infinity;
  let previous = null;
  const selected = [];

  for (const projectedFix of projected) {
    if (projectedFix.t > videoDuration) {
      beyondDurationDropped++;
      continue;
    }
    if (projectedFix.t <= lastT) {
      nonIncreasingDropped++;
      continue;
    }

    if (projectedFix.candidates.length > 1) ambiguousFixes++;
    const candidate = previous
      ? selectNextCandidate(projectedFix.candidates, previous, totalLengthMeters, selectionOptions)
      : selectInitialCandidate(projectedFix.candidates, selectionOptions);
    if (candidate !== projectedFix.candidates[0]) continuityCorrections++;

    const normalized = formatSelectedProjection(projectedFix, candidate);
    selected.push(normalized);
    previous = normalized;
    lastT = projectedFix.t;
  }

  const epsilon = maxErrorMeters / totalLengthMeters;
  const simplified = simplifyFractionCurve(selected, epsilon);
  const keyframes = simplified.map((point) => {
    const snapped = pointAtFraction(routeGeometry, cumulative, point.fraction);
    return { t: point.t, lat: snapped.lat, lon: snapped.lng };
  });

  return {
    keyframes,
    stats: {
      fixesRead: fixes.length,
      offRouteDropped,
      beyondDurationDropped,
      nonIncreasingDropped,
      ambiguousFixes,
      continuityCorrections,
      keyframesOut: keyframes.length,
      startFraction: selected[0]?.fraction ?? null,
      endFraction: selected[selected.length - 1]?.fraction ?? null,
    },
  };
}
