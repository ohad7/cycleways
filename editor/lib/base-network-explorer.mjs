export const BASE_NETWORK_PRESETS = Object.freeze({
  all: {
    id: "all",
    label: "All base edges",
    description: "Show the complete base routing graph.",
  },
  bicycle_no: {
    id: "bicycle_no",
    label: "Raw bicycle=no",
    description: "Show source edges whose raw OSM bicycle tag is no.",
  },
  prohibited_both: {
    id: "prohibited_both",
    label: "Blocked both directions",
    description: "Show edges whose normalized routing policy prohibits both directions.",
  },
  conditional: {
    id: "conditional",
    label: "Conditional",
    description: "Show edges whose effective routing policy remains conditional.",
  },
  manual: {
    id: "manual",
    label: "Manual edges",
    description: "Show manual base-network features.",
  },
  reviewed_overrides: {
    id: "reviewed_overrides",
    label: "Reviewed OSM overrides",
    description: "Show OSM ways with a current reviewed traversal override.",
  },
});

export const BASE_NETWORK_THEMES = Object.freeze({
  traversal: { id: "traversal", label: "Bicycle traversal" },
  raw_access: { id: "raw_access", label: "Raw bicycle/access" },
  source: { id: "source", label: "Source" },
  neutral: { id: "neutral", label: "Neutral" },
  connector: { id: "connector", label: "Connector lens" },
});

const VALID_PRESETS = new Set(Object.keys(BASE_NETWORK_PRESETS));
const VALID_THEMES = new Set(Object.keys(BASE_NETWORK_THEMES));

export function normalizeBaseNetworkPreset(value) {
  return VALID_PRESETS.has(value) ? value : "all";
}

export function normalizeBaseNetworkTheme(value) {
  return VALID_THEMES.has(value) ? value : "traversal";
}

export function rawTagValue(properties, key) {
  const value = properties?.[key];
  if (value === null || value === undefined || value === "") return "missing";
  return String(value).trim().toLowerCase();
}

export function traversalStates(properties) {
  const traversal = properties?.bicycleTraversal || {};
  return {
    forward: String(traversal.forward || "unknown").toLowerCase(),
    reverse: String(traversal.reverse || "unknown").toLowerCase(),
  };
}

function categoryForTraversalStates({ forward, reverse }) {
  if (forward === "unknown" || reverse === "unknown") return "unknown";
  if (forward === "conditional" || reverse === "conditional") return "conditional";
  if (forward === "prohibited" && reverse === "prohibited") return "blocked";
  if (
    (forward === "allowed" && reverse === "prohibited") ||
    (forward === "prohibited" && reverse === "allowed")
  ) {
    return "direction_limited";
  }
  if (forward === "allowed" && reverse === "allowed") return "bidirectional";
  return "unknown";
}

export function traversalCategory(properties) {
  return categoryForTraversalStates(traversalStates(properties));
}

export function effectiveTraversalStates(properties, acceptedCwDirections = new Set()) {
  const edgeId = String(properties?.edgeId || properties?.manualEdgeId || properties?.id || "");
  const states = traversalStates(properties);
  const traversal = properties?.bicycleTraversal || {};
  for (const direction of ["forward", "reverse"]) {
    const reason = String(traversal[`${direction}Reason`] || "");
    const accessEligible =
      (states[direction] === "prohibited" && reason === "explicit-access-prohibited") ||
      (states[direction] === "conditional" && reason === "explicit-access-conditional");
    if (
      accessEligible &&
      acceptedCwDirections.has(`${edgeId}|${direction}`)
    ) {
      states[direction] = "allowed";
    }
  }
  return states;
}

export function baseNetworkRenderProperties(
  properties,
  traversalOverrides = [],
  acceptedCwDirections = new Set(),
) {
  const overrideWayIds =
    traversalOverrides instanceof Set
      ? traversalOverrides
      : new Set((traversalOverrides || []).map((item) => Number(item?.osmWayId)).filter(Number.isFinite));
  const osmWayId = Number(properties?.osmWayId);
  const effectiveStates = effectiveTraversalStates(properties, acceptedCwDirections);
  const baseStates = traversalStates(properties);
  return {
    explorerTraversalCategory: categoryForTraversalStates(effectiveStates),
    explorerBaseTraversalCategory: categoryForTraversalStates(baseStates),
    explorerRawBicycle: rawTagValue(properties, "bicycle"),
    explorerRawAccess: rawTagValue(properties, "access"),
    explorerHasOverride: Number.isInteger(osmWayId) && overrideWayIds.has(osmWayId),
    explorerCwPrecedenceForward:
      baseStates.forward !== effectiveStates.forward,
    explorerCwPrecedenceReverse:
      baseStates.reverse !== effectiveStates.reverse,
  };
}

