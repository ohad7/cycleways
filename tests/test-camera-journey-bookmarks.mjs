import assert from "node:assert/strict";
import { runScenario } from "@cycleways/core/navigation/scenarioRunner.js";
import { scenarios } from "@cycleways/core/navigation/scenarios/index.js";
import { resolveScenario } from "@cycleways/core/navigation/scenarios/resolve.js";

const journeys = scenarios.filter((scenario) => scenario.entryMode === "ride-intro");
assert.equal(journeys.length, 4);

for (const scenario of journeys) {
  const resolved = resolveScenario(scenario);
  const { timeline } = runScenario(resolved);
  assert.equal(resolved.journeySchemaVersion, 2);
  assert.equal(resolved.entryMode, "ride-intro");
  for (const bookmark of resolved.bookmarks) {
    if (bookmark.phase === "pre-start") {
      assert.equal(bookmark.startAction, "hold");
      assert.ok(
        bookmark.expectedStage === "intro-start-facing" ||
          bookmark.expectedStage === "intro-overhead",
      );
      continue;
    }
    assert.equal(bookmark.startAction, "require-confirm");
    const entries = timeline.filter(
      (entry) => entry.timestamp === bookmark.targetTimestamp,
    );
    assert.ok(entries.length > 0, `${scenario.name}/${bookmark.id}: target timestamp exists`);
    assert.ok(
      entries.some((entry) => entry.cameraStage === bookmark.expectedStage),
      `${scenario.name}/${bookmark.id}: expected ${bookmark.expectedStage}, got ${entries.map((e) => e.cameraStage).join(",")}`,
    );
  }
}

console.log("camera journey bookmark tests passed");
