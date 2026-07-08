import { hasCyclewaysNetworkMembership } from "./connectorCostModel.js";
import { getDistance } from "../utils/distance.js";

export const CONNECTOR_FEATURE_VERSION = 1;

// Lower rank is better. `cw_network` is a first-class class because CycleWays
// ownership is stronger evidence than incomplete OSM tags.
export const CONNECTOR_CLASS_RANK = {
  cw_network: 0,
  road: 1,
  local_road: 2,
  cycle: 3,
  path_track: 4,
  manual: 5,
  other: 6,
};

function connectorEdgeClass(edge) {
  if (hasCyclewaysNetworkMembership(edge)) return "cw_network";
  if (edge?.routeClass === "road" || edge?.roadType === "road") return "road";
  const routeClass = edge?.routeClass;
  return routeClass && routeClass in CONNECTOR_CLASS_RANK ? routeClass : "other";
}

function finiteNonNegative(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function detourRatio(routedMeters, straightLineMeters) {
  if (straightLineMeters > 1) return routedMeters / straightLineMeters;
  return routedMeters > 0 ? Infinity : 1;
}

export function computeConnectorFeatures(preview, { origin, routeStart } = {}) {
  const straightLineMeters =
    origin && routeStart ? getDistance(origin, routeStart) : 0;
  const failure = preview?.failure || null;

  if (!preview || failure) {
    return {
      featureVersion: CONNECTOR_FEATURE_VERSION,
      snapOk: false,
      failure: failure || "no-preview",
      straightLineMeters,
      routedMeters: 0,
      detourRatio: Infinity,
      cwNetworkFraction: 0,
      worstRouteClass: null,
      edgeCount: 0,
    };
  }

  const edges = Array.isArray(preview.edgeCosts) ? preview.edgeCosts : [];
  const routedMeters = finiteNonNegative(
    preview.distanceMeters,
    edges.reduce((sum, edge) => sum + finiteNonNegative(edge?.distanceMeters), 0),
  );
  let cwMeters = 0;
  let worstRank = -1;
  let worstRouteClass = null;

  for (const edge of edges) {
    const edgeMeters = finiteNonNegative(edge?.distanceMeters);
    const routeClass = connectorEdgeClass(edge);
    if (routeClass === "cw_network") cwMeters += edgeMeters;
    const rank = CONNECTOR_CLASS_RANK[routeClass] ?? CONNECTOR_CLASS_RANK.other;
    if (rank > worstRank) {
      worstRank = rank;
      worstRouteClass = routeClass;
    }
  }

  return {
    featureVersion: CONNECTOR_FEATURE_VERSION,
    snapOk: true,
    failure: null,
    straightLineMeters,
    routedMeters,
    detourRatio: detourRatio(routedMeters, straightLineMeters),
    cwNetworkFraction: routedMeters > 0 ? cwMeters / routedMeters : 0,
    worstRouteClass,
    edgeCount: edges.length,
  };
}
