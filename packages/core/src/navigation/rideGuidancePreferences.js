export const DEFAULT_RIDE_GUIDANCE_PREFERENCES = Object.freeze({
  schemaVersion: 1,
  intersectionCrossingGuidanceEnabled: true,
});

export function normalizeRideGuidancePreferences(value) {
  if (!value || value.schemaVersion !== 1) {
    return { ...DEFAULT_RIDE_GUIDANCE_PREFERENCES };
  }
  return {
    schemaVersion: 1,
    intersectionCrossingGuidanceEnabled:
      value.intersectionCrossingGuidanceEnabled !== false,
  };
}
