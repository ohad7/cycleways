// Dev-only simulate-ride location source (Task 17).
//
// Implements the locationSource interface consumed by useNavigationSession:
//   { requestPermissions(opts) -> { granted, background },
//     startWatch({ onFix, onError }) -> Promise<{ stop() }> }
//
// Replays a pre-built array of fix objects (e.g. from generateTrack) through
// onFix on a timer. Always grants permission — no native dialog required. Use
// this from the __DEV__-gated MapScreen sim harness, never in production.
//
// To produce fix arrays for use as test fixtures, pair with the MapScreen
// recorder (Task 17) which captures real GPS fixes and logs them as JSON.

export function createSimulateRideSource(fixes, { intervalMs = 1000 } = {}) {
  return {
    requestPermissions: async () => ({ granted: true, background: false }),
    startWatch: async ({ onFix }) => {
      let i = 0;
      const id = setInterval(() => {
        if (i >= fixes.length) {
          clearInterval(id);
          return;
        }
        onFix(fixes[i++]);
      }, intervalMs);
      return { stop: () => clearInterval(id) };
    },
  };
}
