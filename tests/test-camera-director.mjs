// tests/test-camera-director.mjs — stage-aware navigation camera shots.
import assert from "node:assert/strict";
import {
  createCameraDirector,
  zoomForSpanMeters,
} from "@cycleways/core/navigation/cameraDirector.js";

const riding = (over = {}) => ({
  status: "navigating",
  offRoute: false,
  activeCue: null,
  approach: null,
  progress: {
    hasAcquiredRoute: true,
    remainingMeters: 5000,
    smoothedSpeedMps: 5,
    guidanceDistanceMeters: null,
  },
  ...over,
});

// zoomForSpanMeters: monotone, clamped.
{
  assert.ok(Math.abs(zoomForSpanMeters(100) - 17.5) < 0.01);
  assert.ok(Math.abs(zoomForSpanMeters(400) - 15.5) < 0.01);
  assert.ok(Math.abs(zoomForSpanMeters(1600) - 13.5) < 0.01);
  assert.equal(zoomForSpanMeters(1e9), 12, "clamped low");
  assert.equal(zoomForSpanMeters(10), 17.5, "clamped high (span floor 50)");
}

// Ride: pitch 55 with a speed-derived corridor and centralized zoom clamps.
{
  const director = createCameraDirector();
  const slow = director.update(
    riding({ progress: { ...riding().progress, smoothedSpeedMps: 2 } }),
    0,
  );
  assert.equal(slow.stage, "ride");
  assert.equal(slow.pitch, 55);
  assert.equal(slow.viewportMode, "follow");
  assert.equal(slow.zoomPolicy.kind, "corridor-fit");
  assert.equal(slow.lookaheadMeters, 160);
  const fast = director.update(
    riding({ progress: { ...riding().progress, smoothedSpeedMps: 8 } }),
    100,
  );
  assert.equal(fast.lookaheadMeters, 340, "faster rider sees farther ahead");
}

// Approach and off-route shots.
{
  const director = createCameraDirector();
  const approach = director.update(
    riding({
      status: "approaching",
      approach: { distanceToRouteMeters: 400 },
      progress: { hasAcquiredRoute: false, remainingMeters: 5000, smoothedSpeedMps: 5 },
    }),
    0,
  );
  assert.equal(approach.stage, "approach-resolving");
  assert.equal(approach.viewportMode, "overview");
  assert.equal(approach.pitch, 55);
  assert.equal(approach.fitKind, "approach-start");

  const off = director.update(
    riding({
      status: "off-route",
      offRoute: true,
      progress: { ...riding().progress, guidanceDistanceMeters: 150 },
    }),
    100, // within the dwell window — off-route must still win immediately
  );
  assert.equal(off.stage, "off-route", "off-route adopts immediately");
  assert.equal(off.viewportMode, "overview");
  assert.equal(off.fitKind, "rejoin");
}

// Approach ownership stages: too-far and show-leg are stable overviews; guide
// follows the approach corridor; a nearby connector cue lowers pitch.
{
  const director = createCameraDirector();
  const tooFar = director.update(
    riding({
      status: "approaching",
      progress: { hasAcquiredRoute: false, remainingMeters: 5000, smoothedSpeedMps: 4 },
      approach: { ownershipTier: "too-far" },
    }),
    0,
  );
  assert.equal(tooFar.stage, "approach-too-far");
  assert.equal(tooFar.viewportMode, "overview");
  assert.equal(tooFar.pitch, 40);
  assert.equal(tooFar.zoomPolicy.kind, "points-fit");

  const showLeg = director.update(
    riding({
      status: "approaching",
      progress: { hasAcquiredRoute: false, remainingMeters: 5000, smoothedSpeedMps: 4 },
      approach: { ownershipTier: "show-leg" },
    }),
    100,
  );
  assert.equal(showLeg.stage, "approach-show-leg");
  assert.equal(showLeg.viewportMode, "overview");
  assert.equal(showLeg.pitch, 35);
  assert.equal(showLeg.fitKind, "approach-leg");

  const guide = director.update(
    riding({
      status: "approaching",
      progress: { hasAcquiredRoute: false, remainingMeters: 5000, smoothedSpeedMps: 2 },
      approach: {
        ownershipTier: "guide",
        approachProgress: { smoothedSpeedMps: 8 },
      },
    }),
    200,
  );
  assert.equal(guide.stage, "approach-guide");
  assert.equal(guide.viewportMode, "follow");
  assert.equal(guide.pitch, 55);
  assert.equal(guide.lookaheadMeters, 340);

  const preTurn = director.update(
    riding({
      status: "approaching",
      progress: { hasAcquiredRoute: false, remainingMeters: 5000, smoothedSpeedMps: 4 },
      approach: {
        ownershipTier: "guide",
        approachProgress: { smoothedSpeedMps: 4 },
        approachActiveCue: { cue: { type: "turn" }, distanceToCueMeters: 70 },
      },
    }),
    300,
  );
  assert.equal(preTurn.stage, "approach-guide-pre-turn");
  assert.equal(preTurn.viewportMode, "follow");
  assert.equal(preTurn.pitch, 38);
  assert.deepEqual(preTurn.pitchRange, { min: 35, max: 40 });
  assert.equal(preTurn.focusKind, "approach-cue");
}

