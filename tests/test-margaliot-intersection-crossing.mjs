import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildNavigationGeometry,
} from "@cycleways/core/navigation/navigationRoute.js";
import { buildRouteCues } from "@cycleways/core/navigation/navigationCues.js";
import { createNavigationVoicePlanner } from "@cycleways/core/navigation/navigationVoice.js";
import { buildRouteAttestation } from "@cycleways/core/routing/routeAttestation.js";
import { crossingsOnRoute } from "@cycleways/core/routing/crossingsOnRoute.js";
import { joinCrossingReviews } from "../editor/lib/crossingReview.mjs";

const loadJson = async (relative) => JSON.parse(
  await readFile(new URL(`../${relative}`, import.meta.url), "utf8"),
);

const [graph, registry, reviews] = await Promise.all([
  loadJson("build/osm/osm-base-graph-elevated.json"),
  loadJson("data/base-edge-share-ids.json"),
  loadJson("data/crossing-review.json"),
]);

const joined = joinCrossingReviews(
  { schemaVersion: 1, coverage: { baseGraph: "complete" }, crossings: [] },
  reviews,
);
assert.deepEqual(joined.blockingIssues, []);
const crossing = joined.runtimeCrossings.find(
  (item) => item.id === "manual-crossing-margaliot-dirt-to-sideline",
);
assert.ok(crossing, "the reviewed Margaliot transition is publishable");

const edgeIdByShare = new Map(
  Object.entries(registry.edges).map(([edgeId, shareId]) => [shareId, edgeId]),
);
const edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
const edgeForShare = (shareId) => edgeById.get(edgeIdByShare.get(shareId));
const mapping = crossing.mappings[0];

function coordinatesForSlice(slice) {
  const edge = edgeForShare(slice.edgeShareId);
  assert.ok(edge, `base edge for share ${slice.edgeShareId}`);
  const coordinates = slice.toFractionQ > slice.fromFractionQ
    ? edge.coordinates
    : [...edge.coordinates].reverse();
  return coordinates.map(([lng, lat]) => ({ lat, lng }));
}

function routeForSlices(slices) {
  const rawGeometry = [];
  for (const slice of slices) {
    const points = coordinatesForSlice(slice);
    rawGeometry.push(...(rawGeometry.length ? points.slice(1) : points));
  }
  const geometry = buildNavigationGeometry(rawGeometry);
  const policyDigest = edgeForShare(slices[0].edgeShareId)
    .bicycleTraversalShadow.policyDigest;
  const routingValidation = buildRouteAttestation({
    validationContext: {
      baseRoutingSchemaVersion: 3,
      graphVersion: "margaliot-current-graph",
      policyId: "il-bicycle-v1",
      policyDigest,
      routingContextDigest: "margaliot-intersection-regression",
    },
    traversalSlices: slices.map((slice) => {
      const edge = edgeForShare(slice.edgeShareId);
      const direction = slice.toFractionQ > slice.fromFractionQ ? "forward" : "reverse";
      const opposite = direction === "forward" ? "reverse" : "forward";
      return {
        ...slice,
        distanceMeters: edge.distanceMeters,
        policyState: edge.bicycleTraversalShadow[direction],
        policyReason: "reviewed-base-policy",
        oppositePolicyState: edge.bicycleTraversalShadow[opposite],
        oppositePolicyReason: "reviewed-base-policy",
      };
    }),
    waypointOccurrences: [],
    legBoundaries: [],
    geometry,
  });
  return { geometry, routingValidation, policyDigest };
}

const transitionSlices = [
  ...mapping.match.before,
  ...mapping.match.after,
];
const transitionRoute = routeForSlices(transitionSlices);
const artifact = {
  schemaVersion: 1,
  traversalPolicyDigest: transitionRoute.policyDigest,
  crossings: [crossing],
};
const matches = crossingsOnRoute(
  artifact,
  transitionRoute.routingValidation,
  transitionRoute.geometry,
);
assert.equal(matches.length, 1);
assert.equal(matches[0].entryMeters, matches[0].exitMeters);
assert.equal(matches[0].crossingRepresentation, "junction-transition");
assert.equal(matches[0].guidancePolicy, "user-option");

const routeTotal = transitionRoute.geometry.at(-1).distanceFromStartMeters;
const namedRoute = {
  geometry: transitionRoute.geometry,
  junctions: [{ ...crossing.center }],
  crossings: matches,
  segmentSpans: [
    {
      startMeters: 0,
      endMeters: matches[0].entryMeters,
      name: "שביל אדום הרי נפתלי",
    },
    {
      startMeters: matches[0].entryMeters,
      endMeters: routeTotal,
      name: "דרך נוף מצפה עדי - מטולה דרום",
    },
  ],
};

const enabledCues = buildRouteCues(namedRoute);
const enabledCrossing = enabledCues.find((cue) => cue.type === "crossing");
assert.ok(enabledCrossing);
assert.equal(enabledCues.filter((cue) => cue.type === "turn").length, 0);
assert.deepEqual(enabledCrossing.thenManeuver, {
  type: "turn",
  direction: "left",
  ontoSegmentName: "דרך נוף מצפה עדי - מטולה דרום",
});
const utterance = createNavigationVoicePlanner().plan(
  {
    kind: "cue",
    cueType: "crossing",
    phase: "final",
    cue: enabledCrossing,
  },
  {
    activeCue: {
      cue: enabledCrossing,
      phase: "final",
      distanceToCueMeters: 15,
    },
  },
  1000,
).utterance;
assert.match(
  utterance.text,
  /חצו בזהירות לצד השני של הכביש, ואז פנו שמאלה אל דרך נוף מצפה עדי - מטולה דרום/,
);

const disabledCues = buildRouteCues(namedRoute, {
  intersectionCrossingGuidanceEnabled: false,
});
assert.equal(disabledCues.filter((cue) => cue.type === "crossing").length, 0);
const fallbackTurn = disabledCues.find((cue) => cue.type === "turn");
assert.equal(fallbackTurn?.direction, "left");
assert.equal(fallbackTurn?.ontoSegmentName, "דרך נוף מצפה עדי - מטולה דרום");

const rightTurnRoute = routeForSlices([
  mapping.match.before[0],
  { edgeShareId: 42652, fromFractionQ: 0, toFractionQ: 1_000_000 },
]);
assert.deepEqual(
  crossingsOnRoute(artifact, rightTurnRoute.routingValidation, rightTurnRoute.geometry),
  [],
  "turning right onto 9977 must not match the dirt-to-sideline crossing",
);
const rightTurnCues = buildRouteCues({
  geometry: rightTurnRoute.geometry,
  junctions: [{ ...crossing.center }],
  crossings: [],
  segmentSpans: [],
});
assert.equal(rightTurnCues.find((cue) => cue.type === "turn")?.direction, "right");

console.log("Margaliot optional intersection crossing regression passed");
