import assert from "node:assert/strict";
import {
  capabilitiesForMode,
  MAP_MODE_PLANNER,
  MAP_MODE_READONLY_ROUTE,
} from "../src/map/mapCapabilities.js";

// The full planner capability set. This is the zero-diff contract: every flag
// that powers planner behavior MUST stay true so `/` is unchanged. If a
// capability is added to the helper, it must be added here too.
const PLANNER_CAPS = {
  mapInit: true,
  baseStyle: true,
  networkLayers: true,
  networkHitTest: true,
  hoverPreview: true,
  routeGeometryLayer: true,
  routePointDragPreview: true,
  routePointLayers: true,
  routeEndpointMarkers: false,
  routePointSelect: true,
  routePointEditing: true,
  routeLineEditing: true,
  routeFit: true,
  focusedMarkerCamera: true,
  dataMarkerLayer: true,
  dataMarkerClick: true,
  videoCursorLayer: true,
  routeClickCallback: true,
  directionPulse: true,
  elevationPulse: true,
  searchHighlight: true,
  viewportPrefetch: true,
};

// planner: every capability on (the zero-diff guarantee).
{
  const caps = capabilitiesForMode(MAP_MODE_PLANNER);
  assert.deepEqual(caps, PLANNER_CAPS, "planner mode matches the zero-diff capability set");
  for (const [name, value] of Object.entries(caps)) {
    assert.equal(value, PLANNER_CAPS[name], `planner caps.${name} mismatch`);
  }
}

// default mode is planner (preserves the main app when `mode` is omitted).
{
  assert.deepEqual(
    capabilitiesForMode(),
    PLANNER_CAPS,
    "omitting mode defaults to the full planner capability set",
  );
}

// unknown modes fall back to planner so callers never silently lose caps.
{
  assert.deepEqual(
    capabilitiesForMode("totally-unknown-mode"),
    PLANNER_CAPS,
    "unknown modes fall back to planner",
  );
}

// readonly-route: only display/video capabilities on; every planner-only
// network/editing/prefetch capability off.
{
  const caps = capabilitiesForMode(MAP_MODE_READONLY_ROUTE);

  const enabled = [
    "mapInit",
    "baseStyle",
    "routeGeometryLayer",
    "routeEndpointMarkers",
    "routeFit",
    "focusedMarkerCamera",
    "dataMarkerLayer",
    "dataMarkerClick",
    "videoCursorLayer",
    "routeClickCallback",
  ];
  for (const name of enabled) {
    assert.equal(caps[name], true, `readonly-route caps.${name} must be true`);
  }

  const disabled = [
    "networkLayers",
    "networkHitTest",
    "hoverPreview",
    "routePointDragPreview",
    "routePointLayers",
    "routePointSelect",
    "routePointEditing",
    "routeLineEditing",
    "directionPulse",
    "elevationPulse",
    "searchHighlight",
    "viewportPrefetch",
  ];
  for (const name of disabled) {
    assert.equal(caps[name], false, `readonly-route caps.${name} must be false`);
  }

  // readonly-route exposes the same key set as planner (no missing/extra flags).
  assert.deepEqual(
    Object.keys(caps).sort(),
    Object.keys(PLANNER_CAPS).sort(),
    "readonly-route and planner expose the same capability keys",
  );
}

// returned objects are independent (mutating one must not affect another).
{
  const a = capabilitiesForMode(MAP_MODE_PLANNER);
  a.networkLayers = false;
  const b = capabilitiesForMode(MAP_MODE_PLANNER);
  assert.equal(b.networkLayers, true, "capability objects are not shared");
}

console.log("test-map-mode.mjs passed");
