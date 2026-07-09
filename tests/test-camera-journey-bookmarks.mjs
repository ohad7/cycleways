import assert from "node:assert/strict";
import { runScenario } from "@cycleways/core/navigation/scenarioRunner.js";
import { scenarios } from "@cycleways/core/navigation/scenarios/index.js";
import { resolveScenario } from "@cycleways/core/navigation/scenarios/resolve.js";

const journeys = scenarios.filter((scenario) => scenario.journeySchemaVersion === 1);
assert.equal(journeys.length, 4);

for (const scenario of journeys) {
  const resolved = resolveScenario(scenario);
  const { timeline } = runScenario(resolved);
  for (const bookmark of resolved.bookmarks) {
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
