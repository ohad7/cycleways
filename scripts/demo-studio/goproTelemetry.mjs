import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { probeMedia } from "./mediaProbe.mjs";
import { spawnChecked } from "./process.mjs";

function numberOrNull(value) {
  if (value === undefined || value === null || value === "" || value === "-") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseExiftoolGpsRows(text) {
  const rows = [];
  const stats = { total: 0, valid: 0, noLock: 0, malformed: 0, duplicateTimes: 0 };
  const times = new Set();
  for (const [index, rawLine] of String(text).split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("SourceFile,")) continue;
    const fields = line.split(",").map((field) => field.trim());
    if (fields.length < 6) {
      stats.malformed += 1;
      continue;
    }
    const hasSource = !Number.isFinite(Number(fields[0]));
    const offset = hasSource ? 1 : 0;
    const timeSeconds = numberOrNull(fields[offset]);
    const measureMode = numberOrNull(fields[offset + 1]);
    const latitude = numberOrNull(fields[offset + 2]);
    const longitude = numberOrNull(fields[offset + 3]);
    const altitude = numberOrNull(fields[offset + 4]);
    const speed = numberOrNull(fields[offset + 5]);
    const accuracy = numberOrNull(fields[offset + 6]);
    stats.total += 1;
    if (timeSeconds === null || latitude === null || longitude === null) {
      stats.malformed += 1;
      continue;
    }
    if (![2, 3].includes(measureMode)) {
      stats.noLock += 1;
      continue;
    }
    if (times.has(timeSeconds)) stats.duplicateTimes += 1;
    times.add(timeSeconds);
    rows.push({
      source: hasSource ? fields[0] : null,
      line: index + 1,
      timeSeconds,
      measureMode,
      latitude,
      longitude,
      altitude,
      speed,
      accuracy,
    });
    stats.valid += 1;
  }
  return { rows, stats };
}

export function parseAlignedGpsCsv(text) {
  const lines = String(text).trim().split(/\r?\n/);
  const header = lines.shift()?.split(",").map((value) => value.trim()) || [];
  const required = ["time_s", "latitude", "longitude"];
  for (const column of required) {
    if (!header.includes(column)) throw new Error(`aligned GPS CSV is missing ${column}`);
  }
  const index = Object.fromEntries(header.map((name, position) => [name, position]));
  const converted = lines.map((line) => {
    const fields = line.split(",");
    return [
      fields[index.time_s],
      "3",
      fields[index.latitude],
      fields[index.longitude],
      fields[index.altitude_m] ?? "",
      fields[index.speed_mps] ?? "",
      fields[index.accuracy_m] ?? "",
    ].join(",");
  }).join("\n");
  return parseExiftoolGpsRows(converted);
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

export async function extractGoproGps(path, options = {}, deps = {}) {
  const sourceSha256 = await (deps.sha256File || sha256File)(path);
  if (options.kind === "aligned-csv" || path.toLowerCase().endsWith(".csv")) {
    const raw = await readFile(path, "utf8");
    const parsed = parseAlignedGpsCsv(raw);
    return { raw, ...parsed, sourceSha256, probe: null, sourceName: basename(path), adapter: "aligned-csv" };
  }
  const media = await (deps.probeMedia || probeMedia)(path, deps);
  if (!media.telemetry) throw new Error("video has no detectable GoPro GPMF telemetry stream");
  const run = deps.spawnChecked || spawnChecked;
  const result = await run("exiftool", [
    "-ee", "-n", "-f", "-api", "LargeFileSupport=1",
    "-p", "$SampleTime,$GPSMeasureMode,$GPSLatitude,$GPSLongitude,$GPSAltitude,$GPSSpeed,$GPSHPositioningError",
    path,
  ], { onStdout: options.onProgress });
  const parsed = parseExiftoolGpsRows(result.stdout);
  if (parsed.rows.length < 2) throw new Error("GoPro telemetry contains fewer than two valid locked GPS fixes");
  return { raw: result.stdout, ...parsed, sourceSha256, probe: media, sourceName: basename(path), adapter: "gopro-gpmf" };
}
