import assert from "node:assert/strict";
import {
  NAVIGATION_CONNECTOR_ROLE,
  NAVIGATION_MAIN_ROUTE_PROMINENCE,
  navigationLinePresentationForState,
} from "@cycleways/core/navigation/navigationLinePresentation.js";
import {
  NAVIGATION_LINE_COLORS,
  SETUP_CONNECTOR_PREVIEW_STYLES,
  SETUP_ROUTE_PREVIEW_STYLES,
  navigationConnectorLineStyles,
  navigationMainRouteLineStyle,
} from "../apps/mobile/src/navigation/navigationLineStyles.js";

assert.deepEqual(
  navigationLinePresentationForState({
    status: "approaching",
    approach: { ownershipTier: "guide" },
  }),
  {
    mainRouteProminence: NAVIGATION_MAIN_ROUTE_PROMINENCE.SECONDARY,
    connectorRole: NAVIGATION_CONNECTOR_ROLE.GUIDE,
  },
);
assert.deepEqual(
  navigationLinePresentationForState({
    status: "approaching",
    approach: { ownershipTier: "too-far" },
  }),
  {
    mainRouteProminence: NAVIGATION_MAIN_ROUTE_PROMINENCE.CONTEXT,
    connectorRole: NAVIGATION_CONNECTOR_ROLE.DIRECT,
  },
);
assert.deepEqual(
  navigationLinePresentationForState({
    status: "navigating",
    cameraTransition: { kind: "join", sourceTier: "guide" },
  }),
  {
    mainRouteProminence: NAVIGATION_MAIN_ROUTE_PROMINENCE.JOINING,
    connectorRole: NAVIGATION_CONNECTOR_ROLE.JOIN_GUIDE,
  },
);
assert.deepEqual(
  navigationLinePresentationForState({ status: "off-route", offRoute: true }),
  {
    mainRouteProminence: NAVIGATION_MAIN_ROUTE_PROMINENCE.ACTIVE,
    connectorRole: NAVIGATION_CONNECTOR_ROLE.REJOIN,
  },
);
assert.deepEqual(
  navigationLinePresentationForState({ status: "navigating" }),
  {
    mainRouteProminence: NAVIGATION_MAIN_ROUTE_PROMINENCE.ACTIVE,
    connectorRole: NAVIGATION_CONNECTOR_ROLE.NONE,
  },
);

assert.equal(SETUP_ROUTE_PREVIEW_STYLES.core.lineColor, NAVIGATION_LINE_COLORS.mainRoute);
assert.equal(
  SETUP_CONNECTOR_PREVIEW_STYLES.core.lineColor,
  NAVIGATION_LINE_COLORS.approach,
);
assert.notEqual(NAVIGATION_LINE_COLORS.mainRoute, NAVIGATION_LINE_COLORS.approach);
assert.ok(Array.isArray(SETUP_CONNECTOR_PREVIEW_STYLES.core.lineDasharray));

const guided = navigationConnectorLineStyles(NAVIGATION_CONNECTOR_ROLE.GUIDE);
const rejoin = navigationConnectorLineStyles(NAVIGATION_CONNECTOR_ROLE.REJOIN);
assert.equal(guided.core.lineColor, NAVIGATION_LINE_COLORS.approach);
assert.equal(guided.core.lineDasharray, undefined, "guided connector is solid");
assert.equal(rejoin.core.lineColor, NAVIGATION_LINE_COLORS.rejoin);
assert.notEqual(rejoin.core.lineColor, guided.core.lineColor);

const active = navigationMainRouteLineStyle(NAVIGATION_MAIN_ROUTE_PROMINENCE.ACTIVE);
const secondary = navigationMainRouteLineStyle(NAVIGATION_MAIN_ROUTE_PROMINENCE.SECONDARY);
assert.equal(active.lineColor, secondary.lineColor, "official route hue stays stable");
assert.ok(active.lineWidth > secondary.lineWidth);
assert.ok(active.lineOpacity.at(-1) > secondary.lineOpacity.at(-1));

console.log("navigation line presentation tests passed");
