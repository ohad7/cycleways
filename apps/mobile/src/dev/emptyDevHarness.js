// Production Metro replacement for the navigation scenario/CAM harness. The
// custom resolver maps dev-only imports here before graph construction, so the
// real fixtures, bookmark UI, and diagnostics are absent from release bundles.
export const scenarios = [];
export const resolveScenario = () => {
  throw new Error("navigation scenario harness is unavailable in production");
};
export const bookmarkPlaybackWindow = () => ({
  warmupEndIndex: -1,
  startIndex: 0,
  endIndex: -1,
});
export const connectorRouterForScenario = () => null;
export const createJourneyPlaybackSource = () => {
  throw new Error("journey playback is unavailable in production");
};
export default function EmptyDevHarness() {
  return null;
}
