import assert from "node:assert/strict";
import { createMediaClockPlaybackSource } from "../apps/mobile/src/navigation/mediaClockPlaybackSource.js";

let clock = 0;
let nextId = 1;
const queue = new Map();
const schedule = (callback, delay) => { const id = nextId++; queue.set(id, { callback, at: clock + delay }); return id; };
const cancelSchedule = (id) => queue.delete(id);
const advance = (to) => {
  while (true) {
    const due = [...queue.entries()].filter(([, item]) => item.at <= to).sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    queue.delete(due[0]); clock = due[1].at; due[1].callback();
  }
  clock = to;
};
const fixes = Array.from({ length: 21 }, (_, index) => ({ lat: 33, lng: 35 + index / 10000, timestamp: index * 1000 }));
const received = [];
let completedAt = null;
const source = createMediaClockPlaybackSource(fixes, {
  visibleInMs: 5000,
  visibleOutMs: 10_500,
  preRollMs: 2000,
  now: () => clock,
  schedule,
  cancelSchedule,
  onComplete: () => { completedAt = clock; },
});
await source.startWatch({ onFix: (fix, meta) => received.push({ timestamp: fix.timestamp, ...meta }) });
source.arm();
assert.equal(source.getDiagnostics().phase, "armed");
assert.ok(received.every((item) => item.warmup));
source.beginVisiblePlayback();
advance(5000);
assert.equal(source.getDiagnostics().phase, "playing", "capture remains active after the final in-range GPS fix");
advance(5500);
assert.equal(source.getDiagnostics().phase, "hold");
assert.deepEqual(received.filter((item) => !item.warmup).map((item) => item.timestamp), [5000, 6000, 7000, 8000, 9000, 10000]);
assert.equal(source.getDiagnostics().maxLatenessMs, 0);
assert.equal(completedAt, 5500, "capture ends at visibleOutMs rather than at the final GPS fix");

console.log("media clock playback source tests passed");
