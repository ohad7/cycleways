import assert from "node:assert/strict";
import { auditSensitiveMediaMetadata, detectFlashFromRgb, buildProofFfmpegArgs } from "../scripts/demo-studio/render.mjs";
import { validateProofEdit } from "../scripts/demo-studio/editDecision.mjs";
import { buildVoiceMixArgs, voicePlacementsFromEvents } from "../scripts/demo-studio/voiceRender.mjs";

const rgb = Buffer.from([10, 20, 10, 180, 240, 20, 180, 240, 20, 10, 20, 10]);
assert.deepEqual(detectFlashFromRgb(rgb, { fps: 30 }), { firstFrame: 1, lastFrame: 2, startMs: 1000 / 30, endMs: 3000 / 30 });
const edit = validateProofEdit({ schemaVersion: 1, kind: "proof", bundleDigest: "d", captureRunId: "capture-001", source: { inMs: 1000, outMs: 5000 }, layout: { master: "1920x1080", fps: 30, roadFraction: 0.68 }, audio: {}, captions: { burnIn: true } });
const args = buildProofFfmpegArgs({ road: "/tmp/road ride.mp4", app: "/tmp/app.mov", voice: "/tmp/voice.wav", captions: "/tmp/he.srt", output: "/tmp/out.mp4", edit, appStartMs: 100 });
assert.ok(args.includes("/tmp/road ride.mp4"), "paths remain individual argv values");
assert.ok(args.includes("-map_metadata"));
assert.deepEqual(auditSensitiveMediaMetadata({ format: { tags: { major_brand: "isom" } }, streams: [{ codec_type: "video", tags: { encoder: "Lavc" } }] }), { pass: true, findings: [] });
assert.equal(auditSensitiveMediaMetadata({ format: { tags: { location: "+32.1+35.1/" } }, streams: [] }).pass, false);
assert.equal(auditSensitiveMediaMetadata({ streams: [{ codec_type: "data", codec_tag_string: "gpmd" }] }).pass, false);
const placements = voicePlacementsFromEvents([{ sequence: 0, kind: "speech-start", mediaTimeMs: 1200, payload: { utteranceId: "one", text: "hello" } }], { originMs: 1000 });
placements[0].clip = "/tmp/one.wav";
assert.match(buildVoiceMixArgs(placements, "/tmp/voice.wav").join(" "), /adelay=200\|200/);

console.log("demo render tests passed");
