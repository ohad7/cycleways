import { classifyConnector } from "./connectorConfidence.js";

function isLatLng(point) {
  return point && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng));
}

function pointKey(point) {
  return `${Number(point.lat).toFixed(6)},${Number(point.lng).toFixed(6)}`;
}

function labelIdentity(record, index) {
  if (
    !record ||
    !isLatLng(record.routeStart) ||
    !isLatLng(record.origin) ||
    typeof record.strategyHash !== "string"
  ) {
    return `row:${index}`;
  }
  const featureVersion =
    record.featureVersion ??
    record.features?.featureVersion ??
    "unversioned";
  return [
    record.routeSlug || "",
    pointKey(record.routeStart),
    pointKey(record.origin),
    record.strategyHash,
    featureVersion,
  ].join("|");
}

export function latestConnectorLabels(labels) {
  const latest = new Map();
  for (const [index, record] of (labels || []).entries()) {
    latest.set(labelIdentity(record, index), record);
  }
  return [...latest.values()];
}

function emptyVerdictCounts() {
  return { guide: 0, tooFar: 0, other: 0 };
}

export function evaluateThresholds(labels, thresholds) {
  const counts = {
    valid: emptyVerdictCounts(),
    unacceptable: emptyVerdictCounts(),
    borderline: emptyVerdictCounts(),
    total: 0,
  };
  for (const record of latestConnectorLabels(labels)) {
    if (!record || !counts[record.verdict]) continue;
    const { tier } = classifyConnector(record.features, thresholds);
    if (tier === "guide") {
      counts[record.verdict].guide += 1;
    } else {
      counts[record.verdict].tooFar += 1;
      counts[record.verdict].other += 1;
    }
    counts.total += 1;
  }

  const validTotal = counts.valid.guide + counts.valid.other;
  const invalidTotal = counts.unacceptable.guide + counts.unacceptable.other;
  return {
    counts,
    validGuideRate: validTotal ? counts.valid.guide / validTotal : null,
    invalidGuideRate: invalidTotal
      ? counts.unacceptable.guide / invalidTotal
      : null,
  };
}
