import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { stableDemoBundleDigest } from "../../packages/core/src/navigation/demoBundle.js";
import { captionsFromCaptureEvents, remapCuesToSegments, writeSrt } from "./captions.mjs";
import { validateProofEdit } from "./editDecision.mjs";
import { probeMedia } from "./mediaProbe.mjs";
import { nextAttemptId } from "./projectState.mjs";
import { writeValidationReport } from "./report.mjs";
import { spawnChecked } from "./process.mjs";
import { renderVoiceStem } from "./voiceRender.mjs";
import { readProject, updateProject, writeJsonAtomic } from "./workspace.mjs";
import { normalizeSourceClips, sourceTimeline, splitGlobalSegmentsAcrossClips } from "./sources.mjs";

const SENSITIVE_METADATA_PATTERN = /(?:gps|location|latitude|longitude|serial|firmware|camera[_ -]?model|device[_ -]?model)/i;

function visitMetadata(value, path, findings) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (SENSITIVE_METADATA_PATTERN.test(key) && child !== null && child !== "") {
      findings.push({ path: nextPath, value: String(child).slice(0, 160) });
    }
    visitMetadata(child, nextPath, findings);
  }
}

export function auditSensitiveMediaMetadata(probe) {
  const findings = [];
  visitMetadata(probe?.format?.tags, "format.tags", findings);
  for (const [index, stream] of (probe?.streams || []).entries()) {
    visitMetadata(stream?.tags, `streams.${index}.tags`, findings);
    if (String(stream?.codec_type || "").toLowerCase() === "data") {
      findings.push({ path: `streams.${index}`, value: `data stream ${stream.codec_tag_string || stream.codec_name || "unknown"}` });
    }
  }
  return { pass: findings.length === 0, findings };
}

export function detectFlashFromRgb(buffer, { fps = 30, redMin = 140, greenMin = 190, blueMax = 120 } = {}) {
  const bytes = Buffer.from(buffer);
  const matches = [];
  for (let offset = 0, frame = 0; offset + 2 < bytes.length; offset += 3, frame += 1) {
    const [red, green, blue] = [bytes[offset], bytes[offset + 1], bytes[offset + 2]];
    if (red >= redMin && green >= greenMin && blue <= blueMax && green > red && green > blue * 1.8) matches.push(frame);
  }
  if (!matches.length) throw new Error("sync flash was not found in the app capture");
  const first = matches[0];
  let last = first;
  for (const frame of matches.slice(1)) {
    if (frame > last + 1) break;
    last = frame;
  }
  return { firstFrame: first, lastFrame: last, startMs: first / fps * 1000, endMs: (last + 1) / fps * 1000 };
}

export function syncFlashScanFilter({ fps = 30, bottomFraction = 0.18 } = {}) {
  const fraction = Math.max(0.1, Math.min(0.5, Number(bottomFraction) || 0.18));
  // RN Mapbox is a native surface above most of the React tree. The capture
  // slate reliably owns the bottom panel, so scan that region instead of
  // averaging the flash together with the much larger map surface.
  return `fps=${fps},crop=iw:ih*${fraction}:0:ih*(1-${fraction}),scale=1:1:flags=area,format=rgb24`;
}

export async function detectSyncFlash(path, { fps = 30, spawnImpl = spawn } = {}) {
  const child = spawnImpl("ffmpeg", ["-v", "error", "-i", path, "-vf", syncFlashScanFilter({ fps }), "-an", "-f", "rawvideo", "pipe:1"], { shell: false, stdio: ["ignore", "pipe", "pipe"] });
  const output = [];
  const errors = [];
  child.stdout.on("data", (chunk) => output.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => errors.push(Buffer.from(chunk)));
  await new Promise((resolveChild, reject) => {
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolveChild() : reject(new Error(`ffmpeg flash scan failed: ${Buffer.concat(errors).toString("utf8")}`)));
  });
  return detectFlashFromRgb(Buffer.concat(output), { fps });
}

function dbVolume(db) {
  return Math.pow(10, Number(db || 0) / 20).toFixed(6);
}

