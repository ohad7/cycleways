const STAGES = [
  "source",
  "track",
  "route",
  "navigation",
  "inputs",
  "capture",
  "voice",
  "captions",
  "render",
  "publish",
];

const INVALIDATION = Object.freeze({
  "sources": ["source", "track", "route", "navigation", "inputs", "capture", "voice", "captions", "render", "publish"],
  "source.path": ["source", "track", "route", "navigation", "inputs", "capture", "voice", "captions", "render", "publish"],
  "source.sha256": ["source", "track", "route", "navigation", "inputs", "capture", "voice", "captions", "render", "publish"],
  "source.csvPath": ["track", "route", "navigation", "inputs", "capture", "voice", "captions", "render", "publish"],
  "source.csvSha256": ["track", "route", "navigation", "inputs", "capture", "voice", "captions", "render", "publish"],
  "source.trim": ["track", "route", "navigation", "inputs", "capture", "voice", "captions", "render", "publish"],
  "source.gpsOffsetSeconds": ["track", "route", "navigation", "inputs", "capture", "voice", "captions", "render", "publish"],
  "route.kind": ["route", "navigation", "inputs", "capture", "voice", "captions", "render", "publish"],
  "route.value": ["route", "navigation", "inputs", "capture", "voice", "captions", "render", "publish"],
  "route.snapshotDigest": ["route", "navigation", "inputs", "capture", "voice", "captions", "render", "publish"],
  "story.showcases": ["navigation", "inputs", "capture", "voice", "captions", "render", "publish"],
  "story.proof": ["navigation", "inputs", "capture", "voice", "captions", "render", "publish"],
  "captureProfile": ["capture", "voice", "captions", "render", "publish"],
  "captureProfile.voice": ["voice", "captions", "render", "publish"],
  "proofEdit.captions": ["captions", "render", "publish"],
  "proofEdit.layout": ["render", "publish"],
  "proofEdit.title": ["render", "publish"],
  "proofEdit.audio": ["render", "publish"],
});

function now(action) {
  return action.at || new Date().toISOString();
}

function clone(value) {
  return structuredClone(value);
}

function sourceClip(source = {}, index = 0) {
  return {
    id: source.id || `clip-${String(index + 1).padStart(3, "0")}`,
    kind: source.kind || (source.csvPath ? "aligned-csv" : "gopro-mp4"),
    path: source.path || null,
    csvPath: source.csvPath || null,
    sha256: source.sha256 || null,
    csvSha256: source.csvSha256 || null,
    trim: {
      inSeconds: Math.max(0, Number(source.trim?.inSeconds) || 0),
      outSeconds: source.trim?.outSeconds ?? null,
    },
    gpsOffsetSeconds: Number(source.gpsOffsetSeconds) || 0,
    timeline: source.timeline || null,
  };
}

export function migrateDemoProject(project) {
  if (!project || project.schemaVersion !== 1) throw new Error("demo project schemaVersion must be 1");
  const migrated = clone(project);
  migrated.inputs ||= {};
  migrated.inputs.sources = (Array.isArray(migrated.inputs.sources) && migrated.inputs.sources.length
    ? migrated.inputs.sources
    : migrated.inputs.source?.path
      ? [migrated.inputs.source]
      : []).map(sourceClip);
  migrated.inputs.source ||= sourceClip(migrated.inputs.sources[0] || {});
  migrated.runtime ||= { lastOpenedAt: null };
  migrated.attempts ||= { capture: [], voice: [], render: [], publish: [] };
  for (const kind of ["capture", "voice", "render", "publish"]) migrated.attempts[kind] ||= [];
  return migrated;
}

