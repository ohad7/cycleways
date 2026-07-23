import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { validateDemoProjectManifest } from "../../packages/core/src/navigation/demoBundle.js";
import { demoScenarioFromBundle } from "../../packages/core/src/navigation/demoScenario.js";
import { runScenario } from "../../packages/core/src/navigation/scenarioRunner.js";
import { compileDemoBundle } from "./compileBundle.mjs";
import { extractGoproGps, sha256File } from "./goproTelemetry.mjs";
import { probeMedia } from "./mediaProbe.mjs";
import { normalizeRideFixes, normalizeRideFixesWithRecovery } from "./normalizeFixes.mjs";
import { buildNavigationRouteSnapshot, routeSnapshotDigest } from "./routeSnapshot.mjs";
import { validateDemoRideAgainstRoute } from "./validateRide.mjs";
import { formatProjectStatus } from "./status.mjs";
import { readProject, updateProject, writeJsonAtomic } from "./workspace.mjs";
import { canonicalSha256 } from "../../packages/core/src/utils/canonicalHash.js";
import { normalizeSourceClips } from "./sources.mjs";

async function mutate(path, action) {
  const updated = await updateProject(path, action);
  return { path: updated.path, directory: updated.directory, project: updated.project };
}

async function gitCommit() {
  try {
    const { spawnChecked } = await import("./process.mjs");
    const commit = (await spawnChecked("git", ["rev-parse", "HEAD"], { maxOutputBytes: 4096 })).stdout.trim();
    const status = (await spawnChecked("git", ["status", "--porcelain=v1", "--", "apps/mobile", "packages/core", "src", "data"], { maxOutputBytes: 1024 * 1024 })).stdout;
    if (!status.trim()) return commit;
    const diff = (await spawnChecked("git", ["diff", "--no-ext-diff", "--", "apps/mobile", "packages/core", "src", "data"], { maxOutputBytes: 8 * 1024 * 1024 })).stdout;
    return `${commit}+working-${canonicalSha256({ status, diff }).slice(0, 16)}`;
  } catch {
    return "unknown";
  }
}

export function proofWindowFor(project, rows, durationSeconds) {
  const trim = project.inputs.source.trim;
  const first = Math.max(Number(trim.inSeconds) || 0, rows[0]?.timeSeconds || 0);
  const availableEnd = Math.min(
    Number.isFinite(Number(trim.outSeconds)) ? Number(trim.outSeconds) : durationSeconds,
    durationSeconds,
    rows.at(-1)?.timeSeconds ?? durationSeconds,
  );
  const current = project.inputs.story.proof;
  const firstMs = Math.round(first * 1000);
  const availableEndMs = Math.round(availableEnd * 1000);
  const requestedInMs = current.inMs !== null && current.inMs !== undefined && Number.isFinite(Number(current.inMs)) ? Number(current.inMs) : firstMs;
  const inMs = Math.max(firstMs, requestedInMs);
  const defaultOutMs = Math.round(Math.min(availableEnd, inMs / 1000 + 180) * 1000);
  const requestedOutMs = current.outMs !== null && current.outMs !== undefined && Number.isFinite(Number(current.outMs)) ? Number(current.outMs) : defaultOutMs;
  const outMs = requestedOutMs > inMs ? Math.min(availableEndMs, requestedOutMs) : defaultOutMs;
  if (outMs <= inMs) throw new Error("source does not contain a usable proof window");
  const requestedPreRollMs = Number.isFinite(Number(current.preRollMs)) ? Number(current.preRollMs) : 8000;
  return { inMs, outMs, preRollMs: Math.max(0, Math.min(requestedPreRollMs, inMs - firstMs)) };
}

