import { cwNetworkDetailOpacityExpression } from "./cwNetworkDetail.js";

export const ROUTE_NETWORK_PRESENTATION_VARIANTS = Object.freeze({
  CURRENT: "current",
  TYPED_BOLD: "typed-bold",
  TYPED_CASED: "typed-cased",
  BUILD_FOCUS: "build-focus",
  SINGLE_BLUE: "single-blue",
});

export const ROUTE_GEOMETRY_PRESENTATION_VARIANTS = Object.freeze({
  CURRENT: "current",
  CASED: "cased",
  BRIGHT_BLUE: "bright-blue",
  ORANGE: "orange",
  DARK: "dark",
  MAGENTA: "magenta",
});

export const ROUTE_NETWORK_COLOR_SCHEMES = Object.freeze({
  AUTO: "auto",
  CURRENT_MUTED: "current-muted",
  OUTDOORS_BALANCED: "outdoors-balanced",
  TOPO_HIGH_CONTRAST: "topo-high-contrast",
  GRAY_MAP_SATURATED: "gray-map-saturated",
  AERIAL_BRIGHT: "aerial-bright",
});

export const ROUTE_NETWORK_BASE_MAP_PROFILES = Object.freeze({
  MAPBOX_OUTDOORS: "mapbox-outdoors",
  TOPO: "topo",
  GRAY: "gray",
  AERIAL: "aerial",
});

export const ROUTE_NETWORK_BUCKETS = Object.freeze({
  PRIMARY: "primary",
  ROAD: "road",
  TRAIL: "trail",
});

export const ROUTE_NETWORK_PRESENTATION_VALUES = Object.freeze(
  Object.values(ROUTE_NETWORK_PRESENTATION_VARIANTS),
);

export const ROUTE_GEOMETRY_PRESENTATION_VALUES = Object.freeze(
  Object.values(ROUTE_GEOMETRY_PRESENTATION_VARIANTS),
);

export const ROUTE_NETWORK_COLOR_SCHEME_VALUES = Object.freeze(
  Object.values(ROUTE_NETWORK_COLOR_SCHEMES),
);

export const ROUTE_NETWORK_BASE_MAP_PROFILE_VALUES = Object.freeze(
  Object.values(ROUTE_NETWORK_BASE_MAP_PROFILES),
);

const CURRENT_MUTED_COLORS = Object.freeze({
  [ROUTE_NETWORK_BUCKETS.PRIMARY]: "rgb(101, 170, 162)",
  [ROUTE_NETWORK_BUCKETS.ROAD]: "rgb(138, 147, 158)",
  [ROUTE_NETWORK_BUCKETS.TRAIL]: "rgb(174, 144, 103)",
});

