import { appendFile, mkdir, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";

const CONTEXT_KEYS = new Set([
  "cacheStatus",
  "matcherRuntime",
  "outcome",
  "segmentId",
  "sourceId",
  "stage",
  "workspace",
]);

function finiteNumber(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : undefined;
}
function safeToken(value, maxLength = 80) {
  const token = String(value ?? "").slice(0, maxLength);
  return /^[a-zA-Z0-9_.:/ -]*$/.test(token) ? token : undefined;
}

export function sanitizeEditorActivityEvent(value, now = Date.now()) {
  if (!value || typeof value !== "object") return null;
  const name = safeToken(value.name, 80);
  const type = ["action", "timing"].includes(value.type) ? value.type : null;
  if (!name || !type) return null;

  const context = {};
  for (const [key, rawValue] of Object.entries(value.context || {})) {
    if (!CONTEXT_KEYS.has(key)) continue;
    if (key === "segmentId") {
      const segmentId = finiteNumber(rawValue, { max: 1_000_000_000 });
      if (segmentId !== undefined) context.segmentId = Math.trunc(segmentId);
      continue;
    }
    const token = safeToken(rawValue, 80);
    if (token !== undefined) context[key] = token;
  }

  const event = {
    schemaVersion: 1,
    recordedAt: new Date(now).toISOString(),
    sessionId: safeToken(value.sessionId, 80) || "unknown",
    type,
    name,
    context,
  };
  const durationMs = finiteNumber(value.durationMs, { max: 24 * 60 * 60 * 1000 });
  if (type === "timing" && durationMs !== undefined) event.durationMs = durationMs;
  return event;
}

function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) return null;
  return sortedValues[Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * fraction) - 1)];
}

export function summarizeEditorActivity(events) {
  const groups = new Map();
  for (const event of events) {
    const key = `${event.type}:${event.name}`;
    const group = groups.get(key) || { type: event.type, name: event.name, count: 0, durations: [] };
    group.count += 1;
    if (Number.isFinite(event.durationMs)) group.durations.push(event.durationMs);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => {
      const durations = group.durations.sort((a, b) => a - b);
      return {
        type: group.type,
        name: group.name,
        count: group.count,
        p50Ms: percentile(durations, 0.5),
        p95Ms: percentile(durations, 0.95),
        maxMs: durations.length ? durations[durations.length - 1] : null,
      };
    })
    .sort((left, right) => (right.p95Ms ?? -1) - (left.p95Ms ?? -1) || right.count - left.count);
}

export class EditorActivityLog {
  constructor({ path, maxBytes = 5 * 1024 * 1024, maxSummaryEvents = 10_000 }) {
    this.path = path;
    this.rotatedPath = `${path}.1`;
    this.maxBytes = maxBytes;
    this.maxSummaryEvents = maxSummaryEvents;
    this.pending = Promise.resolve();
  }

  append(values) {
    const events = (Array.isArray(values) ? values : [values])
      .slice(0, 200)
      .map((value) => sanitizeEditorActivityEvent(value))
      .filter(Boolean);
    if (events.length === 0) return Promise.resolve(0);
    this.pending = this.pending.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const current = await stat(this.path).catch(() => null);
      if (current && current.size >= this.maxBytes) {
        await unlink(this.rotatedPath).catch(() => {});
        await rename(this.path, this.rotatedPath);
      }
      await appendFile(this.path, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
      return events.length;
    });
    return this.pending;
  }

  async summary() {
    await this.pending;
    const text = await readFile(this.path, "utf8").catch(() => "");
    const events = text
      .trim()
      .split("\n")
      .slice(-this.maxSummaryEvents)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
    return {
      ok: true,
      localOnly: true,
      eventCount: events.length,
      groups: summarizeEditorActivity(events),
    };
  }

  async clear() {
    await this.pending;
    await Promise.all([
      unlink(this.path).catch(() => {}),
      unlink(this.rotatedPath).catch(() => {}),
    ]);
  }
}
