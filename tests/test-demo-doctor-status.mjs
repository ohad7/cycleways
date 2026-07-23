import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDemoProject } from "../scripts/demo-studio/projectState.mjs";
import { formatDoctorHuman, terminalColorsEnabled } from "../scripts/demo-studio/cli.mjs";
import { runDoctor } from "../scripts/demo-studio/doctor.mjs";
import { formatProjectStatus } from "../scripts/demo-studio/status.mjs";

const project = createDemoProject({ id: "doctor-test", sourcePath: "/missing.mp4", routeValue: "route" });
const formatted = formatProjectStatus(project);
assert.match(formatted.text, /PROJECT  doctor-test/);
assert.match(formatted.text, /NEXT/);
assert.equal(formatted.status.publishable, false);

const directory = await mkdtemp(join(tmpdir(), "demo-doctor-"));
const source = join(directory, "ride.mp4");
await writeFile(source, "fixture");
const readyProject = createDemoProject({ id: "doctor-ready", sourcePath: source, routeValue: "route" });
const ready = await runDoctor({
  projectPath: join(directory, "project.json"),
  project: readyProject,
  platform: "darwin",
  tool: async () => ({ available: true, version: "test-version" }),
  deps: {
    mapTokenReady: true,
    spawnChecked: async (executable) => executable === "xcrun"
      ? { stdout: JSON.stringify({ devices: { runtime: [{ state: "Booted", isAvailable: true }] } }) }
      : { stdout: "Hebrew test voice" },
  },
});
assert.deepEqual(ready.capabilities, { inspect: true, capture: true, render: true });
const colored = formatDoctorHuman(ready, { next: "./studio inspect", color: true });
assert.match(colored, /\u001b\[32mready/);
assert.match(colored, /\u001b\[1m\u001b\[32mRESULT/);
assert.match(colored, /\u001b\[1m\u001b\[36mNEXT/);
assert.doesNotMatch(formatDoctorHuman(ready, { next: "./studio inspect" }), /\u001b\[/);
assert.equal(terminalColorsEnabled({ isTTY: true, env: {} }), true);
assert.equal(terminalColorsEnabled({ isTTY: true, env: { NO_COLOR: "" } }), false);
assert.equal(terminalColorsEnabled({ isTTY: false, env: { FORCE_COLOR: "1" } }), true);
assert.equal(terminalColorsEnabled({ isTTY: true, env: { FORCE_COLOR: "0" } }), false);

const noSimulator = await runDoctor({
  projectPath: join(directory, "project.json"),
  project: readyProject,
  platform: "darwin",
  tool: async () => ({ available: true, version: "test-version" }),
  deps: {
    mapTokenReady: true,
    spawnChecked: async (executable) => executable === "xcrun"
      ? { stdout: JSON.stringify({ devices: { runtime: [] } }) }
      : { stdout: "Hebrew test voice" },
  },
});
assert.equal(noSimulator.capabilities.inspect, true);
assert.equal(noSimulator.capabilities.capture, true, "capture can boot the configured Simulator");
assert.match(noSimulator.checks.find((check) => check.name === "simulator").detail, /boot.*automatically/);
assert.equal(noSimulator.capabilities.render, true);

console.log("demo doctor/status tests passed");