export function matchesBaseNetworkPreset(feature, presetValue, traversalOverrides = []) {
  const preset = normalizeBaseNetworkPreset(presetValue);
  const properties = feature?.properties || {};
  if (preset === "all") return true;
  if (preset === "bicycle_no") return rawTagValue(properties, "bicycle") === "no";
  const category = properties.explorerTraversalCategory || traversalCategory(properties);
  if (preset === "prohibited_both") return category === "blocked";
  if (preset === "conditional") return category === "conditional";
  if (preset === "manual") return properties.source === "manual";
  if (preset === "reviewed_overrides") {
    const wayId = Number(properties.osmWayId);
    const ids =
      traversalOverrides instanceof Set
        ? traversalOverrides
        : new Set((traversalOverrides || []).map((item) => Number(item?.osmWayId)).filter(Number.isFinite));
    return Number.isInteger(wayId) && ids.has(wayId);
  }
  return true;
}

export function filterBaseNetworkFeatures(features, preset, traversalOverrides = []) {
  return (features || []).filter((feature) =>
    matchesBaseNetworkPreset(feature, preset, traversalOverrides),
  );
}

export function indexCyclewaysEdges(overlay) {
  const byEdgeId = new Map();
  for (const mapping of Object.values(overlay?.segments || {})) {
    if (!Array.isArray(mapping?.edgeRefs)) continue;
    const segmentId = Number(mapping.segmentId);
    for (const ref of mapping.edgeRefs) {
      const edgeId = String(ref?.edgeId || "");
      if (!edgeId) continue;
      if (!byEdgeId.has(edgeId)) byEdgeId.set(edgeId, new Map());
      if (Number.isInteger(segmentId)) {
        byEdgeId.get(edgeId).set(segmentId, mapping.segmentName || `Segment ${segmentId}`);
      }
    }
  }
  return byEdgeId;
}

function featureEdgeId(feature) {
  return String(
    feature?.properties?.edgeId ||
      feature?.properties?.manualEdgeId ||
      feature?.properties?.id ||
      feature?.id ||
      "",
  );
}

export function baseNetworkSubjectKey(feature) {
  const properties = feature?.properties || {};
  const osmWayId = Number(properties.osmWayId);
  if (Number.isInteger(osmWayId) && osmWayId > 0) return `osm:${osmWayId}`;
  return `edge:${featureEdgeId(feature)}`;
}

export function groupBaseNetworkSubjects(features, cwByEdgeId = new Map()) {
  const grouped = new Map();
  for (const feature of features || []) {
    const properties = feature?.properties || {};
    const key = baseNetworkSubjectKey(feature);
    if (!grouped.has(key)) {
      const osmWayId = Number(properties.osmWayId);
      grouped.set(key, {
        key,
        kind: Number.isInteger(osmWayId) && osmWayId > 0 ? "osm_way" : "base_edge",
        osmWayId: Number.isInteger(osmWayId) && osmWayId > 0 ? osmWayId : null,
        label: properties.name || properties["name:he"] || properties.highway || featureEdgeId(feature),
        highway: properties.highway || properties.osmRouteClass || properties.roadType || "unknown",
        features: [],
        edgeIds: [],
        cwSegments: new Map(),
        cwPrecedenceDirections: new Set(),
      });
    }
    const subject = grouped.get(key);
    const edgeId = featureEdgeId(feature);
    subject.features.push(feature);
    subject.edgeIds.push(edgeId);
    if (properties.explorerCwPrecedenceForward) subject.cwPrecedenceDirections.add("forward");
    if (properties.explorerCwPrecedenceReverse) subject.cwPrecedenceDirections.add("reverse");
    for (const [segmentId, segmentName] of cwByEdgeId.get(edgeId) || []) {
      subject.cwSegments.set(segmentId, segmentName);
    }
  }
  return [...grouped.values()]
    .map((subject) => ({
      ...subject,
      cwSegments: [...subject.cwSegments.entries()]
        .map(([segmentId, segmentName]) => ({ segmentId, segmentName }))
        .sort((left, right) => left.segmentId - right.segmentId),
      cwPrecedenceDirections: [...subject.cwPrecedenceDirections].sort(),
    }))
    .sort((left, right) => {
      const cwOrder = Number(right.cwSegments.length > 0) - Number(left.cwSegments.length > 0);
      if (cwOrder !== 0) return cwOrder;
      return String(left.label).localeCompare(String(right.label), "he");
    });
}

