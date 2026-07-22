import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { validateDemoProjectManifest } from "../../packages/core/src/navigation/demoBundle.js";
import { demoScenarioFromBundle } from "../../packages/core/src/navigation/demoScenario.js";
import { runScenario } from "../../packages/core/src/navigation/scenarioRunner.js";
import { compileDemoBundle } from "./compileBundle.mjs";
import { extractGoproGps, sha256File } from "./goproTelemetry.mjs";
import { probeMedia } from "./mediaProbe.mjs";
import { normalizeRideFixes } from "./normalizeFixes.mjs";
import { buildNavigationRouteSnapshot, routeSnapshotDigest } from "./routeSnapshot.mjs";
import { validateDemoRideAgainstRoute } from "./validateRide.mjs";
import { formatProjectStatus } from "./status.mjs";
import { readProject, updateProject, writeJsonAtomic } from "./workspace.mjs";
import { canonicalSha256 } from "../../packages/core/src/utils/canonicalHash.js";

async function mutate(path, action) {
  const updated = await updateProject(path, action);
  return { path: updated.path, directory: updated.directory, project: updated.project };
}

async function gitCommit() {
  try {
    const { spawnChecked } = await import("./process.mjs");
    return (await spawnChecked("git", ["rev-parse", "HEAD"], { maxOutputBytes: 4096 })).stdout.trim();
  } catch {
    return "unknown";
  }
}

function proofWindowFor(project, rows, durationSeconds) {
  const trim = project.inputs.source.trim;
  const first = Math.max(Number(trim.inSeconds) || 0, rows[0]?.timeSeconds || 0);
  const availableEnd = Math.min(
    Number.isFinite(Number(trim.outSeconds)) ? Number(trim.outSeconds) : durationSeconds,
    durationSeconds,
    rows.at(-1)?.timeSeconds ?? durationSeconds,
  );
  const current = project.inputs.story.proof;
  const inMs = current.inMs !== null && current.inMs !== undefined && Number.isFinite(Number(current.inMs)) ? Number(current.inMs) : Math.round(first * 1000);
  const outMs = current.outMs !== null && current.outMs !== undefined && Number.isFinite(Number(current.outMs))
    ? Number(current.outMs)
    : Math.round(Math.min(availableEnd, first + 180) * 1000);
  if (outMs <= inMs) throw new Error("source does not contain a usable proof window");
  return { inMs, outMs, preRollMs: Math.min(Number(current.preRollMs) || 8000, inMs - Math.round(first * 1000)) };
}

export function evaluateNavigationReplay(run, expectations = {}) {
  const timeline = Array.isArray(run?.timeline) ? run.timeline : [];
  const forbiddenStatuses = new Set(expectations.forbiddenStatuses || ["error"]);
  const forbidden = timeline.filter((entry) => forbiddenStatuses.has(entry.status));
  const offRoute = timeline.filter((entry) => entry.offRoute === true || entry.status === "off-route");
  const voiceEvents = timeline
    .filter((entry) => entry.voiceText)
    .map((entry) => ({ timestamp: entry.timestamp, text: entry.voiceText }));
  const gates = [
    { code: "forbidden-navigation-status", pass: forbidden.length === 0, actual: forbidden.length, limit: 0 },
    { code: "off-route", pass: expectations.allowOffRoute === true || offRoute.length === 0, actual: offRoute.length, limit: expectations.allowOffRoute === true ? null : 0 },
    { code: "voice-present", pass: expectations.requireVoice !== true || voiceEvents.length > 0, actual: voiceEvents.length, limit: expectations.requireVoice === true ? 1 : 0 },
  ];
  return {
    pass: gates.every((gate) => gate.pass),
    gates,
    timeline,
    routeRequests: run?.routeRequests || [],
    voiceEvents,
  };
}

