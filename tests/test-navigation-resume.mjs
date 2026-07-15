import assert from "node:assert/strict";
import { createNavigationResumeCoordinator } from "../apps/mobile/src/navigation/navigationResume.js";

function harness({ status = "navigating", backgroundLocation = false, backgroundStarts = true } = {}) {
  const events = [];
  const record = {
    sessionId: "s1",
    navigationRoute: { id: "r1" },
    sessionSnapshot: { version: 1 },
    settings: { intersectionCrossingGuidanceEnabled: false },
  };
  const session = { getState: () => ({ status, backgroundLocation }) };
  const coordinator = createNavigationResumeCoordinator({
    loadRecord: async () => record,
    createSession: (_route, options) => {
      events.push(["create", options]);
      return session;
    },
    installSession: () => events.push(["install"]),
    beginWatch: () => events.push(["watch"]),
    startBackgroundUpdates: async () => {
      events.push(["start-background"]);
      return backgroundStarts;
    },
    stopBackgroundUpdates: async () => events.push(["stop-background"]),
    activateKeepAwake: async () => events.push(["awake-on"]),
    deactivateKeepAwake: async () => events.push(["awake-off"]),
    clearPersisted: async () => events.push(["clear"]),
    markForegroundOnly: () => events.push(["foreground-only"]),
    setBackgroundActive: (value) => events.push(["background-active", value]),
    recordSessionOptions: (savedRecord) => ({
      intersectionCrossingGuidanceEnabled:
        savedRecord.settings?.intersectionCrossingGuidanceEnabled !== false,
    }),
  });
  return { coordinator, events, record };
}

{
  const { coordinator, events, record } = harness();
  const result = await coordinator.activate({
    navigationRoute: { id: "r1" },
    sessionId: "s1",
    sessionOptions: { intersectionCrossingGuidanceEnabled: true },
  });
  assert.equal(result.status, "restored");
  assert.ok(events.findIndex(([name]) => name === "install") < events.findIndex(([name]) => name === "watch"));
  assert.ok(events.some(([name]) => name === "awake-on"));
  assert.ok(!events.some(([name]) => name === "start"), "normal start is never dispatched");
  const createOptions = events.find(([name]) => name === "create")?.[1];
  assert.equal(
    createOptions?.intersectionCrossingGuidanceEnabled,
    false,
    "crash resume restores the ride's immutable crossing-guidance preference",
  );
  assert.deepEqual(createOptions?.snapshot, record.sessionSnapshot);
}

{
  const { coordinator, events } = harness({ backgroundLocation: true });
  const first = coordinator.activate({ navigationRoute: { id: "r1" }, sessionId: "s1" });
  const second = coordinator.activate({ navigationRoute: { id: "r1" }, sessionId: "s1" });
  assert.equal(first, second);
  assert.equal((await first).backgroundActive, true);
  assert.ok(
    events.findIndex(([name]) => name === "install") <
      events.findIndex(([name]) => name === "start-background"),
    "restored state is installed before native services start",
  );
  assert.ok(events.some(([name]) => name === "start-background"));
  assert.ok(events.some(([name]) => name === "watch"));
}

{
  const { coordinator, events } = harness({ backgroundLocation: true, backgroundStarts: false });
  const result = await coordinator.activate({ navigationRoute: { id: "r1" }, sessionId: "s1" });
  assert.equal(result.backgroundActive, false);
  assert.ok(events.some(([name]) => name === "foreground-only"));
  assert.ok(events.some(([name]) => name === "awake-on"));
}

{
  const { coordinator, events } = harness({ status: "paused", backgroundLocation: true });
  const result = await coordinator.activate({ navigationRoute: { id: "r1" }, sessionId: "s1" });
  assert.equal(result.paused, true);
  assert.ok(!events.some(([name]) => name === "watch"));
  assert.ok(!events.some(([name]) => name === "start-background"));
}

for (const request of [
  { navigationRoute: { id: "wrong" }, sessionId: "s1" },
  { navigationRoute: { id: "r1" }, sessionId: "wrong" },
]) {
  const { coordinator, events } = harness();
  const result = await coordinator.activate(request);
  assert.equal(result.status, "failed");
  assert.ok(events.some(([name]) => name === "clear"));
  assert.ok(events.some(([name]) => name === "stop-background"));
  assert.ok(!events.some(([name]) => name === "watch"));
}

{
  const { coordinator, events } = harness({ status: "ended" });
  const result = await coordinator.activate({ navigationRoute: { id: "r1" }, sessionId: "s1" });
  assert.equal(result.status, "failed");
  assert.ok(events.some(([name]) => name === "clear"));
}

{
  const { coordinator, events } = harness({ status: "requesting-permission" });
  const result = await coordinator.activate({ navigationRoute: { id: "r1" }, sessionId: "s1" });
  assert.equal(result.status, "failed", "permission prompts are not active rides");
  assert.ok(!events.some(([name]) => name === "watch"));
}

console.log("navigation resume tests passed");
