import assert from "node:assert/strict";
import {
  buildNavigationGeometry,
} from "@cycleways/core/navigation/navigationRoute.js";
import { buildRouteCues } from "@cycleways/core/navigation/navigationCues.js";
import { createNavigationVoicePlanner } from "@cycleways/core/navigation/navigationVoice.js";
import { buildRouteAttestation } from "@cycleways/core/routing/routeAttestation.js";
import { crossingsOnRoute } from "@cycleways/core/routing/crossingsOnRoute.js";

// This is a behavior regression, not a live-curation assertion. The original
// Margaliot review record was intentionally removed, so keep the topology
// self-contained and let publication/current-data tests own curated content.
const BEFORE_SHARE = 10;
const AFTER_LEFT_SHARE = 20;
const AFTER_RIGHT_SHARE = 30;
const center = { lat: 33.2205053, lng: 35.548282 };
const crossing = {
  id: "fixture-margaliot-dirt-to-sideline",
  kind: "side-change",
  representation: "junction-transition",
  guidancePolicy: "user-option",
  center,
  crossedRoad: { name: "כביש 9977", highway: "secondary" },
  mappings: [{
    id: "fixture-margaliot-dirt-to-sideline-forward",
    direction: "dirt-to-north",
    match: {
      before: [{ edgeShareId: BEFORE_SHARE, fromFractionQ: 1_000_000, toFractionQ: 0 }],
      action: [],
      after: [{ edgeShareId: AFTER_LEFT_SHARE, fromFractionQ: 1_000_000, toFractionQ: 0 }],
    },
    entry: center,
    exit: center,
    continuation: { type: "turn", direction: "left" },
    policy: { state: "allowed", policyDigest: "fixture-policy" },
  }],
};

function routeFor({ geometry: rawGeometry, slices }) {
  const geometry = buildNavigationGeometry(rawGeometry);
  const routingValidation = buildRouteAttestation({
    validationContext: {
      baseRoutingSchemaVersion: 3,
      graphVersion: "margaliot-fixture-graph",
      policyId: "il-bicycle-v1",
      policyDigest: "fixture-policy",
      routingContextDigest: "margaliot-intersection-regression",
    },
    traversalSlices: slices.map((slice, index) => ({
      ...slice,
      distanceMeters: index === 0
        ? geometry[1].distanceFromStartMeters
        : geometry.at(-1).distanceFromStartMeters - geometry[1].distanceFromStartMeters,
      policyState: "allowed",
      policyReason: "fixture-policy",
      oppositePolicyState: "allowed",
      oppositePolicyReason: "fixture-policy",
      shardIds: ["margaliot-fixture"],
    })),
    waypointOccurrences: [],
    legBoundaries: [{ startTraversal: 0, endTraversal: slices.length }],
    geometry,
  });
  return { geometry, routingValidation };
}

const transitionRoute = routeFor({
  geometry: [
    { lat: 33.2204367, lng: 35.5477011 },
    center,
    { lat: 33.2207388, lng: 35.5483479 },
  ],
  slices: [
    { edgeShareId: BEFORE_SHARE, fromFractionQ: 1_000_000, toFractionQ: 0 },
    { edgeShareId: AFTER_LEFT_SHARE, fromFractionQ: 1_000_000, toFractionQ: 0 },
  ],
});
const artifact = {
  schemaVersion: 1,
  traversalPolicyDigest: "fixture-policy",
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
  junctions: [center],
  crossings: matches,
  guidanceMode: "guidance-v1",
  guidanceSpans: [
    {
      startMeters: 0,
      endMeters: matches[0].entryMeters,
      guidanceIdentity: "way:red-naftali-trail",
      name: "שביל אדום הרי נפתלי",
      role: "named-way",
      kind: "trail",
    },
    {
      startMeters: matches[0].entryMeters,
      endMeters: routeTotal,
      guidanceIdentity: "way:mitzpe-adi-road",
      name: "דרך נוף מצפה עדי - מטולה דרום",
      role: "named-way",
      kind: "road",
    },
  ],
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
assert.equal(enabledCrossing.thenManeuver.type, "turn");
assert.equal(enabledCrossing.thenManeuver.direction, "left");
assert.equal(
  enabledCrossing.thenManeuver.ontoGuidance.guidanceIdentity,
  "way:mitzpe-adi-road",
);
assert.equal(
  enabledCrossing.thenManeuver.ontoGuidance.name,
  "דרך נוף מצפה עדי - מטולה דרום",
);
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

const rightTurnRoute = routeFor({
  geometry: [
    { lat: 33.2204367, lng: 35.5477011 },
    center,
    { lat: 33.2202, lng: 35.54835 },
  ],
  slices: [
    { edgeShareId: BEFORE_SHARE, fromFractionQ: 1_000_000, toFractionQ: 0 },
    { edgeShareId: AFTER_RIGHT_SHARE, fromFractionQ: 0, toFractionQ: 1_000_000 },
  ],
});
assert.deepEqual(
  crossingsOnRoute(artifact, rightTurnRoute.routingValidation, rightTurnRoute.geometry),
  [],
  "turning right onto 9977 must not match the dirt-to-sideline crossing",
);
const rightTurnCues = buildRouteCues({
  geometry: rightTurnRoute.geometry,
  junctions: [center],
  crossings: [],
  segmentSpans: [],
});
assert.equal(rightTurnCues.find((cue) => cue.type === "turn")?.direction, "right");

console.log("Margaliot optional intersection crossing regression passed");
