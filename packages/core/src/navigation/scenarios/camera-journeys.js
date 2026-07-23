import { getDistance } from "../../utils/distance.js";
import { approachTargetChoices } from "../connectorTargeting.js";
import { navigationRouteFromRouteState } from "../navigationRoute.js";
import { generateTrack } from "../trackGenerator.js";
import baniasGanHatsafon from "./routes/banias-gan-hatsafon.js";
import beitHillelWestConnector from "./routes/beit-hillel-west-connector.js";
import hulaRegionalMovement from "./routes/hula-regional-movement.js";
import sovevBeitHillel from "./routes/sovev-beit-hillel.js";

function routeFor(routeState, id) {
  return navigationRouteFromRouteState(routeState, { param: id });
}

function connectorResponse({
  id,
  from,
  to,
  purpose,
  attempt,
  targetMode = "start",
  targetProgressMeters = 0,
  geometry = null,
  distanceMeters = null,
  edgeCosts = null,
}) {
  const routedGeometry = Array.isArray(geometry) && geometry.length >= 2
    ? geometry
    : [
        { lat: Number(from.lat), lng: Number(from.lng) },
        { lat: Number(to.lat), lng: Number(to.lng) },
      ];
  const routedDistance = Number.isFinite(Number(distanceMeters))
    ? Number(distanceMeters)
    : getDistance(from, to);
  return {
    id,
    match: {
      targetMode,
      targetProgressMeters,
      progressToleranceMeters: 1,
      purpose,
      attempt,
      from,
      to,
      coordinateToleranceMeters: 35,
    },
    result: {
      geometry: routedGeometry,
      distanceMeters: routedDistance,
      snappedEndpoints: [],
      edgeCosts: Array.isArray(edgeCosts)
        ? edgeCosts
        : [],
    },
  };
}

const sovevRoute = routeFor(sovevBeitHillel, "camera-journey-sovev-beit-hillel");
const routeStart = sovevRoute.geometry[0];
const guidedConnectorStart = {
  lat: routeStart.lat,
  lng: routeStart.lng + 0.006,
};
const connectorRoute = routeFor(
  {
    points: [
      { id: "connector-start", ...guidedConnectorStart },
      { id: "route-start", ...routeStart },
    ],
    selectedSegments: [],
    segmentSpans: [],
    geometry: [guidedConnectorStart, routeStart],
  },
  "camera-journey-guided-connector",
);

function combinedApproachRide(seed) {
  const connectorFixes = generateTrack(connectorRoute, {
    speedMps: 8,
    intervalMs: 1000,
    seed,
  });
  const rideFixes = generateTrack(sovevRoute, {
    speedMps: 8,
    intervalMs: 1000,
    seed: seed + 1,
    startTimestamp: connectorFixes.at(-1).timestamp + 1000,
  });
  return { connectorFixes, fixes: [...connectorFixes, ...rideFixes] };
}

const guidedTrack = combinedApproachRide(21);
const guidedFixes = guidedTrack.fixes;
const guidedTarget = approachTargetChoices(sovevRoute, guidedFixes[0]).nearest;
// The route tracker acquires the main route three seconds before the final
// sampled connector point; this timestamp is asserted by the headless journey
// timeline and used as CAM's seam bookmark.
const approachJoinTimestamp = guidedTrack.connectorFixes.at(-1).timestamp - 3000;