function timestampInRange(timestamp, range) {
  return Number.isFinite(Number(timestamp))
    && Number(timestamp) >= range.inMs
    && Number(timestamp) <= range.outMs;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

const HARD_GPS_GAP_MS = 15_000;

export function gpsCoverageForClip(fixes, timeline, sourceId) {
  const warnings = [];
  const coverage = [];
  if (fixes.length < 2) {
    warnings.push({
      code: "gps-unavailable",
      severity: "blocking-showcase",
      fromMs: timeline.inMs,
      toMs: timeline.outMs,
      gapSeconds: (timeline.outMs - timeline.inMs) / 1000,
      sourceId,
    });
    return { warnings, coverage };
  }
  let rangeStart = fixes[0].timestamp;
  if (rangeStart - timeline.sourceInMs > 3000) {
    warnings.push({
      code: "gps-unavailable",
      severity: "blocking-showcase",
      fromMs: timeline.inMs,
      toMs: timeline.inMs + rangeStart - timeline.sourceInMs,
      gapSeconds: (rangeStart - timeline.sourceInMs) / 1000,
      sourceId,
    });
  }
  for (let index = 1; index < fixes.length; index += 1) {
    const previous = fixes[index - 1];
    const current = fixes[index];
    if (current.timestamp - previous.timestamp <= HARD_GPS_GAP_MS) continue;
    coverage.push({
      sourceId,
      inMs: timeline.inMs + rangeStart - timeline.sourceInMs,
      outMs: timeline.inMs + previous.timestamp - timeline.sourceInMs,
    });
    warnings.push({
      code: "gps-unavailable",
      severity: "blocking-showcase",
      fromMs: timeline.inMs + previous.timestamp - timeline.sourceInMs,
      toMs: timeline.inMs + current.timestamp - timeline.sourceInMs,
      gapSeconds: (current.timestamp - previous.timestamp) / 1000,
      sourceId,
    });
    rangeStart = current.timestamp;
  }
  coverage.push({
    sourceId,
    inMs: timeline.inMs + rangeStart - timeline.sourceInMs,
    outMs: timeline.inMs + fixes.at(-1).timestamp - timeline.sourceInMs,
  });
  if (timeline.sourceOutMs - fixes.at(-1).timestamp > 3000) {
    warnings.push({
      code: "gps-unavailable",
      severity: "blocking-showcase",
      fromMs: timeline.inMs + fixes.at(-1).timestamp - timeline.sourceInMs,
      toMs: timeline.outMs,
      gapSeconds: (timeline.sourceOutMs - fixes.at(-1).timestamp) / 1000,
      sourceId,
    });
  }
  return {
    warnings,
    coverage: coverage.filter((range) => range.outMs - range.inMs >= 1000),
  };
}

function mergeTimeRanges(ranges, toleranceMs = 1000) {
  const ordered = [...ranges].sort((left, right) => left.fromMs - right.fromMs);
  const merged = [];
  for (const range of ordered) {
    const previous = merged.at(-1);
    if (previous && range.fromMs <= previous.toMs + toleranceMs && range.sourceId === previous.sourceId) {
      previous.toMs = Math.max(previous.toMs, range.toMs);
      previous.sampleCount += range.sampleCount;
      previous.maxDistanceMeters = Math.max(previous.maxDistanceMeters, range.maxDistanceMeters);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

export function routeFitExclusions(fixes, sourceValidation, sourceClips, options = {}) {
  const maxDistanceMeters = Math.max(10, Number(options.maxDistanceMeters) || 120);
  const minSamples = Math.max(2, Number(options.minSamples) || 3);
  const minDurationMs = Math.max(0, Number(options.minDurationMs) || 2000);
  const samples = sourceValidation?.samples || [];
  const paired = (fixes || []).map((fix, index) => ({ fix, sample: samples[index] })).filter((item) =>
    item.sample && Number.isFinite(Number(item.sample.distanceMeters))
  );
  const exclusions = [];
  for (const clip of sourceClips || []) {
    const clipPairs = paired.filter(({ fix }) => fix.sourceId === clip.id);
    let run = [];
    const finishRun = (nextGood = null) => {
      if (!run.length) return;
      const durationMs = run.at(-1).fix.timestamp - run[0].fix.timestamp;
      if (run.length >= minSamples && (durationMs >= minDurationMs || run.length === clipPairs.length)) {
        const startsAtClipEdge = run[0] === clipPairs[0];
        const endsAtClipEdge = run.at(-1) === clipPairs.at(-1);
        exclusions.push({
          code: "route-mismatch",
          severity: "blocking-showcase",
          sourceId: clip.id,
          fromMs: startsAtClipEdge ? clip.timeline.inMs : run[0].fix.timestamp,
          toMs: endsAtClipEdge
            ? clip.timeline.outMs
            : Math.round((run.at(-1).fix.timestamp + nextGood.fix.timestamp) / 2),
          sampleCount: run.length,
          maxDistanceMeters: Math.max(...run.map(({ sample }) => sample.distanceMeters)),
          limitMeters: maxDistanceMeters,
        });
      }
      run = [];
    };
    for (const item of clipPairs) {
      if (item.sample.distanceMeters > maxDistanceMeters) run.push(item);
      else finishRun(item);
    }
    finishRun();
  }
  return mergeTimeRanges(exclusions);
}

export function subtractBlockedCoverage(coverage, blocked) {
  let remaining = (coverage || []).map((range) => ({ ...range }));
  for (const exclusion of blocked || []) {
    remaining = remaining.flatMap((range) => {
      if (range.sourceId !== exclusion.sourceId || exclusion.toMs <= range.inMs || exclusion.fromMs >= range.outMs) return [range];
      return [
        exclusion.fromMs > range.inMs ? { ...range, outMs: Math.min(range.outMs, exclusion.fromMs) } : null,
        exclusion.toMs < range.outMs ? { ...range, inMs: Math.max(range.inMs, exclusion.toMs) } : null,
      ].filter((candidate) => candidate && candidate.outMs - candidate.inMs >= 1000);
    });
  }
  return remaining;
}

export function validationScopeForCapture(capture = {}) {
  const proof = capture.proof || {};
  const showcases = (Array.isArray(capture.showcases) && capture.showcases.length
    ? capture.showcases
    : [proof])
    .map((segment) => ({ inMs: Number(segment.inMs), outMs: Number(segment.outMs) }))
    .filter((segment) => Number.isFinite(segment.inMs) && Number.isFinite(segment.outMs) && segment.outMs > segment.inMs)
    .sort((left, right) => left.inMs - right.inMs);
  if (!showcases.length) throw new Error("validation requires at least one showcase");
  const proofInMs = Number.isFinite(Number(proof.inMs)) ? Number(proof.inMs) : showcases[0].inMs;
  const proofOutMs = Number.isFinite(Number(proof.outMs)) ? Number(proof.outMs) : showcases.at(-1).outMs;
  const preRollMs = Math.max(0, Number(proof.preRollMs) || 0);
  return {
    captureEnvelope: {
      inMs: Math.max(0, Math.min(proofInMs, showcases[0].inMs) - preRollMs),
      outMs: Math.max(proofOutMs, showcases.at(-1).outMs),
    },
    showcases,
  };
}

export function scopeRideValidation(sourceValidation, scope) {
  const envelope = scope.captureEnvelope;
  const p95Limit = sourceValidation.gates.find((gate) => gate.code === "route-fit-p95")?.limit ?? 45;
  const maxLimit = sourceValidation.gates.find((gate) => gate.code === "route-fit-max")?.limit ?? 120;
  const samples = (sourceValidation.samples || []).filter((sample) => timestampInRange(sample.timestamp, envelope));
  const distances = samples.map((sample) => sample.distanceMeters).filter(Number.isFinite);
  const gaps = (sourceValidation.metrics?.gaps || []).filter((gap) => gap.toMs > envelope.inMs && gap.fromMs < envelope.outMs);
  const metrics = {
    sampleCount: samples.length,
    p50DistanceMeters: percentile(distances, 0.5),
    p95DistanceMeters: percentile(distances, 0.95),
    maxDistanceMeters: distances.length ? Math.max(...distances) : null,
    offRouteSamples: distances.filter((distance) => distance > p95Limit).length,
    gaps,
  };
  const gates = [
    { code: "route-fit-p95", pass: Number.isFinite(metrics.p95DistanceMeters) && metrics.p95DistanceMeters <= p95Limit, actual: metrics.p95DistanceMeters, limit: p95Limit },
    { code: "route-fit-max", pass: Number.isFinite(metrics.maxDistanceMeters) && metrics.maxDistanceMeters <= maxLimit, actual: metrics.maxDistanceMeters, limit: maxLimit },
    { code: "gps-gaps", pass: gaps.length === 0, actual: gaps.length, limit: 0 },
  ];
  const pass = gates.every((gate) => gate.pass);
  const failingCodes = new Set(gates.filter((gate) => !gate.pass).map((gate) => gate.code));
  return {
    pass,
    scope: { kind: "capture-envelope", ...envelope },
    metrics,
    gates,
    samples,
    sourceDiagnostics: {
      pass: sourceValidation.pass,
      scope: { kind: "full-source" },
      metrics: sourceValidation.metrics,
      gates: sourceValidation.gates,
      samples: sourceValidation.samples,
      nonBlockingGateCodes: sourceValidation.gates
        .filter((gate) => !gate.pass && !failingCodes.has(gate.code))
        .map((gate) => gate.code),
    },
  };
}

export function evaluateNavigationReplay(run, expectations = {}, scope = null) {
  const timeline = Array.isArray(run?.timeline) ? run.timeline : [];
  const captureTimeline = scope?.captureEnvelope
    ? timeline.filter((entry) => timestampInRange(entry.timestamp, scope.captureEnvelope))
    : timeline;
  const finalTimeline = scope?.showcases?.length
    ? timeline.filter((entry) => scope.showcases.some((showcase) => timestampInRange(entry.timestamp, showcase)))
    : captureTimeline;
  const forbiddenStatuses = new Set(expectations.forbiddenStatuses || ["error"]);
  const sourceForbidden = timeline.filter((entry) => forbiddenStatuses.has(entry.status));
  const sourceOffRoute = timeline.filter((entry) => entry.offRoute === true || entry.status === "off-route");
  const sourceVoiceEvents = timeline
    .filter((entry) => entry.voiceText)
    .map((entry) => ({ timestamp: entry.timestamp, text: entry.voiceText }));
  const forbidden = captureTimeline.filter((entry) => forbiddenStatuses.has(entry.status));
  const offRoute = captureTimeline.filter((entry) => entry.offRoute === true || entry.status === "off-route");
  const voiceEvents = finalTimeline
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
    scope: scope || { captureEnvelope: null, showcases: [] },
    timeline,
    routeRequests: run?.routeRequests || [],
    voiceEvents,
    sourceDiagnostics: {
      timelineCount: timeline.length,
      forbiddenStatusCount: sourceForbidden.length,
      forbiddenStatusOutsideCaptureCount: Math.max(0, sourceForbidden.length - forbidden.length),
      offRouteCount: sourceOffRoute.length,
      offRouteOutsideCaptureCount: Math.max(0, sourceOffRoute.length - offRoute.length),
      voiceEventCount: sourceVoiceEvents.length,
      voiceEventOutsideShowcasesCount: Math.max(0, sourceVoiceEvents.length - voiceEvents.length),
    },
  };
}

export async function inspectProject(loaded, context = {}) {
  const { options, io, outputResult, commandResult } = context;
  const sourceClips = normalizeSourceClips(loaded.project.inputs);
  if (!sourceClips.length || sourceClips.some((source) => !source.path)) {
    throw new Error("project has no complete source timeline; add at least one video");
  }
  io.log?.(`Inspecting ${sourceClips.length} media clip${sourceClips.length === 1 ? "" : "s"} and embedded GPS…`);
  const inspected = [];
  let timelineCursorMs = 0;
  for (const [index, source] of sourceClips.entries()) {
    io.log?.(sourceClips.length > 1 ? `Clip ${index + 1}/${sourceClips.length}: ${source.path}` : "");
    const telemetryPath = source.kind === "aligned-csv" ? source.csvPath : source.path;
    if (!telemetryPath) throw new Error(`aligned-csv clip ${source.id} requires a CSV path`);
    const extracted = await extractGoproGps(telemetryPath, { kind: source.kind });
    if (source.kind === "aligned-csv") extracted.probe = await probeMedia(source.path);
    const videoSha256 = source.kind === "aligned-csv" ? await sha256File(source.path) : extracted.sourceSha256;
    const durationSeconds = extracted.probe?.durationSeconds ?? extracted.rows.at(-1)?.timeSeconds;
    if (!Number.isFinite(durationSeconds)) throw new Error(`could not determine duration for ${source.path}`);
    const trim = {
      inSeconds: Math.max(0, Number(source.trim?.inSeconds) || 0),
      outSeconds: Math.min(Number(source.trim?.outSeconds) || durationSeconds, durationSeconds),
    };
    if (trim.outSeconds <= trim.inSeconds) throw new Error(`clip ${source.id} has no usable time after trimming`);
    const durationMs = Math.round((trim.outSeconds - trim.inSeconds) * 1000);
    const timeline = {
      inMs: timelineCursorMs,
      outMs: timelineCursorMs + durationMs,
      sourceInMs: Math.round(trim.inSeconds * 1000),
      sourceOutMs: Math.round(trim.outSeconds * 1000),
      durationMs,
    };
    const normalizedLocal = normalizeRideFixesWithRecovery(extracted.rows, {
      trimInSeconds: trim.inSeconds,
      trimOutSeconds: trim.outSeconds,
      gpsOffsetSeconds: source.gpsOffsetSeconds,
      defaultAccuracyMeters: 12,
      maxTeleportKmh: 200,
      maxInterpolatedGapSeconds: 0,
    });
    const localCoverage = gpsCoverageForClip(normalizedLocal.fixes, timeline, source.id);
    const shiftMs = timeline.inMs - timeline.sourceInMs;
    inspected.push({
      source: {
        ...source,
        sha256: videoSha256,
        csvSha256: source.kind === "aligned-csv" ? extracted.sourceSha256 : null,
        trim,
        timeline,
      },
      extracted,
      normalized: {
        ...normalizedLocal,
        fixes: normalizedLocal.fixes.map((fix) => ({ ...fix, timestamp: fix.timestamp + shiftMs, sourceId: source.id })),
        warnings: [...normalizedLocal.warnings.map((warning) => ({
          ...warning,
          fromMs: warning.fromMs + shiftMs,
          toMs: warning.toMs + shiftMs,
          sourceId: source.id,
        })), ...localCoverage.warnings],
        coverage: localCoverage.coverage,
      },
      globalRows: extracted.rows.map((row) => ({
        ...row,
        timeSeconds: timeline.inMs / 1000 + row.timeSeconds - trim.inSeconds,
        sourceId: source.id,
      })),
    });
    timelineCursorMs = timeline.outMs;
  }
  const durationSeconds = timelineCursorMs / 1000;
  const rows = inspected.flatMap((item) => item.globalRows).filter((row) => row.timeSeconds >= 0 && row.timeSeconds <= durationSeconds);
  const videoSha256 = canonicalSha256(inspected.map((item) => ({ id: item.source.id, sha256: item.source.sha256, timeline: item.source.timeline })));
  const trim = { inSeconds: 0, outSeconds: durationSeconds };
  let current = loaded;
  if (JSON.stringify(current.project.inputs.sources) !== JSON.stringify(inspected.map((item) => item.source))) {
    current = await mutate(current.path, {
      type: "replace-sources",
      sources: inspected.map((item) => item.source),
      reason: "source-timeline-inspected",
    });
  }
  if (current.project.inputs.source.sha256 !== videoSha256) current = await mutate(current.path, { type: "configure", field: "source.sha256", value: videoSha256, reason: "source-inspected" });
  if (JSON.stringify(current.project.inputs.source.trim) !== JSON.stringify(trim)) current = await mutate(current.path, { type: "configure", field: "source.trim", value: trim, reason: "source-duration-detected" });
  const combinedFixes = [];
  for (const fix of inspected.flatMap((item) => item.normalized.fixes)) {
    if (combinedFixes.length && fix.timestamp <= combinedFixes.at(-1).timestamp) continue;
    combinedFixes.push(fix);
  }
  const normalized = {
    fixes: combinedFixes,
    warnings: inspected.flatMap((item) => item.normalized.warnings),
    coverage: inspected.flatMap((item) => item.normalized.coverage),
    cleanup: {
      sourceCount: inspected.length,
      clipBoundariesMs: inspected.slice(1).map((item) => item.source.timeline.inMs),
      clips: inspected.map((item) => ({ sourceId: item.source.id, ...item.normalized.cleanup })),
      recoveries: inspected.flatMap((item) => item.normalized.recovery ? [{ sourceId: item.source.id, ...item.normalized.recovery }] : []),
    },
  };
  if (normalized.fixes.length < 2) throw new Error("the source timeline contains fewer than two usable GPS fixes");
  const currentProof = current.project.inputs.story.proof;
  let proof;
  if (
    (currentProof.inMs === null || currentProof.outMs === null) &&
    normalized.coverage.length
  ) {
    const range = [...normalized.coverage].sort((left, right) => (right.outMs - right.inMs) - (left.outMs - left.inMs))[0];
    proof = {
      inMs: range.inMs,
      outMs: Math.min(range.outMs, range.inMs + 180_000),
      preRollMs: 0,
    };
  } else {
    proof = proofWindowFor(current.project, rows, durationSeconds);
  }
  if (JSON.stringify(current.project.inputs.story.proof) !== JSON.stringify(proof)) current = await mutate(current.path, { type: "configure", field: "story.proof", value: proof, reason: "initial-proof-window" });
  const aggregateStats = {
    total: inspected.reduce((sum, item) => sum + item.extracted.stats.total, 0),
    valid: inspected.reduce((sum, item) => sum + item.extracted.stats.valid, 0),
    invalid: inspected.reduce((sum, item) => sum + item.extracted.stats.invalid, 0),
  };
  await writeJsonAtomic(join(current.directory, "artifacts", "media-probe.json"), {
    durationSeconds,
    clips: inspected.map((item) => ({ id: item.source.id, path: item.source.path, probe: item.extracted.probe, timeline: item.source.timeline })),
  });
  await writeJsonAtomic(join(current.directory, "artifacts", "media-timeline.json"), {
    durationMs: timelineCursorMs,
    clips: inspected.map((item) => item.source),
  });
  await writeJsonAtomic(join(current.directory, "artifacts", "raw-gps.json"), { stats: aggregateStats, rows });
  await writeJsonAtomic(join(current.directory, "artifacts", "normalized-track.json"), normalized);
  current = await mutate(current.path, { type: "stage-result", stage: "source", state: "ready", digest: videoSha256, artifact: "artifacts/media-probe.json", reason: inspected.length > 1 ? `${inspected.length}-clip-virtual-ride` : inspected[0].extracted.adapter });
  current = await mutate(current.path, { type: "stage-result", stage: "track", state: normalized.warnings.length ? "needs-review" : "ready", digest: canonicalSha256({ fixes: normalized.fixes, cleanup: normalized.cleanup }), artifact: "artifacts/normalized-track.json", reason: normalized.warnings.length ? `${normalized.warnings.length}-gps-gap(s)` : null });
  const payload = {
    ok: true,
    code: normalized.warnings.length ? "SOURCE_NEEDS_REVIEW" : "SOURCE_READY",
    source: { durationSeconds, clipCount: inspected.length, ...aggregateStats },
    cleanup: normalized.cleanup,
    warnings: normalized.warnings,
  };
  return outputResult(io, options, payload, commandResult({
    result: `Inspected ${inspected.length} clip${inspected.length === 1 ? "" : "s"}: ${aggregateStats.valid} valid GPS fixes`,
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
  const sourceRideValidation = validateDemoRideAgainstRoute(normalized.fixes, routeState);
  const routeExclusions = routeFitExclusions(normalized.fixes, sourceRideValidation, normalizeSourceClips(current.project.inputs));
  const eligibleCoverage = subtractBlockedCoverage(normalized.coverage, routeExclusions);
  const hasSavedShowcases = current.project.inputs.story.showcases?.length > 0;
  const currentProof = current.project.inputs.story.proof;
  const proofIsBlocked = routeExclusions.some((range) =>
    range.toMs > Number(currentProof.inMs) &&
    range.fromMs < Number(currentProof.outMs)
  );
  if (!hasSavedShowcases && proofIsBlocked && eligibleCoverage.length) {
    const best = [...eligibleCoverage].sort((left, right) => (right.outMs - right.inMs) - (left.outMs - left.inMs))[0];
    current = await mutate(current.path, {
      type: "configure",
      field: "story.proof",
      value: { inMs: best.inMs, outMs: Math.min(best.outMs, best.inMs + 180_000), preRollMs: 0 },
      reason: "initial-proof-moved-to-route-matching-telemetry",
    });
  }
  const validationScope = validationScopeForCapture({
    proof: current.project.inputs.story.proof,
    showcases: current.project.inputs.story.showcases,
  });
  const rideValidation = {
    ...scopeRideValidation(sourceRideValidation, validationScope),
    eligibility: {
      coverage: eligibleCoverage,
      warnings: routeExclusions,
    },
  };
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
    navigation = evaluateNavigationReplay(run, compiled.appBundle.expectations, validationScope);
  } catch (error) {
    navigation = { pass: false, error: error.message, timeline: [] };
  }
  await writeJsonAtomic(join(current.directory, "artifacts", "navigation-validation.json"), navigation);
  const pass = rideValidation.pass && navigation.pass;
  current = await mutate(current.path, { type: "stage-result", stage: "navigation", state: pass ? "ready" : "needs-review", digest: compiled.digest, artifact: "artifacts/navigation-validation.json", reason: pass ? null : "validation-gates-failed" });
  if (!acceptedInputsAreCurrent || !pass) {
    current = await mutate(current.path, { type: "stage-result", stage: "inputs", state: "needs-review", digest: compiled.digest, artifact: "artifacts/bundle.app.json", reason: "human-input-review-required" });
  }
  const blockingFailures = [
    ...rideValidation.gates.filter((gate) => !gate.pass).map((gate) => gate.code),
    ...(navigation.gates || []).filter((gate) => !gate.pass).map((gate) => gate.code),
    navigation.error,
  ].filter(Boolean);
  const sourceNotes = [
    ...rideValidation.sourceDiagnostics.nonBlockingGateCodes,
    navigation.sourceDiagnostics?.forbiddenStatusOutsideCaptureCount ? `${navigation.sourceDiagnostics.forbiddenStatusOutsideCaptureCount} forbidden navigation event(s)` : null,
    navigation.sourceDiagnostics?.offRouteOutsideCaptureCount ? `${navigation.sourceDiagnostics.offRouteOutsideCaptureCount} off-route event(s)` : null,
  ].filter(Boolean);
  return outputResult(io, options, { ok: pass, code: pass ? "VALIDATION_READY_FOR_REVIEW" : "VALIDATION_NEEDS_REVIEW", bundleDigest: compiled.digest, rideValidation, navigation }, commandResult({
    result: pass ? "Data and navigation validation passed" : "Validation needs review",
    why: pass ? "The selected edit, GPS, and real navigation replay agree" : blockingFailures.join(", "),
    wrote: join(current.directory, "artifacts", "bundle.app.json"),
    next: "./studio review",
    details: pass && sourceNotes.length ? `Non-blocking source issues outside the selected edit: ${sourceNotes.join(", ")}` : null,
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
