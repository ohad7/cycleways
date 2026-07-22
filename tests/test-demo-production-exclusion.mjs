import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const metro = await readFile("apps/mobile/metro.config.js", "utf8");
for (const module of ["demoCaptureClient", "demoCaptureLaunch", "mediaClockPlaybackSource", "demoCaptureEvents"]) {
  assert.match(metro, new RegExp(module), `${module} must be production-replaced`);
}
assert.match(metro, /emptyDemoCapture/);

console.log("demo production exclusion tests passed");