const COLOR_SCHEME_DEFINITIONS = Object.freeze({
  [ROUTE_NETWORK_COLOR_SCHEMES.CURRENT_MUTED]: {
    id: ROUTE_NETWORK_COLOR_SCHEMES.CURRENT_MUTED,
    colors: CURRENT_MUTED_COLORS,
    casing: "rgba(255, 255, 255, 0.72)",
    casingOpacity: 0.64,
    shadow: "rgba(24, 37, 46, 0.22)",
    shadowOpacity: 0.18,
  },
  [ROUTE_NETWORK_COLOR_SCHEMES.OUTDOORS_BALANCED]: {
    id: ROUTE_NETWORK_COLOR_SCHEMES.OUTDOORS_BALANCED,
    colors: {
      [ROUTE_NETWORK_BUCKETS.PRIMARY]: "#1976c9",
      [ROUTE_NETWORK_BUCKETS.ROAD]: "#6f7782",
      [ROUTE_NETWORK_BUCKETS.TRAIL]: "#a06a32",
    },
    casing: "rgba(255, 255, 255, 0.86)",
    casingOpacity: 0.82,
    shadow: "rgba(26, 44, 63, 0.24)",
    shadowOpacity: 0.2,
  },
  [ROUTE_NETWORK_COLOR_SCHEMES.TOPO_HIGH_CONTRAST]: {
    id: ROUTE_NETWORK_COLOR_SCHEMES.TOPO_HIGH_CONTRAST,
    colors: {
      [ROUTE_NETWORK_BUCKETS.PRIMARY]: "#2286d9",
      [ROUTE_NETWORK_BUCKETS.ROAD]: "#5d6878",
      [ROUTE_NETWORK_BUCKETS.TRAIL]: "#b5682f",
    },
    casing: "rgba(248, 252, 255, 0.9)",
    casingOpacity: 0.86,
    shadow: "rgba(30, 45, 64, 0.28)",
    shadowOpacity: 0.22,
  },
  [ROUTE_NETWORK_COLOR_SCHEMES.GRAY_MAP_SATURATED]: {
    id: ROUTE_NETWORK_COLOR_SCHEMES.GRAY_MAP_SATURATED,
    colors: {
      [ROUTE_NETWORK_BUCKETS.PRIMARY]: "#0077d9",
      [ROUTE_NETWORK_BUCKETS.ROAD]: "#596578",
      [ROUTE_NETWORK_BUCKETS.TRAIL]: "#b35c1e",
    },
    casing: "rgba(255, 255, 255, 0.92)",
    casingOpacity: 0.88,
    shadow: "rgba(9, 25, 46, 0.34)",
    shadowOpacity: 0.24,
  },
  [ROUTE_NETWORK_COLOR_SCHEMES.AERIAL_BRIGHT]: {
    id: ROUTE_NETWORK_COLOR_SCHEMES.AERIAL_BRIGHT,
    colors: {
      [ROUTE_NETWORK_BUCKETS.PRIMARY]: "#2aa8ff",
      [ROUTE_NETWORK_BUCKETS.ROAD]: "#c8d2df",
      [ROUTE_NETWORK_BUCKETS.TRAIL]: "#ffb14a",
    },
    casing: "rgba(6, 18, 31, 0.72)",
    casingOpacity: 0.78,
    shadow: "rgba(255, 255, 255, 0.2)",
    shadowOpacity: 0.16,
  },
});

const SINGLE_BLUE_COLORS = Object.freeze({
  [ROUTE_NETWORK_BUCKETS.PRIMARY]: "#2286d9",
  [ROUTE_NETWORK_BUCKETS.ROAD]: "#2286d9",
  [ROUTE_NETWORK_BUCKETS.TRAIL]: "#2286d9",
});

const CURRENT_WIDTH_EXPRESSION = ["get", "routeWidth"];
const TYPED_BOLD_WIDTH_EXPRESSION = [
  "interpolate",
  ["linear"],
  ["zoom"],
  8,
  3.2,
  11,
  4.2,
  14,
  5.6,
];
const CASED_CORE_WIDTH_EXPRESSION = [
  "interpolate",
  ["linear"],
  ["zoom"],
  8,
  3,
  11,
  4,
  14,
  5.2,
];
const CASED_CASING_WIDTH_EXPRESSION = [
  "interpolate",
  ["linear"],
  ["zoom"],
  8,
  5,
  11,
  6.3,
  14,
  7.8,
];
const CASED_SHADOW_WIDTH_EXPRESSION = [
  "interpolate",
  ["linear"],
  ["zoom"],
  8,
  6,
  11,
  7.5,
  14,
  9.2,
];

const ROUTE_GEOMETRY_CASED_CORE_WIDTH_EXPRESSION = [
  "interpolate",
  ["linear"],
  ["zoom"],
  8,
  4.5,
  11,
  6,
  14,
  7.4,
];
const ROUTE_GEOMETRY_CASED_CASING_WIDTH_EXPRESSION = [
  "interpolate",
  ["linear"],
  ["zoom"],
  8,
  7,
  11,
  8.8,
  14,
  10.4,
];

const ROUTE_GEOMETRY_EMPHASIZED_CORE_WIDTH_EXPRESSION = [
  "interpolate",
  ["linear"],
  ["zoom"],
  8,
  5.2,
  11,
  6.8,
  14,
  8.4,
];
const ROUTE_GEOMETRY_EMPHASIZED_CASING_WIDTH_EXPRESSION = [
  "interpolate",
  ["linear"],
  ["zoom"],
  8,
  8.2,
  11,
  10.2,
  14,
  12,
];

