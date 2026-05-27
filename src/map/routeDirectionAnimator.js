import { getDistance } from "../../utils/distance.js";

const CHANNELS = new Set(["chevron", "litPoint", "elevation"]);
const GAP_DURATION_MS = 1200;

export function precomputeArcLength(geometry) {
  const n = geometry.length;
  const cumDist = new Float64Array(n);
  let acc = 0;
  for (let i = 1; i < n; i++) {
    const segment = getDistance(geometry[i - 1], geometry[i]);
    acc += Number.isFinite(segment) && segment > 0 ? segment : 0;
    cumDist[i] = acc;
  }
  return { cumDist, totalDistMeters: acc };
}

export function computeCycleDuration(totalDistanceMeters) {
  const distanceKm = (totalDistanceMeters || 0) / 1000;
  const raw = distanceKm * 0.25 + 2.0;
  return Math.min(7.0, Math.max(3.0, raw));
}

export function createRouteDirectionAnimator(options = {}) {
  const clock = options.clock ?? defaultClock();
  const prefersReducedMotion =
    options.prefersReducedMotion ?? detectPrefersReducedMotion();

  const subscribers = {
    chevron: new Set(),
    litPoint: new Set(),
    elevation: new Set(),
  };

  let state = null;
  let frameId = null;

  function subscribe(channel, callback) {
    if (!CHANNELS.has(channel)) {
      throw new Error(`unknown channel: ${channel}`);
    }
    subscribers[channel].add(callback);
    let active = true;
    return function unsubscribe() {
      if (!active) return;
      active = false;
      subscribers[channel].delete(callback);
    };
  }

  function emit(channel, payload) {
    subscribers[channel].forEach((cb) => cb(payload));
  }

  function trigger(geometry, routePointIndices) {
    if (!Array.isArray(geometry) || geometry.length < 2) return;
    if (!Array.isArray(routePointIndices) || routePointIndices.length < 2) return;

    cancelInternal({ silent: true });

    const arc = precomputeArcLength(geometry);
    if (!(arc.totalDistMeters > 0)) return;

    const cycleDurationSec = computeCycleDuration(arc.totalDistMeters);
    const routePointTs = routePointIndices.map((idx) => {
      const safe = Math.max(0, Math.min(idx, arc.cumDist.length - 1));
      return arc.cumDist[safe] / arc.totalDistMeters;
    });
    state = {
      phase: "cycle1",
      phaseStartTime: clock.now(),
      geometry,
      arc,
      cycleDurationMs: cycleDurationSec * 1000,
      routePointIndices,
      routePointTs,
      lastLitIndex: null,
    };
    scheduleNextFrame();
  }

  function scheduleNextFrame() {
    frameId = clock.requestFrame(onFrame);
  }

  function onFrame(now) {
    frameId = null;
    if (!state) return;

    // Fast-forward through any phases we have blown past (handles tab-background catch-up).
    while (state) {
      const elapsed = now - state.phaseStartTime;
      const phaseDur =
        state.phase === "gap" ? GAP_DURATION_MS : state.cycleDurationMs;
      if (elapsed < phaseDur) break;
      advancePhase();
    }

    if (!state) return;

    if (state.phase === "cycle1" || state.phase === "cycle2") {
      const t = Math.min((now - state.phaseStartTime) / state.cycleDurationMs, 1);
      emit("chevron", computeChevronPayload(state, t));
      const litIndex = detectLitIndex(state, t);
      if (litIndex !== state.lastLitIndex) {
        state.lastLitIndex = litIndex;
        emit("litPoint", buildLitPayload(state, litIndex));
      }
      emit("elevation", { t });
    }

    scheduleNextFrame();
  }

  function advancePhase() {
    if (state.phase === "cycle1") {
      emit("chevron", null);
      emit("elevation", null);
      emitLitNullIfNeeded();
      state.phase = "gap";
      state.phaseStartTime += state.cycleDurationMs;
    } else if (state.phase === "gap") {
      state.phase = "cycle2";
      state.phaseStartTime += GAP_DURATION_MS;
      state.lastLitIndex = null;
    } else if (state.phase === "cycle2") {
      emit("chevron", null);
      emit("elevation", null);
      emitLitNullIfNeeded();
      state = null;
    }
  }

  function emitLitNullIfNeeded() {
    if (state && state.lastLitIndex !== null) {
      state.lastLitIndex = null;
      emit("litPoint", null);
    }
  }

  function cancelInternal({ silent }) {
    if (frameId !== null) {
      clock.cancelFrame(frameId);
      frameId = null;
    }
    if (state && !silent) {
      emit("chevron", null);
      emit("elevation", null);
      if (state.lastLitIndex !== null) emit("litPoint", null);
    }
    state = null;
  }

  function cancel() {
    cancelInternal({ silent: false });
  }

  function dispose() {
    cancelInternal({ silent: true });
    Object.values(subscribers).forEach((s) => s.clear());
  }

  return { trigger, subscribe, cancel, dispose };
}

function computeChevronPayload(state, t) {
  const { arc, geometry } = state;
  const target = t * arc.totalDistMeters;
  const i = findSegmentIndex(arc.cumDist, target);
  const segLen = arc.cumDist[i + 1] - arc.cumDist[i];
  const localFrac = segLen > 0 ? (target - arc.cumDist[i]) / segLen : 0;
  const a = geometry[i];
  const b = geometry[i + 1];
  return {
    lng: a.lng + (b.lng - a.lng) * localFrac,
    lat: a.lat + (b.lat - a.lat) * localFrac,
    bearing: computeBearing(a, b),
  };
}

function findSegmentIndex(cumDist, target) {
  // Binary search for the largest i such that cumDist[i] <= target.
  let lo = 0;
  let hi = cumDist.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (cumDist[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  return Math.min(lo, cumDist.length - 2);
}

function detectLitIndex(state, t) {
  const windowT = 500 / state.cycleDurationMs;
  let lit = null;
  for (let k = 0; k < state.routePointTs.length; k++) {
    if (Math.abs(t - state.routePointTs[k]) <= windowT) {
      lit = k;
    }
  }
  return lit;
}

function buildLitPayload(state, k) {
  if (k === null) return null;
  const geomIndex = state.routePointIndices[k];
  const coord = state.geometry[geomIndex];
  return { index: k, lng: coord.lng, lat: coord.lat };
}

function computeBearing(from, to) {
  const φ1 = (from.lat * Math.PI) / 180;
  const φ2 = (to.lat * Math.PI) / 180;
  const Δλ = ((to.lng - from.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

function defaultClock() {
  return {
    now: () => performance.now(),
    requestFrame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (id) => cancelAnimationFrame(id),
  };
}

function detectPrefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
