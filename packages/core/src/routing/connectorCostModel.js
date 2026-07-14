// Single source of truth for the connector cost model: the two gates that
// decide whether an edge may carry a connector route and how expensive it is.
// A `null` class multiplier or access-policy value means "excluded".
// CW network membership is a first-class connector class: it is evaluated
// before base-map routeClass/access gates because accepted CycleWays ownership
// is stronger evidence of connector usability than incomplete OSM tags.


export const DEFAULT_CONNECTOR_STRATEGY = {
  "classMultipliers": {
    "cw_network": 0.8,
    "road": 1,
    "local_road": 4,
    "cycle": null,
    "path_track": null,
    "manual": null,
    "other": null
  },
  "accessPolicy": {
    "restricted": null,
    "conditional": null
  },
  "uphillWeight": 8,
  "snap": "allowed-only"
}

export const DEFAULT_CONNECTOR_STRATEGY_PREVIOUS = {
  classMultipliers: {
    cw_network: 0.8,
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

const SNAP_MODES = new Set(["allowed-only", "any"]);

function isFiniteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

export function hasCyclewaysNetworkMembership(edge) {
  if (!edge || typeof edge !== "object") return false;
  const arrays = [
    edge.cwSegmentIds,
    edge.cyclewaysSegmentIds,
    edge.cwAlignments?.forward,
    edge.cwAlignments?.reverse,
  ];
  if (arrays.some((value) => Array.isArray(value) && value.length > 0)) {
    return true;
  }
  return Boolean(
    edge.cwSegmentId ||
      edge.cyclewaysSegmentId ||
      Number(edge.cwSegmentCount) > 0 ||
      Number(edge.cyclewaysSegmentCount) > 0,
  );
}

export function validateConnectorStrategy(strategy) {
  if (!strategy || typeof strategy !== "object") {
    return { ok: false, error: "strategy object required" };
  }
  if (!strategy.classMultipliers || typeof strategy.classMultipliers !== "object") {
    return { ok: false, error: "strategy.classMultipliers object required" };
  }
  for (const [key, value] of Object.entries(strategy.classMultipliers)) {
    if (value !== null && !isFiniteNonNegative(Number(value))) {
      return { ok: false, error: `strategy.classMultipliers.${key} must be a non-negative number or null` };
    }
  }
  if (!strategy.accessPolicy || typeof strategy.accessPolicy !== "object") {
    return { ok: false, error: "strategy.accessPolicy object required" };
  }
  for (const [key, value] of Object.entries(strategy.accessPolicy)) {
    if (value !== null && !isFiniteNonNegative(Number(value))) {
      return { ok: false, error: `strategy.accessPolicy.${key} must be a non-negative number or null` };
    }
  }
  if (!isFiniteNonNegative(Number(strategy.uphillWeight))) {
    return { ok: false, error: "strategy.uphillWeight must be a non-negative number" };
  }
  if (!SNAP_MODES.has(strategy.snap)) {
    return { ok: false, error: "strategy.snap must be allowed-only or any" };
  }
  return { ok: true, error: null };
}

function classMultiplier(edge, strategy) {
  const cm = strategy.classMultipliers || {};
  if (hasCyclewaysNetworkMembership(edge)) {
    return cm.cw_network == null ? null : Number(cm.cw_network);
  }
  if (edge.routeClass === "road" || edge.roadType === "road") {
    return cm.road == null ? null : Number(cm.road);
  }
  const key = edge.routeClass;
  if (key != null && key in cm) return cm[key] == null ? null : Number(cm[key]);
  return cm.other == null ? null : Number(cm.other);
}

function accessMultiplier(edge, strategy) {
  const ap = strategy.accessPolicy || {};
  const status = edge.accessStatus;
  if (status != null && status in ap) {
    return ap[status] == null ? null : Number(ap[status]);
  }
  return 1;
}

export function evaluateConnectorEdge(edge, strategy = DEFAULT_CONNECTOR_STRATEGY) {
  const excluded = { allowed: false, multiplier: Infinity };
  if (!edge) return excluded;

  if (hasCyclewaysNetworkMembership(edge)) {
    const cwMultiplier = classMultiplier(edge, strategy);
    if (cwMultiplier == null || !Number.isFinite(cwMultiplier)) return excluded;
    return { allowed: true, multiplier: cwMultiplier };
  }

  const access = accessMultiplier(edge, strategy);
  if (access == null || !Number.isFinite(access)) return excluded;

  const klass = classMultiplier(edge, strategy);
  if (klass == null || !Number.isFinite(klass)) return excluded;

  return { allowed: true, multiplier: klass * access };
}
