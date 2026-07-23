import { getStoredItem } from "../platform/storage.js";

const DEFAULT_FEATURE_FLAGS = {
  guidanceWayNames: true,
  routeDiscovery: true,
  segmentQualityPublicDisplay: false,
  segmentQualityRouting: false,
};

const DEFAULT_STRING_FEATURE_FLAGS = {
  routeGeometryPresentation: "dark",
  routeNetworkBaseMapProfile: "mapbox-outdoors",
  routeNetworkColorScheme: "outdoors-balanced",
  routeNetworkPresentation: "typed-cased",
};

const STRING_FEATURE_FLAG_VALUES = {
  routeGeometryPresentation: [
    "current",
    "cased",
    "bright-blue",
    "orange",
    "dark",
    "magenta",
  ],
  routeNetworkBaseMapProfile: ["mapbox-outdoors", "topo", "gray", "aerial"],
  routeNetworkColorScheme: [
    "auto",
    "current-muted",
    "outdoors-balanced",
    "topo-high-contrast",
    "gray-map-saturated",
    "aerial-bright",
  ],
  routeNetworkPresentation: [
    "current",
    "typed-bold",
    "typed-cased",
    "build-focus",
    "single-blue",
  ],
};

const STRING_FEATURE_QUERY_PARAMS = {
  routeGeometryPresentation: ["routeStyle", "routeGeometryPresentation"],
  routeNetworkBaseMapProfile: ["baseMapProfile", "routeNetworkBaseMapProfile"],
  routeNetworkColorScheme: ["networkScheme", "routeNetworkColorScheme"],
  routeNetworkPresentation: ["networkStyle", "routeNetworkPresentation"],
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

export function featureFlagStringValue(
  key,
  allowedValues = STRING_FEATURE_FLAG_VALUES[key] || [],
  defaultValue = DEFAULT_STRING_FEATURE_FLAGS[key] || "",
) {
  const allowed = new Set(allowedValues);
  const normalize = (value) =>
    typeof value === "string" && allowed.has(value) ? value : null;
  const queryValue = queryStringFlagValue(key, normalize);
  if (queryValue) return queryValue;

  const globalValue =
    typeof window !== "undefined"
      ? normalize(window.CYCLEWAYS_FEATURE_FLAGS?.[key])
      : null;
  if (globalValue) return globalValue;

  return normalize(defaultValue) || allowedValues[0] || "";
}

function queryStringFlagValue(key, normalize) {
  if (typeof window === "undefined" || !window.location?.search) return null;
  const params = new URLSearchParams(window.location.search);
  for (const paramName of STRING_FEATURE_QUERY_PARAMS[key] || [key]) {
    const value = normalize(params.get(paramName));
    if (value) return value;
  }
  return null;
}

export function getFeatureFlags() {
  const booleanFlags = Object.fromEntries(
    Object.keys(DEFAULT_FEATURE_FLAGS).map((key) => [
      key,
      featureFlagValue(key),
    ]),
  );
  const stringFlags = Object.fromEntries(
    Object.keys(DEFAULT_STRING_FEATURE_FLAGS).map((key) => [
      key,
      featureFlagStringValue(key),
    ]),
  );
  return { ...booleanFlags, ...stringFlags };
}