const guidedJourney = {
  name: "journey-guided-approach",
  description: "Guided approach, connector seam, main maneuver, and local arrival",
  group: "camera-journey",
  camera: true,
  entryMode: "ride-intro",
  journeySchemaVersion: 2,
  route: { routeState: sovevBeitHillel },
  track: { fixes: guidedFixes },
  connectorResponses: [
    connectorResponse({
      id: "guided-initial",
      from: guidedFixes[0],
      to: guidedTarget.point,
      purpose: "initial",
      attempt: 1,
      targetMode: "nearest",
      targetProgressMeters: guidedTarget.mainProgressMeters,
      geometry: [guidedFixes[0], guidedTarget.point],
      distanceMeters: getDistance(guidedFixes[0], guidedTarget.point),
      edgeCosts: beitHillelWestConnector.edgeCosts,
    }),
  ],
  bookmarks: [
    {
      id: "guided-intro",
      label: "Intro · before Start",
      phase: "pre-start",
      startAction: "hold",
      targetTimestamp: guidedFixes[0].timestamp,
      preRollMs: 0,
      holdMs: 0,
      expectedStage: "intro-start-facing",
    },
    {
      id: "guided-follow",
      label: "Guided approach follow",
      phase: "post-start",
      startAction: "require-confirm",
      targetTimestamp: 30000,
      preRollMs: 5000,
      holdMs: 2500,
      expectedStage: "approach-guide",
    },
    {
      id: "connector-seam",
      label: "Connector → main-route seam",
      phase: "post-start",
      startAction: "require-confirm",
      targetTimestamp: approachJoinTimestamp,
      preRollMs: 5000,
      holdMs: 3000,
      expectedStage: "join-route",
    },
    {
      id: "main-maneuver",
      label: "Main-route maneuver",
      phase: "post-start",
      startAction: "require-confirm",
      targetTimestamp: 354000,
      preRollMs: 6000,
      holdMs: 2500,
      expectedStage: "pre-turn",
    },
    {
      id: "local-arrival",
      label: "Local arrival",
      phase: "post-start",
      startAction: "require-confirm",
      targetTimestamp: guidedFixes.at(-1).timestamp,
      preRollMs: 5000,
      holdMs: 3000,
      expectedStage: "arrived-local",
    },
  ],
  expect: [
    { type: "camera-sequence", values: ["approach-guide", "join-route", "ride", "pre-turn", "arrived-local"] },
    { type: "camera-fit-kind", value: "route", never: true },
    { type: "arrived" },
  ],
};

const regionalMovementRoute = routeFor(
  hulaRegionalMovement,
  "camera-journey-hula-regional-movement",
);
const tooFarFixes = generateTrack(regionalMovementRoute, {
  speedMps: 5,
  intervalMs: 10000,
  stopAtMeters: 350,
  seed: 23,
});
const tooFarJourney = {
  name: "journey-too-far",
  description: "Plausible regional movement while the selected start remains too far away",
  group: "camera-journey",
  camera: true,
  entryMode: "ride-intro",
  journeySchemaVersion: 2,
  route: { routeState: baniasGanHatsafon },
  track: { fixes: tooFarFixes },
  connectorResponses: [],
  bookmarks: [
    {
      id: "regional-intro",
      label: "Regional intro · before Start",
      phase: "pre-start",
      startAction: "hold",
      targetTimestamp: tooFarFixes[0].timestamp,
      preRollMs: 0,
      holdMs: 0,
      expectedStage: "intro-start-facing",
    },
    {
      id: "regional-too-far",
      label: "Regional too-far overview",
      phase: "post-start",
      startAction: "require-confirm",
      targetTimestamp: tooFarFixes.at(-1).timestamp,
      preRollMs: Math.min(30000, tooFarFixes.at(-1).timestamp),
      holdMs: 3000,
      expectedStage: "approach-too-far",
    },
  ],
  expect: [
    { type: "camera-stage", value: "approach-too-far" },
    { type: "camera-pitch", stage: "approach-too-far", value: 55 },
    { type: "camera-fit-kind", value: "route", never: true },
  ],
};

