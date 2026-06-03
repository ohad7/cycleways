import { getStoredItem } from "../platform/storage.js";

const DEFAULT_FEATURE_FLAGS = {
  routeDiscovery: false,
  segmentQualityPublicDisplay: false,
  segmentQualityRouting: false,
};

export function featureFlagValue(key) {
  const defaultValue = DEFAULT_FEATURE_FLAGS[key] ?? false;
  const globalValue =
    typeof window !== "undefined"
      ? window.CYCLEWAYS_FEATURE_FLAGS?.[key]
      : undefined;
  if (typeof globalValue === "boolean") return globalValue;

  try {
    const storedValue = getStoredItem(`cycleways.flags.${key}`);
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
