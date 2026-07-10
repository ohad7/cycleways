import assert from "node:assert/strict";
import {
  cameraBoundsForPoints,
  cameraPaddingForRiderAnchor,
  createNavigationCameraAdapter,
  evaluateProjectedPlacement,
  normalizeCameraViewport,
} from "../apps/mobile/src/navigation/navigationCameraAdapter.js";

const viewport = normalizeCameraViewport({
  width: 390,
  height: 844,
  safeInsets: { top: 47, bottom: 34 },
  topOverlayBottom: 128,
  bottomOverlayTop: 748,
  clearance: 12,
});

assert.equal(viewport.top, 140);
assert.equal(viewport.bottom, 736);
assert.deepEqual(cameraBoundsForPoints([
  { lat: 33.1, lng: 35.6 },
  { lat: 33.2, lng: 35.4 },
  { lat: 33.15, lng: 35.8 },
]), { ne: [35.8, 33.2], sw: [35.4, 33.1] });

{
  const padding = cameraPaddingForRiderAnchor(viewport, 0.72);
  const centerY = (padding.paddingTop + (viewport.height - padding.paddingBottom)) / 2;
  const desired = viewport.top + viewport.usableHeight * 0.72;
  assert.ok(Math.abs(centerY - desired) < 0.01, "native padding maps center to rider slot");
  assert.equal(padding.paddingBottom, viewport.height - viewport.bottom);
}

{
  const placement = evaluateProjectedPlacement(
    [
      { id: "rider", x: 190, y: viewport.top + viewport.usableHeight * 0.72 },
      { id: "maneuver", x: 180, y: 250 },
    ],
    viewport,
    { riderId: "rider", anchorY: 0.72 },
  );
  assert.equal(placement.valid, true);
  assert.deepEqual(placement.outside, []);
  const blocked = evaluateProjectedPlacement(
    [{ id: "maneuver", x: 180, y: 760 }],
    viewport,
  );
  assert.equal(blocked.valid, false);
  assert.deepEqual(blocked.outside, ["maneuver"]);
  const unprojectable = evaluateProjectedPlacement(
    [{ id: "target", x: NaN, y: NaN }],
    viewport,
  );
  assert.equal(unprojectable.valid, false);
  assert.deepEqual(unprojectable.outside, ["target"]);
}

{
  const cameraStops = [];
  const timers = [];
  const diagnostics = [];
  const adapter = createNavigationCameraAdapter({
    getCamera: () => ({ setCamera: (stop) => cameraStops.push(stop) }),
    getMap: () => ({
      getPointInView: async ([lng, lat]) => [lng === 35.6 ? 190 : 200, lat === 33.1 ? 570 : 250],
    }),
    schedule: (callback, ms) => {
      const timer = { callback, ms, cancelled: false };
      timers.push(timer);
      return timer;
    },
    cancelSchedule: (timer) => {
      timer.cancelled = true;
    },
    onDiagnostics: (next) => diagnostics.push(next),
  });

  assert.equal(adapter.applyOverview({
    key: "overview:a",
    points: [{ lat: 33.1, lng: 35.6 }, { lat: 33.2, lng: 35.7 }],
    requiredPoints: [
      { id: "rider", lat: 33.1, lng: 35.6 },
      { id: "target", lat: 33.2, lng: 35.7 },
    ],
    riderId: "rider",
    riderAnchorY: 0.72,
    pitch: 35,
    heading: 20,
    animationDuration: 500,
  }, viewport), true);
  assert.equal(adapter.getState().owner, "overview");
  assert.equal(adapter.getState().transitionState, "running");
  assert.equal(adapter.applyOverview({ key: "overview:a" }, viewport), false, "same fit is not restarted");
  assert.equal(timers.length, 1);

  assert.equal(adapter.applyFollow({
    key: "ride",
    center: { lat: 33.1, lng: 35.6 },
    pitch: 55,
    zoom: 16.4,
    heading: 90,
    riderAnchorY: 0.72,
  }, viewport), true);
  assert.equal(timers[0].cancelled, true, "follow interrupts the native overview owner");
  assert.equal(adapter.getState().owner, "follow");
  assert.equal(cameraStops.at(-1).animationDuration, 0);
  assert.equal(cameraStops.at(-1).animationMode, "none");

  adapter.setFree();
  assert.equal(adapter.getState().owner, "free");
  adapter.reset();
  assert.equal(adapter.getState().owner, "idle");
  assert.ok(diagnostics.some((entry) => entry.transitionState === "interrupted"));
}

console.log("navigation camera adapter tests passed");
