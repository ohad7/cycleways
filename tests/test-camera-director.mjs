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

// Ride: pitch 50, speed-breathing zoom.
{
  const director = createCameraDirector();
  const slow = director.update(
    riding({ progress: { ...riding().progress, smoothedSpeedMps: 2 } }),
    0,
  );
  assert.equal(slow.stage, "ride");
  assert.equal(slow.pitch, 50);
  assert.ok(Math.abs(slow.zoom - 16.8) < 0.01, "slow = zoomed in");
  const fast = director.update(
    riding({ progress: { ...riding().progress, smoothedSpeedMps: 8 } }),
    100,
  );
  assert.ok(Math.abs(fast.zoom - 15.8) < 0.01, "fast = zoomed out");
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
  assert.equal(approach.stage, "approach");
  assert.equal(approach.mode, "fit");
  assert.equal(approach.pitch, 20);
  assert.equal(approach.fitKind, "approach");

  const off = director.update(
    riding({
      status: "off-route",
      offRoute: true,
      progress: { ...riding().progress, guidanceDistanceMeters: 150 },
    }),
    100, // within the dwell window — off-route must still win immediately
  );
  assert.equal(off.stage, "off-route", "off-route adopts immediately");
  assert.equal(off.mode, "fit");
  assert.equal(off.fitKind, "rejoin");
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
  assert.equal(adopted.mode, "follow");
  assert.equal(adopted.pitch, 35);
  assert.equal(adopted.zoom, 17.2);
  assert.equal(adopted.centerBias, 0.5);
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

// Arrival waits for dwell; arrived fits the route and is immediate.
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
  assert.equal(done.stage, "arrived");
  assert.equal(done.mode, "fit");
  assert.equal(done.pitch, 0);
  assert.equal(done.fitKind, "route");
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
