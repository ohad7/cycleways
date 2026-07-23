import assert from "node:assert/strict";
import { captionTextKey, captionsFromCaptureEvents, remapCuesToSegments, writeSrt } from "../scripts/demo-studio/captions.mjs";

const events = [
  { sequence: 0, kind: "speech-start", mediaTimeMs: 3_599_900, payload: { utteranceId: "one", text: "בעוד מאה מטרים", interruptsCurrentSpeech: false } },
  { sequence: 1, kind: "speech-done", mediaTimeMs: 3_601_200, payload: { utteranceId: "one", text: "בעוד מאה מטרים" } },
  { sequence: 2, kind: "speech-start", mediaTimeMs: 3_602_000, payload: { utteranceId: "two", text: "פנה ימינה", interruptsCurrentSpeech: true } },
];
const cues = captionsFromCaptureEvents(events);
assert.equal(cues[0].endRule, "speech-done");
assert.match(writeSrt(cues), /00:59:59,900 --> 01:00:01,200/);
assert.match(writeSrt(cues), /פנה ימינה/);
const translated = captionsFromCaptureEvents(events, { language: "en", translations: { [captionTextKey("בעוד מאה מטרים")]: "In 100 meters", two: "Turn right" } });
assert.equal(translated[0].text, "In 100 meters");
assert.throws(() => captionsFromCaptureEvents(events, { language: "en", translations: {} }), /missing reviewed/);
const remapped = remapCuesToSegments([
  { id: "a", startMs: 1000, endMs: 3000, text: "one" },
  { id: "b", startMs: 11_000, endMs: 13_000, text: "two" },
], [{ inMs: 0, outMs: 5000 }, { inMs: 10_000, outMs: 15_000 }]);
assert.deepEqual(remapped.map(({ startMs, endMs }) => ({ startMs, endMs })), [{ startMs: 1000, endMs: 3000 }, { startMs: 6000, endMs: 8000 }]);

console.log("demo caption tests passed");
