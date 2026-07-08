// Single source of truth for the connector cost model: the two gates that
// decide whether an edge may carry a connector route and how expensive it is.
// A `null` class multiplier or access-policy value means "excluded".
// DEFAULT_CONNECTOR_STRATEGY encodes the exact current production behavior.

export const DEFAULT_CONNECTOR_STRATEGY = {
  classMultipliers: {
    road: 1,
    local_road: 1.1,
    cycle: null,
    path_track: null,
    manual: null,
    other: null,
  },
  accessPolicy: {
    restricted: null,
    conditional: null,
  },
  uphillWeight: 8,
  snap: "allowed-only",
};

function classMultiplier(edge, strategy) {
  const cm = strategy.classMultipliers || {};
  if (edge.routeClass === "road" || edge.roadType === "road") {
    return cm.road ?? null;
  }
  const key = edge.routeClass;
  if (key != null && key in cm) return cm[key];
  return cm.other ?? null;
}

function accessMultiplier(edge, strategy) {
  const ap = strategy.accessPolicy || {};
  const status = edge.accessStatus;
  if (status != null && status in ap) return ap[status];
  return 1;
}

export function evaluateConnectorEdge(edge, strategy = DEFAULT_CONNECTOR_STRATEGY) {
  const excluded = { allowed: false, multiplier: Infinity };
  if (!edge) return excluded;

  const access = accessMultiplier(edge, strategy);
  if (access == null || !Number.isFinite(access)) return excluded;

  const klass = classMultiplier(edge, strategy);
  if (klass == null || !Number.isFinite(klass)) return excluded;

  return { allowed: true, multiplier: klass * access };
}
