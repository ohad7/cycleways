import { buildOriginGrid } from "@cycleways/core/routing/connectorSampling.js";

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function isLatLng(p) {
  return p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));
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
  };
}

export function runConnectorPreview(manager, body = {}) {
  const { mode, routeStart, strategy } = body;
  if (!isLatLng(routeStart)) throw badRequest("routeStart {lat,lng} required");
  if (!strategy || typeof strategy !== "object") throw badRequest("strategy required");

  if (mode === "single") {
    if (!isLatLng(body.origin)) throw badRequest("origin {lat,lng} required for single mode");
    return runSingle(manager, body.origin, routeStart, strategy);
  }

  if (mode === "frequency") {
    const { origins, spacingMeters, radiusMeters, capped } = buildOriginGrid(routeStart, {
      radiusMeters: Number(body.radiusMeters) || 2000,
      spacingMeters: Number(body.gridSpacingMeters) || 150,
      maxOrigins: Number(body.maxOrigins) || 400,
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