export async function inspectProject(loaded, context = {}) {
  const { options, io, outputResult, commandResult } = context;
  const source = loaded.project.inputs.source;
  if (!source.path) throw new Error("project has no source; create it with --source or configure source.path");
  io.log?.("Inspecting media and embedded GPS…");
  const telemetryPath = source.kind === "aligned-csv" ? source.csvPath : source.path;
  if (!telemetryPath) throw new Error("aligned-csv projects require source.csvPath");
  const extracted = await extractGoproGps(telemetryPath, { kind: source.kind });
  if (source.kind === "aligned-csv") extracted.probe = await probeMedia(source.path);
  const videoSha256 = source.kind === "aligned-csv" ? await sha256File(source.path) : extracted.sourceSha256;
  const durationSeconds = extracted.probe?.durationSeconds ?? extracted.rows.at(-1)?.timeSeconds;
  if (!Number.isFinite(durationSeconds)) throw new Error("could not determine source duration");
  const trim = {
    inSeconds: Math.max(0, Number(source.trim.inSeconds) || 0),
    outSeconds: Math.min(Number(source.trim.outSeconds) || durationSeconds, durationSeconds),
  };
  let current = loaded;
  if (source.sha256 !== videoSha256) current = await mutate(current.path, { type: "configure", field: "source.sha256", value: videoSha256, reason: "source-inspected" });
  if (source.kind === "aligned-csv" && source.csvSha256 !== extracted.sourceSha256) current = await mutate(current.path, { type: "configure", field: "source.csvSha256", value: extracted.sourceSha256, reason: "aligned-gps-inspected" });
  if (JSON.stringify(current.project.inputs.source.trim) !== JSON.stringify(trim)) current = await mutate(current.path, { type: "configure", field: "source.trim", value: trim, reason: "source-duration-detected" });
  const proof = proofWindowFor(current.project, extracted.rows, durationSeconds);
  if (JSON.stringify(current.project.inputs.story.proof) !== JSON.stringify(proof)) current = await mutate(current.path, { type: "configure", field: "story.proof", value: proof, reason: "initial-proof-window" });
  const normalized = normalizeRideFixes(extracted.rows, {
    trimInSeconds: trim.inSeconds,
    trimOutSeconds: trim.outSeconds,
    gpsOffsetSeconds: current.project.inputs.source.gpsOffsetSeconds,
    defaultAccuracyMeters: 12,
    maxTeleportKmh: 200,
    maxInterpolatedGapSeconds: 0,
  });
  await writeJsonAtomic(join(current.directory, "artifacts", "media-probe.json"), extracted.probe || { durationSeconds, telemetry: { kind: "aligned-csv" } });
  await writeJsonAtomic(join(current.directory, "artifacts", "raw-gps.json"), { stats: extracted.stats, rows: extracted.rows });
  await writeJsonAtomic(join(current.directory, "artifacts", "normalized-track.json"), normalized);
  current = await mutate(current.path, { type: "stage-result", stage: "source", state: "ready", digest: videoSha256, artifact: "artifacts/media-probe.json", reason: extracted.adapter });
  current = await mutate(current.path, { type: "stage-result", stage: "track", state: normalized.warnings.length ? "needs-review" : "ready", digest: canonicalSha256({ fixes: normalized.fixes, cleanup: normalized.cleanup }), artifact: "artifacts/normalized-track.json", reason: normalized.warnings.length ? `${normalized.warnings.length}-gps-gap(s)` : null });
  const payload = {
    ok: true,
    code: normalized.warnings.length ? "SOURCE_NEEDS_REVIEW" : "SOURCE_READY",
    source: { durationSeconds, ...extracted.stats },
    cleanup: normalized.cleanup,
    warnings: normalized.warnings,
  };
  return outputResult(io, options, payload, commandResult({
    result: `Inspected ${extracted.sourceName}: ${extracted.stats.valid} valid GPS fixes`,
    why: normalized.warnings.length ? `${normalized.warnings.length} GPS gap(s) need visual review` : "GPS coverage is continuous at the configured threshold",
    wrote: join(current.directory, "artifacts", "normalized-track.json"),
    next: normalized.warnings.length ? "./studio review" : "./studio validate",
  }));
}

