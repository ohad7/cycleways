// Pure helpers for deciding when navigation state should be persisted and for
// coordinating the resulting asynchronous writes. The policy throttles steady
// GPS updates; the coordinator ensures slow filesystem writes cannot complete
// out of order and coalesces queued work to the newest snapshot.

export const DEFAULT_PERSIST_INTERVAL_MS = 10_000;

export function isNavigationSnapshotFresh({
  savedAtMs,
  nowMs,
  staleAfterMs,
} = {}) {
  if (savedAtMs === null || savedAtMs === undefined) return false;
  const savedAt = Number(savedAtMs);
  const now = Number(nowMs);
  const maxAge = Number(staleAfterMs);
  return (
    Number.isFinite(savedAt) &&
    Number.isFinite(now) &&
    Number.isFinite(maxAge) &&
    maxAge >= 0 &&
    now - savedAt <= maxAge
  );
}

export function shouldPersistNavigationSnapshot({
  lastPersistAtMs = null,
  lastStatus = null,
  status,
  hasCueEvent = false,
  nowMs,
  intervalMs = DEFAULT_PERSIST_INTERVAL_MS,
} = {}) {
  if (status !== lastStatus) return true;
  if (hasCueEvent) return true;
  if (lastPersistAtMs === null || lastPersistAtMs === undefined) return true;
  const last = Number(lastPersistAtMs);
  if (!Number.isFinite(last)) return true;
  return Number(nowMs) - last >= intervalMs;
}

// The navigation event clock — it times persistence throttling AND the voice
// and haptic planners' cooldowns, so changes here affect what gets spoken.
// Journey playback uses synthetic fix timestamps: once a session receives a
// fix, keep non-location actions in that same clock domain instead of mixing
// the synthetic values with Date.now(). `resetPolicy` tells the caller to drop
// wall-clock throttle history when the first fix establishes the fix clock.
export function createNavigationEventClock({ now = Date.now } = {}) {
  let source = null;
  let currentMs = null;

  return {
    timestamp(fix = null) {
      const fixMs = Number(fix?.timestamp);
      if (Number.isFinite(fixMs)) {
        const resetPolicy = source === "wall";
        source = "fix";
        currentMs = fixMs;
        return { nowMs: currentMs, resetPolicy };
      }

      if (source !== "fix") {
        source = "wall";
        currentMs = Number(now());
      }
      return { nowMs: currentMs, resetPolicy: false };
    },
  };
}

export function createNavigationPersistenceCoordinator(write) {
  if (typeof write !== "function") {
    throw new TypeError("navigation persistence coordinator requires a writer");
  }

  let running = false;
  let pending = null;

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (pending) {
        const current = pending;
        pending = null;
        let succeeded = false;
        try {
          succeeded = (await write(current.value)) === true;
        } catch {
          succeeded = false;
        }
        for (const resolve of current.resolvers) resolve(succeeded);
      }
    } finally {
      running = false;
    }
  }

  return {
    request(value) {
      const promise = new Promise((resolve) => {
        if (pending) {
          pending.value = value;
          pending.resolvers.push(resolve);
        } else {
          pending = { value, resolvers: [resolve] };
        }
      });
      void drain();
      return promise;
    },
  };
}