const ROUTE_GEOMETRY_PRESENTATION_STYLES = Object.freeze({
  [ROUTE_GEOMETRY_PRESENTATION_VARIANTS.CASED]: {
    color: "#006699",
    casingColor: "rgba(248, 252, 255, 0.92)",
    coreWidth: ROUTE_GEOMETRY_CASED_CORE_WIDTH_EXPRESSION,
    casingWidth: ROUTE_GEOMETRY_CASED_CASING_WIDTH_EXPRESSION,
    coreOpacity: 0.96,
    affectedCoreOpacity: 0.34,
    casingOpacity: 0.86,
    affectedCasingOpacity: 0.18,
  },
  [ROUTE_GEOMETRY_PRESENTATION_VARIANTS.BRIGHT_BLUE]: {
    color: "#0057ff",
    casingColor: "rgba(255, 255, 255, 0.96)",
    coreWidth: ROUTE_GEOMETRY_EMPHASIZED_CORE_WIDTH_EXPRESSION,
    casingWidth: ROUTE_GEOMETRY_EMPHASIZED_CASING_WIDTH_EXPRESSION,
    coreOpacity: 1,
    affectedCoreOpacity: 0.42,
    casingOpacity: 0.92,
    affectedCasingOpacity: 0.22,
  },
  [ROUTE_GEOMETRY_PRESENTATION_VARIANTS.ORANGE]: {
    color: "#f97316",
    casingColor: "rgba(255, 255, 255, 0.96)",
    coreWidth: ROUTE_GEOMETRY_EMPHASIZED_CORE_WIDTH_EXPRESSION,
    casingWidth: ROUTE_GEOMETRY_EMPHASIZED_CASING_WIDTH_EXPRESSION,
    coreOpacity: 1,
    affectedCoreOpacity: 0.42,
    casingOpacity: 0.92,
    affectedCasingOpacity: 0.22,
  },
  [ROUTE_GEOMETRY_PRESENTATION_VARIANTS.DARK]: {
    color: "#102a43",
    casingColor: "rgba(255, 255, 255, 0.98)",
    coreWidth: ROUTE_GEOMETRY_EMPHASIZED_CORE_WIDTH_EXPRESSION,
    casingWidth: ROUTE_GEOMETRY_EMPHASIZED_CASING_WIDTH_EXPRESSION,
    coreOpacity: 1,
    affectedCoreOpacity: 0.42,
    casingOpacity: 0.94,
    affectedCasingOpacity: 0.24,
  },
  [ROUTE_GEOMETRY_PRESENTATION_VARIANTS.MAGENTA]: {
    color: "#c026d3",
    casingColor: "rgba(255, 255, 255, 0.96)",
    coreWidth: ROUTE_GEOMETRY_EMPHASIZED_CORE_WIDTH_EXPRESSION,
    casingWidth: ROUTE_GEOMETRY_EMPHASIZED_CASING_WIDTH_EXPRESSION,
    coreOpacity: 1,
    affectedCoreOpacity: 0.42,
    casingOpacity: 0.92,
    affectedCasingOpacity: 0.22,
  },
});

export function normalizeRouteNetworkPresentationVariant(value) {
  return ROUTE_NETWORK_PRESENTATION_VALUES.includes(value)
    ? value
    : ROUTE_NETWORK_PRESENTATION_VARIANTS.CURRENT;
}

export function normalizeRouteGeometryPresentationVariant(value) {
  return ROUTE_GEOMETRY_PRESENTATION_VALUES.includes(value)
    ? value
    : ROUTE_GEOMETRY_PRESENTATION_VARIANTS.CURRENT;
}

export function normalizeRouteNetworkColorScheme(value) {
  return ROUTE_NETWORK_COLOR_SCHEME_VALUES.includes(value)
    ? value
    : ROUTE_NETWORK_COLOR_SCHEMES.AUTO;
}

