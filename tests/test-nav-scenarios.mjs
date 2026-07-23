// tests/test-nav-scenarios.mjs — runs every registered nav scenario headlessly
// and checks its milestones. On failure, the full user-visible timeline is
// written to test-results/nav-scenarios/<name>.json (gitignored) so an agent
// can diagnose e.g. "banner flipped too early at entry 142" without a device.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { evaluateExpectations } from "@cycleways/core/navigation/scenarioExpectations.js";
import { runScenario } from "@cycleways/core/navigation/scenarioRunner.js";
import { getScenario, scenarios } from "@cycleways/core/navigation/scenarios/index.js";
import { resolveScenario } from "@cycleways/core/navigation/scenarios/resolve.js";

assert.ok(scenarios.length >= 7, "seed scenario set is registered");
assert.equal(getScenario("on-route-happy-path")?.name, "on-route-happy-path");
assert.equal(
  getScenario("compound-turn-left-right")?.name,
  "compound-turn-left-right",
);
assert.equal(
  getScenario("roundabouts-upper-galilee")?.name,
  "roundabouts-upper-galilee",
);
assert.equal(
  getScenario("roundabout-then-right-turn")?.name,
  "roundabout-then-right-turn",
);
assert.deepEqual(
  getScenario("roundabouts-upper-galilee").route.routeState.junctions
    .filter((junction) => junction.kind === "roundabout")
    .map((junction) => junction.roundaboutId),
  ["osm-ways:306636824", "osm-ways:323780427"],
);
assert.equal(getScenario("nope"), null);
assert.equal(
  new Set(scenarios.map((s) => s.name)).size,
  scenarios.length,
  "scenario names are unique",
);
assert.deepEqual(
  getScenario("sovev-beit-hillel-ride")?.route,
  { catalogSlug: "sovev-beit-hillel" },
  "the visual catalog ride resolves from the installed route rather than a fixture",
);

const ARTIFACT_DIR = "test-results/nav-scenarios";
let failedCount = 0;

for (const scenario of scenarios) {
  if (scenario.visualOnly === true) {
    console.log(`- ${scenario.name} (visual-only, skipped)`);
    continue;
  }
  const resolved = resolveScenario(scenario);
  const { timeline } = runScenario(resolved);
  const result = evaluateExpectations(resolved.expect, timeline);
  if (result.passed) {
    console.log(`✓ ${scenario.name} (${timeline.length} entries)`);
    continue;
  }
  failedCount += 1;
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const artifactPath = `${ARTIFACT_DIR}/${scenario.name}.json`;
  writeFileSync(
    artifactPath,
    JSON.stringify({ scenario: scenario.name, failures: result.failures, timeline }, null, 1),
  );
  console.error(`✗ ${scenario.name}`);
  for (const failure of result.failures) console.error(`    ${failure}`);
  console.error(`    timeline written to ${artifactPath}`);
}

if (failedCount > 0) {
  console.error(`${failedCount} nav scenario(s) failed`);
  process.exit(1);
}
console.log("nav scenarios suite passed");