const recoveryFixes = generateTrack(sovevRoute, {
  speedMps: 8,
  intervalMs: 1000,
  seed: 33,
  offRouteExcursion: { startMeters: 4000, lengthMeters: 500, offsetMeters: 60 },
});
const rejoinSnapshots = [
  [33.205280805332954, 35.59975444531128, 33.20514082540959, 35.599298290183896, 4135.99993158092],
  [33.20575137407448, 35.59980347377052, 33.2058393552652, 35.59918278599651, 4216.0000863475925],
  [33.20624673142696, 35.59991239369497, 33.20633590087187, 35.59928332305134, 4272.000142966559],
  [33.20674564995111, 35.59995046258506, 33.206831334617384, 35.5993914083868, 4328.000333496344],
  [33.20726203118704, 35.59992187499088, 33.20732671200372, 35.59949986153525, 4384.000291781499],
  [33.20771107778022, 35.59985538850453, 33.20775132072196, 35.59959282127387, 4432.000202890254],
  [33.20816375697838, 35.59976519813782, 33.20817592903175, 35.599685780923075, 4480.000067825406],
];
const recoveryResponses = rejoinSnapshots.map((snapshot, index) => {
  const from = { lat: snapshot[0], lng: snapshot[1] };
  const to = { lat: snapshot[2], lng: snapshot[3] };
  return {
    id: `rejoin-${index + 1}`,
    match: {
      targetMode: "rejoin",
      purpose: index === 0 ? "initial" : "refresh",
      attempt: index + 1,
      targetProgressMeters: snapshot[4],
      progressToleranceMeters: 5,
      from,
      to,
      coordinateToleranceMeters: 15,
    },
    result: {
      geometry: [from, to],
      distanceMeters: getDistance(from, to),
      snappedEndpoints: [],
      edgeCosts: [],
    },
  };
});

const recoveryJourney = {
  name: "journey-ride-recovery",
  description: "Main ride, maneuver, off-route follow, reacquisition, and local arrival",
  group: "camera-journey",
  camera: true,
  entryMode: "ride-intro",
  journeySchemaVersion: 2,
  route: { routeState: sovevBeitHillel },
  track: { fixes: recoveryFixes },
  connectorResponses: recoveryResponses,
  bookmarks: [
    {
      id: "ride-intro",
      label: "At-start intro · before Start",
      phase: "pre-start",
      startAction: "hold",
      targetTimestamp: recoveryFixes[0].timestamp,
      preRollMs: 0,
      holdMs: 0,
      expectedStage: "intro-overhead",
    },
    {
      id: "off-route-follow",
      label: "Off-route rider-centered follow",
      phase: "post-start",
      startAction: "require-confirm",
      targetTimestamp: 530000,
      preRollMs: 6000,
      holdMs: 3000,
      expectedStage: "off-route",
    },
    {
      id: "reacquisition",
      label: "Reacquisition into follow",
      phase: "post-start",
      startAction: "require-confirm",
      targetTimestamp: 561000,
      preRollMs: 7000,
      holdMs: 3000,
      expectedStage: "reacquire-route",
    },
    {
      id: "post-recovery-turn",
      label: "Maneuver after recovery",
      phase: "post-start",
      startAction: "require-confirm",
      targetTimestamp: 651000,
      preRollMs: 5000,
      holdMs: 2500,
      expectedStage: "pre-turn",
    },
    {
      id: "recovery-arrival",
      label: "Local arrival after recovery",
      phase: "post-start",
      startAction: "require-confirm",
      targetTimestamp: recoveryFixes.at(-1).timestamp,
      preRollMs: 5000,
      holdMs: 3000,
      expectedStage: "arrived-local",
    },
  ],
  expect: [
    { type: "camera-sequence", values: ["ride", "off-route", "reacquire-route", "pre-turn", "arrived-local"] },
    // A guided rejoin leg is delivered during the off-route segment (see
    // recoveryResponses above), so the frame steers course-up along it
    // instead of holding still.
    { type: "camera-rotations", atMost: 2, during: "off-route" },
    { type: "camera-fit-kind", value: "route", never: true },
    { type: "arrived" },
  ],
};

export default [guidedJourney, tooFarJourney, recoveryJourney];
