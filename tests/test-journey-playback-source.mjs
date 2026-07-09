import assert from "node:assert/strict";
import { createJourneyPlaybackSource } from "../apps/mobile/src/navigation/journeyPlaybackSource.js";

const fixes = [0, 1000, 2000, 3000].map((timestamp, index) => ({
  lat: 33.1,
  lng: 35.6 + index * 0.00001,
  timestamp,
}));
const scheduled = [];
const emitted = [];
const source = createJourneyPlaybackSource(fixes, {
  warmupEndIndex: 0,
  startIndex: 1,
  endIndex: 3,
  speed: 1,
  schedule: (callback, delay) => {
    const item = { callback, delay, cancelled: false };
    scheduled.push(item);
    return item;
  },
  cancelSchedule: (item) => { item.cancelled = true; },
});
assert.equal(source.getState().running, false);
assert.equal(scheduled.length, 0, "selecting a journey does not begin continuous playback");
await source.startWatch({ onFix: (fix) => emitted.push(fix.timestamp) });
assert.deepEqual(emitted, [], "playback is scheduled so native effects can settle");
scheduled.shift().callback();
assert.deepEqual(emitted, [0], "warmup rebuilds state before visible playback");
scheduled.shift().callback();
assert.deepEqual(emitted, [0, 1000]);
source.pause();
assert.equal(source.getState().paused, true);
assert.equal(source.step(), true);
assert.deepEqual(emitted, [0, 1000, 2000]);
source.resume();
const next = scheduled.find((item) => !item.cancelled);
next.callback();
assert.deepEqual(emitted, [0, 1000, 2000, 3000]);
assert.equal(source.getState().completed, true);
source.restart();
assert.equal(source.getState().index, 0);
assert.equal(source.getState().warming, true);

console.log("journey playback source tests passed");