export async function validateProject(loaded, context = {}) {
  const { options, io, outputResult, commandResult } = context;
  let current = await readProject(loaded.path);
  const trackPath = join(current.directory, "artifacts", "normalized-track.json");
  let normalized;
  try {
    normalized = JSON.parse(await readFile(trackPath, "utf8"));
  } catch {
    throw new Error("normalized track is missing; run inspect first");
  }
  io.log?.("Resolving the selected route and running the real navigation engine…");
  const selection = current.project.inputs.route;
  if (!selection.value) throw new Error("no route selected; run route set <slug>");
  const routeState = await buildNavigationRouteSnapshot(selection.kind === "route-token"
    ? { routeToken: selection.value, name: current.project.id }
    : { catalogSlug: selection.value, name: current.project.id });
  const routeDigest = routeSnapshotDigest(routeState);
  if (selection.snapshotDigest !== routeDigest) current = await mutate(current.path, { type: "configure", field: "route.snapshotDigest", value: routeDigest, reason: "route-snapshot-resolved" });
  await writeJsonAtomic(join(current.directory, "artifacts", "route-snapshot.json"), routeState);
  const rideValidation = validateDemoRideAgainstRoute(normalized.fixes, routeState);
  await writeJsonAtomic(join(current.directory, "artifacts", "ride-validation.json"), rideValidation);
  current = await mutate(current.path, { type: "stage-result", stage: "route", state: rideValidation.pass ? "ready" : "needs-review", digest: routeDigest, artifact: "artifacts/ride-validation.json", reason: rideValidation.pass ? null : "route-fit-gates-failed" });
  const compiled = compileDemoBundle({
    project: current.project,
    routeState,
    fixes: normalized.fixes,
    cleanup: normalized.cleanup,
    gitCommit: await gitCommit(),
  });
  await writeJsonAtomic(join(current.directory, "artifacts", "bundle.private.json"), compiled.privateBundle);
  await writeJsonAtomic(join(current.directory, "artifacts", "bundle.app.json"), compiled.appBundle);
  const acceptedInputsAreCurrent = current.project.stages.inputs.state === "accepted" && current.project.stages.inputs.digest === compiled.digest;
  let navigation;
  try {
    const resolved = demoScenarioFromBundle(compiled.appBundle);
    const run = runScenario({
      ...resolved,
      navigationRoute: (await import("../../packages/core/src/navigation/scenarios/resolve.js")).resolveScenario(resolved).navigationRoute,
      fixes: resolved.track.fixes,
    });
    navigation = evaluateNavigationReplay(run, compiled.appBundle.expectations);
  } catch (error) {
    navigation = { pass: false, error: error.message, timeline: [] };
  }
  await writeJsonAtomic(join(current.directory, "artifacts", "navigation-validation.json"), navigation);
  const pass = rideValidation.pass && navigation.pass;
  current = await mutate(current.path, { type: "stage-result", stage: "navigation", state: pass ? "ready" : "needs-review", digest: compiled.digest, artifact: "artifacts/navigation-validation.json", reason: pass ? null : "validation-gates-failed" });
  if (!acceptedInputsAreCurrent || !pass) {
    current = await mutate(current.path, { type: "stage-result", stage: "inputs", state: "needs-review", digest: compiled.digest, artifact: "artifacts/bundle.app.json", reason: "human-input-review-required" });
  }
  return outputResult(io, options, { ok: pass, code: pass ? "VALIDATION_READY_FOR_REVIEW" : "VALIDATION_NEEDS_REVIEW", bundleDigest: compiled.digest, rideValidation, navigation }, commandResult({
    result: pass ? "Data and navigation validation passed" : "Validation needs review",
    why: pass ? "The selected route, GPS, and real navigation replay agree" : [...rideValidation.gates.filter((gate) => !gate.pass).map((gate) => gate.code), navigation.error].filter(Boolean).join(", "),
    wrote: join(current.directory, "artifacts", "bundle.app.json"),
    next: "./studio review",
  }));
}

