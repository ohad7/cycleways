import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDemoProject } from "../scripts/demo-studio/projectState.mjs";
import { createReviewServer } from "../scripts/demo-studio/reviewServer.mjs";

const directory = await mkdtemp(join(tmpdir(), "demo-review-"));
const project = createDemoProject({ id: "review-one", sourcePath: join(directory, "ride.mp4"), routeValue: "route" });
project.privacy.acknowledged = true;
project.stages.navigation = { state: "ready", digest: "nav" };
project.inputs.story.showcases = [
  { id: "showcase-1", inMs: 12_000, outMs: 32_000 },
  { id: "showcase-2", inMs: 52_000, outMs: 72_000 },
];
project.inputs.story.proof = { inMs: 12_000, outMs: 72_000, preRollMs: 8000 };
project.attempts.capture.push({
  id: "capture-001",
  inputRevision: project.revision,
  state: "completed",
  artifact: join(directory, "app.mov"),
});
project.stages.capture = {
  state: "needs-review",
  attemptId: "capture-001",
  artifact: join(directory, "app.mov"),
};
await writeFile(join(directory, "ride.mp4"), "fixture");
await writeFile(join(directory, "app.mov"), "fixture");
await mkdir(join(directory, "artifacts"), { recursive: true });
await writeFile(join(directory, "artifacts", "normalized-track.json"), `${JSON.stringify({
  fixes: [],
  warnings: [
    {
      code: "gps-unavailable",
      severity: "blocking-showcase",
      fromMs: 35_000,
      toMs: 50_000,
      sourceId: "source-1",
    },
  ],
}, null, 2)}\n`);
await writeFile(join(directory, "artifacts", "ride-validation.json"), `${JSON.stringify({
  eligibility: {
    warnings: [
      {
        code: "route-mismatch",
        severity: "blocking-showcase",
        fromMs: 75_000,
        toMs: 90_000,
        sourceId: "source-1",
      },
    ],
  },
}, null, 2)}\n`);
await mkdir(join(directory, "attempts", "capture-001"), { recursive: true });
await writeFile(join(directory, "attempts", "capture-001", "capture-events.json"), `${JSON.stringify({
  schemaVersion: 1,
  runId: "capture-001",
  events: [
    { kind: "capture-ready", mediaTimeMs: 12_000 },
    { kind: "capture-hold", mediaTimeMs: 72_000 },
  ],
}, null, 2)}\n`);
await writeFile(join(directory, "project.json"), `${JSON.stringify(project, null, 2)}\n`);
await writeFile(join(directory, "history.jsonl"), "");
const service = await createReviewServer({ projectPath: join(directory, "project.json"), selectedRun: "capture-001", token: "review-token" });
assert.equal((await fetch(`${service.url.split("?")[0]}api/state`)).status, 401);
assert.equal((await fetch(`${service.url.split("?")[0]}review.css`)).status, 200, "static code contains no project data and may load before auth");
const state = await (await fetch(`${service.url.split("?")[0]}api/state?token=review-token`)).json();
assert.equal(state.project.id, "review-one");
assert.equal(state.selectedRun, "capture-001");
assert.match(state.media.attempts["capture-001"], /media\/attempt\/capture-001/);
assert.deepEqual(state.attemptMeta["capture-001"].captureWindow, { inMs: 12_000, outMs: 72_000 });
assert.equal(state.attemptMeta["capture-001"].canTrim, true);
const page = await (await fetch(service.url)).text();
assert.match(page, /Choose your showcases/);
assert.match(page, /Review ride and app together/);
assert.match(page, /Set start here/);
assert.match(page, /Add another showcase here/);
assert.match(page, /Capture another take/);
assert.match(page, /Edit selection &amp; recapture|Edit selection & recapture/);
assert.match(page, /recapture-notice/);
assert.match(page, /source-quality/);
assert.match(page, /trim-modal/);
assert.match(page, /Production workflow/);
assert.match(page, /continue-action/);
assert.match(page, /Project settings/);
assert.match(page, /History &amp; restore|History & restore/);
assert.match(page, /project-modal/);
assert.match(page, /sources-modal/);
assert.doesNotMatch(page, /Calibrate inputs|Proof edit|GPS \/ video offset/);
const reviewScript = await (await fetch(`${service.url.split("?")[0]}review.js`)).text();
assert.match(reviewScript, /toggleAttribute\("hidden"/);
assert.match(reviewScript, /syncAttemptToRoad/);
assert.match(reviewScript, /trim-showcases/);
assert.match(reviewScript, /api\/jobs/);
assert.match(reviewScript, /api\/restore/);
assert.match(reviewScript, /seekSourceGlobal/);
assert.match(reviewScript, /gps-unavailable-band/);
assert.match(reviewScript, /splitTrackSegments/);
assert.match(reviewScript, /clip-span/);
assert.match(reviewScript, /route-mismatch-band/);
assert.match(reviewScript, /retryFrom/);
assert.match(reviewScript, /earlier take is preserved/);
assert.match(reviewScript, /editingInputs/);
assert.match(reviewScript, /Extend the showcase, save it, then validate and capture again/);
const reviewCss = await (await fetch(`${service.url.split("?")[0]}review.css`)).text();
assert.match(reviewCss, /height: clamp\(310px, 52vh, 560px\)/);
assert.match(reviewCss, /\.stage-cards::before/);
assert.match(reviewCss, /repeating-linear-gradient/);
assert.match(reviewCss, /recapture-option/);
const blockedDecision = await fetch(`${service.url.split("?")[0]}api/decision?token=review-token`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ type: "select-showcases", showcases: [{ inMs: 30_000, outMs: 40_000 }] }),
});
assert.equal(blockedDecision.status, 400, "showcases in GPS-unavailable ranges are rejected server-side");
assert.match((await blockedDecision.json()).error, /GPS-unavailable/);
const routeBlockedDecision = await fetch(`${service.url.split("?")[0]}api/decision?token=review-token`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ type: "select-showcases", showcases: [{ inMs: 76_000, outMs: 80_000 }] }),
});
assert.equal(routeBlockedDecision.status, 400, "showcases with GPS far from the selected route are rejected server-side");
assert.match((await routeBlockedDecision.json()).error, /does not match the selected route/);
const trimDecision = await fetch(`${service.url.split("?")[0]}api/decision?token=review-token`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    type: "trim-showcases",
    attemptId: "capture-001",
    showcases: [{ inMs: 14_000, outMs: 30_000 }, { inMs: 54_000, outMs: 70_000 }],
  }),
});
assert.equal(trimDecision.status, 200);
const trimmed = await trimDecision.json();
assert.deepEqual(trimmed.invalidated, ["render", "publish"]);
assert.equal(trimmed.state.project.attempts.capture[0].staleAtRevision, undefined);
assert.deepEqual(trimmed.state.project.inputs.story.proof, { inMs: 12_000, outMs: 72_000, preRollMs: 8000 });
const decision = await fetch(`${service.url.split("?")[0]}api/decision?token=review-token`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ type: "select-showcases", showcases: [{ inMs: 12_000, outMs: 32_000 }, { inMs: 52_000, outMs: 72_000 }] }),
});
assert.equal(decision.status, 200);
const saved = await decision.json();
assert.deepEqual(saved.invalidated, ["navigation", "inputs", "capture", "voice", "captions", "render", "publish"]);
assert.deepEqual(saved.state.project.inputs.story.showcases, [
  { id: "showcase-1", inMs: 12_000, outMs: 32_000 },
  { id: "showcase-2", inMs: 52_000, outMs: 72_000 },
]);
assert.deepEqual(saved.state.project.inputs.story.proof, { inMs: 12_000, outMs: 72_000, preRollMs: 8000 });
await service.close();

console.log("demo review workspace tests passed");
