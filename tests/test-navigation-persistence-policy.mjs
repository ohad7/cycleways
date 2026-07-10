import assert from "node:assert/strict";
import {
  createNavigationEventClock,
  createNavigationPersistenceCoordinator,
  isNavigationSnapshotFresh,
  shouldPersistNavigationSnapshot,
} from "@cycleways/core/navigation/persistencePolicy.js";

assert.equal(
  shouldPersistNavigationSnapshot({ status: "navigating", nowMs: 1000 }),
  true,
  "no history -> persist",
);
assert.equal(
  shouldPersistNavigationSnapshot({
    lastPersistAtMs: null,
    lastStatus: "navigating",
    status: "navigating",
    nowMs: 1000,
  }),
  true,
  "missing timestamp persists even when status is unchanged",
);
assert.equal(
  shouldPersistNavigationSnapshot({
    lastPersistAtMs: 1000,
    lastStatus: "navigating",
    status: "off-route",
    nowMs: 1500,
  }),
  true,
  "status transition -> persist",
);
assert.equal(
  shouldPersistNavigationSnapshot({
    lastPersistAtMs: 1000,
    lastStatus: "navigating",
    status: "navigating",
    hasCueEvent: true,
    nowMs: 1500,
  }),
  true,
  "cue event -> persist",
);
assert.equal(
  shouldPersistNavigationSnapshot({
    lastPersistAtMs: 1000,
    lastStatus: "navigating",
    status: "navigating",
    nowMs: 5000,
  }),
  false,
  "steady state inside interval -> skip",
);
assert.equal(
  shouldPersistNavigationSnapshot({
    lastPersistAtMs: 1000,
    lastStatus: "navigating",
    status: "navigating",
    nowMs: 11_001,
  }),
  true,
  "interval elapsed -> persist",
);

assert.equal(
  isNavigationSnapshotFresh({
    savedAtMs: 1_000_000,
    nowMs: 1_001_000,
    staleAfterMs: 10_000,
  }),
  true,
  "freshness uses the wall-clock save time",
);
assert.equal(
  isNavigationSnapshotFresh({
    savedAtMs: 1_000_000,
    nowMs: 1_020_000,
    staleAfterMs: 10_000,
  }),
  false,
  "old saves expire",
);

{
  let wallMs = 1_000_000;
  const clock = createNavigationEventClock({ now: () => wallMs });
  assert.deepEqual(clock.timestamp(), { nowMs: wallMs, resetPolicy: false });
  assert.deepEqual(
    clock.timestamp({ timestamp: 1000 }),
    { nowMs: 1000, resetPolicy: true },
    "the first fix switches clock domains and invalidates wall-clock history",
  );
  wallMs += 50_000;
  assert.deepEqual(
    clock.timestamp(),
    { nowMs: 1000, resetPolicy: false },
    "non-fix actions stay on the session fix clock",
  );
  assert.deepEqual(clock.timestamp({ timestamp: 11_001 }), {
    nowMs: 11_001,
    resetPolicy: false,
  });
}

{
  const writes = [];
  const releases = [];
  let activeWrites = 0;
  let maxActiveWrites = 0;
  const coordinator = createNavigationPersistenceCoordinator(async (value) => {
    writes.push(value);
    activeWrites += 1;
    maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
    const succeeded = await new Promise((resolve) => releases.push(resolve));
    activeWrites -= 1;
    return succeeded;
  });

  const first = coordinator.request("first");
  const superseded = coordinator.request("superseded");
  const latest = coordinator.request("latest");
  await Promise.resolve();
  assert.deepEqual(writes, ["first"], "only one write starts at a time");

  releases.shift()(true);
  assert.equal(await first, true);
  await Promise.resolve();
  assert.deepEqual(writes, ["first", "latest"], "queued writes coalesce to latest");
  assert.equal(maxActiveWrites, 1, "writes never overlap");

  releases.shift()(false);
  assert.equal(await superseded, false);
  assert.equal(await latest, false);

  const retry = coordinator.request("retry");
  await Promise.resolve();
  assert.deepEqual(writes, ["first", "latest", "retry"], "failure does not block retry");
  releases.shift()(true);
  assert.equal(await retry, true);
}

console.log("test-navigation-persistence-policy ok");
