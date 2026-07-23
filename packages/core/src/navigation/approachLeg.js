import { buildNavigationGeometry } from "./navigationRoute.js";

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function buildApproachLeg(connectorResult, { id = "approach", target = null } = {}) {
  const geometry = buildNavigationGeometry(connectorResult?.geometry).map((point) => ({
    ...point,
    leg: "approach",
  }));
  if (geometry.length < 2) return null;

  const computedDistance =
    geometry.length > 0
      ? finitePositive(geometry[geometry.length - 1].distanceFromStartMeters)
      : null;
  const distanceMeters =
    finitePositive(connectorResult?.distanceMeters) ?? computedDistance ?? 0;

  return {
    route: {
      id,
      canNavigate: true,
      unavailableReason: null,
      requiresStartAcquisition: false,
      geometry,
      distanceMeters,
      distanceKm: Math.round((distanceMeters / 1000) * 10) / 10,
      activeDataPoints: [],
      segmentSpans: [],
      junctions: null,
      crossings: Array.isArray(connectorResult?.crossings)
        ? connectorResult.crossings.map((crossing) => ({ ...crossing }))
        : null,
      routingValidation: connectorResult?.routingValidation
        ? structuredClone(connectorResult.routingValidation)
        : null,
      maneuverGeneratorVersion: "navigation-cues-v4",
      approachTarget: target,
    },
    geometry,
    distanceMeters,
  };
}
