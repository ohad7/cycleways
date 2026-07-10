#!/usr/bin/env node
// Decode a shared-route token and print its navigation cues with and without
// derived routing-network junctions. Reads public-data; never writes it.
//
// Usage: node scripts/inspect-route-cues.mjs <route-token>
import { buildLiveDecodeRoute } from "../editor/server.mjs";
import { junctionsNearRoute } from "../packages/core/src/routing/junctionsNearRoute.js";
import { navigationRouteFromRouteState } from "../packages/core/src/navigation/navigationRoute.js";
import { buildRouteCues } from "../packages/core/src/navigation/navigationCues.js";
import { loadBaseNetworkAroundGeometry } from "./lib/base-network.mjs";

const token = process.argv[2];
if (!token) {
  console.error("usage: node scripts/inspect-route-cues.mjs <route-token>");
  process.exit(1);
}

const decode = await buildLiveDecodeRoute();
const decoded = decode(token, {});
if (!Array.isArray(decoded?.geometry) || decoded.geometry.length < 2) {
  console.error("token failed to decode");
  process.exit(1);
}

const routeState = {
  points: [
    { id: "start", ...decoded.geometry[0] },
    { id: "end", ...decoded.geometry.at(-1) },
  ],
  selectedSegments: decoded.selectedSegments ?? [],
  geometry: decoded.geometry,
  segmentSpans: decoded.segmentSpans ?? [],
};

function pointAtDistance(route, distanceMeters) {
  const geometry = route.geometry;
  let closest = geometry[0];
  let delta = Infinity;
  for (const point of geometry) {
    const candidateDelta = Math.abs(
      Number(point.distanceFromStartMeters) - Number(distanceMeters),
    );
    if (candidateDelta < delta) {
      closest = point;
      delta = candidateDelta;
    }
  }
  return closest;
}

function printCues(label, junctions) {
  const route = navigationRouteFromRouteState(
    { ...routeState, junctions },
    { param: "inspect" },
  );
  const cues = buildRouteCues(route);
  const counts = Object.fromEntries(
    [...new Set(cues.map((cue) => cue.type))].map((type) => [
      type,
      cues.filter((cue) => cue.type === type).length,
    ]),
  );
  console.log(`\n=== ${label} (${cues.length} cues) ===`);
  console.log(`counts ${JSON.stringify(counts)}`);
  for (const cue of cues) {
    const point = pointAtDistance(route, cue.distanceMeters);
    const parts = [
      `${Math.round(cue.distanceMeters)}m`,
      cue.type,
      cue.direction || "",
      cue.turnAngleDeg ? `${Math.round(cue.turnAngleDeg)}°` : "",
      cue.thenDirection ? `then ${cue.thenDirection}` : "",
      cue.ontoSegmentName || cue.segmentName || "",
      `@${point.lat.toFixed(5)},${point.lng.toFixed(5)}`,
    ].filter(Boolean);
    console.log(`  ${parts.join("  ")}`);
  }
  return cues;
}

console.log(`token ${token}`);
console.log(`geometry ${decoded.geometry.length} points`);
printCues("WITHOUT junctions (legacy)", null);
const network = loadBaseNetworkAroundGeometry(decoded.geometry);
const junctions = junctionsNearRoute(network, decoded.geometry);
console.log(
  `\nderived ${junctions.length} junctions near the route from ${network.shardCount} shards`,
);
printCues("WITH junctions (junction-gated)", junctions);
