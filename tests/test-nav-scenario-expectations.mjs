// tests/test-nav-scenario-expectations.mjs
import assert from "node:assert/strict";
import { evaluateExpectations } from "@cycleways/core/navigation/scenarioExpectations.js";

// Minimal hand-built timeline entries (only the fields the evaluator reads).
function entry(overrides = {}) {
  return {
    status: "navigating",
    justAcquired: false,
    progressMeters: 0,
    activeCueType: null,
    suggestionStatus: "idle",
    rejoinTargetProgressMeters: null,
    rejoinDistanceToRouteMeters: null,
    connectorResult: null,
    haptic: null,
    wrongWay: false,
    cameraStage: "ride",
    cardMode: "status",
    chipText: null,
    voiceText: null,
    presentation: { cueText: "המשך במסלול", statusText: "", guidanceText: "" },
    ...overrides,
  };
}

const timeline = [
  entry({ status: "approaching", progressMeters: 0, presentation: { cueText: "", statusText: "בדרך למסלול", guidanceText: "" } }),
  entry({ justAcquired: true, progressMeters: 10 }),
  entry({ progressMeters: 200 }),
  entry({
    status: "off-route",
    offRoute: true,
    progressMeters: 300,
    rejoinTargetProgressMeters: 300,
    rejoinDistanceToRouteMeters: 75,
    haptic: "heavy",
  }),
  entry({
    status: "off-route",
    offRoute: true,
    progressMeters: 300,
    rejoinTargetProgressMeters: 520,
    rejoinDistanceToRouteMeters: 50,
    suggestionStatus: "ready",
  }),
  entry({ progressMeters: 400, wrongWay: true }),
  entry({ progressMeters: 450, wrongWay: false }),
  entry({
    progressMeters: 500,
    voiceText: "בעוד 100 מטרים, פנה שמאלה אל שביל הצפון",
    presentation: { cueText: "פנה שמאלה אל שביל הצפון", statusText: "", guidanceText: "" },
  }),
  entry({ progressMeters: 900, activeCueType: "arrive", presentation: { cueText: "הגעת ליעד", statusText: "", guidanceText: "" } }),
];

// All-passing set.
{
  const result = evaluateExpectations(
    [
      { type: "status", value: "approaching" },
      { type: "status", value: "off-route", betweenMeters: [250, 350] },
      { type: "acquired" },
      { type: "banner", match: "פנה שמאלה", afterMeters: 400, beforeMeters: 600 },
      { type: "banner", match: "בדרך למסלול", field: "statusText" },
      { type: "rerouted", withinFixesOfOffRoute: 2 },
      { type: "rejoin-target", position: "first", betweenMeters: [250, 350] },
      { type: "rejoin-target", position: "last", betweenMeters: [500, 550] },
      { type: "rejoin-target-advances", byMeters: 200 },
      { type: "arrived" },
      { type: "haptic", kind: "heavy" },
      { type: "progress-at-least", meters: 800 },
      { type: "wrong-way" },
      { type: "wrong-way-resolved", final: true },
      { type: "voice", match: "פנה שמאלה", count: 1 },
    ],
    timeline,
  );
  assert.deepEqual(result.failures, []);
  assert.equal(result.passed, true);
}

// Failing / never / edge cases.
{
  const result = evaluateExpectations(
    [
      { type: "status", value: "paused" }, // never happened
      { type: "status", value: "off-route", never: true }, // did happen
      { type: "status", value: "off-route", betweenMeters: [400, 500] }, // wrong window
      { type: "banner", match: "פנה ימינה" }, // wrong turn direction
      { type: "banner", match: "פנה שמאלה", beforeMeters: 400 }, // too late
      { type: "haptic", kind: "medium" }, // never fired
      { type: "suggestionFailed" }, // connector never failed
      { type: "rejoin-target", position: "last", betweenMeters: [250, 350] }, // target advanced past this
      { type: "rejoin-target-advances", byMeters: 300 }, // not far enough
      { type: "progress-at-least", meters: 2000 },
      { type: "wrong-way", never: true }, // did fire at 400 m
      { type: "wrong-way-resolved", final: true }, // did resolve, so this one passes
      { type: "voice", match: "פנה ימינה" }, // never spoken
      { type: "bogus-type" },
    ],
    timeline,
  );
  assert.equal(result.passed, false);
  assert.equal(result.failures.length, 13, JSON.stringify(result.failures, null, 1));
}

