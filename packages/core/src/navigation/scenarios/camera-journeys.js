import { getDistance } from "../../utils/distance.js";
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
  routeClass = null,
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
      targetMode: "start",
      targetProgressMeters: 0,
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
        : routeClass
        ? [{
            routeClass,
            roadType: routeClass === "road" ? "road" : null,
            cyclewaysSegmentIds: [],
            distanceMeters: routedDistance,
          }]
        : [],
    },
  };
}

const sovevRoute = routeFor(sovevBeitHillel, "camera-journey-sovev-beit-hillel");
const routeStart = sovevRoute.geometry[0];
const connectorRoute = routeFor(
  {
    points: [
      { id: "connector-start", ...beitHillelWestConnector.from },
      { id: "route-start", ...beitHillelWestConnector.to },
    ],
    selectedSegments: [],
    segmentSpans: [],
    geometry: beitHillelWestConnector.geometry,
    distance: beitHillelWestConnector.distanceMeters,
  },
  "camera-journey-beit-hillel-west-connector",
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

function connectorGeometryAfter(fix, traveledMeters) {
  const remaining = connectorRoute.geometry.filter(
    (point) => Number(point.distanceFromStartMeters) > traveledMeters,
  );
  return [
    { lat: Number(fix.lat), lng: Number(fix.lng) },
    ...remaining.map((point) => ({ lat: point.lat, lng: point.lng })),
    { lat: routeStart.lat, lng: routeStart.lng },
  ];
}

const guidedTrack = combinedApproachRide(21);
const guidedFixes = guidedTrack.fixes;
// The route tracker acquires the main route three seconds before the final
// sampled connector point; this timestamp is asserted by the headless journey
// timeline and used as CAM's seam bookmark.
const approachJoinTimestamp = guidedTrack.connectorFixes.at(-1).timestamp - 3000;

const guidedJourney = {
  name: "journey-guided-approach",
  description: "Guided approach, connector seam, main maneuver, and local arrival",
  group: "camera-journey",
  camera: true,
  journeySchemaVersion: 1,
  route: { routeState: sovevBeitHillel },
  track: { fixes: guidedFixes },
  connectorResponses: [
    connectorResponse({
      id: "guided-initial",
      from: guidedFixes[0],
      to: routeStart,
      purpose: "initial",
      attempt: 1,
      geometry: beitHillelWestConnector.geometry,
      distanceMeters: beitHillelWestConnector.distanceMeters,
      edgeCosts: beitHillelWestConnector.edgeCosts,
    }),
  ],
  bookmarks: [
    {
      id: "guided-follow",
      label: "Guided approach follow",
      targetTimestamp: 30000,
      preRollMs: 5000,
      holdMs: 2500,
      expectedStage: "approach-guide",
    },
    {
      id: "connector-seam",
      label: "Connector → main-route seam",
      targetTimestamp: approachJoinTimestamp,
      preRollMs: 5000,
      holdMs: 3000,
      expectedStage: "join-route",
    },
    {
      id: "main-maneuver",
      label: "Main-route maneuver",
      targetTimestamp: 116000,
      preRollMs: 6000,
      holdMs: 2500,
      expectedStage: "pre-turn",
    },
    {
      id: "local-arrival",
      label: "Local arrival",
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

const showLegTrack = combinedApproachRide(22);
const showLegFixes = showLegTrack.fixes;
const showLegRefreshIndices = [0, 27, 53, 80];
const showLegResponses = showLegRefreshIndices.map((index, responseIndex) =>
  connectorResponse({
    id: `show-leg-${responseIndex + 1}`,
    from: showLegFixes[index],
    to: routeStart,
    purpose: responseIndex === 0 ? "initial" : "refresh",
    attempt: responseIndex + 1,
    routeClass: "path_track",
    geometry: connectorGeometryAfter(showLegFixes[index], index * 8),
    distanceMeters: Math.max(1, connectorRoute.distanceMeters - index * 8),
  }));

const showLegJourney = {
  name: "journey-show-leg",
  description: "Visual-only connector with real movement and main-route acquisition",
  group: "camera-journey",
  camera: true,
  journeySchemaVersion: 1,
  route: { routeState: sovevBeitHillel },
  track: { fixes: showLegFixes },
  connectorResponses: showLegResponses,
  bookmarks: [
    {
      id: "show-leg-moving",
      label: "Moving through the visual connector",
      targetTimestamp: 50000,
      preRollMs: 5000,
      holdMs: 3000,
      expectedStage: "approach-show-leg",
    },
    {
      id: "show-leg-join",
      label: "Visual connector acquisition",
      targetTimestamp: approachJoinTimestamp,
      preRollMs: 5000,
      holdMs: 3000,
      expectedStage: "join-route",
    },
  ],
  expect: [
    { type: "camera-sequence", values: ["approach-show-leg", "join-route", "ride"] },
    { type: "camera-mode", value: "overview", duringStages: ["approach-show-leg"] },
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
  cameraStart: "ride-intro",
  journeySchemaVersion: 1,
  route: { routeState: baniasGanHatsafon },
  track: { fixes: tooFarFixes },
  connectorResponses: [],
  bookmarks: [
    {
      id: "regional-too-far",
      label: "Regional too-far overview",
      targetTimestamp: tooFarFixes.at(-1).timestamp,
      preRollMs: Math.min(30000, tooFarFixes.at(-1).timestamp),
      holdMs: 3000,
      expectedStage: "approach-too-far",
    },
  ],
  expect: [
    { type: "camera-stage", value: "approach-too-far" },
    { type: "camera-pitch", stage: "approach-too-far", value: 40 },
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
  [33.20506889706315, 35.59984869171798, 33.20492811539058, 35.59939289026887, 4135.9998960700395],
  [33.205538021311995, 35.599772165174414, 33.20540273086675, 35.599192423044414, 4191.999955350428],
  [33.20602364926871, 35.5998696340876, 33.20611175925182, 35.59924035185036, 4272.000117104417],
  [33.20652199695405, 35.59990335221963, 33.2066077951563, 35.59934432432273, 4328.000309975507],
  [33.20703838399148, 35.59987491505981, 33.20710315051305, 35.599452921458635, 4384.000274075486],
  [33.207487444098774, 35.59980855949578, 33.20752774036414, 35.5995460046183, 4432.000191900854],
  [33.207940141633394, 35.599718501168574, 33.20795232981526, 35.59963908769027, 4480.000064509082],
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
  description: "Main ride, maneuver, off-route overview, reacquisition, and local arrival",
  group: "camera-journey",
  camera: true,
  journeySchemaVersion: 1,
  route: { routeState: sovevBeitHillel },
  track: { fixes: recoveryFixes },
  connectorResponses: recoveryResponses,
  bookmarks: [
    {
      id: "off-route-hold",
      label: "Off-route stable overview",
      targetTimestamp: 530000,
      preRollMs: 6000,
      holdMs: 3000,
      expectedStage: "off-route",
    },
    {
      id: "reacquisition",
      label: "Reacquisition into follow",
      targetTimestamp: 561000,
      preRollMs: 7000,
      holdMs: 3000,
      expectedStage: "reacquire-route",
    },
    {
      id: "post-recovery-turn",
      label: "Maneuver after recovery",
      targetTimestamp: 651000,
      preRollMs: 5000,
      holdMs: 2500,
      expectedStage: "pre-turn",
    },
    {
      id: "recovery-arrival",
      label: "Local arrival after recovery",
      targetTimestamp: recoveryFixes.at(-1).timestamp,
      preRollMs: 5000,
      holdMs: 3000,
      expectedStage: "arrived-local",
    },
  ],
  expect: [
    { type: "camera-sequence", values: ["ride", "off-route", "reacquire-route", "pre-turn", "arrived-local"] },
    { type: "camera-rotations", atMost: 0, during: "off-route" },
    { type: "camera-fit-kind", value: "route", never: true },
    { type: "arrived" },
  ],
};

export default [guidedJourney, showLegJourney, tooFarJourney, recoveryJourney];
