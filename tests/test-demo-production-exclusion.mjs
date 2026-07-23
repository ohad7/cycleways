import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const {
  demoCaptureModules,
  devHarnessModules,
  productionDevStubFor,
} = require("../apps/mobile/metro-production-stubs.cjs");

for (const moduleName of demoCaptureModules) {
  assert.equal(
    productionDevStubFor(moduleName),
    "emptyDemoCapture.js",
    `${moduleName} must retain the empty demo-capture API in production`,
  );
}
for (const moduleName of devHarnessModules) {
  assert.ok(
    productionDevStubFor(moduleName),
    `${moduleName} must be production-replaced`,
  );
}
assert.equal(
  productionDevStubFor("../navigation/useDemoCaptureSession.js"),
  "emptyDemoCapture.js",
  "BuildScreen's demo-capture hook must remain callable in production",
);
assert.equal(
  productionDevStubFor("../navigation/notADevHarness.js"),
  null,
  "ordinary navigation modules must not be replaced",
);
const emptyDemoCapture = await import(
  "../apps/mobile/src/dev/emptyDemoCapture.js"
);
assert.equal(
  typeof emptyDemoCapture.useDemoCaptureSession,
  "function",
  "the production replacement must preserve BuildScreen's hook API",
);
assert.deepEqual(
  emptyDemoCapture.useDemoCaptureSession(),
  {
    active: false,
    phase: "inactive",
    scenario: null,
    source: null,
    error: null,
    eventSink: null,
  },
  "the production hook must return an inactive capture session",
);

const app = await readFile("apps/mobile/App.js", "utf8");
assert.match(app, /Open debugger to view warnings/, "the React Native debugger warning must not enter a capture");
assert.match(app, /LogBox\.ignoreAllLogs\(true\)/, "capture mode must hide non-fatal LogBox notifications");
assert.match(app, /LogBox\.clearAllLogs\(\)/, "capture mode must dismiss warning notifications raised before the deep link was handled");
const captureSession = await readFile("apps/mobile/src/navigation/useDemoCaptureSession.js", "utf8");
assert.match(captureSession, /SYNC_FLASH_DURATION_MS\s*=\s*1500/, "the sync marker must survive React rendering and recorder startup");
const captureSlate = await readFile("apps/mobile/src/planner/DevDemoCaptureSlate.jsx", "utf8");
assert.match(captureSlate, /<Modal visible/, "the sync marker must render above the native Mapbox surface");

console.log("demo production exclusion tests passed");
