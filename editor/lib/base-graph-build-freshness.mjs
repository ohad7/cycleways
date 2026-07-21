export const BASE_GRAPH_INPUTS = Object.freeze([
  Object.freeze({ key: "rawOsmWays", label: "raw OSM ways" }),
  Object.freeze({ key: "osmIntersections", label: "OSM intersections" }),
  Object.freeze({ key: "manualBaseEdges", label: "manual base edges" }),
  Object.freeze({ key: "bicycleTraversalOverrides", label: "bicycle traversal overrides" }),
]);

export function compareBaseGraphBuildInputs(recorded, current) {
  if (Number(recorded?.schemaVersion) !== 1 || !recorded?.files) {
    return {
      comparable: false,
      fresh: false,
      mismatches: BASE_GRAPH_INPUTS.map(({ key, label }) => ({
        key,
        label,
        reason: "missing-recorded-digest",
      })),
    };
  }
  if (Number(current?.schemaVersion) !== 1 || !current?.files) {
    throw new Error("Current base-graph input snapshot is invalid");
  }

  const mismatches = [];
  for (const { key, label } of BASE_GRAPH_INPUTS) {
    const recordedFile = recorded.files[key] || {};
    const currentFile = current.files[key] || {};
    const recordedExists = Boolean(recordedFile.exists);
    const currentExists = Boolean(currentFile.exists);
    const recordedDigest = recordedFile.digest || null;
    const currentDigest = currentFile.digest || null;
    if (recordedExists !== currentExists || recordedDigest !== currentDigest) {
      mismatches.push({
        key,
        label,
        reason: recordedExists !== currentExists ? "existence-changed" : "content-changed",
        recordedDigest,
        currentDigest,
      });
    }
  }
  return {
    comparable: true,
    fresh: mismatches.length === 0,
    mismatches,
  };
}

export function baseGraphFreshnessReason(comparison) {
  if (comparison?.fresh) return "current input digests";
  const labels = (comparison?.mismatches || []).map((item) => item.label);
  return labels.length > 0
    ? `changed ${labels.join(", ")}`
    : "missing or invalid input digests";
}