export function normalizeRouteNetworkBaseMapProfile(value) {
  return ROUTE_NETWORK_BASE_MAP_PROFILE_VALUES.includes(value)
    ? value
    : ROUTE_NETWORK_BASE_MAP_PROFILES.MAPBOX_OUTDOORS;
}

export function colorSchemeForBaseMap(baseMapProfile, variant, override = "auto") {
  const normalizedOverride = normalizeRouteNetworkColorScheme(override);
  if (normalizedOverride !== ROUTE_NETWORK_COLOR_SCHEMES.AUTO) {
    return normalizedOverride;
  }
  if (variant === ROUTE_NETWORK_PRESENTATION_VARIANTS.CURRENT) {
    return ROUTE_NETWORK_COLOR_SCHEMES.CURRENT_MUTED;
  }

  switch (normalizeRouteNetworkBaseMapProfile(baseMapProfile)) {
    case ROUTE_NETWORK_BASE_MAP_PROFILES.TOPO:
      return ROUTE_NETWORK_COLOR_SCHEMES.TOPO_HIGH_CONTRAST;
    case ROUTE_NETWORK_BASE_MAP_PROFILES.GRAY:
      return ROUTE_NETWORK_COLOR_SCHEMES.GRAY_MAP_SATURATED;
    case ROUTE_NETWORK_BASE_MAP_PROFILES.AERIAL:
      return ROUTE_NETWORK_COLOR_SCHEMES.AERIAL_BRIGHT;
    case ROUTE_NETWORK_BASE_MAP_PROFILES.MAPBOX_OUTDOORS:
    default:
      return variant === ROUTE_NETWORK_PRESENTATION_VARIANTS.SINGLE_BLUE
        ? ROUTE_NETWORK_COLOR_SCHEMES.TOPO_HIGH_CONTRAST
        : ROUTE_NETWORK_COLOR_SCHEMES.OUTDOORS_BALANCED;
  }
}

export function routeNetworkPresentation(options = {}) {
  const requestedVariant = normalizeRouteNetworkPresentationVariant(
    options.variant,
  );
  const routeBuilding = Boolean(options.routeBuilding);
  const variant =
    requestedVariant === ROUTE_NETWORK_PRESENTATION_VARIANTS.BUILD_FOCUS
    && !routeBuilding
      ? ROUTE_NETWORK_PRESENTATION_VARIANTS.CURRENT
      : requestedVariant;
  const baseMapProfile = normalizeRouteNetworkBaseMapProfile(
    options.baseMapProfile,
  );
  const schemeId = colorSchemeForBaseMap(
    baseMapProfile,
    variant,
    options.colorScheme,
  );
  const scheme =
    COLOR_SCHEME_DEFINITIONS[schemeId] ||
    COLOR_SCHEME_DEFINITIONS[ROUTE_NETWORK_COLOR_SCHEMES.CURRENT_MUTED];
  const colors =
    variant === ROUTE_NETWORK_PRESENTATION_VARIANTS.SINGLE_BLUE
      ? SINGLE_BLUE_COLORS
      : scheme.colors;
  const cased =
    variant === ROUTE_NETWORK_PRESENTATION_VARIANTS.TYPED_CASED ||
    variant === ROUTE_NETWORK_PRESENTATION_VARIANTS.BUILD_FOCUS ||
    variant === ROUTE_NETWORK_PRESENTATION_VARIANTS.SINGLE_BLUE;
  const bold =
    cased || variant === ROUTE_NETWORK_PRESENTATION_VARIANTS.TYPED_BOLD;

  return {
    variant,
    requestedVariant,
    routeBuilding,
    baseMapProfile,
    colorScheme: scheme.id,
    colors,
    casingColor: scheme.casing,
    casingOpacity: cased ? scheme.casingOpacity : 0,
    shadowColor: scheme.shadow,
    shadowOpacity: cased ? scheme.shadowOpacity : 0,
    coreWidth: cased
      ? CASED_CORE_WIDTH_EXPRESSION
      : bold
        ? TYPED_BOLD_WIDTH_EXPRESSION
        : CURRENT_WIDTH_EXPRESSION,
    casingWidth: CASED_CASING_WIDTH_EXPRESSION,
    shadowWidth: CASED_SHADOW_WIDTH_EXPRESSION,
    cased,
  };
}

