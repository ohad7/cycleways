import assert from "node:assert/strict";
import {
  availableSimulators,
  bootedSimulators,
  chooseSimulator,
  ensureCycleWaysInstalled,
  ensureSimulatorReady,
  relaunchSimulatorApp,
  simulatorCaptureCommands,
} from "../scripts/demo-studio/captureIos.mjs";

const devices = bootedSimulators({ devices: {
  "iOS 20": [
    { name: "iPhone", udid: "one", state: "Booted", isAvailable: true },
    { name: "Other", udid: "two", state: "Shutdown", isAvailable: true },
  ],
} });
assert.deepEqual(devices.map(device => device.udid), ["one"]);
assert.deepEqual(availableSimulators({ devices: { runtime: [
  { name: "Preferred", udid: "preferred", state: "Shutdown", isAvailable: true },
  { name: "Old", udid: "old", state: "Shutdown", isAvailable: false },
] } }).map((device) => device.udid), ["preferred"]);
assert.equal(chooseSimulator({ devices: { runtime: [
  { name: "Other", udid: "other", state: "Booted", isAvailable: true },
  { name: "Preferred", udid: "preferred", state: "Shutdown", isAvailable: true },
] } }, "Preferred").udid, "other", "an already booted Simulator avoids an unnecessary second boot");
const bootCalls = [];
const booted = await ensureSimulatorReady({ devices: { runtime: [
  { name: "Preferred", udid: "preferred", state: "Shutdown", isAvailable: true },
] } }, "Preferred", { run: async (...args) => { bootCalls.push(args); return { stdout: "" }; } });
assert.equal(booted.udid, "preferred");
assert.deepEqual(bootCalls, [
  ["xcrun", ["simctl", "boot", "preferred"]],
  ["xcrun", ["simctl", "bootstatus", "preferred", "-b"]],
]);
const commands = simulatorCaptureCommands({ udid: "one", deepLink: "cycleways://build?demo=x", output: "/tmp/a movie.mov" });
assert.deepEqual(commands.appContainer, ["xcrun", ["simctl", "get_app_container", "one", "app.cycleways.mobile", "app"]]);
assert.deepEqual(commands.terminate, ["xcrun", ["simctl", "terminate", "one", "app.cycleways.mobile"]]);
assert.deepEqual(commands.openUrl, ["xcrun", ["simctl", "openurl", "one", "cycleways://build?demo=x"]]);
assert.deepEqual(commands.record, ["xcrun", ["simctl", "io", "one", "recordVideo", "--codec=h264", "/tmp/a movie.mov"]]);

const calls = [];
await relaunchSimulatorApp(commands, {
  settleMs: 0,
  run: async (...command) => { calls.push(command); return { stdout: "" }; },
});
assert.deepEqual(calls, [commands.appContainer, commands.terminate, commands.openUrl]);

const stoppedCalls = [];
await relaunchSimulatorApp(commands, {
  settleMs: 0,
  run: async (...command) => {
    stoppedCalls.push(command);
    if (command[1]?.[1] === "terminate") throw new Error("No such process");
    return { stdout: "" };
  },
});
assert.deepEqual(stoppedCalls, [commands.appContainer, commands.terminate, commands.openUrl], "a stopped app is still cold-launched");

await assert.rejects(
  relaunchSimulatorApp(commands, {
    settleMs: 0,
    run: async (...command) => {
      if (command[1]?.[1] === "get_app_container") throw new Error("container missing");
      return { stdout: "" };
    },
  }),
  /not installed.*mobile:ios/,
);

const installCalls = [];
await ensureCycleWaysInstalled("preferred", {
  run: async (...args) => {
    installCalls.push(args);
    if (installCalls.length === 1) throw new Error("not installed");
    return { stdout: "" };
  },
});
assert.equal(installCalls[1][0], "npm");
assert.deepEqual(installCalls[1][1].slice(0, 3), ["run", "mobile:ios", "--"]);

console.log("demo iOS capture tests passed");
