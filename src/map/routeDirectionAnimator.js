const CHANNELS = new Set(["chevron", "litPoint", "elevation"]);

export function createRouteDirectionAnimator(options = {}) {
  const clock = options.clock ?? defaultClock();
  const prefersReducedMotion =
    options.prefersReducedMotion ?? detectPrefersReducedMotion();

  const subscribers = {
    chevron: new Set(),
    litPoint: new Set(),
    elevation: new Set(),
  };

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

  function trigger(_geometry, _routePointIndices) {
    // Implemented in later tasks.
  }

  function cancel() {
    // Implemented in later tasks.
  }

  function dispose() {
    cancel();
    Object.values(subscribers).forEach((s) => s.clear());
  }

  return {
    trigger,
    subscribe,
    cancel,
    dispose,
    _internal: { clock, prefersReducedMotion },
  };
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
