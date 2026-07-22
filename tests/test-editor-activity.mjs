import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createEditorActivityTracker } from "../editor/lib/editor-activity-client.mjs";
import {
  EditorActivityLog,
  sanitizeEditorActivityEvent,
} from "../editor/lib/editor-activity-log.mjs";

const sanitized = sanitizeEditorActivityEvent({
  sessionId: "session-1",
  type: "timing",
  name: "render_all",
  durationMs: 42.5,
  context: {
    workspace: "overlay",
    sourceId: "segments",
    geometry: [[35, 33]],
    notes: "private editor content",
  },
});
assert.deepEqual(sanitized.context, { workspace: "overlay", sourceId: "segments" });
assert.equal(sanitized.durationMs, 42.5);

const directory = await mkdtemp(resolve(tmpdir(), "cycleways-editor-activity-"));
try {
  const path = resolve(directory, "events.ndjson");
  const log = new EditorActivityLog({ path, maxBytes: 1024 });
  await log.append([sanitized, { type: "timing", name: "render_all", durationMs: 100 }]);
  const summary = await log.summary();
  assert.equal(summary.localOnly, true);
  assert.equal(summary.groups[0].count, 2);
  assert.equal(summary.groups[0].p50Ms, 42.5);
  assert.equal(summary.groups[0].p95Ms, 100);

  const requests = [];
  const tracker = createEditorActivityTracker({
    storage: { getItem: () => "true", setItem() {} },
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: true };
    },
  });
  tracker.action("select_segment", { workspace: "overlay" });
  tracker.timing("render_all", 17, { workspace: "overlay" });
  await tracker.flush();
  assert.equal(requests[0].events.length, 2);
  assert.equal((await readFile(path, "utf8")).includes("private editor content"), false);
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log("editor activity tracking ok");
