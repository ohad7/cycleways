// Shared scenario loader (nav-scenario-harness). Both the headless runner
// (tests/test-nav-scenarios.mjs) and the in-app dev picker resolve scenarios
// through this one function, so a scenario that passes CI is byte-identical
// to the ride replayed on the simulator. Fails fast with messages that name
// the scenario and the offending field.
import { navigationRouteFromRouteState } from "../navigationRoute.js";
import { generateTrack } from "../trackGenerator.js";
import { applyGpsGap, insertDwell } from "../trackTools.js";

const CONNECTOR_MODES = new Set(["straight-line", "fail", "none"]);

export function resolveScenario(scenario, { currentNavigationRoute = null } = {}) {
  const name = scenario?.name;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("scenario is missing a name");
  }
  const err = (message) => new Error(`scenario "${name}": ${message}`);

  let navigationRoute;
  if (scenario.route === "current") {
    if (currentNavigationRoute?.canNavigate !== true) {
      throw err("requires a navigable current route");
    }
    navigationRoute = currentNavigationRoute;
  } else if (scenario.route?.routeState) {
    navigationRoute = navigationRouteFromRouteState(scenario.route.routeState, {
      param: `scenario-${name}`,
    });
    if (!navigationRoute.canNavigate) {
      throw err(`routeState is not navigable (${navigationRoute.unavailableReason})`);
    }
  } else {
    throw err('route must be "current" or { routeState }');
  }

  let fixes;
  if (Array.isArray(scenario.track?.fixes)) {
    fixes = scenario.track.fixes;
  } else if (scenario.track?.generate) {
    fixes = generateTrack(navigationRoute, scenario.track.generate);
  } else {
    throw err("track must provide fixes[] or generate{}");
  }
  if (scenario.track?.gap) fixes = applyGpsGap(fixes, scenario.track.gap);
  if (scenario.track?.dwell) fixes = insertDwell(fixes, scenario.track.dwell);
  if (fixes.length < 2) throw err("track resolved to fewer than 2 fixes");

  const connector = scenario.connector ?? "straight-line";
  if (!CONNECTOR_MODES.has(connector)) {
    throw err(`unknown connector mode "${connector}"`);
  }

  return {
    name,
    description: scenario.description ?? "",
    visualOnly: scenario.visualOnly === true,
    navigationRoute,
    fixes,
    connector,
    expect: Array.isArray(scenario.expect) ? scenario.expect : [],
  };
}
