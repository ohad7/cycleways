// Scenario registry (nav-scenario-harness). Every entry runs headlessly in
// tests/test-nav-scenarios.mjs (visualOnly entries are skipped there) and
// appears in the dev scenario picker on the Build screen. Adding a scenario =
// one module + one line here.
import approachFromDistance from "./approach-from-distance.js";
import cameraJourneys from "./camera-journeys.js";
import compoundTurnLeftRight from "./compound-turn-left-right.js";
import currentRouteGeneric from "./current-route-generic.js";
import gpsGap from "./gps-gap.js";
import missedTurnReroute from "./missed-turn-reroute.js";
import missedTurnRejoinLater from "./missed-turn-rejoin-later.js";
import offRouteExcursion from "./off-route-excursion.js";
import onRouteHappyPath from "./on-route-happy-path.js";
import parallelPath from "./parallel-path.js";
import recordedRealRide from "./recorded-real-ride.js";
import rerouteFailure from "./reroute-failure.js";
import stopAndStand from "./stop-and-stand.js";
import sovevBeitHillelRide from "./sovev-beit-hillel-ride.js";
import wrongWay from "./wrong-way.js";

export const scenarios = [
  onRouteHappyPath,
  compoundTurnLeftRight,
  approachFromDistance,
  offRouteExcursion,
  missedTurnReroute,
  missedTurnRejoinLater,
  rerouteFailure,
  gpsGap,
  stopAndStand,
  parallelPath,
  recordedRealRide,
  sovevBeitHillelRide,
  wrongWay,
  currentRouteGeneric,
  ...cameraJourneys,
];

export function getScenario(name) {
  return scenarios.find((scenario) => scenario.name === name) ?? null;
}
