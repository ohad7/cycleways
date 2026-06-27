import assert from "node:assert/strict";
import { createRoutePlaybackEngine } from "@cycleways/core/ui/routePlaybackEngine.js";

// Minimal fake sync: 10s duration, linear cursor along a 2-point route.
const sync = {
  durationSeconds: 10,
  timeToPosition: (t) => ({ lat: t / 10, lng: 0, fraction: t / 10 }),
  positionToTime: (f) => f * 10,
};

// Controllable fake clock.
let nowMs = 0;
let queued = null;
const clock = {
  now: () => nowMs,
  requestFrame: (cb) => { queued = cb; return 1; },
  cancelFrame: () => { queued = null; },
};
function advance(ms) {
  nowMs += ms;
  const cb = queued;
  queued = null;
  if (cb) cb(nowMs);
}

const cursors = [];
const engine = createRoutePlaybackEngine({
  sync,
  fallbackDuration: 10,
  clock,
  onCursorChange: (c) => cursors.push(c),
});

assert.equal(engine.getState().duration, 10);
assert.equal(engine.getState().isPlaying, false);

// Seek to a fraction → cursor emitted at the right place.
engine.seekToFraction(0.5);
assert.equal(Math.round(engine.getState().currentTime), 5);
assert.equal(engine.getState().cursor.fraction, 0.5);

// Play advances the cursor over time.
engine.seekToTime(0);
engine.play();
assert.equal(engine.getState().isPlaying, true);
advance(2000); // 2s
assert.ok(engine.getState().currentTime >= 2 - 0.001);

// Reaching the end stops playback.
advance(20000);
assert.equal(engine.getState().isPlaying, false);
assert.equal(Math.round(engine.getState().currentTime), 10);

engine.dispose();
console.log("test-route-playback-engine: OK");
