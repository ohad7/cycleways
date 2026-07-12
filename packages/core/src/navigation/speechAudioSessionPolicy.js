// Pure activate/deactivate timing for the iOS audio session around spoken
// navigation prompts (design D11, plans/navigation-ride-feedback).
//
// iOS only *implicitly* activates an audio session for foreground apps, so
// lock-screen speech must explicitly activate the shared session before each
// utterance. Holding the session active ducks other audio (music/podcasts),
// so it is released after a short linger once every in-flight utterance has
// settled. This module owns only the decision logic; the native calls live in
// apps/mobile/src/navigation/speechAdapter.js.

const DEFAULT_LINGER_MS = 1500;

export function createSpeechAudioSessionPolicy({ lingerMs = DEFAULT_LINGER_MS } = {}) {
  const linger = Number.isFinite(Number(lingerMs)) && Number(lingerMs) >= 0
    ? Number(lingerMs)
    : DEFAULT_LINGER_MS;
  let inFlight = 0;
  let active = false;
  let lastSettledAtMs = null;

  return {
    // Called before every speak. Activation is requested only on the
    // idle -> speaking edge; a failed native activation must be reported via
    // onDeactivated() so the next speak retries.
    onSpeakRequested() {
      inFlight += 1;
      const shouldActivate = !active;
      active = true;
      return { shouldActivate };
    },

    // Called exactly once per utterance (done / stopped / error / timeout).
    onUtteranceSettled(nowMs) {
      inFlight = Math.max(0, inFlight - 1);
      if (inFlight === 0) {
        const value = Number(nowMs);
        lastSettledAtMs = Number.isFinite(value) ? value : null;
      }
    },

    // True when the session is active, nothing is speaking, and the linger
    // window since the last settle has elapsed.
    shouldDeactivateNow(nowMs) {
      if (!active || inFlight > 0 || lastSettledAtMs === null) return false;
      const value = Number(nowMs);
      if (!Number.isFinite(value)) return false;
      return value - lastSettledAtMs >= linger;
    },

    // Called after the native session was deactivated (or failed to activate).
    onDeactivated() {
      active = false;
      lastSettledAtMs = null;
    },

    snapshot() {
      return { inFlight, active, lastSettledAtMs, lingerMs: linger };
    },
  };
}
