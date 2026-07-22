import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDemoProject } from "../scripts/demo-studio/projectState.mjs";
import { createReviewServer } from "../scripts/demo-studio/reviewServer.mjs";

const directory = await mkdtemp(join(tmpdir(), "demo-review-"));
const project = createDemoProject({ id: "review-one", sourcePath: join(directory, "ride.mp4"), routeValue: "route" });
project.privacy.acknowledged = true;
project.stages.navigation = { state: "ready", digest: "nav" };
await writeFile(join(directory, "ride.mp4"), "fixture");
await writeFile(join(directory, "project.json"), `${JSON.stringify(project, null, 2)}\n`);
await writeFile(join(directory, "history.jsonl"), "");
const service = await createReviewServer({ projectPath: join(directory, "project.json"), token: "review-token" });
assert.equal((await fetch(`${service.url.split("?")[0]}api/state`)).status, 401);
assert.equal((await fetch(`${service.url.split("?")[0]}review.css`)).status, 200, "static code contains no project data and may load before auth");
const state = await (await fetch(`${service.url.split("?")[0]}api/state?token=review-token`)).json();
assert.equal(state.project.id, "review-one");
const decision = await fetch(`${service.url.split("?")[0]}api/decision?token=review-token`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ type: "configure", field: "proofEdit.layout.roadFraction", value: 0.62, reason: "conference screen" }),
});
assert.equal(decision.status, 200);
assert.deepEqual((await decision.json()).invalidated, ["render", "publish"]);
await service.close();

console.log("demo review workspace tests passed");
