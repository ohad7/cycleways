import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { buildLiveDecodeRoute } from "../../editor/server.mjs";
import { stableDemoBundleString } from "../../packages/core/src/navigation/demoBundle.js";
import { junctionsNearRoute } from "../../packages/core/src/routing/junctionsNearRoute.js";
import { roundaboutsOnRoute } from "../../packages/core/src/routing/roundaboutsOnRoute.js";
import { joinRoundaboutReviews } from "../../editor/lib/roundaboutReview.mjs";
import { loadBaseNetworkAroundGeometry } from "./base-network.mjs";
import { loadRouteStateForSlug } from "./featuredRouteSnapshotBuilder.mjs";

function roundedRouteState(routeState) {
  // Geometry is rounded for a reproducible fixture, so any attestation tied to
  // the unrounded geometry must be rebuilt by the scenario resolver.
  const { routingValidation: _discardedRoutingValidation, ...portableRouteState } = routeState;
  const geometry = (routeState.geometry || []).map((point) => ({
    ...point,
    lat: Math.round(Number(point.lat) * 1e6) / 1e6,
    lng: Math.round(Number(point.lng) * 1e6) / 1e6,
  }));
  return {
    ...portableRouteState,
    points: Array.isArray(routeState.points) && routeState.points.length >= 2
      ? routeState.points
      : [{ id: "start", ...geometry[0] }, { id: "end", ...geometry.at(-1) }],
    geometry,
    segmentSpans: (routeState.segmentSpans || []).map((span) => ({
      ...span,
      startMeters: Math.round(Number(span.startMeters) * 100) / 100,
      endMeters: Math.round(Number(span.endMeters) * 100) / 100,
    })),
  };
}

function reviewedRoundabouts() {
  const candidatesPath = "build/osm/roundabout-candidates.json";
  const reviewsPath = "data/roundabout-review.json";
  if (!existsSync(candidatesPath) || !existsSync(reviewsPath)) return [];
  const joined = joinRoundaboutReviews(
    JSON.parse(readFileSync(candidatesPath, "utf8")),
    JSON.parse(readFileSync(reviewsPath, "utf8")),
  );
  if (joined.blockingIssues.length > 0) {
    throw new Error(`roundabout review is incomplete: ${joined.blockingIssues.map((issue) => issue.code).join(", ")}`);
  }
  return joined.accepted;
}

function navigationJunctions(geometry) {
  const network = loadBaseNetworkAroundGeometry(geometry);
  const junctions = junctionsNearRoute(network, geometry).map((junction) => ({
    lat: Math.round(Number(junction.lat) * 1e6) / 1e6,
    lng: Math.round(Number(junction.lng) * 1e6) / 1e6,
  }));
  return [...junctions, ...roundaboutsOnRoute(reviewedRoundabouts(), geometry)];
}

export async function buildNavigationRouteSnapshot({ catalogSlug, routeToken, name } = {}) {
  if (!!catalogSlug === !!routeToken) throw new Error("choose exactly one catalogSlug or routeToken");
  let state;
  if (catalogSlug) {
    const loaded = await loadRouteStateForSlug(catalogSlug);
    state = loaded?.routeState || loaded;
  }
  else {
    const decode = await buildLiveDecodeRoute();
    state = decode(routeToken, { slug: name || "demo-route", name: name || "Demo route", route: routeToken });
  }
  if (!state?.geometry || state.geometry.length < 2) throw new Error("route did not decode to navigable geometry");
  const rounded = roundedRouteState(state);
  return {
    ...rounded,
    junctions: navigationJunctions(rounded.geometry),
  };
}

export function routeSnapshotDigest(routeState) {
  const canonical = stableDemoBundleString(routeState);
  return createHash("sha256").update(canonical).digest("hex");
}