function escapeFilterPath(path) {
  return path.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export function buildProofFfmpegArgs({ road, roads, app, voice, captions, output, edit, appStartMs }) {
  const width = edit.layout.width;
  const height = edit.layout.height;
  const roadWidth = Math.round(width * edit.layout.roadFraction / 2) * 2;
  const appWidth = width - roadWidth;
  const roadInputs = roads?.length
    ? roads
    : [{ id: edit.source.segments?.[0]?.sourceId || "clip-001", path: road }];
  const roadIndex = new Map(roadInputs.map((item, index) => [item.id, index]));
  const segments = edit.source.segments || [{ inMs: edit.source.inMs, outMs: edit.source.outMs }];
  const appInputIndex = roadInputs.length;
  const voiceInputIndex = roadInputs.length + 1;
  const filters = [];
  const outputs = [];
  let totalDuration = 0;
  for (const [index, segment] of segments.entries()) {
    const sourceStart = Number(segment.sourceInMs ?? segment.inMs) / 1000;
    const sourceEnd = Number(segment.sourceOutMs ?? segment.outMs) / 1000;
    const selectedRoadIndex = segment.sourceId ? roadIndex.get(segment.sourceId) : 0;
    if (!Number.isInteger(selectedRoadIndex)) throw new Error(`proof edit references missing source ${segment.sourceId}`);
    const duration = sourceEnd - sourceStart;
    const captureStart = appStartMs / 1000 + (segment.inMs - edit.source.inMs) / 1000;
    const voiceStart = (segment.inMs - edit.source.inMs) / 1000;
    const fadeDuration = Math.min(0.25, duration / 4);
    const videoLabel = `segment-video-${index}`;
    const audioLabel = `segment-audio-${index}`;
    filters.push(
      `[${selectedRoadIndex}:v]trim=start=${sourceStart}:end=${sourceEnd},setpts=PTS-STARTPTS,scale=${roadWidth}:${height}:force_original_aspect_ratio=increase,crop=${roadWidth}:${height}[road-${index}]`,
      `[${appInputIndex}:v]trim=start=${captureStart.toFixed(6)}:duration=${duration},setpts=PTS-STARTPTS,scale=${appWidth}:${height}:force_original_aspect_ratio=decrease,pad=${appWidth}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x07130f[app-${index}]`,
      `[road-${index}][app-${index}]hstack=inputs=2[base-${index}]`,
      segments.length > 1
        ? `[base-${index}]fade=t=in:st=0:d=${fadeDuration.toFixed(3)},fade=t=out:st=${Math.max(0, duration - fadeDuration).toFixed(3)}:d=${fadeDuration.toFixed(3)}[${videoLabel}]`
        : `[base-${index}]null[${videoLabel}]`,
      `[${selectedRoadIndex}:a]atrim=start=${sourceStart}:end=${sourceEnd},asetpts=PTS-STARTPTS,volume=${dbVolume(edit.audio?.ambienceGainDb ?? -14)}[road-a-${index}]`,
      `[${voiceInputIndex}:a]apad,atrim=start=${voiceStart.toFixed(6)}:end=${(voiceStart + duration).toFixed(6)},asetpts=PTS-STARTPTS,volume=${dbVolume(edit.audio?.voiceGainDb ?? 0)}[voice-a-${index}]`,
      `[road-a-${index}][voice-a-${index}]amix=inputs=2:duration=first:normalize=0[mix-a-${index}]`,
      segments.length > 1
        ? `[mix-a-${index}]afade=t=in:st=0:d=${fadeDuration.toFixed(3)},afade=t=out:st=${Math.max(0, duration - fadeDuration).toFixed(3)}:d=${fadeDuration.toFixed(3)}[${audioLabel}]`
        : `[mix-a-${index}]anull[${audioLabel}]`,
    );
    outputs.push(`[${videoLabel}][${audioLabel}]`);
    totalDuration += duration;
  }
  let stitchedVideo = "segment-video-0";
  let stitchedAudio = "segment-audio-0";
  if (segments.length > 1) {
    stitchedVideo = "stitched-video";
    stitchedAudio = "stitched-audio";
    filters.push(`${outputs.join("")}concat=n=${segments.length}:v=1:a=1[${stitchedVideo}][${stitchedAudio}]`);
  }
  filters.push(
    captions && edit.captions?.burnIn !== false
      ? `[${stitchedVideo}]subtitles='${escapeFilterPath(captions)}':force_style='FontSize=22,Outline=2,Shadow=1,Alignment=2,MarginV=42'[video]`
      : `[${stitchedVideo}]null[video]`,
    `[${stitchedAudio}]anull[audio]`,
  );
  return [
    "-y", ...roadInputs.flatMap((item) => ["-i", item.path]), "-i", app, "-i", voice,
    "-filter_complex", filters.join(";"),
    "-map", "[video]", "-map", "[audio]",
    "-t", totalDuration.toFixed(3), "-r", String(edit.layout.fps),
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-map_metadata", "-1", "-movflags", "+faststart", output,
  ];
}

export function proofEditFromProject(project, bundle, captureRunId) {
  const proof = project.inputs.story.proof;
  const selectedSegments = project.inputs.story.showcases?.length
    ? project.inputs.story.showcases.map(({ inMs, outMs }) => ({ inMs, outMs }))
    : bundle.capture.showcases || [{ inMs: proof.inMs, outMs: proof.outMs }];
  const timeline = sourceTimeline(project);
  const segments = timeline.length > 1
    ? splitGlobalSegmentsAcrossClips(selectedSegments, timeline)
    : selectedSegments;
  const value = project.inputs.proofEdit;
  return validateProofEdit({
    schemaVersion: 1,
    kind: "proof",
    bundleDigest: stableDemoBundleDigest(bundle),
    captureRunId,
    source: { inMs: proof.inMs, outMs: proof.outMs, segments },
    layout: value.layout,
    audio: value.audio,
    captions: value.captions,
    title: value.title,
  });
}

export async function renderProject(loaded, context) {
  const { options, io, outputResult, commandResult, args } = context;
  if (!options.edit && args[0] !== "proof") throw new Error("usage: render proof");
  if (!options.edit && options.output) {
    throw new Error("render proof stores immutable output in its attempt directory; use an edit manifest for an expert custom output");
  }
  let current = await readProject(loaded.path);
  const captureId = current.project.accepted.capture;
  if (!captureId || current.project.stages.capture.state !== "accepted") {
    return outputResult(io, options, { ok: false, code: "ACCEPTED_CAPTURE_REQUIRED" }, commandResult({ result: "Render did not start", why: "A current completed capture must be explicitly accepted", next: "./studio review" }));
  }
  const capture = current.project.attempts.capture.find((attempt) => attempt.id === captureId);
  if (!capture?.artifact) throw new Error(`accepted capture ${captureId} has no video artifact`);
  const bundle = JSON.parse(await readFile(join(current.directory, "artifacts", "bundle.app.json"), "utf8"));
  const edit = options.edit ? validateProofEdit(JSON.parse(await readFile(resolve(options.edit), "utf8"))) : proofEditFromProject(current.project, bundle, captureId);
  if (edit.captureRunId !== captureId) throw new Error("proof edit does not target the accepted capture");
  if (edit.bundleDigest !== stableDemoBundleDigest(bundle)) throw new Error("proof edit bundle digest is stale");
  const runId = nextAttemptId(current.project, "render");
  const runDirectory = join(current.directory, "attempts", runId);
  await mkdir(runDirectory, { recursive: false });
  const output = options.output ? resolve(options.output) : join(runDirectory, "proof.mp4");
  current = await updateProject(current.path, { type: "attempt-start", kind: "render", attempt: { id: runId, predecessor: current.project.attempts.render.at(-1)?.id || null, inputRevision: current.project.revision, captureRunId: captureId }, reason: "proof-render-started" });
  try {
    const eventsDocument = JSON.parse(await readFile(join(current.directory, "attempts", captureId, "capture-events.json"), "utf8"));
    const events = eventsDocument.events || [];
    const cues = captionsFromCaptureEvents(events, { language: edit.captions.language, translations: edit.captions.translations || {} });
    const srt = writeSrt(remapCuesToSegments(cues, edit.source.segments));
    const captionsPath = join(runDirectory, `${edit.captions.language || "he"}.srt`);
    await writeFile(captionsPath, srt, "utf8");
    const voicePath = join(runDirectory, "voice.wav");
    const voice = await renderVoiceStem(events, { output: voicePath, cacheDirectory: join(current.directory, "cache", "voice"), voice: current.project.inputs.captureProfile.voice || "default", originMs: edit.source.inMs });
    const flash = await detectSyncFlash(capture.artifact, { fps: edit.layout.fps });
    await writeJsonAtomic(join(runDirectory, "edit.json"), edit);
    await writeJsonAtomic(join(runDirectory, "sync.json"), flash);
    await writeJsonAtomic(join(runDirectory, "voice-placement.json"), voice);
    const clips = sourceTimeline(current.project);
    const roads = clips.length
      ? clips.map((clip) => ({ id: clip.id, path: clip.path }))
      : normalizeSourceClips(current.project.inputs).map((clip) => ({ id: clip.id, path: clip.path }));
    const args = buildProofFfmpegArgs({ roads, app: capture.artifact, voice: voicePath, captions: captionsPath, output, edit, appStartMs: flash.endMs });
    io.log?.(`Rendering ${runId}; this may take several minutes…`);
    await spawnChecked("ffmpeg", args, { onStderr: (chunk) => { if (process.env.DEMO_STUDIO_DEBUG) io.error?.(chunk); } });
    const media = await probeMedia(output);
    const metadataAudit = auditSensitiveMediaMetadata(media.raw);
    await writeJsonAtomic(join(runDirectory, "privacy-metadata.json"), metadataAudit);
    if (!metadataAudit.pass) {
      throw new Error(`render contains sensitive metadata: ${metadataAudit.findings.map((finding) => finding.path).join(", ")}`);
    }
    await writeJsonAtomic(join(runDirectory, "media-facts.json"), media);
    current = await updateProject(current.path, { type: "attempt-finish", kind: "render", attemptId: runId, state: "completed", artifact: output, digest: stableDemoBundleDigest({ edit, media: { durationSeconds: media.durationSeconds, video: media.video } }), reason: "proof-render-complete" });
    await writeValidationReport({ project: current.project, directory: current.directory });
    return outputResult(io, options, { ok: true, code: "RENDER_NEEDS_REVIEW", runId, output, media }, commandResult({ result: `Rendered ${runId}; human review is required`, wrote: output, kept: current.project.accepted.render ? `${current.project.accepted.render} remains accepted` : "No render was auto-accepted", next: `./studio review --run ${runId}` }));
  } catch (error) {
    current = await updateProject(current.path, { type: "attempt-finish", kind: "render", attemptId: runId, state: "failed", reason: error.message });
    return outputResult(io, options, { ok: false, code: "RENDER_FAILED", runId, error: error.message }, commandResult({ result: `${runId} failed`, why: error.message, kept: current.project.accepted.render ? `${current.project.accepted.render} remains accepted` : "Earlier attempts remain available", next: "./studio review", details: runDirectory }));
  }
}

export async function publishProof(loaded, context) {
  const { options, io, outputResult, commandResult } = context;
  let current = await readProject(loaded.path);
  const renderId = current.project.accepted.render;
  if (!renderId || current.project.stages.render.state !== "accepted") {
    return outputResult(io, options, { ok: false, code: "ACCEPTED_RENDER_REQUIRED" }, commandResult({ result: "Publish was blocked", why: "A current passing render has not been explicitly accepted", next: "./studio review" }));
  }
  const render = current.project.attempts.render.find((attempt) => attempt.id === renderId);
  if (!render?.artifact || !existsSync(render.artifact)) throw new Error(`accepted render ${renderId} is missing`);
  const report = await writeValidationReport({ project: current.project, directory: current.directory, shareable: true, basename: "validation-report.shareable" });
  if (!report.report.publishable) {
    return outputResult(io, options, { ok: false, code: "PUBLISH_GATES_FAILED", gates: report.report.gates }, commandResult({ result: "Publish was blocked", why: Object.entries(report.report.gates).filter(([, pass]) => !pass).map(([gate]) => gate).join(", "), next: "./studio status" }));
  }
  await mkdir(join(current.directory, "publish"), { recursive: true });
  const output = join(current.directory, "publish", `${current.project.id}-proof.mp4`);
  if (existsSync(output) && !options.force) throw new Error(`publish output exists: ${output}; use --force only after confirming replacement`);
  await copyFile(render.artifact, output);
  const reportOutput = join(current.directory, "publish", `${current.project.id}-validation.html`);
  await copyFile(report.htmlPath, reportOutput);
  current = await updateProject(current.path, { type: "stage-result", stage: "publish", state: "completed", artifact: output, digest: render.digest, reason: "accepted-render-published" });
  return outputResult(io, options, { ok: true, code: "PROOF_PUBLISHED", output, report: reportOutput }, commandResult({ result: `Published accepted ${renderId}`, wrote: `${output}\n         ${reportOutput}`, kept: "Private source, GPS, logs, and rejected attempts stayed in the project workspace", next: "Share the proof film together with its validation report" }));
}
