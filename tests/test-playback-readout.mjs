import assert from "node:assert/strict";
import { formatPlaybackTime } from "@cycleways/core/ui/playbackReadout.js";

assert.equal(formatPlaybackTime(0), "0:00");
assert.equal(formatPlaybackTime(9), "0:09");
assert.equal(formatPlaybackTime(95), "1:35");
assert.equal(formatPlaybackTime(600), "10:00");
assert.equal(formatPlaybackTime(-5), "0:00");
assert.equal(formatPlaybackTime(NaN), "0:00");
assert.equal(formatPlaybackTime(undefined), "0:00");
console.log("test-playback-readout: OK");