// voice: supports substring matching, exact counts, bounds, progress windows,
// and explicit absence checks against the utterances accepted by the planner.
{
  const spoken = [
    entry({ progressMeters: 100, voiceText: "פנה שמאלה ומיד ימינה" }),
    entry({ progressMeters: 110, voiceText: null }),
    entry({ progressMeters: 200, voiceText: "הגעת ליעד" }),
  ];
  assert.equal(
    evaluateExpectations(
      [
        { type: "voice", match: "ומיד ימינה", count: 1, afterMeters: 50, beforeMeters: 150 },
        { type: "voice", match: "פנה ימינה אל שביל המזרח", never: true },
        { type: "voice", match: "הגעת", atLeast: 1, atMost: 1 },
      ],
      spoken,
    ).passed,
    true,
  );
  assert.equal(
    evaluateExpectations([{ type: "voice", match: "פנה", count: 2 }], spoken).passed,
    false,
  );
  assert.equal(
    evaluateExpectations(
      [{ type: "voice", match: "ומיד", afterMeters: 150 }],
      spoken,
    ).passed,
    false,
  );
}

// wrong-way that never fired: bare expectation fails, never-form passes.
{
  const clean = [entry(), entry({ progressMeters: 100 })];
  assert.equal(evaluateExpectations([{ type: "wrong-way" }], clean).passed, false);
  assert.equal(evaluateExpectations([{ type: "wrong-way-resolved" }], clean).passed, false);
  assert.equal(
    evaluateExpectations([{ type: "wrong-way", never: true }], clean).passed,
    true,
  );
}

// wrong-way without recovery: resolution expectation fails.
{
  const unresolved = [entry(), entry({ progressMeters: 100, wrongWay: true })];
  assert.equal(
    evaluateExpectations([{ type: "wrong-way-resolved" }], unresolved).passed,
    false,
  );
}

// wrong-way that briefly resolves and then returns can be required to end clean.
{
  const reappeared = [
    entry(),
    entry({ progressMeters: 100, wrongWay: true }),
    entry({ progressMeters: 105, wrongWay: false }),
    entry({ progressMeters: 110, wrongWay: true }),
  ];
  assert.equal(
    evaluateExpectations([{ type: "wrong-way-resolved" }], reappeared).passed,
    true,
  );
  assert.equal(
    evaluateExpectations([{ type: "wrong-way-resolved", final: true }], reappeared)
      .passed,
    false,
  );
}

// camera-rotations: bounds how often the governed map heading may change,
// optionally only while in a given status (0 while off-route = stable frame).
{
  const ride = [
    entry({ cameraHeadingDeg: 90 }),
    entry({ cameraHeadingDeg: 90 }),
    entry({ status: "off-route", cameraHeadingDeg: 90 }),
    entry({ status: "off-route", cameraHeadingDeg: 120 }), // rotation while off-route
    entry({ cameraHeadingDeg: 120 }),
    entry({ cameraHeadingDeg: 0 }), // rotation while navigating (the corner)
  ];
  assert.equal(
    evaluateExpectations([{ type: "camera-rotations", atMost: 2 }], ride).passed,
    true,
    "two rotations within a budget of two",
  );
  const over = evaluateExpectations([{ type: "camera-rotations", atMost: 1 }], ride);
  assert.equal(over.passed, false);
  assert.match(over.failures[0], /2 camera rotation/);
  const offRoute = evaluateExpectations(
    [{ type: "camera-rotations", atMost: 0, during: "off-route" }],
    ride,
  );
  assert.equal(offRoute.passed, false, "the off-route rotation is counted");
  assert.equal(
    evaluateExpectations(
      [{ type: "camera-rotations", atMost: 1, during: "off-route" }],
      ride,
    ).passed,
    true,
  );
  // Entries without a finite camera heading are ignored, not rotations.
  assert.equal(
    evaluateExpectations(
      [{ type: "camera-rotations", atMost: 0 }],
      [entry({ cameraHeadingDeg: null }), entry({ cameraHeadingDeg: 90 }), entry({ cameraHeadingDeg: 90 })],
    ).passed,
    true,
  );
}