export function summarizeBaseNetwork(features, preset, traversalOverrides = [], overlay = null) {
  const matchingFeatures = filterBaseNetworkFeatures(features, preset, traversalOverrides);
  const subjects = groupBaseNetworkSubjects(matchingFeatures, indexCyclewaysEdges(overlay));
  const cwSegmentIds = new Set(
    subjects.flatMap((subject) => subject.cwSegments.map((segment) => segment.segmentId)),
  );
  return {
    matchingFeatures,
    subjects,
    edgeCount: matchingFeatures.length,
    subjectCount: subjects.length,
    cwSegmentCount: cwSegmentIds.size,
  };
}

export function baseNetworkMapFilter(presetValue) {
  const preset = normalizeBaseNetworkPreset(presetValue);
  if (preset === "all") return null;
  if (preset === "bicycle_no") return ["==", ["get", "explorerRawBicycle"], "no"];
  if (preset === "prohibited_both") {
    return ["==", ["get", "explorerTraversalCategory"], "blocked"];
  }
  if (preset === "conditional") {
    return ["==", ["get", "explorerTraversalCategory"], "conditional"];
  }
  if (preset === "manual") return ["==", ["get", "source"], "manual"];
  if (preset === "reviewed_overrides") return ["==", ["get", "explorerHasOverride"], true];
  return null;
}

export function baseNetworkLineColorExpression(themeValue) {
  const theme = normalizeBaseNetworkTheme(themeValue);
  if (theme === "raw_access") {
    return [
      "case",
      ["==", ["get", "explorerRawBicycle"], "no"],
      "#dc2626",
      ["==", ["get", "explorerRawAccess"], "no"],
      "#991b1b",
      ["in", ["get", "explorerRawAccess"], ["literal", ["private", "conditional"]]],
      "#d97706",
      ["==", ["get", "explorerRawBicycle"], "missing"],
      "#64748b",
      "#15803d",
    ];
  }
  if (theme === "source") {
    return ["match", ["get", "source"], "manual", "#7c3aed", "osm", "#2563eb", "#64748b"];
  }
  if (theme === "neutral") return "#2563eb";
  if (theme === "connector") {
    return ["coalesce", ["get", "connectorLensColor"], ["get", "graphColor"], "#607076"];
  }
  return [
    "match",
    ["get", "explorerTraversalCategory"],
    "bidirectional",
    "#0f766e",
    "direction_limited",
    "#2563eb",
    "blocked",
    "#dc2626",
    "conditional",
    "#d97706",
    "unknown",
    "#7c3aed",
    "#64748b",
  ];
}

export function baseNetworkLegend(themeValue) {
  const theme = normalizeBaseNetworkTheme(themeValue);
  if (theme === "raw_access") {
    return [
      { label: "bicycle=no", color: "#dc2626" },
      { label: "access=no", color: "#991b1b" },
      { label: "private/conditional", color: "#d97706" },
      { label: "bicycle missing", color: "#64748b" },
      { label: "other bicycle value", color: "#15803d" },
    ];
  }
  if (theme === "source") {
    return [
      { label: "OSM", color: "#2563eb" },
      { label: "manual", color: "#7c3aed" },
    ];
  }
  if (theme === "neutral") return [{ label: "base edge", color: "#2563eb" }];
  if (theme === "connector") return [{ label: "controlled by Connector Lens", color: "#607076" }];
  return [
    { label: "bidirectional", color: "#0f766e" },
    { label: "direction-limited", color: "#2563eb" },
    { label: "blocked", color: "#dc2626" },
    { label: "conditional", color: "#d97706" },
    { label: "unknown", color: "#7c3aed" },
  ];
}
