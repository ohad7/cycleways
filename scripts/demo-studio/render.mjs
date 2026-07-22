import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { stableDemoBundleDigest } from "../../packages/core/src/navigation/demoBundle.js";
import { captionsFromCaptureEvents, writeSrt } from "./captions.mjs";
import { validateProofEdit } from "./editDecision.mjs";
import { probeMedia } from "./mediaProbe.mjs";
import { nextAttemptId } from "./projectState.mjs";
import { writeValidationReport } from "./report.mjs";
import { spawnChecked } from "./process.mjs";
import { renderVoiceStem } from "./voiceRender.mjs";
import { readProject, updateProject, writeJsonAtomic } from "./workspace.mjs";

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

export async function detectSyncFlash(path, { fps = 30, spawnImpl = spawn } = {}) {
  const child = spawnImpl("ffmpeg", ["-v", "error", "-i", path, "-vf", `fps=${fps},scale=1:1:flags=area,format=rgb24`, "-an", "-f", "rawvideo", "pipe:1"], { shell: false, stdio: ["ignore", "pipe", "pipe"] });
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

export function buildProofFfmpegArgs({ road, app, voice, captions, output, edit, appStartMs }) {
  const width = edit.layout.width;
  const height = edit.layout.height;
  const roadWidth = Math.round(width * edit.layout.roadFraction / 2) * 2;
  const appWidth = width - roadWidth;
  const sourceStart = edit.source.inMs / 1000;
  const sourceEnd = edit.source.outMs / 1000;
  const duration = sourceEnd - sourceStart;
  const filters = [
    `[0:v]trim=start=${sourceStart}:end=${sourceEnd},setpts=PTS-STARTPTS,scale=${roadWidth}:${height}:force_original_aspect_ratio=increase,crop=${roadWidth}:${height}[road]`,
    `[1:v]trim=start=${(appStartMs / 1000).toFixed(6)}:duration=${duration},setpts=PTS-STARTPTS,scale=${appWidth}:${height}:force_original_aspect_ratio=decrease,pad=${appWidth}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x07130f[app]`,
    `[road][app]hstack=inputs=2[base]`,
    captions && edit.captions?.burnIn !== false
      ? `[base]subtitles='${escapeFilterPath(captions)}':force_style='FontSize=22,Outline=2,Shadow=1,Alignment=2,MarginV=42'[video]`
      : `[base]null[video]`,
    `[0:a]atrim=start=${sourceStart}:end=${sourceEnd},asetpts=PTS-STARTPTS,volume=${dbVolume(edit.audio?.ambienceGainDb ?? -14)}[road-a]`,
    `[2:a]atrim=duration=${duration},asetpts=PTS-STARTPTS,volume=${dbVolume(edit.audio?.voiceGainDb ?? 0)}[voice-a]`,
    `[road-a][voice-a]amix=inputs=2:duration=first:normalize=0[audio]`,
  ];
  return [
    "-y", "-i", road, "-i", app, "-i", voice,
    "-filter_complex", filters.join(";"),
    "-map", "[video]", "-map", "[audio]",
    "-t", duration.toFixed(3), "-r", String(edit.layout.fps),
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-map_metadata", "-1", "-movflags", "+faststart", output,
  ];
}

function proofEditFromProject(project, bundle, captureRunId) {
  const proof = project.inputs.story.proof;
  const value = project.inputs.proofEdit;
  return validateProofEdit({
    schemaVersion: 1,
    kind: "proof",
    bundleDigest: stableDemoBundleDigest(bundle),
    captureRunId,
    source: { inMs: proof.inMs, outMs: proof.outMs },
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
    const srt = writeSrt(cues, { originMs: edit.source.inMs });
    const captionsPath = join(runDirectory, `${edit.captions.language || "he"}.srt`);
    await writeFile(captionsPath, srt, "utf8");
    const voicePath = join(runDirectory, "voice.wav");
    const voice = await renderVoiceStem(events, { output: voicePath, cacheDirectory: join(current.directory, "cache", "voice"), voice: current.project.inputs.captureProfile.voice || "default", originMs: edit.source.inMs });
    const flash = await detectSyncFlash(capture.artifact, { fps: edit.layout.fps });
    await writeJsonAtomic(join(runDirectory, "edit.json"), edit);
    await writeJsonAtomic(join(runDirectory, "sync.json"), flash);
    await writeJsonAtomic(join(runDirectory, "voice-placement.json"), voice);
    const args = buildProofFfmpegArgs({ road: current.project.inputs.source.path, app: capture.artifact, voice: voicePath, captions: captionsPath, output, edit, appStartMs: flash.endMs });
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
