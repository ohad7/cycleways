import assert from "node:assert/strict";
import {
  createDemoProject,
  deriveDemoProjectStatus,
  nextAttemptId,
  previewDemoProjectMutation,
  reduceDemoProject,
} from "../scripts/demo-studio/projectState.mjs";

let project = createDemoProject({ id: "ride-one", sourcePath: "/tmp/ride.mp4", routeValue: "route-one", at: "2026-01-01T00:00:00Z" });
project.privacy.acknowledged = true;
project.stages.source = { state: "ready", digest: "source" };
project.stages.capture = { state: "accepted", attemptId: "capture-001", digest: "capture" };
project.attempts.capture.push({ id: "capture-001", state: "completed", digest: "capture" });
project.accepted.capture = "capture-001";

const captionPreview = previewDemoProjectMutation(project, "proofEdit.captions.language", "en");
assert.deepEqual(captionPreview.invalidated, ["captions", "render", "publish"]);
assert.throws(() => previewDemoProjectMutation(project, "proofEdit.layuot.master", "1920x1080"), /unknown demo configuration field/);
assert.throws(() => previewDemoProjectMutation(project, "proofEdit.captions.__proto__.polluted", "yes"), /unsafe demo configuration field/);
assert.throws(() => previewDemoProjectMutation(project, "proofEdit.layout.roadFraction", 0.9), /between 0.58 and 0.72/);
assert.throws(() => previewDemoProjectMutation(project, "story.proof", { inMs: 5000, outMs: 1000, preRollMs: 0 }), /increasing finite/);
let changed = reduceDemoProject(project, { type: "configure", field: "proofEdit.captions.language", value: "en", reason: "investor subtitles", at: "2026-01-01T01:00:00Z" });
assert.equal(changed.project.stages.capture.state, "accepted");
assert.equal(changed.project.stages.captions.state, "pending");
assert.deepEqual(changed.invalidated, ["captions", "render", "publish"]);

changed = reduceDemoProject(changed.project, { type: "configure", field: "source.gpsOffsetSeconds", value: 1.3, reason: "bridge landmark", at: "2026-01-01T02:00:00Z" });
assert.equal(changed.project.stages.capture.state, "accepted-stale");
assert.equal(changed.project.accepted.capture, "capture-001", "accepted pointer remains for history");
assert.throws(() => reduceDemoProject(changed.project, { type: "accept", kind: "capture", attemptId: "capture-001" }), /stale/);
assert.ok(deriveDemoProjectStatus(changed.project).next.includes("validate"));

changed.project.stages.navigation = { state: "ready", digest: "bundle-2" };
changed.project.stages.inputs = { state: "needs-review", digest: "bundle-2" };
changed = reduceDemoProject(changed.project, { type: "accept", kind: "inputs", note: "new inputs reviewed" });

changed = reduceDemoProject(changed.project, { type: "attempt-start", kind: "capture", attempt: { id: "capture-002", predecessor: "capture-001" } });
changed = reduceDemoProject(changed.project, { type: "attempt-finish", kind: "capture", attemptId: "capture-002", state: "completed", digest: "capture2" });
assert.equal(changed.project.accepted.capture, "capture-001", "success does not auto-accept");
changed = reduceDemoProject(changed.project, { type: "accept", kind: "capture", attemptId: "capture-002", note: "looks good" });
assert.equal(changed.project.accepted.capture, "capture-002");
assert.equal(nextAttemptId(changed.project, "capture"), "capture-003");

let inputs = createDemoProject({ id: "input-one", sourcePath: "/tmp/ride.mp4", routeValue: "route" });
inputs.stages.navigation = { state: "ready", digest: "bundle" };
inputs.stages.inputs = { state: "needs-review", digest: "bundle", artifact: "bundle.json" };
inputs = reduceDemoProject(inputs, { type: "accept", kind: "inputs" }).project;
assert.equal(inputs.stages.inputs.digest, "bundle", "input acceptance preserves the reviewed bundle digest");
assert.equal(reduceDemoProject(inputs, { type: "stage-result", stage: "inputs", state: "accepted", digest: "bundle", artifact: "bundle.json", attemptId: inputs.accepted.inputs }).historyEvent, null, "identical stage results are no-ops");

console.log("demo project state tests passed");
