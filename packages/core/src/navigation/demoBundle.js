const PROJECT_SCHEMA_VERSION = 1;
const BUNDLE_SCHEMA_VERSION = 1;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function fail(label, path, message) {
  throw new Error(`${label}: ${path} ${message}`);
}

function object(value, label, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(label, path, "must be an object");
  }
  return value;
}

function onlyKeys(value, allowed, label, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(label, `${path}.${key}`, "is not supported");
  }
}

function finite(value, label, path, { min = -Infinity, max = Infinity } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    fail(label, path, `must be a finite number between ${min} and ${max}`);
  }
  return number;
}

function string(value, label, path) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(label, path, "must be a non-empty string");
  }
  return value;
}

function validateId(value, label) {
  const id = string(value, label, "id");
  if (!ID_PATTERN.test(id)) fail(label, "id", "must use kebab-case");
  return id;
}

function validateRange(value, label, path, inKey, outKey) {
  const range = object(value, label, path);
  onlyKeys(range, new Set([inKey, outKey, "preRollMs"]), label, path);
  const start = finite(range[inKey], label, `${path}.${inKey}`, { min: 0 });
  const end = finite(range[outKey], label, `${path}.${outKey}`, { min: 0 });
  if (end <= start) fail(label, path, `${outKey} must be greater than ${inKey}`);
  const result = { [inKey]: start, [outKey]: end };
  if (range.preRollMs !== undefined) {
    result.preRollMs = finite(range.preRollMs, label, `${path}.preRollMs`, { min: 0 });
  }
  return result;
}

export function validateDemoProjectManifest(value) {
  const label = `demo project "${value?.id || "unnamed"}"`;
  const manifest = object(value, label, "project");
  onlyKeys(
    manifest,
    new Set(["schemaVersion", "id", "source", "route", "capture", "story"]),
    label,
    "project",
  );
  if (manifest.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    fail(label, "schemaVersion", `must be ${PROJECT_SCHEMA_VERSION}`);
  }
  const id = validateId(manifest.id, label);
  const source = object(manifest.source, label, "source");
  onlyKeys(
    source,
    new Set(["kind", "video", "csv", "trim", "gpsOffsetSeconds"]),
    label,
    "source",
  );
  if (!["gopro-mp4", "aligned-csv"].includes(source.kind)) {
    fail(label, "source.kind", 'must be "gopro-mp4" or "aligned-csv"');
  }
  string(source.video, label, "source.video");
  if (source.kind === "aligned-csv") string(source.csv, label, "source.csv");
  const trim = validateRange(source.trim, label, "source.trim", "inSeconds", "outSeconds");
  const route = object(manifest.route, label, "route");
  onlyKeys(route, new Set(["kind", "value"]), label, "route");
  if (!["catalog-slug", "route-token"].includes(route.kind)) {
    fail(label, "route.kind", 'must be "catalog-slug" or "route-token"');
  }
  const capture = object(manifest.capture, label, "capture");
  onlyKeys(
    capture,
    new Set(["locale", "appearance", "fontScale", "device", "mapProfile", "voice"]),
    label,
    "capture",
  );
  if (!["light", "dark"].includes(capture.appearance)) {
    fail(label, "capture.appearance", 'must be "light" or "dark"');
  }
  const story = object(manifest.story, label, "story");
  onlyKeys(story, new Set(["proof", "beats"]), label, "story");
  const proof = validateRange(story.proof, label, "story.proof", "inSeconds", "outSeconds");
  if (proof.inSeconds < trim.inSeconds || proof.outSeconds > trim.outSeconds) {
    fail(label, "story.proof", "must be contained by source.trim");
  }
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id,
    source: {
      kind: source.kind,
      video: source.video ?? null,
      csv: source.csv ?? null,
      trim,
      gpsOffsetSeconds: finite(source.gpsOffsetSeconds ?? 0, label, "source.gpsOffsetSeconds"),
    },
    route: { kind: route.kind, value: string(route.value, label, "route.value") },
    capture: {
      locale: string(capture.locale, label, "capture.locale"),
      appearance: capture.appearance,
      fontScale: finite(capture.fontScale, label, "capture.fontScale", { min: 0.5, max: 3 }),
      device: string(capture.device, label, "capture.device"),
      mapProfile: string(capture.mapProfile, label, "capture.mapProfile"),
      ...(capture.voice ? { voice: string(capture.voice, label, "capture.voice") } : {}),
    },
    story: { proof, beats: Array.isArray(story.beats) ? story.beats : [] },
  };
}

