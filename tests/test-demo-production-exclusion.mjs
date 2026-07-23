import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const metro = await readFile("apps/mobile/metro.config.js", "utf8");
for (const module of ["demoCaptureClient", "demoCaptureLaunch", "mediaClockPlaybackSource", "demoCaptureEvents"]) {
  assert.match(metro, new RegExp(module), `${module} must be production-replaced`);
}
assert.match(metro, /emptyDemoCapture/);

const app = await readFile("apps/mobile/App.js", "utf8");
assert.match(app, /Open debugger to view warnings/, "the React Native debugger warning must not enter a capture");
assert.match(app, /LogBox\.ignoreAllLogs\(true\)/, "capture mode must hide non-fatal LogBox notifications");
assert.match(app, /LogBox\.clearAllLogs\(\)/, "capture mode must dismiss warning notifications raised before the deep link was handled");
const captureSession = await readFile("apps/mobile/src/navigation/useDemoCaptureSession.js", "utf8");
assert.match(captureSession, /SYNC_FLASH_DURATION_MS\s*=\s*1500/, "the sync marker must survive React rendering and recorder startup");
const captureSlate = await readFile("apps/mobile/src/planner/DevDemoCaptureSlate.jsx", "utf8");
assert.match(captureSlate, /<Modal visible/, "the sync marker must render above the native Mapbox surface");

console.log("demo production exclusion tests passed");
