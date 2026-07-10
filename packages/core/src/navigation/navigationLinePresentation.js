export const NAVIGATION_MAIN_ROUTE_PROMINENCE = Object.freeze({
  ACTIVE: "active",
  JOINING: "joining",
  SECONDARY: "secondary",
  CONTEXT: "context",
});

export const NAVIGATION_CONNECTOR_ROLE = Object.freeze({
  NONE: "none",
  DIRECT: "direct",
  GUIDE: "guide",
  JOIN_GUIDE: "join-guide",
  REJOIN: "rejoin",
});

// Selects semantic map-line authority without knowing anything about Mapbox.
// Color, width, casing, and dash styles are resolved by the native adapter.
export function navigationLinePresentationForState(state = {}) {
  const transition = state.cameraTransition || null;
  if (transition?.kind === "join") {
    return {
      mainRouteProminence: NAVIGATION_MAIN_ROUTE_PROMINENCE.JOINING,
      connectorRole: NAVIGATION_CONNECTOR_ROLE.JOIN_GUIDE,
    };
  }

  const status = state.status || "idle";
  if (status === "off-route" || state.offRoute === true) {
    return {
      mainRouteProminence: NAVIGATION_MAIN_ROUTE_PROMINENCE.ACTIVE,
      connectorRole: NAVIGATION_CONNECTOR_ROLE.REJOIN,
    };
  }

  if (status === "approaching") {
    switch (state.approach?.ownershipTier) {
      case "guide":
        return {
          mainRouteProminence: NAVIGATION_MAIN_ROUTE_PROMINENCE.SECONDARY,
          connectorRole: NAVIGATION_CONNECTOR_ROLE.GUIDE,
        };
      default:
        return {
          mainRouteProminence: NAVIGATION_MAIN_ROUTE_PROMINENCE.CONTEXT,
          connectorRole: NAVIGATION_CONNECTOR_ROLE.DIRECT,
        };
    }
  }

  return {
    mainRouteProminence: NAVIGATION_MAIN_ROUTE_PROMINENCE.ACTIVE,
    connectorRole: NAVIGATION_CONNECTOR_ROLE.NONE,
  };
}
