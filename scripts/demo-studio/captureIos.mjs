import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createCaptureServer } from "./captureServer.mjs";
import { probeMedia } from "./mediaProbe.mjs";
import { nextAttemptId } from "./projectState.mjs";
import { spawnChecked } from "./process.mjs";
import { readProject, updateProject, writeJsonAtomic } from "./workspace.mjs";

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function waitFor(predicate, { timeoutMs = 60_000, intervalMs = 200, label = "condition" } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await delay(intervalMs);
  }
  throw new Error(`timed out waiting for ${label}`);
}

export function bootedSimulators(value) {
  return Object.values(value?.devices || {}).flat().filter((device) => device.state === "Booted" && device.isAvailable !== false);
}

export function simulatorCaptureCommands({ udid, deepLink, output }) {
  return {
    openUrl: ["xcrun", ["simctl", "openurl", udid, deepLink]],
    record: ["xcrun", ["simctl", "io", udid, "recordVideo", "--codec=h264", output]],
  };
}

function spawnRecorder(executable, args, logPath) {
  const child = spawn(executable, args, { shell: false, stdio: ["ignore", "ignore", "pipe"] });
  const chunks = [];
  child.stderr.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const completed = new Promise((resolveCompleted, reject) => {
    child.once("error", reject);
    child.once("close", async (code, signal) => {
      await writeFile(logPath, Buffer.concat(chunks));
      resolveCompleted({ code, signal });
    });
  });
  return { child, completed };
}

async function postControl(service, path) {
  const response = await fetch(`${service.url}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${service.token}`, "content-type": "application/json" },
    body: "{}",
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `capture control failed (${response.status})`);
  return body;
}

export async function runSimulatorCapture({ bundle, workspace, runId, output, retryFrom = null, deps = {} } = {}) {
  if ((deps.platform || process.platform) !== "darwin") throw new Error("iOS Simulator capture requires macOS");
  const run = deps.spawnChecked || spawnChecked;
  const list = await run("xcrun", ["simctl", "list", "devices", "booted", "--json"]);
  const devices = bootedSimulators(JSON.parse(list.stdout));
  if (devices.length !== 1) throw new Error(`capture requires exactly one booted Simulator; found ${devices.length}`);
  const udid = devices[0].udid;
  const service = await (deps.createCaptureServer || createCaptureServer)({ bundle, workspace, runId });
  const deepLink = `cycleways://build?demo=${encodeURIComponent(service.url)}&token=${encodeURIComponent(service.token)}&run=${encodeURIComponent(runId)}`;
  const commands = simulatorCaptureCommands({ udid, deepLink, output });
  let recorder = null;
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
    recorder?.child?.kill("SIGINT");
    void (deps.postControl || postControl)(service, "/v1/control/abort").catch(() => {});
  };
  if (deps.registerSignals !== false) {
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
  }
  try {
    await run(...commands.openUrl);
    await waitFor(() => {
      if (interrupted) { const error = new Error("capture interrupted by operator"); error.captureAborted = true; throw error; }
      return service.state.stage === "ready";
    }, { timeoutMs: Number(deps.readyTimeoutMs) || 90_000, label: "the app, route, and map to become ready" });
    recorder = (deps.spawnRecorder || spawnRecorder)(commands.record[0], commands.record[1], join(workspace, "attempts", runId, "simctl-record.log"));
    await delay(Number(deps.recorderLeadMs) || 500);
    await (deps.postControl || postControl)(service, "/v1/control/start");
    await waitFor(() => {
      if (interrupted) { const error = new Error("capture interrupted by operator"); error.captureAborted = true; throw error; }
      if (["failed", "aborted"].includes(service.state.stage)) throw new Error(service.state.error?.message || `capture ${service.state.stage}`);
      return service.state.stage === "completed";
    }, { timeoutMs: Number(deps.captureTimeoutMs) || Math.max(120_000, Number(bundle.capture.proof.outMs) - Number(bundle.capture.proof.inMs) + 60_000), label: "capture completion" });
    recorder.child.kill("SIGINT");
    const recorderResult = await recorder.completed;
    recorder = null;
    if (![0, 130, null].includes(recorderResult.code) && recorderResult.signal !== "SIGINT") {
      throw new Error(`simctl recordVideo exited with ${recorderResult.code ?? recorderResult.signal}`);
    }
    const media = await (deps.probeMedia || probeMedia)(output);
    if (!media.video || media.durationSeconds <= 0) throw new Error("Simulator recording is not a valid video");
    const flash = deps.detectSyncFlash
      ? await deps.detectSyncFlash(output, { fps: 30 })
      : await import("./render.mjs").then(({ detectSyncFlash }) => detectSyncFlash(output, { fps: 30 }));
    await writeJsonAtomic(join(workspace, "attempts", runId, "sync.json"), flash);
    await writeJsonAtomic(join(workspace, "attempts", runId, "capture-facts.json"), {
      schemaVersion: 1,
      runId,
      retryFrom,
      simulator: devices[0],
      output,
      media: { durationSeconds: media.durationSeconds, video: media.video, audio: media.audio },
      sync: flash,
      bundleId: bundle.id,
    });
    return { output, media, simulator: devices[0], serviceState: service.state };
  } catch (error) {
    if (recorder) {
      recorder.child.kill("SIGINT");
      await recorder.completed.catch(() => {});
    }
    if (!["completed", "failed", "aborted"].includes(service.state.stage)) {
      await (deps.postControl || postControl)(service, "/v1/control/abort").catch(() => {});
    }
    throw error;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    await service.close();
  }
}

