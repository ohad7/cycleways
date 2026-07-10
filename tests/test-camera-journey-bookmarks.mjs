import assert from "node:assert/strict";
import {
  createRidePlan,
  ridePlanNeedsConnectorPreview,
  ridePlanNeedsDirectApproachPreview,
} from "@cycleways/core/navigation/ridePlan.js";
import { getRideIntroPresentation } from "@cycleways/core/navigation/rideIntroPresentation.js";
import { runScenario } from "@cycleways/core/navigation/scenarioRunner.js";
import { scenarios } from "@cycleways/core/navigation/scenarios/index.js";
import { resolveScenario } from "@cycleways/core/navigation/scenarios/resolve.js";

const journeys = scenarios.filter((scenario) => scenario.entryMode === "ride-intro");
assert.deepEqual(
  journeys.map((scenario) => scenario.name),
  ["journey-guided-approach", "journey-too-far", "journey-ride-recovery"],
);

const tooFar = resolveScenario(
  journeys.find((scenario) => scenario.name === "journey-too-far"),
);
const tooFarIntroPlan = createRidePlan(
  tooFar.navigationRoute,
  {
    direction: "forward",
    startMode: "official",
    selectedPoint: null,
    startProgressMeters: null,
  },
  tooFar.fixes[0],
  tooFar.fixes[0].timestamp,
);
assert.ok(
  tooFarIntroPlan.distanceToStartMeters > 15_000 &&
    tooFarIntroPlan.distanceToStartMeters < 17_000,
  `too-far Ride Intro must use the journey fix, got ${tooFarIntroPlan.distanceToStartMeters} m`,
);
assert.equal(
  getRideIntroPresentation(tooFarIntroPlan, "ready").headline,
  "תחילת המסלול במרחק 15.9 ק״מ",
);
assert.equal(ridePlanNeedsConnectorPreview(tooFarIntroPlan), false);
assert.equal(ridePlanNeedsDirectApproachPreview(tooFarIntroPlan), true);

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
  if (scenario.name === "journey-guided-approach") {
    const joinIndex = timeline.findIndex((entry) => entry.cameraStage === "join-route");
    assert.ok(joinIndex > 0, "guided journey reaches the route seam");
    assert.equal(
      timeline.slice(0, joinIndex).some((entry) => /יעד/.test(entry.voiceText || "")),
      false,
      "guided approach never announces destination arrival before the seam",
    );
    assert.equal(
      timeline.filter((entry) => /הגעת למסלול/.test(entry.voiceText || "")).length,
      1,
      "guided approach announces the route join exactly once",
    );
  }
}

console.log("camera journey bookmark tests passed");
