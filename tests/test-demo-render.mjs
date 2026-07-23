import assert from "node:assert/strict";
import {
  auditSensitiveMediaMetadata,
  detectFlashFromRgb,
  buildProofFfmpegArgs,
  proofEditFromProject,
  syncFlashScanFilter,
} from "../scripts/demo-studio/render.mjs";
import { validateProofEdit } from "../scripts/demo-studio/editDecision.mjs";
import { buildVoiceMixArgs, voicePlacementsFromEvents } from "../scripts/demo-studio/voiceRender.mjs";

const rgb = Buffer.from([10, 20, 10, 180, 240, 20, 180, 240, 20, 10, 20, 10]);
assert.deepEqual(detectFlashFromRgb(rgb, { fps: 30 }), { firstFrame: 1, lastFrame: 2, startMs: 1000 / 30, endMs: 3000 / 30 });
assert.equal(syncFlashScanFilter({ fps: 30 }), "fps=30,crop=iw:ih*0.18:0:ih*(1-0.18),scale=1:1:flags=area,format=rgb24");
const edit = validateProofEdit({ schemaVersion: 1, kind: "proof", bundleDigest: "d", captureRunId: "capture-001", source: { inMs: 1000, outMs: 5000 }, layout: { master: "1920x1080", fps: 30, roadFraction: 0.68 }, audio: {}, captions: { burnIn: true } });
const args = buildProofFfmpegArgs({ road: "/tmp/road ride.mp4", app: "/tmp/app.mov", voice: "/tmp/voice.wav", captions: "/tmp/he.srt", output: "/tmp/out.mp4", edit, appStartMs: 100 });
assert.ok(args.includes("/tmp/road ride.mp4"), "paths remain individual argv values");
assert.ok(args.includes("-map_metadata"));
const multiEdit = validateProofEdit({
  schemaVersion: 1,
  kind: "proof",
  bundleDigest: "d",
  captureRunId: "capture-001",
  source: { inMs: 1000, outMs: 9000, segments: [{ inMs: 1000, outMs: 3000 }, { inMs: 7000, outMs: 9000 }] },
  layout: { master: "1920x1080", fps: 30, roadFraction: 0.68 },
  audio: {},
  captions: { burnIn: true },
});
const multiArgs = buildProofFfmpegArgs({ road: "/tmp/road.mp4", app: "/tmp/app.mov", voice: "/tmp/voice.wav", captions: null, output: "/tmp/out.mp4", edit: multiEdit, appStartMs: 100 });
const multiFilters = multiArgs[multiArgs.indexOf("-filter_complex") + 1];
assert.match(multiFilters, /trim=start=6\.100000:duration=2/);
assert.match(multiFilters, /concat=n=2:v=1:a=1/);
assert.match(multiFilters, /fade=t=out/);
assert.equal(multiArgs[multiArgs.indexOf("-t") + 1], "4.000");
const projectEdit = proofEditFromProject({
  inputs: {
    story: {
      proof: { inMs: 1000, outMs: 9000 },
      showcases: [{ inMs: 1500, outMs: 2800 }, { inMs: 7200, outMs: 8500 }],
    },
    proofEdit: {
      layout: { master: "1920x1080", fps: 30, roadFraction: 0.68 },
      audio: {},
      captions: { burnIn: true },
      title: {},
    },
  },
}, {
  capture: { showcases: [{ inMs: 1000, outMs: 3000 }, { inMs: 7000, outMs: 9000 }] },
}, "capture-001");
assert.deepEqual(projectEdit.source.segments, [
  { inMs: 1500, outMs: 2800 },
  { inMs: 7200, outMs: 8500 },
], "render uses post-capture trims instead of the original bundle showcases");
assert.deepEqual(auditSensitiveMediaMetadata({ format: { tags: { major_brand: "isom" } }, streams: [{ codec_type: "video", tags: { encoder: "Lavc" } }] }), { pass: true, findings: [] });
assert.equal(auditSensitiveMediaMetadata({ format: { tags: { location: "+32.1+35.1/" } }, streams: [] }).pass, false);
assert.equal(auditSensitiveMediaMetadata({ streams: [{ codec_type: "data", codec_tag_string: "gpmd" }] }).pass, false);
const placements = voicePlacementsFromEvents([{ sequence: 0, kind: "speech-start", mediaTimeMs: 1200, payload: { utteranceId: "one", text: "hello" } }], { originMs: 1000 });
placements[0].clip = "/tmp/one.wav";
assert.match(buildVoiceMixArgs(placements, "/tmp/voice.wav").join(" "), /adelay=200\|200/);

console.log("demo render tests passed");
