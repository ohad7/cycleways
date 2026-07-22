import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCliArguments } from "../scripts/demo-studio/cli.mjs";
import { assertNarrowDemoPath, createProjectWorkspace, DEMO_REPOSITORY_ROOT, readProject, writeJsonAtomic } from "../scripts/demo-studio/workspace.mjs";
import { createDemoProject } from "../scripts/demo-studio/projectState.mjs";

assert.deepEqual(parseCliArguments(["new", "ride-one", "--source", "/tmp/a ride's file.mp4", "--route", "slug"]), {
  positional: ["new", "ride-one"],
  options: { source: "/tmp/a ride's file.mp4", route: "slug" },
});
assert.throws(() => parseCliArguments(["status", "--wat"]), /unknown option/);
assert.throws(() => parseCliArguments(["status", "--project"]), /requires a value/);
assert.deepEqual(parseCliArguments(["configure", "source.gpsOffsetSeconds", "-1.3", "--reason", "bridge"]), { positional: ["configure", "source.gpsOffsetSeconds", "-1.3"], options: { reason: "bridge" } });
assert.throws(() => assertNarrowDemoPath("/"), /unsafe/);
assert.throws(() => assertNarrowDemoPath(process.cwd()), /unsafe/);

const temporary = await mkdtemp(join(tmpdir(), "demo-cli-"));
await mkdir(join(temporary, "nested"));
const path = join(temporary, "nested", "state.json");
await writeJsonAtomic(path, { unicode: "מסלול", quote: "a'b" });
const parsed = JSON.parse(await (await import("node:fs/promises")).readFile(path, "utf8"));
assert.equal(parsed.unicode, "מסלול");

const recovery = join(temporary, "recovery");
await mkdir(recovery);
const recoveryProject = createDemoProject({ id: "recovery-one", sourcePath: "/tmp/ride.mp4", routeValue: "route" });
recoveryProject.revision = 1;
await writeJsonAtomic(join(recovery, "project.json"), recoveryProject);
await (await import("node:fs/promises")).writeFile(join(recovery, "history.jsonl"), "{partial");
await writeJsonAtomic(join(recovery, ".pending-history.json"), { id: "recovery-one:r1", revision: 1, type: "configure" });
await readProject(join(recovery, "project.json"));
const recoveredHistory = (await (await import("node:fs/promises")).readFile(join(recovery, "history.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
assert.equal(recoveredHistory[0].id, "recovery-one:r1");

const launcherId = `launcher-${process.pid}`;
const launcherWorkspace = await createProjectWorkspace({ id: launcherId, sourcePath: "/tmp/ride.mp4", routeValue: "route" });
const launcher = await readFile(join(launcherWorkspace.directory, "studio"), "utf8");
assert.ok(launcher.indexOf(`process.chdir(${JSON.stringify(DEMO_REPOSITORY_ROOT)})`) < launcher.indexOf("await import"));

console.log("demo CLI tests passed");