function getAtPath(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function setAtPath(object, path, value) {
  const keys = path.split(".");
  let cursor = object;
  for (const key of keys.slice(0, -1)) {
    if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[keys.at(-1)] = value;
}

function invalidatedFor(field) {
  if (INVALIDATION[field]) return INVALIDATION[field];
  const parent = Object.keys(INVALIDATION)
    .filter((candidate) => field.startsWith(`${candidate}.`))
    .sort((a, b) => b.length - a.length)[0];
  return parent ? INVALIDATION[parent] : [];
}

function knownConfigurationField(field) {
  return Boolean(INVALIDATION[field] || Object.keys(INVALIDATION).some((candidate) => field.startsWith(`${candidate}.`)));
}

function assertFiniteRange(value, field, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${field} must be between ${min} and ${max}`);
  }
}

function validateConfigurationValue(field, value) {
  if (field === "route.kind" && !["catalog-slug", "route-token"].includes(value)) throw new Error("route.kind must be catalog-slug or route-token");
  if (field === "source.gpsOffsetSeconds") assertFiniteRange(value, field, -60, 60);
  if (field === "proofEdit.layout.roadFraction") assertFiniteRange(value, field, 0.58, 0.72);
  if (field === "proofEdit.layout.fps") assertFiniteRange(value, field, 1, 120);
  if (field === "proofEdit.audio.ambienceGainDb" || field === "proofEdit.audio.voiceGainDb") assertFiniteRange(value, field, -60, 12);
  if (field === "proofEdit.layout.master" && !/^\d{3,5}x\d{3,5}$/.test(String(value))) throw new Error(`${field} must look like 1920x1080`);
  if (field === "proofEdit.captions.language" && !["he", "en"].includes(value)) throw new Error(`${field} must be he or en`);
  if (field.startsWith("proofEdit.captions.translations.") && typeof value !== "string") throw new Error(`${field} must be text`);
  if (field === "source.trim") {
    const start = Number(value?.inSeconds);
    const end = Number(value?.outSeconds);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error("source.trim must contain increasing finite inSeconds/outSeconds");
  }
  if (field === "story.proof") {
    const start = Number(value?.inMs);
    const end = Number(value?.outMs);
    const preRoll = Number(value?.preRollMs ?? 0);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(preRoll) || start < 0 || end <= start || preRoll < 0) {
      throw new Error("story.proof must contain increasing finite inMs/outMs and non-negative preRollMs");
    }
  }
}

export function normalizeShowcaseSelection(project, value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) {
    throw new Error("choose between one and six showcase segments");
  }
  const trimInMs = Math.round(Math.max(0, Number(project.inputs.source.trim.inSeconds) || 0) * 1000);
  const trimOutValue = project.inputs.source.trim.outSeconds;
  const trimOutSeconds = trimOutValue === null || trimOutValue === undefined ? NaN : Number(trimOutValue);
  const trimOutMs = Number.isFinite(trimOutSeconds) ? Math.round(trimOutSeconds * 1000) : Infinity;
  const showcases = value.map((segment, index) => {
    const inMs = Math.round(Number(segment?.inMs));
    const outMs = Math.round(Number(segment?.outMs));
    if (!Number.isFinite(inMs) || !Number.isFinite(outMs) || outMs <= inMs) {
      throw new Error(`showcase ${index + 1} must have an end after its start`);
    }
    if (inMs < trimInMs || outMs > trimOutMs) {
      throw new Error(`showcase ${index + 1} must stay inside the usable ride video`);
    }
    return { inMs, outMs };
  }).sort((left, right) => left.inMs - right.inMs);
  for (let index = 1; index < showcases.length; index += 1) {
    if (showcases[index].inMs < showcases[index - 1].outMs) {
      throw new Error(`showcases ${index} and ${index + 1} overlap; move one boundary before saving`);
    }
  }
  const numbered = showcases.map((segment, index) => ({ id: `showcase-${index + 1}`, ...segment }));
  const inMs = numbered[0].inMs;
  const outMs = numbered.at(-1).outMs;
  return {
    showcases: numbered,
    proof: { inMs, outMs, preRollMs: Math.min(8000, Math.max(0, inMs - trimInMs)) },
  };
}

function normalizeCaptureWindow(value) {
  const inMs = Math.round(Number(value?.inMs));
  const outMs = Math.round(Number(value?.outMs));
  if (!Number.isFinite(inMs) || !Number.isFinite(outMs) || inMs < 0 || outMs <= inMs) {
    throw new Error("capture window must contain increasing finite inMs/outMs");
  }
  return { inMs, outMs };
}

function staleStage(project, stage, reason) {
  const current = project.stages[stage] || { state: "pending" };
  if (["pending", "blocked"].includes(current.state) && !current.digest) return;
  project.stages[stage] = {
    ...current,
    state: current.attemptId && project.accepted[stage] === current.attemptId
      ? "accepted-stale"
      : "stale",
    reason,
  };
}

function eventFor(project, action, details = {}) {
  return {
    schemaVersion: 1,
    id: `${project.id}:r${project.revision}`,
    revision: project.revision,
    at: now(action),
    actor: action.actor || "operator",
    type: action.type,
    reason: action.reason || null,
    ...details,
  };
}

export function createDemoProject({ id, sourcePath = null, csvPath = null, routeValue = null, at } = {}) {
  const initialSource = sourceClip({
    kind: csvPath ? "aligned-csv" : "gopro-mp4",
    path: sourcePath,
    csvPath,
  });
  return {
    schemaVersion: 1,
    id,
    revision: 0,
    createdAt: at || new Date().toISOString(),
    inputs: {
      source: clone(initialSource),
      sources: sourcePath ? [clone(initialSource)] : [],
      route: { kind: "catalog-slug", value: routeValue, snapshotDigest: null },
      story: { showcases: [], proof: { inMs: null, outMs: null, preRollMs: 8000 } },
      captureProfile: {
        locale: "he-IL",
        appearance: "light",
        fontScale: 1,
        device: "iPhone 16 Pro",
        mapProfile: "mapbox-outdoors-prewarmed",
        voice: null,
      },
      proofEdit: {
        layout: { master: "3840x2160", fps: 30, roadFraction: 0.68, captionPosition: "road-bottom" },
        captions: { language: "he", burnIn: true, translations: {} },
        audio: { ambienceGainDb: -14, voiceGainDb: 0 },
        title: { embeddedGpsDisclosure: true },
      },
    },
    privacy: { acknowledged: false, shareExactEndpoints: false },
    stages: Object.fromEntries(STAGES.map((stage) => [stage, { state: "pending", reason: "not-run" }])),
    attempts: { capture: [], voice: [], render: [], publish: [] },
    accepted: { inputs: null, capture: null, voice: null, render: null },
    attestations: [],
    runtime: { lastOpenedAt: null },
  };
}

export function previewDemoProjectMutation(project, field, value) {
  if (String(field).split(".").some((part) => ["__proto__", "prototype", "constructor"].includes(part))) {
    throw new Error("unsafe demo configuration field");
  }
  if (!knownConfigurationField(field)) throw new Error(`unknown demo configuration field "${field}"`);
  validateConfigurationValue(field, value);
  const previous = getAtPath(project.inputs, field);
  const invalidated = Object.is(previous, value) ? [] : invalidatedFor(field);
  return { field, previous, value, invalidated };
}

export function reduceDemoProject(current, action) {
  if (!current || current.schemaVersion !== 1) throw new Error("demo project schemaVersion must be 1");
  const project = migrateDemoProject(current);
  let details = {};
  let invalidated = [];

  switch (action.type) {
    case "replace-sources": {
      if (!Array.isArray(action.sources) || action.sources.length < 1) {
        throw new Error("a demo project needs at least one source clip");
      }
      const sources = action.sources.map(sourceClip);
      if (sources.some((source) => !source.path)) throw new Error("every source clip requires a video path");
      const ids = new Set(sources.map((source) => source.id));
      if (ids.size !== sources.length) throw new Error("source clip ids must be unique");
      const previous = clone(project.inputs.sources);
      if (JSON.stringify(previous) === JSON.stringify(sources)) {
        return { project: current, historyEvent: null, invalidated: [] };
      }
      project.inputs.sources = sources;
      project.inputs.source = clone(sources[0]);
      invalidated = invalidatedFor("sources");
      for (const stage of invalidated) {
        staleStage(project, stage, "sources-changed");
        for (const attempt of project.attempts[stage] || []) {
          attempt.staleAtRevision = project.revision + 1;
          attempt.staleReason = "sources-changed";
        }
      }
      details = { previous, value: clone(sources), invalidated };
      break;
    }
    case "configure": {
      const preview = previewDemoProjectMutation(project, action.field, action.value);
      if (preview.invalidated.length === 0 && Object.is(preview.previous, action.value)) {
        return { project: current, historyEvent: null, invalidated: [] };
      }
      setAtPath(project.inputs, action.field, action.value);
      if (action.field.startsWith("source.") && project.inputs.sources.length === 1) {
        setAtPath(project.inputs.sources[0], action.field.slice("source.".length), clone(action.value));
      }
      invalidated = preview.invalidated;
      for (const stage of invalidated) {
        staleStage(project, stage, `${action.field}-changed`);
        for (const attempt of project.attempts[stage] || []) {
          attempt.staleAtRevision = project.revision + 1;
          attempt.staleReason = `${action.field}-changed`;
        }
      }
      details = { field: action.field, previous: preview.previous, value: action.value, invalidated };
      break;
    }
    case "select-showcases": {
      const previous = clone(project.inputs.story.showcases || []);
      const selection = normalizeShowcaseSelection(project, action.showcases);
      project.inputs.story.showcases = selection.showcases;
      project.inputs.story.proof = selection.proof;
      invalidated = invalidatedFor("story.showcases");
      for (const stage of invalidated) {
        staleStage(project, stage, "story.showcases-changed");
        for (const attempt of project.attempts[stage] || []) {
          attempt.staleAtRevision = project.revision + 1;
          attempt.staleReason = "story.showcases-changed";
        }
      }
      details = { previous, value: clone(selection.showcases), proof: clone(selection.proof), invalidated };
      break;
    }
    case "trim-showcases": {
      const attempt = project.attempts.capture.find((item) => item.id === action.captureAttemptId);
      if (!attempt || attempt.state !== "completed" || !attempt.artifact) {
        throw new Error("showcase trims require a completed capture");
      }
      if (attempt.staleAtRevision) {
        throw new Error(`capture "${attempt.id}" is stale because ${attempt.staleReason}`);
      }
      if (
        project.stages.capture.attemptId !== attempt.id &&
        project.accepted.capture !== attempt.id
      ) {
        throw new Error("showcase trims must target the current or accepted capture");
      }
      const captureWindow = normalizeCaptureWindow(attempt.captureWindow || action.captureWindow);
      const proof = normalizeCaptureWindow(project.inputs.story.proof);
      if (!attempt.captureWindow && (captureWindow.inMs !== proof.inMs || captureWindow.outMs !== proof.outMs)) {
        throw new Error("legacy capture bounds do not match the recorded proof window");
      }
      if (attempt.captureWindow && action.captureWindow) {
        const supplied = normalizeCaptureWindow(action.captureWindow);
        if (supplied.inMs !== captureWindow.inMs || supplied.outMs !== captureWindow.outMs) {
          throw new Error("capture window does not match the immutable recorded bounds");
        }
      }
      const selection = normalizeShowcaseSelection(project, action.showcases);
      if (selection.showcases.some((showcase) =>
        showcase.inMs < captureWindow.inMs || showcase.outMs > captureWindow.outMs
      )) {
        throw new Error("showcase trims must stay inside the recorded capture");
      }
      const previous = clone(project.inputs.story.showcases || []);
      if (JSON.stringify(previous) === JSON.stringify(selection.showcases)) {
        return { project: current, historyEvent: null, invalidated: [] };
      }
      attempt.captureWindow = captureWindow;
      project.inputs.story.showcases = selection.showcases;
      invalidated = ["render", "publish"];
      for (const stage of invalidated) {
        staleStage(project, stage, "showcase-trim-changed");
        for (const candidate of project.attempts[stage] || []) {
          candidate.staleAtRevision = project.revision + 1;
          candidate.staleReason = "showcase-trim-changed";
        }
      }
      details = {
        previous,
        value: clone(selection.showcases),
        captureAttemptId: attempt.id,
        captureWindow,
        invalidated,
      };
      break;
    }
    case "privacy-acknowledged":
      project.privacy.acknowledged = true;
      project.privacy.shareExactEndpoints = action.shareExactEndpoints === true;
      details = { value: clone(project.privacy) };
      break;
    case "stage-result": {
      if (!STAGES.includes(action.stage)) throw new Error(`unknown demo stage "${action.stage}"`);
      const nextStage = {
        state: action.state,
        reason: action.reason || null,
        digest: action.digest || null,
        artifact: action.artifact || null,
        attemptId: action.attemptId || null,
      };
      const currentStage = project.stages[action.stage] || {};
      if (["state", "reason", "digest", "artifact", "attemptId"].every((key) => (currentStage[key] ?? null) === (nextStage[key] ?? null))) {
        return { project: current, historyEvent: null, invalidated: [] };
      }
      project.stages[action.stage] = { ...nextStage, revision: project.revision + 1 };
      details = { stage: action.stage, result: clone(project.stages[action.stage]) };
      break;
    }
    case "attempt-start": {
      if (!project.attempts[action.kind]) throw new Error(`unknown attempt kind "${action.kind}"`);
      if (project.attempts[action.kind].some((item) => item.id === action.attempt.id)) {
        throw new Error(`attempt "${action.attempt.id}" already exists`);
      }
      project.attempts[action.kind].push({
        ...clone(action.attempt),
        state: action.attempt.state || "running",
        createdAt: now(action),
      });
      details = { kind: action.kind, attemptId: action.attempt.id, predecessor: action.attempt.predecessor || null };
      break;
    }
    case "attempt-finish": {
      const attempt = project.attempts[action.kind]?.find((item) => item.id === action.attemptId);
      if (!attempt) throw new Error(`unknown ${action.kind} attempt "${action.attemptId}"`);
      attempt.state = action.state;
      attempt.reason = action.reason || null;
      attempt.completedAt = now(action);
      attempt.artifact = action.artifact || attempt.artifact || null;
      attempt.digest = action.digest || attempt.digest || null;
      if (action.kind === "capture" && action.captureWindow) {
        attempt.captureWindow = normalizeCaptureWindow(action.captureWindow);
      }
      project.stages[action.kind] = {
        state: action.state === "completed" ? "needs-review" : action.state,
        reason: action.reason || null,
        attemptId: action.attemptId,
        artifact: attempt.artifact,
        digest: attempt.digest,
      };
      details = { kind: action.kind, attemptId: action.attemptId, state: action.state };
      break;
    }
    case "accept": {
      if (action.kind === "inputs") {
        if (project.stages.navigation.state !== "ready") {
          throw new Error("inputs cannot be accepted until navigation validation is ready");
        }
        project.accepted.inputs = `inputs-r${project.revision + 1}`;
        project.stages.inputs = { ...project.stages.inputs, state: "accepted", reason: null, attemptId: project.accepted.inputs };
      } else {
        const attempt = project.attempts[action.kind]?.find((item) => item.id === action.attemptId);
        if (!attempt) throw new Error(`unknown ${action.kind} attempt "${action.attemptId}"`);
        if (attempt.state !== "completed") throw new Error(`attempt "${action.attemptId}" is not completed`);
        if (attempt.staleAtRevision) throw new Error(`attempt "${action.attemptId}" is stale because ${attempt.staleReason}`);
        if (action.kind === "capture" && project.stages.inputs.state !== "accepted") {
          throw new Error("capture cannot be accepted until current inputs are accepted");
        }
        if (action.kind === "render" && project.stages.capture.state !== "accepted") {
          throw new Error("render cannot be accepted until a current capture is accepted");
        }
        project.accepted[action.kind] = action.attemptId;
        project.stages[action.kind] = { ...project.stages[action.kind], state: "accepted", attemptId: action.attemptId };
      }
      details = { kind: action.kind, attemptId: action.attemptId || project.accepted.inputs, note: action.note || null };
      break;
    }
    case "reject": {
      const attempt = project.attempts[action.kind]?.find((item) => item.id === action.attemptId);
      if (!attempt) throw new Error(`unknown ${action.kind} attempt "${action.attemptId}"`);
      attempt.review = { decision: "rejected", note: action.note || null, at: now(action) };
      if (project.accepted[action.kind] === action.attemptId) project.accepted[action.kind] = null;
      project.stages[action.kind] = { ...project.stages[action.kind], state: "needs-review", reason: "latest-attempt-rejected" };
      details = { kind: action.kind, attemptId: action.attemptId, note: action.note || null };
      break;
    }
    case "attest-old-build":
      project.attestations.push({ at: now(action), actor: action.actor || "operator", note: action.note });
      details = { note: action.note };
      break;
    case "restore-revision": {
      const target = migrateDemoProject(action.snapshot);
      if (target.id !== project.id) throw new Error("cannot restore a revision from another project");
      if (!Number.isInteger(action.targetRevision) || action.targetRevision < 0 || action.targetRevision >= project.revision) {
        throw new Error("restore target must be an earlier project revision");
      }
      const currentAttempts = clone(project.attempts);
      project.inputs = clone(target.inputs);
      project.stages = clone(target.stages);
      project.accepted = clone(target.accepted);
      for (const kind of Object.keys(currentAttempts)) {
        const restored = new Map((target.attempts[kind] || []).map((attempt) => [attempt.id, clone(attempt)]));
        for (const attempt of currentAttempts[kind] || []) {
          if (restored.has(attempt.id)) continue;
          restored.set(attempt.id, {
            ...clone(attempt),
            staleAtRevision: project.revision + 1,
            staleReason: `restored-revision-${action.targetRevision}`,
          });
        }
        project.attempts[kind] = [...restored.values()];
      }
      invalidated = STAGES.filter((stage) => JSON.stringify(current.stages?.[stage]) !== JSON.stringify(target.stages?.[stage]));
      details = {
        targetRevision: action.targetRevision,
        restoredInputsFromRevision: target.revision,
        invalidated,
      };
      break;
    }
    default:
      throw new Error(`unknown demo project action "${action.type}"`);
  }

  project.revision += 1;
  return { project, historyEvent: eventFor(project, action, details), invalidated };
}

export function deriveDemoProjectStatus(project) {
  const stages = STAGES.map((name) => ({ name, ...(project.stages[name] || { state: "pending" }) }));
  let next = "demo:studio inspect";
  if (!project.privacy?.acknowledged) next = "demo:studio configure privacy.acknowledged true";
  else if (project.stages.source.state !== "ready") next = "demo:studio inspect";
  else if (!["ready", "accepted"].includes(project.stages.navigation.state)) next = "demo:studio validate";
  else if (project.stages.inputs.state !== "accepted") next = "demo:studio review";
  else if (project.stages.capture.state !== "accepted") {
    next = project.stages.capture.state === "needs-review" && project.stages.capture.attemptId
      ? `demo:studio review --run ${project.stages.capture.attemptId}`
      : "demo:studio capture proof";
  } else if (project.stages.render.state !== "accepted") {
    next = project.stages.render.state === "needs-review" && project.stages.render.attemptId
      ? `demo:studio review --run ${project.stages.render.attemptId}`
      : "demo:studio render proof";
  }
  else if (project.stages.publish.state !== "completed") next = "demo:studio publish proof";
  return { stages, next, publishable: project.stages.render.state === "accepted" };
}

export function nextAttemptId(project, kind) {
  const prefix = kind === "capture" ? "capture" : kind === "render" ? "render" : kind;
  const numbers = (project.attempts[kind] || [])
    .map((attempt) => Number(attempt.id?.match(/(\d+)$/)?.[1]))
    .filter(Number.isFinite);
  return `${prefix}-${String(Math.max(0, ...numbers) + 1).padStart(3, "0")}`;
}

export { INVALIDATION as DEMO_INVALIDATION_RULES, STAGES as DEMO_STAGES };