export async function captureProject(loaded, context) {
  const { options, io, outputResult, commandResult, alias, args } = context;
  if (alias === "capture" && args[0] !== "proof") throw new Error("usage: capture proof [--retry-from capture-NNN]");
  if (alias === "capture" && options.output) {
    throw new Error("capture proof stores immutable output in its attempt directory; --output is available only with capture-ios");
  }
  let current = await readProject(loaded.path);
  if (current.project.stages.inputs.state !== "accepted") {
    return outputResult(io, options, { ok: false, code: "NEEDS_REVIEW" }, commandResult({
      result: "Capture did not start",
      why: "Current source, route, offset, and proof window have not been accepted",
      kept: current.project.accepted.capture ? `${current.project.accepted.capture} remains accepted` : null,
      next: "./studio review",
    }));
  }
  const bundlePath = options.bundle ? resolve(options.bundle) : join(current.directory, "artifacts", "bundle.app.json");
  const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
  const runId = nextAttemptId(current.project, "capture");
  if (options["retry-from"] && !current.project.attempts.capture.some((attempt) => attempt.id === options["retry-from"])) {
    throw new Error(`retry source ${options["retry-from"]} does not exist`);
  }
  const runDirectory = join(current.directory, "attempts", runId);
  await mkdir(runDirectory, { recursive: false });
  const output = options.output ? resolve(options.output) : join(runDirectory, "app-clean.mov");
  current = await updateProject(current.path, {
    type: "attempt-start",
    kind: "capture",
    attempt: { id: runId, predecessor: options["retry-from"] || null, inputRevision: current.project.revision, bundlePath: "artifacts/bundle.app.json" },
    reason: options["retry-from"] ? "capture-retry" : "capture-started",
  });
  io.log?.(`Capturing ${runId}; logs: ${join(runDirectory, "simctl-record.log")}`);
  try {
    const result = await runSimulatorCapture({ bundle, workspace: current.directory, runId, output, retryFrom: options["retry-from"] || null });
    current = await updateProject(current.path, { type: "attempt-finish", kind: "capture", attemptId: runId, state: "completed", artifact: output, digest: bundle.provenance?.routeDigest || null, reason: "simulator-capture-complete" });
    return outputResult(io, options, { ok: true, code: "CAPTURE_NEEDS_REVIEW", runId, output, media: result.media }, commandResult({
      result: `Captured ${runId}; human review is required`,
      wrote: output,
      kept: current.project.accepted.capture ? `${current.project.accepted.capture} remains accepted` : "No acceptance pointer was changed",
      next: `./studio review --run ${runId}`,
    }));
  } catch (error) {
    const state = error.captureAborted ? "aborted" : "failed";
    current = await updateProject(current.path, { type: "attempt-finish", kind: "capture", attemptId: runId, state, reason: error.message });
    return outputResult(io, options, { ok: false, code: error.captureAborted ? "CAPTURE_ABORTED" : "CAPTURE_FAILED", runId, error: error.message }, commandResult({
      result: `${runId} ${state}`,
      why: error.message,
      kept: current.project.accepted.capture ? `${current.project.accepted.capture} remains accepted` : "All earlier attempts remain available",
      next: `./studio capture proof --retry-from ${runId}`,
      details: runDirectory,
    }));
  }
}

export { waitFor };
