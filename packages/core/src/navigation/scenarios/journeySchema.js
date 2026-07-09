import { getDistance } from "../../utils/distance.js";

export const JOURNEY_SCHEMA_VERSION = 1;

function failure(name, message) {
  throw new Error(`journey "${name}": ${message}`);
}

function validPoint(point) {
  return Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng));
}

function geometryDistance(geometry) {
  const points = Array.isArray(geometry) ? geometry : [];
  let distance = 0;
  for (let index = 1; index < points.length; index += 1) {
    distance += getDistance(points[index - 1], points[index]);
  }
  return distance;
}

export function validateResolvedJourney(journey) {
  const name = journey?.name || "unnamed";
  if (journey?.journeySchemaVersion !== JOURNEY_SCHEMA_VERSION) {
    failure(name, `journeySchemaVersion must be ${JOURNEY_SCHEMA_VERSION}`);
  }
  const fixes = Array.isArray(journey.fixes) ? journey.fixes : [];
  if (fixes.length < 2) failure(name, "requires at least two fixes");
  for (let index = 0; index < fixes.length; index += 1) {
    const fix = fixes[index];
    if (![fix?.lat, fix?.lng, fix?.timestamp].every(Number.isFinite)) {
      failure(name, `fix ${index} has invalid coordinate/timestamp`);
    }
    if (index === 0) continue;
    const previous = fixes[index - 1];
    const dtSeconds = (fix.timestamp - previous.timestamp) / 1000;
    if (!(dtSeconds > 0)) failure(name, `fix ${index} timestamp is not monotonic`);
    const measuredSpeed = getDistance(previous, fix) / dtSeconds;
    const declaredSpeed = Math.max(
      Number(previous.speed) || 0,
      Number(fix.speed) || 0,
    );
    if (measuredSpeed > Math.max(12, declaredSpeed * 1.5 + 2)) {
      failure(
        name,
        `fix ${index} moves at ${measuredSpeed.toFixed(1)}m/s but declares ${declaredSpeed.toFixed(1)}m/s`,
      );
    }
  }

  const responses = Array.isArray(journey.connectorResponses)
    ? journey.connectorResponses
    : [];
  const responseIds = responses.map((response) => response?.id);
  if (responseIds.some((id) => typeof id !== "string" || id.length === 0)) {
    failure(name, "every connector response requires an id");
  }
  if (new Set(responseIds).size !== responseIds.length) {
    failure(name, "connector response ids must be unique");
  }
  const responseKeys = new Set();
  for (const response of responses) {
    const match = response?.match;
    if (
      !match ||
      typeof match.targetMode !== "string" ||
      typeof match.purpose !== "string" ||
      !Number.isFinite(Number(match.attempt)) ||
      !validPoint(match.from) ||
      !validPoint(match.to)
    ) {
      failure(
        name,
        `connector response "${response.id}" requires semantic target, purpose, attempt, from, and to`,
      );
    }
    if (
      match.targetMode === "rejoin" &&
      !Number.isFinite(Number(match.targetProgressMeters))
    ) {
      failure(name, `connector response "${response.id}" requires rejoin target progress`);
    }
    const responseKey = [
      match.targetMode,
      match.purpose,
      Number(match.attempt),
      Number(match.targetProgressMeters ?? 0).toFixed(1),
      Number(match.from.lat).toFixed(6),
      Number(match.from.lng).toFixed(6),
      Number(match.to.lat).toFixed(6),
      Number(match.to.lng).toFixed(6),
    ].join(":");
    if (responseKeys.has(responseKey)) {
      failure(name, `connector response "${response.id}" duplicates a semantic request`);
    }
    responseKeys.add(responseKey);

    if (response.failure) continue;
    const result = response.result || response.connectorResult;
    const geometry = result?.geometry;
    if (
      !Array.isArray(geometry) ||
      geometry.length < 2 ||
      geometry.some((point) => !validPoint(point))
    ) {
      failure(name, `connector response "${response.id}" requires valid result geometry`);
    }
    if (!Array.isArray(result.edgeCosts) || !Array.isArray(result.snappedEndpoints)) {
      failure(name, `connector response "${response.id}" requires edgeCosts and snappedEndpoints snapshots`);
    }
    const tolerance = Math.max(
      20,
      Number(match.coordinateToleranceMeters) || 0,
    );
    if (
      getDistance(match.from, geometry[0]) > tolerance ||
      getDistance(match.to, geometry.at(-1)) > tolerance
    ) {
      failure(name, `connector response "${response.id}" geometry endpoints do not match its request`);
    }
    const declaredDistance = Number(result.distanceMeters);
    const measuredDistance = geometryDistance(geometry);
    if (
      !Number.isFinite(declaredDistance) ||
      declaredDistance <= 0 ||
      Math.abs(declaredDistance - measuredDistance) > Math.max(30, measuredDistance * 0.15)
    ) {
      failure(name, `connector response "${response.id}" has inconsistent routed distance`);
    }
  }

  const bookmarks = Array.isArray(journey.bookmarks) ? journey.bookmarks : [];
  if (bookmarks.length === 0) failure(name, "requires at least one camera bookmark");
  const bookmarkIds = new Set();
  const firstTimestamp = fixes[0].timestamp;
  const lastTimestamp = fixes.at(-1).timestamp;
  let previousTimestamp = -Infinity;
  for (const bookmark of bookmarks) {
    if (typeof bookmark?.id !== "string" || bookmark.id.length === 0) {
      failure(name, "every bookmark requires an id");
    }
    if (bookmarkIds.has(bookmark.id)) failure(name, `duplicate bookmark "${bookmark.id}"`);
    bookmarkIds.add(bookmark.id);
    const targetTimestamp = Number(bookmark.targetTimestamp);
    if (
      !Number.isFinite(targetTimestamp) ||
      targetTimestamp < firstTimestamp ||
      targetTimestamp > lastTimestamp
    ) {
      failure(name, `bookmark "${bookmark.id}" targetTimestamp is outside the journey`);
    }
    if (targetTimestamp < previousTimestamp) {
      failure(name, `bookmark "${bookmark.id}" is out of order`);
    }
    previousTimestamp = targetTimestamp;
    if (Number(bookmark.preRollMs) < 0 || Number(bookmark.holdMs) < 0) {
      failure(name, `bookmark "${bookmark.id}" has a negative pre-roll/hold`);
    }
    if (typeof bookmark.expectedStage !== "string" || bookmark.expectedStage.length === 0) {
      failure(name, `bookmark "${bookmark.id}" requires expectedStage`);
    }
  }
  return journey;
}

export function bookmarkPlaybackWindow(fixes, bookmark) {
  const list = Array.isArray(fixes) ? fixes : [];
  if (list.length === 0) return { warmupEndIndex: -1, startIndex: 0, endIndex: -1 };
  const target = Number(bookmark?.targetTimestamp);
  const startTimestamp = target - Math.max(0, Number(bookmark?.preRollMs) || 0);
  let startIndex = list.findIndex((fix) => Number(fix.timestamp) >= startTimestamp);
  if (startIndex < 0) startIndex = list.length - 1;
  let endIndex = list.findIndex((fix) => Number(fix.timestamp) >= target);
  if (endIndex < 0) endIndex = list.length - 1;
  return {
    warmupEndIndex: startIndex - 1,
    startIndex,
    endIndex,
  };
}