// Resolving a connector refresh retains the accepted frame instead of
// bouncing to a generic low-pitch approach fit.
{
  const director = createCameraDirector();
  const accepted = director.update(
    riding({
      status: "approaching",
      progress: { hasAcquiredRoute: false, remainingMeters: 5000 },
      approach: { ownershipTier: "show-leg" },
    }),
    0,
  );
  const resolving = director.update(
    riding({
      status: "approaching",
      progress: { hasAcquiredRoute: false, remainingMeters: 5000 },
      approach: { ownershipTier: "unknown", suggestionStatus: "requesting" },
    }),
    100,
  );
  assert.equal(accepted.pitch, 35);
  assert.equal(resolving.stage, "approach-resolving");
  assert.equal(resolving.retainedStage, "approach-show-leg");
  assert.equal(resolving.pitch, 35);
  assert.equal(resolving.holdFrame, true);
}

// Join-route is an immediate one-frame transition shot.
{
  const director = createCameraDirector();
  director.update(
    riding({
      status: "approaching",
      progress: { hasAcquiredRoute: false, remainingMeters: 5000, smoothedSpeedMps: 4 },
      approach: { ownershipTier: "guide" },
    }),
    0,
  );
  const join = director.update(
    riding({ cueEvent: { kind: "acquired", acquisition: "join-route" } }),
    50,
  );
  assert.equal(join.stage, "join-route");
  assert.equal(join.viewportMode, "follow");
  assert.equal(join.pitch, 42);
}

// A retained seam snapshot owns the camera for its bounded duration, then
// returns directly to ride without an extra stage dwell.
{
  const director = createCameraDirector();
  const state = riding({
    cameraTransition: { id: "join-1", kind: "join", durationMs: 1200 },
  });
  assert.equal(director.update(state, 100).stage, "join-route");
  assert.equal(director.update(state, 1000).stage, "join-route");
  assert.equal(director.update(state, 1400).stage, "ride");
}

// Pre-turn waits for the candidate dwell; a turn cue seen only briefly does not switch.
{
  const director = createCameraDirector();
  director.update(riding(), 0);
  const early = director.update(
    riding({ activeCue: { cue: { type: "turn" }, distanceToCueMeters: 110 } }),
    1000,
  );
  assert.equal(early.stage, "ride", "pre-turn waits out the 2 s dwell");
  const gone = director.update(riding(), 1500);
  assert.equal(gone.stage, "ride", "transient cue does not leave a stale candidate");
  const candidateAgain = director.update(
    riding({ activeCue: { cue: { type: "turn" }, distanceToCueMeters: 95 } }),
    1700,
  );
  assert.equal(candidateAgain.stage, "ride", "candidate dwell restarts after disappearing");
  const adopted = director.update(
    riding({ activeCue: { cue: { type: "turn" }, distanceToCueMeters: 90 } }),
    3800,
  );
  assert.equal(adopted.stage, "pre-turn");
  assert.equal(adopted.viewportMode, "follow");
  assert.equal(adopted.pitch, 38);
  assert.equal(adopted.zoomPolicy.minZoom, 16.2);
  assert.equal(adopted.focusKind, "cue");

  const bend = createCameraDirector();
  bend.update(riding(), 0);
  bend.update(riding({ activeCue: { cue: { type: "bend" }, distanceToCueMeters: 80 } }), 100);
  const bendShot = bend.update(
    riding({ activeCue: { cue: { type: "bend" }, distanceToCueMeters: 80 } }),
    2200,
  );
  assert.equal(bendShot.stage, "pre-turn");
}

// Arrival waits for dwell; completion uses a local frame and is immediate.
{
  const director = createCameraDirector();
  director.update(riding(), 0);
  const early = director.update(
    riding({
      activeCue: { cue: { type: "arrive" }, distanceToCueMeters: 120 },
      progress: { ...riding().progress, remainingMeters: 120 },
    }),
    1000,
  );
  assert.equal(early.stage, "ride", "arrival waits out the 2 s dwell");
  const arrival = director.update(
    riding({
      activeCue: { cue: { type: "arrive" }, distanceToCueMeters: 110 },
      progress: { ...riding().progress, remainingMeters: 110 },
    }),
    3100,
  );
  assert.equal(arrival.stage, "arrival");
  const done = director.update(
    riding({ progress: { ...riding().progress, remainingMeters: 8 } }),
    3200, // inside the dwell — arrived is immediate anyway
  );
  assert.equal(done.stage, "arrived-local");
  assert.equal(done.viewportMode, "overview");
  assert.equal(done.pitch, 0);
  assert.equal(done.fitKind, "arrival-local");
  assert.notEqual(done.fitKind, "route");
}

// Off-route wins over arrived when both conditions are true.
{
  const director = createCameraDirector();
  const shot = director.update(
    riding({
      status: "off-route",
      offRoute: true,
      progress: { ...riding().progress, remainingMeters: 8 },
    }),
    0,
  );
  assert.equal(shot.stage, "off-route");
  assert.equal(shot.fitKind, "rejoin");
}

// reset() forgets the stage.
{
  const director = createCameraDirector();
  director.update(riding({ status: "off-route", offRoute: true }), 0);
  director.reset();
  assert.equal(director.update(riding(), 10).stage, "ride");
}

console.log("camera director tests passed");
