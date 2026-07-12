export const CONNECTOR_EXCLUDED_COLOR = "#9ca3af";

// Sequential low→high cost stops (viridis-ish, colorblind-safe).
const COST_STOPS = [
  { max: 1.0, color: "#1b7837" }, // free / road
  { max: 1.25, color: "#5aae61" },
  { max: 1.75, color: "#d9ef8b" },
  { max: 2.5, color: "#fee08b" },
  { max: 4.0, color: "#f46d43" },
  { max: Infinity, color: "#a50026" }, // very expensive but still traversable
];

export function connectorCostColor(multiplier) {
  if (!Number.isFinite(multiplier)) return CONNECTOR_EXCLUDED_COLOR;
  for (const stop of COST_STOPS) {
    if (multiplier <= stop.max) return stop.color;
  }
  return COST_STOPS[COST_STOPS.length - 1].color;
}

export const CONNECTOR_COST_LEGEND = [
  { label: "≤1.0 (road)", color: "#1b7837" },
  { label: "≤1.25", color: "#5aae61" },
  { label: "≤1.75", color: "#d9ef8b" },
  { label: "≤2.5", color: "#fee08b" },
  { label: "≤4.0", color: "#f46d43" },
  { label: ">4.0", color: "#a50026" },
  { label: "excluded", color: CONNECTOR_EXCLUDED_COLOR },
];

const CLASS_COLORS = {
  cw_network: "#7c3aed",
  road: "#1f78b4",
  local_road: "#6d7785",
  cycle: "#33a02c",
  path_track: "#8f6a20",
  manual: "#b15928",
  other: "#999999",
};

export function connectorClassColor(routeClass) {
  return CLASS_COLORS[routeClass] || CLASS_COLORS.other;
}

export const CONNECTOR_CLASS_LEGEND = Object.entries(CLASS_COLORS).map(
  ([label, color]) => ({ label, color }),
);

const ACCESS_COLORS = {
  unrestricted: "#1b7837",
  permitted: "#5aae61",
  unspecified: "#6d7785",
  conditional: "#f59e0b",
  restricted: "#dc2626",
  unknown: "#999999",
};

export function connectorAccessColor(accessStatus) {
  return ACCESS_COLORS[accessStatus] || ACCESS_COLORS.unknown;
}

export const CONNECTOR_ACCESS_LEGEND = Object.entries(ACCESS_COLORS).map(
  ([label, color]) => ({ label, color }),
);