export function routeNetworkColorForBucket(bucket, options = {}) {
  const presentation = routeNetworkPresentation(options);
  return (
    presentation.colors[bucket] ||
    presentation.colors[ROUTE_NETWORK_BUCKETS.TRAIL]
  );
}

export function routeNetworkLineStyleForPresentation(presentationInput = {}) {
  const presentation = presentationInput.colors
    ? presentationInput
    : routeNetworkPresentation(presentationInput);
  return {
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
    paint: {
      "line-color": ["get", "routeColor"],
      "line-width": presentation.coreWidth,
      "line-opacity": cwNetworkDetailOpacityExpression(["get", "routeOpacity"]),
    },
  };
}

export function routeNetworkCasingStyleForPresentation(presentationInput = {}) {
  const presentation = presentationInput.colors
    ? presentationInput
    : routeNetworkPresentation(presentationInput);
  return {
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
    paint: {
      "line-color": ["get", "routeCasingColor"],
      "line-width": presentation.casingWidth,
      "line-opacity": cwNetworkDetailOpacityExpression([
        "get",
        "routeCasingOpacity",
      ]),
    },
  };
}

export function routeNetworkShadowStyleForPresentation(presentationInput = {}) {
  const presentation = presentationInput.colors
    ? presentationInput
    : routeNetworkPresentation(presentationInput);
  return {
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
    paint: {
      "line-color": ["get", "routeShadowColor"],
      "line-width": presentation.shadowWidth,
      "line-opacity": cwNetworkDetailOpacityExpression([
        "get",
        "routeShadowOpacity",
      ]),
      "line-blur": 0.35,
    },
  };
}

export function routeNetworkHoverStyleForPresentation(presentationInput = {}) {
  const presentation = presentationInput.colors
    ? presentationInput
    : routeNetworkPresentation(presentationInput);
  return {
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
    paint: {
      "line-color": presentation.cased ? "#173a56" : "#666633",
      "line-width": presentation.cased
        ? [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            5.4,
            11,
            6.4,
            14,
            7.6,
          ]
        : 5,
      "line-opacity": cwNetworkDetailOpacityExpression(1),
    },
  };
}

export function routeNetworkFocusStyleForPresentation(presentationInput = {}) {
  const presentation = presentationInput.colors
    ? presentationInput
    : routeNetworkPresentation(presentationInput);
  return {
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
    paint: {
      "line-color": "#ffffff",
      "line-width": presentation.cased
        ? [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            7.2,
            11,
            8.2,
            14,
            9.4,
          ]
        : 7,
      "line-opacity": cwNetworkDetailOpacityExpression(1),
    },
  };
}

export function routeGeometryLineStyleForPresentation(variantInput = "current") {
  const variant = normalizeRouteGeometryPresentationVariant(variantInput);
  const style = ROUTE_GEOMETRY_PRESENTATION_STYLES[variant];
  if (!style) return null;
  return {
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
    paint: {
      "line-color": style.color,
      "line-width": style.coreWidth,
      "line-opacity": [
        "case",
        ["boolean", ["get", "affected"], false],
        style.affectedCoreOpacity,
        style.coreOpacity,
      ],
    },
  };
}

export function routeGeometryCasingStyleForPresentation(
  variantInput = "current",
) {
  const variant = normalizeRouteGeometryPresentationVariant(variantInput);
  const style = ROUTE_GEOMETRY_PRESENTATION_STYLES[variant];
  if (!style) return null;
  return {
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
    paint: {
      "line-color": style.casingColor,
      "line-width": style.casingWidth,
      "line-opacity": [
        "case",
        ["boolean", ["get", "affected"], false],
        style.affectedCasingOpacity,
        style.casingOpacity,
      ],
    },
  };
}
