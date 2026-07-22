import assert from "node:assert/strict";
import { createDemoCaptureEventRecorder, summarizeNavigationCaptureState } from "../apps/mobile/src/navigation/demoCaptureEvents.js";
import { parseDemoCaptureLaunch } from "../apps/mobile/src/dev/demoCaptureLaunch.js";

const uploaded = [];
const recorder = createDemoCaptureEventRecorder({ runId: "capture-001", mediaTime: () => 123, monotonicTime: () => 456, upload: async events => uploaded.push(...events), batchSize: 2 });
assert.equal(recorder.record("speech-start", { text: "hidden" }, { warmup: true }), null);
recorder.record("capture-ready");
recorder.record("navigation-state", summarizeNavigationCaptureState({ status: "on-route", offRoute: false, progress: { progressMeters: 10 } }));
await recorder.flush();
assert.deepEqual(uploaded.map(event => event.sequence), [0, 1]);
assert.equal(uploaded[1].payload.progressMeters, 10);

let uploadAttempt = 0;
const retriedSequences = [];
const retrying = createDemoCaptureEventRecorder({
  runId: "capture-002",
  upload: async (events) => {
    uploadAttempt += 1;
    if (uploadAttempt === 1) throw new Error("temporary disconnect");
    retriedSequences.push(...events.map((event) => event.sequence));
  },
  batchSize: 2,
});
retrying.record("capture-ready");
retrying.record("navigation-state");
await new Promise((resolve) => setTimeout(resolve, 0));
retrying.record("capture-hold");
await retrying.flush();
assert.deepEqual(retriedSequences, [0, 1, 2]);

const link = "cycleways://build?demo=http%3A%2F%2F127.0.0.1%3A9000&token=abc&run=capture-001";
assert.equal(parseDemoCaptureLaunch(link, { enabled: false }), null);
assert.equal(parseDemoCaptureLaunch(link, { enabled: true }).runId, "capture-001");
assert.throws(() => parseDemoCaptureLaunch("cycleways://build?demo=https%3A%2F%2Fexample.com&token=x&run=y", { enabled: true }), /local HTTP/);

console.log("demo capture event tests passed");
