// Scenario registry (nav-scenario-harness). Every entry runs headlessly in
// tests/test-nav-scenarios.mjs (visualOnly entries are skipped there) and
// appears in the dev scenario picker on the Build screen. Adding a scenario =
// one module + one line here.
import approachFromDistance from "./approach-from-distance.js";
import currentRouteGeneric from "./current-route-generic.js";
import gpsGap from "./gps-gap.js";
import missedTurnReroute from "./missed-turn-reroute.js";
import onRouteHappyPath from "./on-route-happy-path.js";
import recordedRealRide from "./recorded-real-ride.js";
import rerouteFailure from "./reroute-failure.js";
import stopAndStand from "./stop-and-stand.js";
import sovevBeitHillelRide from "./sovev-beit-hillel-ride.js";

export const scenarios = [
  onRouteHappyPath,
  approachFromDistance,
  missedTurnReroute,
  rerouteFailure,
  gpsGap,
  stopAndStand,
  recordedRealRide,
  sovevBeitHillelRide,
  currentRouteGeneric,
];

export function getScenario(name) {
  return scenarios.find((scenario) => scenario.name === name) ?? null;
}
