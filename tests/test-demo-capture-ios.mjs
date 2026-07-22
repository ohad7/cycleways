import assert from "node:assert/strict";
import { bootedSimulators, simulatorCaptureCommands } from "../scripts/demo-studio/captureIos.mjs";

const devices = bootedSimulators({ devices: {
  "iOS 20": [
    { name: "iPhone", udid: "one", state: "Booted", isAvailable: true },
    { name: "Other", udid: "two", state: "Shutdown", isAvailable: true },
  ],
} });
assert.deepEqual(devices.map(device => device.udid), ["one"]);
const commands = simulatorCaptureCommands({ udid: "one", deepLink: "cycleways://build?demo=x", output: "/tmp/a movie.mov" });
assert.deepEqual(commands.openUrl, ["xcrun", ["simctl", "openurl", "one", "cycleways://build?demo=x"]]);
assert.deepEqual(commands.record, ["xcrun", ["simctl", "io", "one", "recordVideo", "--codec=h264", "/tmp/a movie.mov"]]);

console.log("demo iOS capture tests passed");