// rerouted without any off-route entry fails cleanly.
{
  const result = evaluateExpectations([{ type: "rerouted" }], [entry()]);
  assert.equal(result.passed, false);
  assert.match(result.failures[0], /never went off-route/);
}

// Rejoin target expectations fail clearly when no target or no advance exists.
{
  const noTarget = [entry(), entry({ status: "off-route", offRoute: true })];
  assert.equal(evaluateExpectations([{ type: "rejoin-target" }], noTarget).passed, false);
  assert.equal(
    evaluateExpectations([{ type: "rejoin-target-advances", byMeters: 10 }], noTarget)
      .passed,
    false,
  );
  const pinned = [
    entry({ status: "off-route", rejoinTargetProgressMeters: 300 }),
    entry({ status: "off-route", rejoinTargetProgressMeters: 300 }),
  ];
  assert.equal(
    evaluateExpectations([{ type: "rejoin-target-advances", byMeters: 10 }], pinned)
      .passed,
    false,
  );
  const regressed = [
    entry({ status: "off-route", rejoinTargetProgressMeters: 300 }),
    entry({ status: "off-route", rejoinTargetProgressMeters: 550 }),
    entry({ status: "off-route", rejoinTargetProgressMeters: 320 }),
  ];
  assert.equal(
    evaluateExpectations([{ type: "rejoin-target-advances", byMeters: 100 }], regressed)
      .passed,
    false,
    "target advance expectation rejects regressions",
  );
}

// suggestionFailed passes when a connector failure surfaced.
{
  const result = evaluateExpectations(
    [{ type: "suggestionFailed" }],
    [entry({ connectorResult: "failed" })],
  );
  assert.equal(result.passed, true);
}

// Empty expectation list passes (smoke-only scenario).
assert.equal(evaluateExpectations([], timeline).passed, true);

// camera-stage, card-mode and chip expectations.
{
  const ride = [
    entry({ cameraStage: "approach", cardMode: "approach", chipText: "המסלול המוצע", progressMeters: 0 }),
    entry({ progressMeters: 100 }),
    entry({ cameraStage: "pre-turn", cardMode: "cue", chipText: "דרך הפרדס · דרך עפר", progressMeters: 500 }),
    entry({ cameraStage: "arrived", cardMode: "arrived", progressMeters: 900 }),
  ];
  const pass = evaluateExpectations(
    [
      { type: "camera-stage", value: "approach" },
      { type: "camera-stage", value: "pre-turn", betweenMeters: [450, 550] },
      { type: "camera-stage", value: "arrived" },
      { type: "camera-stage", value: "off-route", never: true },
      { type: "card-mode", value: "approach" },
      { type: "card-mode", value: "cue", betweenMeters: [450, 550] },
      { type: "card-mode", value: "arrived" },
      { type: "chip", match: "דרך הפרדס" },
      { type: "chip", match: "חזרה למסלול", never: true },
    ],
    ride,
  );
  assert.deepEqual(pass.failures, []);
  const fail = evaluateExpectations(
    [
      { type: "camera-stage", value: "off-route" },
      { type: "camera-stage", value: "pre-turn", betweenMeters: [0, 100] },
      { type: "card-mode", value: "off-route" },
      { type: "chip", match: "לא קיים" },
      { type: "chip", match: "המסלול המוצע", never: true },
    ],
    ride,
  );
  assert.equal(fail.failures.length, 5, JSON.stringify(fail.failures, null, 1));
}

console.log("nav scenario expectations tests passed");