function validatePoint(point, label, path) {
  const value = object(point, label, path);
  return {
    ...value,
    lat: finite(value.lat, label, `${path}.lat`, { min: -90, max: 90 }),
    lng: finite(value.lng, label, `${path}.lng`, { min: -180, max: 180 }),
  };
}

export function validateDemoBundle(value) {
  const label = `demo "${value?.id || "unnamed"}"`;
  const bundle = object(value, label, "bundle");
  onlyKeys(
    bundle,
    new Set(["schemaVersion", "id", "routeState", "fixes", "capture", "expectations", "provenance"]),
    label,
    "bundle",
  );
  if (bundle.schemaVersion !== BUNDLE_SCHEMA_VERSION) {
    fail(label, "schemaVersion", `must be ${BUNDLE_SCHEMA_VERSION}`);
  }
  validateId(bundle.id, label);
  const routeState = object(bundle.routeState, label, "routeState");
  if (!Array.isArray(routeState.geometry) || routeState.geometry.length < 2) {
    fail(label, "routeState.geometry", "must contain at least two points");
  }
  routeState.geometry.forEach((point, index) => validatePoint(point, label, `routeState.geometry[${index}]`));
  if (!Array.isArray(bundle.fixes) || bundle.fixes.length < 2) {
    fail(label, "fixes", "must contain at least two fixes");
  }
  let previous = -Infinity;
  const fixes = bundle.fixes.map((fix, index) => {
    const path = `fixes[${index}]`;
    const normalized = validatePoint(fix, label, path);
    normalized.timestamp = finite(fix.timestamp, label, `${path}.timestamp`, { min: 0 });
    if (normalized.timestamp <= previous) {
      fail(label, `${path}.timestamp`, `must be greater than fixes[${index - 1}].timestamp`);
    }
    previous = normalized.timestamp;
    normalized.accuracy = finite(fix.accuracy, label, `${path}.accuracy`, { min: 0 });
    normalized.speed = finite(fix.speed, label, `${path}.speed`, { min: 0 });
    normalized.heading = finite(fix.heading, label, `${path}.heading`, { min: 0, max: 360 });
    if (fix.altitude !== undefined && fix.altitude !== null) {
      normalized.altitude = finite(fix.altitude, label, `${path}.altitude`);
    }
    return normalized;
  });
  const capture = object(bundle.capture, label, "capture");
  const proof = validateRange(capture.proof, label, "capture.proof", "inMs", "outMs");
  if (fixes[0].timestamp > proof.inMs - (proof.preRollMs ?? 0) || fixes.at(-1).timestamp < proof.outMs) {
    fail(label, "fixes", "must cover the proof window and pre-roll");
  }
  return {
    ...bundle,
    id: bundle.id,
    routeState,
    fixes,
    capture: { ...capture, proof },
    expectations: object(bundle.expectations, label, "expectations"),
    provenance: object(bundle.provenance, label, "provenance"),
  };
}

function removePrivate(value, key = "") {
  if (Array.isArray(value)) return value.map((item) => removePrivate(item));
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [childKey, child] of Object.entries(value)) {
    if (/^(sourcePath|videoPath|csvPath|rawTelemetry|privateNotes)$/i.test(childKey)) continue;
    if (typeof child === "string" && (childKey.toLowerCase().includes("path") || key === "paths")) continue;
    result[childKey] = removePrivate(child, childKey);
  }
  return result;
}

export function sanitizeDemoBundleForApp(bundle) {
  return validateDemoBundle(removePrivate(bundle));
}

function canonical(value, parentKey = "") {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => !(parentKey === "provenance" && key === "compiledAt"))
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key], key)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

// A deterministic SHA-256 digest suitable for provenance checks in both Node
// and React Native. The shared pure-JS implementation avoids node:crypto.
export function stableDemoBundleDigest(bundle) {
  return sha256Hex(canonical(bundle));
}

export { canonical as stableDemoBundleString };
import { sha256Hex } from "../utils/canonicalHash.js";
