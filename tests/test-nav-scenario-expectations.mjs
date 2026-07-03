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
    connectorResult: null,
    haptic: null,
    presentation: { cueText: "המשך במסלול", statusText: "", guidanceText: "" },
    ...overrides,
  };
}

const timeline = [
  entry({ status: "approaching", progressMeters: 0, presentation: { cueText: "", statusText: "בדרך למסלול", guidanceText: "" } }),
  entry({ justAcquired: true, progressMeters: 10 }),
  entry({ progressMeters: 200 }),
  entry({ status: "off-route", offRoute: true, progressMeters: 300, haptic: "heavy" }),
  entry({ status: "off-route", offRoute: true, progressMeters: 300, suggestionStatus: "ready" }),
  entry({ progressMeters: 500, presentation: { cueText: "פנה שמאלה אל שביל הצפון", statusText: "", guidanceText: "" } }),
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
      { type: "arrived" },
      { type: "haptic", kind: "heavy" },
      { type: "progress-at-least", meters: 800 },
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
      { type: "progress-at-least", meters: 2000 },
      { type: "bogus-type" },
    ],
    timeline,
  );
  assert.equal(result.passed, false);
  assert.equal(result.failures.length, 9, JSON.stringify(result.failures, null, 1));
}

// rerouted without any off-route entry fails cleanly.
{
  const result = evaluateExpectations([{ type: "rerouted" }], [entry()]);
  assert.equal(result.passed, false);
  assert.match(result.failures[0], /never went off-route/);
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

console.log("nav scenario expectations tests passed");
