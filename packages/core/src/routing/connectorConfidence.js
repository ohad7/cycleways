export const DEFAULT_CONNECTOR_THRESHOLDS = {
  tooFarRadiusMeters: 10000,
};

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

  // A successful connector has already passed the routing strategy's edge and
  // access gates. Distance, detour, and route-class metadata describe the
  // resulting trip; they do not make that accepted route less trustworthy.
  return { tier: "guide", handoffSuggested: false, reasons: [] };
}
