const ALLOWED = "allowed";
const PROHIBITED = "prohibited";

function manualEdgeId(feature) {
  return String(
    feature?.properties?.manualEdgeId ||
      feature?.properties?.id ||
      feature?.id ||
      "",
  );
}

function traversalForFeature(feature, overrideByWayId, manualById) {
  const properties = feature?.properties || {};
  const osmWayId = Number(properties.osmWayId);
  const override = Number.isInteger(osmWayId) ? overrideByWayId.get(osmWayId) : null;
  if (override?.states) {
    return {
      forward: override.states.forward,
      reverse: override.states.reverse,
      evidenceSource: "reviewed-override",
      staged: true,
    };
  }

  if (properties.source === "manual" || properties.manualEdgeId) {
    const currentManual = manualById.get(manualEdgeId(feature));
    const traversal = currentManual?.properties?.bicycleTraversal || properties.bicycleTraversal || {};
    return {
      forward: traversal.forward || "unknown",
      reverse: traversal.reverse || "unknown",
      evidenceSource: traversal.reviewed ? "manual-review" : "manual-unreviewed",
      staged: Boolean(currentManual),
    };
  }

  const traversal = properties.bicycleTraversal || {};
  return {
    forward: traversal.forward || "unknown",
    reverse: traversal.reverse || "unknown",
    evidenceSource: "osm-policy",
    staged: false,
  };
}

function directionLimitedFeature(feature, traversal) {
  const coordinates = feature?.geometry?.coordinates;
  if (feature?.geometry?.type !== "LineString" || !Array.isArray(coordinates) || coordinates.length < 2) {
    return null;
  }

  const forwardAllowed = traversal.forward === ALLOWED;
  const reverseAllowed = traversal.reverse === ALLOWED;
  if (forwardAllowed === reverseAllowed) return null;

  const allowedDirection = forwardAllowed ? "forward" : "reverse";
  const blockedDirection = forwardAllowed ? "reverse" : "forward";
  const blockedState = traversal[blockedDirection];
  const reviewClass = blockedState === PROHIBITED ? "confirmed-one-way" : "needs-review";
  const orientedCoordinates = forwardAllowed
    ? coordinates.map((coordinate) => [...coordinate])
    : [...coordinates].reverse().map((coordinate) => [...coordinate]);

  return {
    ...feature,
    geometry: { ...feature.geometry, coordinates: orientedCoordinates },
    properties: {
      ...(feature.properties || {}),
      directionLayerClass: reviewClass,
      allowedDirection,
      blockedDirection,
      blockedState,
      directionLabel: forwardAllowed ? "A → B" : "B → A",
      directionEvidenceSource: traversal.evidenceSource,
      directionEvidenceStaged: traversal.staged,
    },
  };
}

export function buildBaseEdgeDirectionLayer(
  graphEdges,
  manualEdges = null,
  traversalOverrides = null,
) {
  const graphFeatures = Array.isArray(graphEdges?.features) ? graphEdges.features : [];
  const manualFeatures = Array.isArray(manualEdges?.features) ? manualEdges.features : [];
  const manualById = new Map(
    manualFeatures
      .map((feature) => [manualEdgeId(feature), feature])
      .filter(([id]) => id),
  );
  const overrideByWayId = new Map(
    (traversalOverrides?.overrides || [])
      .map((record) => [Number(record?.osmWayId), record])
      .filter(([wayId]) => Number.isInteger(wayId) && wayId > 0),
  );
  const graphManualIds = new Set(
    graphFeatures
      .filter((feature) => feature?.properties?.source === "manual")
      .map(manualEdgeId)
      .filter(Boolean),
  );
  const candidates = [
    ...graphFeatures,
    ...manualFeatures.filter((feature) => !graphManualIds.has(manualEdgeId(feature))),
  ];
  const features = candidates
    .map((feature) =>
      directionLimitedFeature(
        feature,
        traversalForFeature(feature, overrideByWayId, manualById),
      ),
    )
    .filter(Boolean);

  return {
    type: "FeatureCollection",
    features,
  };
}

export function summarizeBaseEdgeDirectionLayer(collection) {
  const summary = { total: 0, confirmedOneWay: 0, needsReview: 0 };
  for (const feature of collection?.features || []) {
    summary.total += 1;
    if (feature?.properties?.directionLayerClass === "confirmed-one-way") {
      summary.confirmedOneWay += 1;
    } else {
      summary.needsReview += 1;
    }
  }
  return summary;
}
