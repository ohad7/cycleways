import { getDistance } from "../utils/distance.js";

function normalizeRequest(fromOrRequest, to, request) {
  if (request?.from && request?.to) return request;
  if (fromOrRequest?.from && fromOrRequest?.to) return fromOrRequest;
  return { from: fromOrRequest, to };
}

function closePoint(actual, expected, toleranceMeters) {
  if (!expected) return true;
  if (!actual) return false;
  const distance = getDistance(actual, expected);
  return Number.isFinite(distance) && distance <= toleranceMeters;
}

function matchesRequest(response, request, defaultToleranceMeters) {
  const match = response?.match || {};
  const tolerance = Number.isFinite(Number(match.coordinateToleranceMeters))
    ? Number(match.coordinateToleranceMeters)
    : defaultToleranceMeters;
  if (match.targetMode !== undefined && request.targetMode !== match.targetMode) return false;
  if (match.purpose !== undefined && request.purpose !== match.purpose) return false;
  if (match.attempt !== undefined && Number(request.attempt) !== Number(match.attempt)) return false;
  if (
    match.targetProgressMeters !== undefined
  ) {
    const actualProgress = Number(request.targetProgressMeters);
    const expectedProgress = Number(match.targetProgressMeters);
    const tolerance = Number(match.progressToleranceMeters ?? 20);
    if (
      !Number.isFinite(actualProgress) ||
      !Number.isFinite(expectedProgress) ||
      !Number.isFinite(tolerance) ||
      Math.abs(actualProgress - expectedProgress) > tolerance
    ) return false;
  }
  if (!closePoint(request.from, match.from, tolerance)) return false;
  if (!closePoint(request.to, match.to, tolerance)) return false;
  return true;
}

export function createScenarioConnectorAdapter(responses, options = {}) {
  const journeyId = options.journeyId || "scenario";
  const defaultToleranceMeters = Number.isFinite(Number(options.coordinateToleranceMeters))
    ? Number(options.coordinateToleranceMeters)
    : 35;
  const records = (Array.isArray(responses) ? responses : []).map((response, index) => ({
    ...response,
    id: response?.id || `response-${index + 1}`,
    consumed: false,
  }));
  const history = [];

  const connector = (fromOrRequest, to, explicitRequest) => {
    const request = normalizeRequest(fromOrRequest, to, explicitRequest);
    const candidates = records.filter(
      (response) => !response.consumed && matchesRequest(response, request, defaultToleranceMeters),
    );
    if (candidates.length !== 1) {
      const candidateIds = candidates.map((candidate) => candidate.id).join(", ") || "none";
      const error = new Error(
        `scenario connector "${journeyId}": expected exactly one response for ` +
          `${request.targetMode || "unknown"}/${request.purpose || "unknown"}/` +
          `attempt-${request.attempt ?? "?"}; matched ${candidateIds}`,
      );
      error.code = "SCENARIO_CONNECTOR_MISMATCH";
      error.scenarioConnector = true;
      throw error;
    }
    const selected = candidates[0];
    selected.consumed = true;
    history.push({
      responseId: selected.id,
      requestId: request.requestId ?? null,
      targetMode: request.targetMode ?? null,
      purpose: request.purpose ?? null,
      attempt: request.attempt ?? null,
    });
    if (selected.failure) return { failure: selected.failure };
    return selected.result || selected.connectorResult || {};
  };

  connector.assertComplete = () => {
    const unused = records.filter((response) => !response.consumed).map((response) => response.id);
    if (unused.length > 0) {
      const error = new Error(
        `scenario connector "${journeyId}": unused responses: ${unused.join(", ")}`,
      );
      error.code = "SCENARIO_CONNECTOR_UNUSED";
      error.scenarioConnector = true;
      throw error;
    }
    return true;
  };
  connector.getDiagnostics = () => ({
    journeyId,
    history: history.map((entry) => ({ ...entry })),
    unusedResponseIds: records
      .filter((response) => !response.consumed)
      .map((response) => response.id),
  });
  return connector;
}

// Compatibility for existing non-camera scenarios. New shared journeys use
// explicit semantic responses above so changes in request order fail closed.
export function connectorRouterForMode(mode) {
  if (mode === "none") return null;
  if (mode === "fail") return () => ({ failure: "scenario-forced-failure" });
  if (mode === "guide-turn") {
    return (request) => ({
      geometry: [
        request.from,
        { lat: request.from.lat, lng: request.to.lng },
        request.to,
      ],
      edgeCosts: [{
        routeClass: "road",
        roadType: "road",
        cyclewaysSegmentIds: [],
        distanceMeters: 100,
      }],
    });
  }
  return (request) => ({ geometry: [request.from, request.to] });
}

export function connectorRouterForScenario(resolved) {
  if (Array.isArray(resolved?.connectorResponses)) {
    return createScenarioConnectorAdapter(resolved.connectorResponses, {
      journeyId: resolved.name,
    });
  }
  return connectorRouterForMode(resolved?.connector ?? "straight-line");
}
