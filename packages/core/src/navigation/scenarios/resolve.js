// Shared scenario loader (nav-scenario-harness). Deterministic scenarios carry
// routeState fixtures for headless replay. Visual catalog scenarios instead
// receive a route decoded by the running app, so they reflect the installed
// release's current route, geometry, and guidance metadata.
import { navigationRouteFromRouteState } from "../navigationRoute.js";
import { generateTrack } from "../trackGenerator.js";
import { applyGpsGap, insertDwell } from "../trackTools.js";
import { validateResolvedJourney } from "./journeySchema.js";
import { buildRouteAttestation } from "../../routing/routeAttestation.js";

const CONNECTOR_MODES = new Set([
  "straight-line",
  "guide-turn",
  "fail",
  "none",
]);

export function resolveScenario(
  scenario,
  {
    currentNavigationRoute = null,
    catalogNavigationRoute = null,
  } = {},
) {
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
    // A current-route scenario is a playback snapshot, not the live planner
    // route. Give it a distinct id so id-keyed navigation sessions rebind even
    // when only metadata (for example roundabout junctions) changed.
    navigationRoute = {
      ...currentNavigationRoute,
      id: `${currentNavigationRoute.id}:scenario-${name}`,
    };
  } else if (scenario.route?.catalogSlug) {
    if (scenario.visualOnly !== true) {
      throw err("catalog routes are visual-only; deterministic scenarios require routeState");
    }
    if (catalogNavigationRoute?.canNavigate !== true) {
      throw err(`could not load catalog route "${scenario.route.catalogSlug}"`);
    }
    if (
      catalogNavigationRoute.slug &&
      catalogNavigationRoute.slug !== scenario.route.catalogSlug
    ) {
      throw err(
        `loaded catalog route "${catalogNavigationRoute.slug}" instead of "${scenario.route.catalogSlug}"`,
      );
    }
    navigationRoute = {
      ...catalogNavigationRoute,
      id: `${catalogNavigationRoute.id}:scenario-${name}`,
      // Catalog rides enter navigation from the route start through Ride Setup.
      // Preserve that acquisition rule for loops whose start and end overlap.
      requiresStartAcquisition: true,
    };
  } else if (scenario.route?.routeState) {
    navigationRoute = navigationRouteFromRouteState(attestScenarioRouteState(
      scenario.route.routeState,
      name,
    ), {
      param: `scenario-${name}`,
    });
    if (!navigationRoute.canNavigate) {
      throw err(`routeState is not navigable (${navigationRoute.unavailableReason})`);
    }
    // Scenario rides run from the route start, like the effective route the
    // ride-setup flow always produces. Without this, a loop route (start and
    // end on the same vertex) can acquire at the END, so riding forward reads
    // as riding backwards — progress counts down and wrong-way fires.
    navigationRoute = { ...navigationRoute, requiresStartAcquisition: true };
  } else {
    throw err('route must be "current", { catalogSlug }, or { routeState }');
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

  const resolved = {
    name,
    description: scenario.description ?? "",
    visualOnly: scenario.visualOnly === true,
    group: scenario.group || null,
    camera: scenario.camera === true,
    entryMode: scenario.entryMode || "session",
    navigationRoute,
    fixes,
    connector,
    connectorResponses: Array.isArray(scenario.connectorResponses)
      ? scenario.connectorResponses
      : null,
    journeySchemaVersion: scenario.journeySchemaVersion ?? null,
    bookmarks: Array.isArray(scenario.bookmarks) ? scenario.bookmarks : [],
    expect: Array.isArray(scenario.expect) ? scenario.expect : [],
  };
  if (resolved.journeySchemaVersion !== null) validateResolvedJourney(resolved);
  return resolved;
}

function attestScenarioRouteState(routeState, name) {
  if (routeState?.routingValidation) return routeState;
  const geometry = Array.isArray(routeState?.geometry) ? routeState.geometry : [];
  if (geometry.length < 2) return routeState;
  const points = Array.isArray(routeState?.points) && routeState.points.length >= 2
    ? [routeState.points[0], routeState.points.at(-1)]
    : [geometry[0], geometry.at(-1)];
  return {
    ...routeState,
    routingValidation: buildRouteAttestation({
      validationContext: {
        baseRoutingSchemaVersion: 3,
        graphVersion: `scenario-${name}-v3`,
        policyId: "il-bicycle-v1",
        policyDigest: "navigation-scenario-fixture",
        routingContextDigest: `scenario-${name}`,
      },
      traversalSlices: [{
        edgeShareId: 1,
        fromFraction: 0,
        toFraction: 1,
        distanceMeters: Math.max(1, Number(routeState?.distance) || 1000),
        policyState: "allowed",
        policyReason: "navigation-scenario-fixture",
        oppositePolicyState: "allowed",
        oppositePolicyReason: "navigation-scenario-fixture",
        shardIds: ["navigation-scenario-fixture"],
      }],
      waypointOccurrences: points.map((point, index) => ({
        id: point?.id || `scenario-${name}-${index}`,
        lat: Number(point?.lat),
        lng: Number(point?.lng),
        baseEdgeShareId: 1,
        baseEdgeFraction: index,
      })),
      legBoundaries: [{ startTraversal: 0, endTraversal: 1 }],
      geometry,
      derivation: "navigation-scenario-fixture",
    }),
  };
}
