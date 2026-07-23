import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateProofEdit } from "../scripts/demo-studio/editDecision.mjs";
import { createDemoProject, migrateDemoProject, reduceDemoProject } from "../scripts/demo-studio/projectState.mjs";
import { buildProofFfmpegArgs, proofEditFromProject } from "../scripts/demo-studio/render.mjs";
import { sourceTimeline, splitGlobalSegmentsAcrossClips } from "../scripts/demo-studio/sources.mjs";
import { listStudioJobs, recoverInterruptedJobs, studioJobCommand } from "../scripts/demo-studio/studioJobs.mjs";
import { listProjectRevisions, restoreProjectRevision, updateProject, writeJsonAtomic } from "../scripts/demo-studio/workspace.mjs";

const legacy = createDemoProject({ id: "legacy", sourcePath: "/tmp/one.mp4", routeValue: "route" });
delete legacy.inputs.sources;
const migrated = migrateDemoProject(legacy);
assert.equal(migrated.inputs.sources.length, 1);
assert.equal(migrated.inputs.sources[0].path, "/tmp/one.mp4");

let project = createDemoProject({ id: "multi", sourcePath: "/tmp/one.mp4", routeValue: "route" });
project = reduceDemoProject(project, {
  type: "replace-sources",
  sources: [
    { id: "clip-001", path: "/tmp/one.mp4", trim: { inSeconds: 2, outSeconds: 12 }, timeline: { inMs: 0, outMs: 10_000, sourceInMs: 2000, sourceOutMs: 12_000, durationMs: 10_000 } },
    { id: "clip-002", path: "/tmp/two.mp4", trim: { inSeconds: 5, outSeconds: 20 }, timeline: { inMs: 10_000, outMs: 25_000, sourceInMs: 5000, sourceOutMs: 20_000, durationMs: 15_000 } },
  ],
}).project;
project.inputs.source.trim = { inSeconds: 0, outSeconds: 25 };
const timeline = sourceTimeline(project);
assert.equal(timeline.at(-1).timeline.outMs, 25_000);
assert.deepEqual(splitGlobalSegmentsAcrossClips([{ inMs: 8000, outMs: 13_000 }], timeline), [
  { inMs: 8000, outMs: 10_000, sourceId: "clip-001", sourceInMs: 10_000, sourceOutMs: 12_000 },
  { inMs: 10_000, outMs: 13_000, sourceId: "clip-002", sourceInMs: 5000, sourceOutMs: 8000 },
]);

const retryProject = createDemoProject({ id: "retry", sourcePath: "/tmp/ride.mp4", routeValue: "route" });
retryProject.attempts.capture.push({
  id: "capture-001",
  state: "completed",
  artifact: "/tmp/capture-001.mov",
});
assert.deepEqual(
  studioJobCommand("capture", { retryFrom: "capture-001" }, retryProject),
  ["capture", "proof", "--retry-from", "capture-001"],
  "the website starts an immutable linked capture retry",
);
assert.throws(
  () => studioJobCommand("capture", { retryFrom: "capture-999" }, retryProject),
  /does not exist/,
);
assert.throws(
  () => studioJobCommand("render", { retryFrom: "capture-001" }, retryProject),
  /only supported for capture/,
);

project.inputs.story.proof = { inMs: 8000, outMs: 13_000, preRollMs: 0 };
project.inputs.story.showcases = [{ id: "showcase-1", inMs: 8000, outMs: 13_000 }];
const edit = proofEditFromProject(project, { capture: { showcases: [] }, provenance: {}, routeState: {}, fixes: [], expectations: {}, schemaVersion: 1, id: "multi" }, "capture-001");
assert.equal(edit.source.segments.length, 2, "a showcase crossing a GoPro boundary renders from both clips");
const args = buildProofFfmpegArgs({
  roads: [{ id: "clip-001", path: "/tmp/one.mp4" }, { id: "clip-002", path: "/tmp/two.mp4" }],
  app: "/tmp/app.mov",
  voice: "/tmp/voice.wav",
  captions: null,
  output: "/tmp/out.mp4",
  edit: validateProofEdit(edit),
  appStartMs: 100,
});
assert.deepEqual(args.slice(0, 7), ["-y", "-i", "/tmp/one.mp4", "-i", "/tmp/two.mp4", "-i", "/tmp/app.mov"]);
const filter = args[args.indexOf("-filter_complex") + 1];
assert.match(filter, /\[0:v\]trim=start=10:end=12/);
assert.match(filter, /\[1:v\]trim=start=5:end=8/);

const directory = await mkdtemp(join(tmpdir(), "demo-v2-"));
for (const child of ["revisions", "jobs"]) await mkdir(join(directory, child));
let reversible = createDemoProject({ id: "reversible", sourcePath: "/tmp/ride.mp4", routeValue: "route" });
await writeJsonAtomic(join(directory, "project.json"), reversible);
await writeFile(join(directory, "history.jsonl"), "");
await writeJsonAtomic(join(directory, "revisions", "revision-000.json"), reversible);
let updated = await updateProject(join(directory, "project.json"), {
  type: "configure",
  field: "proofEdit.captions.language",
  value: "en",
  reason: "English investor cut",
});
assert.equal(updated.project.revision, 1);
updated = await restoreProjectRevision(join(directory, "project.json"), 0, { reason: "return to Hebrew" });
assert.equal(updated.project.inputs.proofEdit.captions.language, "he");
assert.equal(updated.project.revision, 2, "restore creates a new revision instead of moving history backward");
assert.deepEqual((await listProjectRevisions(join(directory, "project.json"))).map((item) => item.revision), [0, 1, 2]);

await writeJsonAtomic(join(directory, "jobs", "job-001.json"), {
  schemaVersion: 1,
  id: "job-001",
  kind: "render",
  state: "running",
  pid: 999_999_999,
});
await writeFile(join(directory, "jobs", "job-001.log"), "partial render\n");
const recovered = await recoverInterruptedJobs(join(directory, "project.json"));
assert.equal(recovered[0].state, "interrupted");
assert.equal((await listStudioJobs(join(directory, "project.json")))[0].retryable, true);
assert.match((await readFile(join(directory, "jobs", "job-001.log"), "utf8")), /partial render/);

console.log("demo studio v2 tests passed");
