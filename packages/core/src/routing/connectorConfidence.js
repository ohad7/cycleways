import { CONNECTOR_CLASS_RANK } from "./connectorFeatures.js";

export const DEFAULT_CONNECTOR_THRESHOLDS = {
  guideRadiusMeters: 3000,
  tooFarRadiusMeters: 10000,
  maxDetourRatio: 2.5,
  maxRoutedMeters: 8000,
  worstClassAllowed: "local_road",
};

function classRank(routeClass) {
  return CONNECTOR_CLASS_RANK[routeClass] ?? CONNECTOR_CLASS_RANK.other;
}

export function classifyConnector(
  features,
  thresholds = DEFAULT_CONNECTOR_THRESHOLDS,
) {
  if (!features || features.snapOk !== true) {
    return { tier: "too-far", handoffSuggested: true, reasons: ["unreachable"] };
  }

  if (features.straightLineMeters > thresholds.tooFarRadiusMeters) {
    return {
      tier: "too-far",
      handoffSuggested: true,
      reasons: ["beyond-too-far-radius"],
    };
  }

  const reasons = [];
  if (features.straightLineMeters > thresholds.guideRadiusMeters) {
    reasons.push("beyond-guide-radius");
  }
  if (features.detourRatio > thresholds.maxDetourRatio) {
    reasons.push("detour-too-high");
  }
  if (features.routedMeters > thresholds.maxRoutedMeters) {
    reasons.push("routed-too-long");
  }
  const worstRouteClass = features.worstRouteClass || "cw_network";
  if (classRank(worstRouteClass) > classRank(thresholds.worstClassAllowed)) {
    reasons.push("class-too-low");
  }

  if (reasons.length === 0) {
    return { tier: "guide", handoffSuggested: false, reasons: [] };
  }
  return { tier: "show-leg", handoffSuggested: true, reasons };
}