export async function compileManifestCommand({ options, io, outputResult, commandResult }) {
  if (!options.manifest) throw new Error("compile requires --manifest <path>");
  const manifest = validateDemoProjectManifest(JSON.parse(await readFile(resolve(options.manifest), "utf8")));
  const sourcePath = manifest.source.video;
  const telemetryPath = manifest.source.kind === "gopro-mp4" ? manifest.source.video : manifest.source.csv;
  const extracted = await extractGoproGps(telemetryPath, { kind: manifest.source.kind });
  if (manifest.source.kind === "aligned-csv") extracted.probe = await probeMedia(sourcePath);
  const videoSha256 = manifest.source.kind === "aligned-csv" ? await sha256File(sourcePath) : extracted.sourceSha256;
  const normalized = normalizeRideFixes(extracted.rows, {
    trimInSeconds: manifest.source.trim.inSeconds,
    trimOutSeconds: manifest.source.trim.outSeconds,
    gpsOffsetSeconds: manifest.source.gpsOffsetSeconds,
  });
  const routeState = await buildNavigationRouteSnapshot(manifest.route.kind === "route-token" ? { routeToken: manifest.route.value, name: manifest.id } : { catalogSlug: manifest.route.value });
  const project = {
    id: manifest.id,
    inputs: {
      source: { path: sourcePath, sha256: videoSha256, csvSha256: manifest.source.kind === "aligned-csv" ? extracted.sourceSha256 : null },
      route: { snapshotDigest: routeSnapshotDigest(routeState) },
      story: { proof: { inMs: manifest.story.proof.inSeconds * 1000, outMs: manifest.story.proof.outSeconds * 1000, preRollMs: 8000 } },
      captureProfile: manifest.capture,
    },
  };
  const compiled = compileDemoBundle({ project, routeState, fixes: normalized.fixes, cleanup: normalized.cleanup, gitCommit: await gitCommit() });
  const out = resolve(options.out || `${manifest.id}.demo-bundle.json`);
  await writeJsonAtomic(out, compiled.appBundle);
  return outputResult(io, options, { ok: true, code: "BUNDLE_COMPILED", digest: compiled.digest, path: out }, commandResult({ result: `Compiled ${manifest.id}`, wrote: out, next: `npm run demo:studio -- serve --bundle ${out}` }));
}

export async function makeProof(loaded, context) {
  let current = await readProject(loaded.path);
  if (current.project.stages.source.state !== "ready") return inspectProject(current, context);
  if (current.project.stages.navigation.state !== "ready") return validateProject(current, context);
  if (current.project.stages.inputs.state === "accepted" && current.project.stages.capture.state !== "accepted") {
    const reviewable = current.project.attempts.capture.find((attempt) => attempt.state === "completed" && !attempt.staleAtRevision && attempt.review?.decision !== "rejected");
    if (!reviewable) {
      const { captureProject } = await import("./captureIos.mjs");
      return captureProject(current, { ...context, alias: "capture", args: ["proof"] });
    }
  }
  if (current.project.stages.capture.state === "accepted" && current.project.stages.render.state !== "accepted") {
    const reviewable = current.project.attempts.render.find((attempt) => attempt.state === "completed" && !attempt.staleAtRevision && attempt.review?.decision !== "rejected");
    if (!reviewable) {
      const { renderProject } = await import("./render.mjs");
      return renderProject(current, { ...context, args: ["proof"] });
    }
  }
  const status = formatProjectStatus(current.project).status;
  return context.outputResult(context.io, context.options, { ok: false, code: "NEEDS_REVIEW", next: status.next }, context.commandResult({
    result: "Stopped at a required human decision",
    why: "Input, capture, and editorial acceptance cannot be automated",
    next: `./studio ${status.next.replace("demo:studio ", "")}`,
  }));
}
