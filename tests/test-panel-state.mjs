import assert from "node:assert/strict";
import { resolvePanelState, INITIAL_PANEL_STATE } from "../src/components/frontPanel/panelState.js";

// Default is discover.
assert.equal(INITIAL_PANEL_STATE.state, "discover");

// First point added (0 -> 1) auto-switches discover -> build.
let s = resolvePanelState(INITIAL_PANEL_STATE, { type: "route-points-changed", pointCount: 1 });
assert.equal(s.state, "build");

// Going from 1 -> 2 points does not re-trigger anything (stays build).
s = resolvePanelState(s, { type: "route-points-changed", pointCount: 2 });
assert.equal(s.state, "build");

// Clearing the route (back to 0) keeps build.
s = resolvePanelState(s, { type: "route-points-changed", pointCount: 0 });
assert.equal(s.state, "build");

// Adding the first point again after a clear auto-switches again (e.g. user had toggled to discover).
let d = resolvePanelState({ state: "discover", lastPointCount: 0 }, { type: "toggle", to: "discover" });
d = resolvePanelState(d, { type: "route-points-changed", pointCount: 1 });
assert.equal(d.state, "build");

// Explicit toggle wins.
let t = resolvePanelState({ state: "build", lastPointCount: 3 }, { type: "toggle", to: "discover" });
assert.equal(t.state, "discover");
t = resolvePanelState(t, { type: "toggle", to: "build" });
assert.equal(t.state, "build");

// A route-points-changed that is not a 0->1 transition never overrides a toggle.
let u = resolvePanelState({ state: "discover", lastPointCount: 2 }, { type: "route-points-changed", pointCount: 3 });
assert.equal(u.state, "discover");

console.log("panel-state ok");
