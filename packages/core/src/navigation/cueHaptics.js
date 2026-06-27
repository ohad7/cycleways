// Pure cue → haptic planner (turn-by-turn Phase 9).
//
// The navigation session already dedupes cue events (same cue/phase once,
// off-route once on entry). This adds intensity mapping + a global cooldown so a
// ride never buzzes constantly, keeping the actual vibration call (expo-haptics)
// a thin native adapter. Stateful but deterministic given (event, now).

const DEFAULT_COOLDOWN_MS = 1200;

export function createCueHapticPlanner({ cooldownMs = DEFAULT_COOLDOWN_MS } = {}) {
  let lastFiredAt = null;

  function intensity(cueEvent) {
    if (cueEvent.kind === "off-route") return "heavy";
    if (cueEvent.kind === "cue") return cueEvent.phase === "final" ? "medium" : "light";
    return null;
  }

  function plan(cueEvent, nowMs) {
    if (!cueEvent) return { kind: null };
    if (lastFiredAt !== null && nowMs - lastFiredAt < cooldownMs) {
      return { kind: null };
    }
    const kind = intensity(cueEvent);
    if (kind === null) return { kind: null };
    lastFiredAt = nowMs;
    return { kind };
  }

  function reset() {
    lastFiredAt = null;
  }

  return { plan, reset };
}
