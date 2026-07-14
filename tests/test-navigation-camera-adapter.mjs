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

// C1 regression: the first cue mounts a taller top card at the same moment the
// camera changes ride -> pre-turn. The follow owner must retain the old rider
// anchor on that frame and ease only the padding toward the new layout.
{
  let nowMs = 1_000;
  const cameraStops = [];
  const timers = [];
  const adapter = createNavigationCameraAdapter({
    now: () => nowMs,
    followPaddingDurationMs: 500,
    getCamera: () => ({ setCamera: (stop) => cameraStops.push(stop) }),
    getMap: () => ({ getPointInView: async () => [190, 570] }),
    schedule: (callback, ms) => {
      const timer = { callback, ms };
      timers.push(timer);
      return timer;
    },
  });
  const statusViewport = normalizeCameraViewport({
    width: 390,
    height: 844,
    safeInsets: { top: 47, bottom: 34 },
    topOverlayBottom: 47,
    bottomOverlayTop: 748,
    clearance: 12,
  });
  const cueViewport = normalizeCameraViewport({
    width: 390,
    height: 844,
    safeInsets: { top: 47, bottom: 34 },
    topOverlayBottom: 188,
    bottomOverlayTop: 748,
    clearance: 12,
  });
  const frame = {
    center: { lat: 33.1, lng: 35.6 },
    pitch: 55,
    zoom: 16.4,
    heading: 90,
    riderAnchorY: 0.72,
  };

  adapter.applyFollow({ ...frame, key: "ride" }, statusViewport);
  const before = cameraStops.at(-1).padding;
  const target = cameraPaddingForRiderAnchor(cueViewport, frame.riderAnchorY);
  assert.notDeepEqual(target, before, "the cue card materially changes target padding");

  nowMs += 16;
  const cueFrame = {
    ...frame,
    key: "pre-turn",
    requiredPoints: [{ id: "rider", lat: 33.1, lng: 35.6 }],
    riderId: "rider",
    validationKey: "first-cue-layout",
  };
  adapter.applyFollow(cueFrame, cueViewport);
  assert.deepEqual(
    cameraStops.at(-1).padding,
    before,
    "the first cue frame does not jump to the new padding",
  );
  assert.equal(timers.length, 0, "placement validation waits for padding");

  nowMs += 250;
  adapter.applyFollow(cueFrame, cueViewport);
  const halfway = cameraStops.at(-1).padding;
  assert.ok(halfway.paddingTop > before.paddingTop);
  assert.ok(halfway.paddingTop < target.paddingTop);
  assert.equal(timers.length, 0);

  nowMs += 250;
  adapter.applyFollow(cueFrame, cueViewport);
  assert.deepEqual(cameraStops.at(-1).padding, target, "padding settles at the cue layout");
  assert.equal(adapter.getState().paddingTransitionState, "settled");
  assert.equal(timers.length, 1, "settled placement is validated once");

  const tallerViewport = normalizeCameraViewport({
    width: 390,
    height: 844,
    safeInsets: { top: 47, bottom: 34 },
    topOverlayBottom: 220,
    bottomOverlayTop: 748,
    clearance: 12,
  });
  nowMs += 20;
  adapter.applyFollow({ ...frame, key: "pre-turn" }, tallerViewport);
  assert.deepEqual(
    cameraStops.at(-1).padding,
    target,
    "a changed target restarts from the currently displayed padding",
  );
}

// Lock-screen guard (TestFlight build 5 watchdog kill): while the app is not
// active, the adapter must not touch the native map — no setCamera, no
// getPointInView — or rnmapbox camera promises deadlock the main thread on a
// backgrounded UI and iOS kills the app (0x8BADF00D). Skipped applies return
// false so callers can retry once the app is interactive again.
{
  let interactive = false;
  const cameraStops = [];
  const projections = [];
  const timers = [];
  const adapter = createNavigationCameraAdapter({
    isInteractive: () => interactive,
    getCamera: () => ({ setCamera: (stop) => cameraStops.push(stop) }),
    getMap: () => ({
      getPointInView: async ([lng, lat]) => {
        projections.push([lng, lat]);
        return [190, 570];
      },
    }),
    schedule: (callback, ms) => {
      const timer = { callback, ms, cancelled: false };
      timers.push(timer);
      return timer;
    },
    cancelSchedule: (timer) => {
      timer.cancelled = true;
    },
  });

  const followFrame = {
    key: "ride",
    center: { lat: 33.1, lng: 35.6 },
    pitch: 55,
    zoom: 16.4,
    heading: 90,
    riderAnchorY: 0.72,
    requiredPoints: [{ id: "rider", lat: 33.1, lng: 35.6 }],
    riderId: "rider",
    validationKey: "v1",
  };
  assert.equal(adapter.applyFollow(followFrame, viewport), false, "follow skipped while inactive");
  assert.equal(adapter.applyOverview({
    key: "overview:a",
    points: [{ lat: 33.1, lng: 35.6 }, { lat: 33.2, lng: 35.7 }],
  }, viewport), false, "overview skipped while inactive");
  assert.equal(cameraStops.length, 0, "no native camera calls while inactive");
  assert.equal(timers.length, 0, "no validation scheduled while inactive");

  interactive = true;
  assert.equal(adapter.applyFollow(followFrame, viewport), true, "follow resumes when active");
  assert.equal(cameraStops.length, 1);
  assert.equal(timers.length, 1, "validation scheduled while active");

  // Lock the screen between the schedule and the validation pass: the pending
  // getPointInView loop must not run against the backgrounded map.
  interactive = false;
  timers[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(projections.length, 0, "no projection while inactive");
}

console.log("navigation camera adapter tests passed");
