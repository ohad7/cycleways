const DEFAULT_FEATURE_FLAGS = {
  segmentQualityPublicDisplay: false,
  segmentQualityRouting: false,
};

export function featureFlagValue(key) {
  const defaultValue = DEFAULT_FEATURE_FLAGS[key] ?? false;
  const globalValue = window.CYCLEWAYS_FEATURE_FLAGS?.[key];
  if (typeof globalValue === "boolean") return globalValue;

  try {
    const storedValue = window.localStorage.getItem(`cycleways.flags.${key}`);
    if (storedValue === "true") return true;
    if (storedValue === "false") return false;
  } catch {
    // Feature flag persistence is optional.
  }

  return defaultValue;
}

export function getFeatureFlags() {
  return Object.fromEntries(
    Object.keys(DEFAULT_FEATURE_FLAGS).map((key) => [
      key,
      featureFlagValue(key),
    ]),
  );
}
