import {
  NAVIGATION_CONNECTOR_ROLE,
  NAVIGATION_MAIN_ROUTE_PROMINENCE,
} from "@cycleways/core/navigation/navigationLinePresentation.js";

export const NAVIGATION_LINE_COLORS = Object.freeze({
  mainRoute: "#006699",
  approach: "#f97316",
  direct: "#6b7280",
  rejoin: "#d94841",
  casing: "rgba(255, 255, 255, 0.94)",
});

const rounded = {
  lineJoin: "round",
  lineCap: "round",
};

function affectedOpacity(normal, affected) {
  return [
    "case",
    ["boolean", ["get", "affected"], false],
    affected,
    normal,
  ];
}

const MAIN_ROUTE_STYLES = Object.freeze({
  [NAVIGATION_MAIN_ROUTE_PROMINENCE.ACTIVE]: {
    ...rounded,
    lineColor: NAVIGATION_LINE_COLORS.mainRoute,
    lineWidth: 5,
    lineOpacity: affectedOpacity(0.92, 0.34),
  },
  [NAVIGATION_MAIN_ROUTE_PROMINENCE.JOINING]: {
    ...rounded,
    lineColor: NAVIGATION_LINE_COLORS.mainRoute,
    lineWidth: 4.5,
    lineOpacity: affectedOpacity(0.72, 0.25),
  },
  [NAVIGATION_MAIN_ROUTE_PROMINENCE.SECONDARY]: {
    ...rounded,
    lineColor: NAVIGATION_LINE_COLORS.mainRoute,
    lineWidth: 3.5,
    lineOpacity: affectedOpacity(0.44, 0.17),
  },
  [NAVIGATION_MAIN_ROUTE_PROMINENCE.CONTEXT]: {
    ...rounded,
    lineColor: NAVIGATION_LINE_COLORS.mainRoute,
    lineWidth: 3,
    lineOpacity: affectedOpacity(0.32, 0.12),
  },
});

function connectorStyle({
  color,
  width,
  opacity,
  dash = null,
  casingWidth = width + 2,
  casingOpacity = 0.82,
}) {
  // Mapbox dash lengths are multiples of each layer's width. Scale the casing
  // pattern so its pixel-length dashes align with the narrower colored core.
  const coreDash = dash ? { lineDasharray: dash } : {};
  const casingDash = dash
    ? { lineDasharray: dash.map((value) => (value * width) / casingWidth) }
    : {};
  return {
    casing: {
      ...rounded,
      ...casingDash,
      lineColor: NAVIGATION_LINE_COLORS.casing,
      lineWidth: casingWidth,
      lineOpacity: casingOpacity,
    },
    core: {
      ...rounded,
      ...coreDash,
      lineColor: color,
      lineWidth: width,
      lineOpacity: opacity,
    },
  };
}

const CONNECTOR_STYLES = Object.freeze({
  [NAVIGATION_CONNECTOR_ROLE.DIRECT]: {
    casing: null,
    core: {
      ...rounded,
      lineColor: NAVIGATION_LINE_COLORS.direct,
      lineWidth: 2,
      lineOpacity: 0.62,
      lineDasharray: [1, 2],
    },
  },
  [NAVIGATION_CONNECTOR_ROLE.GUIDE]: connectorStyle({
    color: NAVIGATION_LINE_COLORS.approach,
    width: 5,
    opacity: 0.96,
  }),
  [NAVIGATION_CONNECTOR_ROLE.JOIN_GUIDE]: connectorStyle({
    color: NAVIGATION_LINE_COLORS.approach,
    width: 4.5,
    opacity: 0.58,
    casingWidth: 6.5,
    casingOpacity: 0.5,
  }),
  [NAVIGATION_CONNECTOR_ROLE.REJOIN]: connectorStyle({
    color: NAVIGATION_LINE_COLORS.rejoin,
    width: 4,
    opacity: 0.9,
    dash: [2, 1.5],
  }),
});

export const SETUP_ROUTE_PREVIEW_STYLES = Object.freeze({
  casing: {
    ...rounded,
    lineColor: NAVIGATION_LINE_COLORS.casing,
    lineWidth: 9,
    lineOpacity: 0.88,
  },
  core: {
    ...rounded,
    lineColor: NAVIGATION_LINE_COLORS.mainRoute,
    lineWidth: 7,
    lineOpacity: 0.95,
  },
});

// Before Start the connector has not been classified yet, so it is deliberately
// presented as a proposal rather than as already accepted guidance.
export const SETUP_CONNECTOR_PREVIEW_STYLES = Object.freeze(
  connectorStyle({
    color: NAVIGATION_LINE_COLORS.approach,
    width: 4,
    opacity: 0.88,
    dash: [2, 1.5],
  }),
);

export function navigationMainRouteLineStyle(prominence) {
  return (
    MAIN_ROUTE_STYLES[prominence] ||
    MAIN_ROUTE_STYLES[NAVIGATION_MAIN_ROUTE_PROMINENCE.ACTIVE]
  );
}

export function navigationConnectorLineStyles(role) {
  return CONNECTOR_STYLES[role] || { casing: null, core: null };
}
