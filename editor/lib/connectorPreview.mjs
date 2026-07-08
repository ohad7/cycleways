import { buildOriginGrid } from "@cycleways/core/routing/connectorSampling.js";
import { validateConnectorStrategy } from "@cycleways/core/routing/connectorCostModel.js";

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function isLatLng(p) {
  return p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));
}

function positiveNumber(value, fallback, name) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw badRequest(`${name} must be a positive number`);
  return n;
}

function positiveInteger(value, fallback, name) {
  const n = positiveNumber(value, fallback, name);
  if (!Number.isInteger(n)) throw badRequest(`${name} must be a positive integer`);
  return n;
}

function edgeIdsFromPreview(preview) {
  // previewBaseRoute() returns the traversed base-graph edge ids directly
  // (route-manager.js: route.traversals.map(t => t.edge.id)).
  return (preview.edgeIds || []).map(String);
}

function runSingle(manager, origin, routeStart, strategy) {
  const preview = manager.previewBaseRoute([origin, routeStart], {
    costProfile: "connector",
    connectorStrategy: strategy,
  });
  return {
    mode: "single",
    failure: preview.failure || null,
    geometry: preview.geometry || [],
    distanceMeters: preview.distanceMeters || 0,
    edgeIds: preview.failure ? [] : edgeIdsFromPreview(preview),
    edgeCosts: preview.failure ? [] : (preview.edgeCosts || []),
  };
}

export function runConnectorPreview(manager, body = {}) {
  const { mode, routeStart, strategy } = body;
  if (!isLatLng(routeStart)) throw badRequest("routeStart {lat,lng} required");
  const strategyValidation = validateConnectorStrategy(strategy);
  if (!strategyValidation.ok) throw badRequest(strategyValidation.error);

  if (mode === "single") {
    if (!isLatLng(body.origin)) throw badRequest("origin {lat,lng} required for single mode");
    return runSingle(manager, body.origin, routeStart, strategy);
  }

  if (mode === "frequency") {
    const { origins, spacingMeters, radiusMeters, capped } = buildOriginGrid(routeStart, {
      radiusMeters: positiveNumber(body.radiusMeters, 2000, "radiusMeters"),
      spacingMeters: positiveNumber(body.gridSpacingMeters, 150, "gridSpacingMeters"),
      maxOrigins: positiveInteger(body.maxOrigins, 400, "maxOrigins"),
    });
    const edgeUsage = {};
    const outOrigins = [];
    const byFailure = {};
    let ok = 0;
    for (const origin of origins) {
      const preview = manager.previewBaseRoute([origin, routeStart], {
        costProfile: "connector",
        connectorStrategy: strategy,
      });
      const status = preview.failure || "ok";
      outOrigins.push({ lat: origin.lat, lng: origin.lng, status });
      if (preview.failure) {
        byFailure[status] = (byFailure[status] || 0) + 1;
      } else {
        ok += 1;
        for (const id of edgeIdsFromPreview(preview)) {
          edgeUsage[id] = (edgeUsage[id] || 0) + 1;
        }
      }
    }
    return {
      mode: "frequency",
      edgeUsage,
      origins: outOrigins,
      stats: { total: outOrigins.length, ok, failed: outOrigins.length - ok, byFailure },
      grid: { spacingMeters, radiusMeters, capped },
    };
  }

  throw badRequest(`unknown mode: ${mode}`);
}
