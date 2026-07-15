import assert from "node:assert/strict";
import { buildNavigationGeometry } from "@cycleways/core/navigation/navigationRoute.js";
import { buildRouteCues } from "@cycleways/core/navigation/navigationCues.js";
import { createNavigationVoicePlanner } from "@cycleways/core/navigation/navigationVoice.js";
import { crossingsOnRoute } from "@cycleways/core/routing/crossingsOnRoute.js";
import { buildRouteAttestation } from "@cycleways/core/routing/routeAttestation.js";

const geometry = [
  { lat: 33.2346331, lng: 35.5796901 },
  { lat: 33.2348508, lng: 35.5798743 },
  { lat: 33.2349779, lng: 35.5799434 },
  { lat: 33.2350465, lng: 35.5799477 },
  { lat: 33.2350993, lng: 35.5799357 },
  { lat: 33.235098, lng: 35.579934 },
  { lat: 33.235075, lng: 35.580104 },
  { lat: 33.235431, lng: 35.580306 },
  { lat: 33.235477, lng: 35.580311 },
  { lat: 33.235519, lng: 35.580312 },
  { lat: 33.235549, lng: 35.580307 },
  { lat: 33.235618, lng: 35.58028 },
];
const context = {
  baseRoutingSchemaVersion: 3,
  graphVersion: "road99-headless-fixture",
  policyId: "il-bicycle-v1",
  policyDigest: "road99-reviewed-policy",
  routingContextDigest: "road99-headless-context",
};
const slice = (edgeShareId, fromFractionQ, toFractionQ, distanceMetersQ) => ({
  edgeShareId,
  fromFractionQ,
  toFractionQ,
  distanceMetersQ,
  policyState: "allowed",
  policyReason: "reviewed-fixture",
  oppositePolicyState: "unknown",
  oppositePolicyReason: "not-reviewed-for-this-fixture",
});
const traversalSlices = [
  slice(28534, 1_000_000, 0, 58_800),
  slice(48308, 1_000_000, 0, 16_000),
  // The real replay divides this one base edge at a waypoint boundary. The
  // reviewed mapping correctly describes it as one continuous edge slice.
  slice(48320, 1_000_000, 671_636, 21_377),
  slice(48320, 671_636, 0, 43_723),
];
const attestation = buildRouteAttestation({
  validationContext: context,
  traversalSlices,
  waypointOccurrences: [],
  legBoundaries: [],
  geometry,
});
const mapping = {
  id: "mapping:69e01febdbf3b487",
  match: {
    before: [{ edgeShareId: 28534, fromFractionQ: 1_000_000, toFractionQ: 0 }],
    action: [{ edgeShareId: 48308, fromFractionQ: 1_000_000, toFractionQ: 0 }],
    after: [{ edgeShareId: 48320, fromFractionQ: 1_000_000, toFractionQ: 0 }],
  },
  entry: { lat: 33.235098, lng: 35.579934 },
  exit: { lat: 33.235075, lng: 35.580104 },
};
const artifact = {
  schemaVersion: 1,
  graphVersion: context.graphVersion,
  traversalPolicyDigest: context.policyDigest,
  crossings: [{
    id: "crossing:1092567462:33.2351-35.5800:48308",
    kind: "side-change",
    center: { lat: 33.2350865, lng: 35.580019 },
    crossedRoad: { source: "osm", sourceIds: [1092567462], highway: "trunk" },
    mappings: [mapping],
  }],
};

const crossings = crossingsOnRoute(artifact, attestation, geometry);
assert.equal(crossings.length, 1);
assert.equal(crossings[0].mappingId, mapping.id);

const navigationGeometry = buildNavigationGeometry(geometry);
const crossing = crossings[0];
const followingRoundaboutEntry = crossing.exitMeters + 55;
const junctions = [
  { kind: "junction", lat: mapping.entry.lat, lng: mapping.entry.lng },
  { kind: "junction", lat: mapping.exit.lat, lng: mapping.exit.lng },
  {
    kind: "roundabout",
    roundaboutId: "osm-ways:855779446",
    lat: geometry.at(-2).lat,
    lng: geometry.at(-2).lng,
    entryMeters: followingRoundaboutEntry,
    exitMeters: followingRoundaboutEntry + 10,
    entryBearingDeg: 20,
    exitBearingDeg: 20,
    complete: true,
  },
];
const baseRoute = {
  geometry: navigationGeometry,
  junctions,
  segmentSpans: [],
  activeDataPoints: [],
};
const beforeCues = buildRouteCues({ ...baseRoute, crossings: null });
const afterCues = buildRouteCues({ ...baseRoute, crossings });
const afterCrossing = afterCues.find((cue) => cue.type === "crossing");
const afterRoundabout = afterCues.find((cue) => cue.type === "roundabout");

assert.equal(afterCues.filter((cue) => cue.type === "crossing").length, 1);
assert.equal(
  afterCues.filter((cue) => cue.type === "turn"
    && cue.distanceMeters >= crossing.entryMeters - 8
    && cue.distanceMeters <= crossing.exitMeters + 8).length,
  0,
  "the reviewed action interval must not retain the literal corner pair",
);
assert.ok(beforeCues.filter((cue) => cue.type === "turn").length >= 2);
assert.deepEqual(afterCrossing.thenManeuver, { type: "roundabout", direction: "straight" });
assert.equal(afterRoundabout.compoundPreviousType, "crossing");
assert.deepEqual(
  afterCues.at(-1),
  beforeCues.at(-1),
  "crossing semantics must not change route length or arrival progress",
);

const voice = createNavigationVoicePlanner({ locale: "he-IL", cooldownMs: 0 });
const utterance = voice.plan(
  { kind: "cue", cue: afterCrossing, cueType: "crossing", phase: "final" },
  { activeCue: { cue: afterCrossing, distanceToCueMeters: 0 } },
  1000,
).utterance;
assert.equal(
  utterance.text,
  "חצו בזהירות לצד השני של הכביש, ואז בכיכר המשיכו ישר",
);

console.log("Road 99 crossing impact regression passed");
