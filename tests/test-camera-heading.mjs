// tests/test-camera-heading.mjs — governor for the navigation camera heading.
// The map frame is the rider's spatial anchor: it must not chase every small
// bearing change the way the puck arrow does. Deviations within noise never
// rotate it, moderate deviations rotate it only after persisting for a few
// seconds (so it re-orients at most that often), sharp turns rotate it
// immediately.
import assert from "node:assert/strict";
import { createCameraHeadingGovernor } from "@cycleways/core/navigation/cameraHeading.js";

// Defaults: hold under 15°, adopt 15-45° only after persisting 3 s, snap
// beyond 45°.
{
  const governor = createCameraHeadingGovernor();
  assert.equal(governor.update(90, 0), 90, "adopts the first finite target");

  assert.equal(governor.update(100, 500), 90, "small deviation holds");
  assert.equal(governor.update(104, 60000), 90, "small deviation holds forever");

  assert.equal(governor.update(115, 60500), 90, "moderate deviation not adopted yet");
  assert.equal(
    governor.update(112, 62000),
    90,
    "still holding while the deviation persists below 3 s",
  );
  assert.equal(
    governor.update(115, 63600),
    115,
    "moderate deviation adopted after persisting 3 s",
  );
  assert.equal(
    governor.update(135, 64000),
    115,
    "the next moderate deviation starts a fresh persistence window",
  );

  assert.equal(governor.update(200, 64200), 200, "sharp turn adopted immediately");
}

// A transient wobble that returns to agreement never rotates the map.
{
  const governor = createCameraHeadingGovernor();
  governor.update(90, 0);
  assert.equal(governor.update(120, 1000), 90, "wobble starts, held");
  assert.equal(governor.update(95, 2000), 90, "wobble returned to agreement");
  assert.equal(
    governor.update(120, 10000),
    90,
    "a later deviation starts its own window (the old one was cancelled)",
  );
}

// Wraparound: deltas are computed on the circle.
{
  const governor = createCameraHeadingGovernor();
  governor.update(350, 0);
  assert.equal(governor.update(4, 100), 350, "350 -> 4 is a 14° hold, not 346°");
  assert.equal(governor.update(50, 200), 50, "350 -> 50 is a 60° snap");
}

// Non-finite targets hold the current heading and cancel any pending window.
{
  const governor = createCameraHeadingGovernor();
  assert.equal(governor.update(null, 0), null, "no heading before a finite target");
  governor.update(90, 100);
  assert.equal(governor.update(NaN, 200), 90);
  assert.equal(governor.update(undefined, 60000), 90);
}

// reset() forgets the held heading.
{
  const governor = createCameraHeadingGovernor();
  governor.update(90, 0);
  governor.reset();
  assert.equal(governor.update(10, 100), 10, "first target after reset is adopted");
}

// Custom thresholds.
{
  const governor = createCameraHeadingGovernor({
    persistMs: 1000,
    minDeltaDeg: 5,
    snapDeltaDeg: 20,
  });
  governor.update(0, 0);
  assert.equal(governor.update(4, 10), 0, "under custom minDeltaDeg holds");
  assert.equal(governor.update(10, 1100), 0, "custom persistence window opens");
  assert.equal(governor.update(10, 2200), 10, "custom persistence elapsed");
  assert.equal(governor.update(35, 2300), 35, "over custom snapDeltaDeg snaps");
}

// Invalid thresholds fail fast.
assert.throws(
  () => createCameraHeadingGovernor({ minDeltaDeg: 50, snapDeltaDeg: 45 }),
  /minDeltaDeg must be below snapDeltaDeg/,
);

console.log("camera heading governor tests passed");
