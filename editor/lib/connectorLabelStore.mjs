import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { latestConnectorLabels } from "@cycleways/core/routing/connectorEvaluate.js";

const VERDICTS = new Set(["valid", "unacceptable", "borderline"]);
const HASH_RE = /^sha256:[0-9a-f]{64}$/;

function isLatLng(point) {
  if (!point || typeof point !== "object") return false;
  const lat = Number(point.lat);
  const lng = Number(point.lng);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

export function hashStrategy(strategy) {
  const hex = createHash("sha256").update(stableStringify(strategy)).digest("hex");
  return `sha256:${hex}`;
}

export function validateLabelRecord(record) {
  if (!record || typeof record !== "object") return "record object required";
  if (
    record.routeSlug !== null &&
    record.routeSlug !== undefined &&
    typeof record.routeSlug !== "string"
  ) {
    return "routeSlug must be a string or null";
  }
  if (!isLatLng(record.routeStart)) return "routeStart {lat,lng} required";
  if (!isLatLng(record.origin)) return "origin {lat,lng} required";
  if (!VERDICTS.has(record.verdict)) {
    return "verdict must be valid|unacceptable|borderline";
  }
  if (!record.features || typeof record.features !== "object") {
    return "features object required";
  }
  if (!HASH_RE.test(record.strategyHash || "")) {
    return "strategyHash sha256:<hex> required";
  }
  return null;
}

export async function appendLabel(path, record) {
  const error = validateLabelRecord(record);
  if (error) throw badRequest(error);

  const stamped = { ...record, ts: new Date().toISOString() };
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(stamped)}\n`, "utf8");
  return stamped;
}

export async function readLabels(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

export function latestLabels(records) {
  return latestConnectorLabels(records);
}

export async function upsertStrategy(path, strategy) {
  if (!strategy || typeof strategy !== "object") {
    throw badRequest("strategy object required");
  }
  const hash = hashStrategy(strategy);
  let sidecar = {};
  try {
    sidecar = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (!sidecar[hash]) {
    sidecar[hash] = strategy;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
  }
  return hash;
}
