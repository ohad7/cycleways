import assert from "node:assert/strict";
import { createHeadlessCameraFrameSampler } from "@cycleways/core/navigation/cameraTimeline.js";

const sampler = createHeadlessCameraFrameSampler();
assert.deepEqual(
  sampler.update({ stage: "ride", pitch: 55, transition: { durationMs: 0 } }, 90, 0),
  { stage: "ride", pitch: 55, heading: 90, transitionState: "settled" },
);
const entering = sampler.update(
  { stage: "pre-turn", pitch: 35, transition: { durationMs: 1000 } },
  120,
  100,
);
assert.equal(entering.transitionState, "running");
assert.ok(entering.pitch < 55 && entering.pitch > 35);
const settled = sampler.update(
  { stage: "pre-turn", pitch: 35, transition: { durationMs: 1000 } },
  120,
  1200,
);
assert.equal(settled.transitionState, "settled");
assert.equal(settled.pitch, 35);

console.log("camera timeline tests passed");
