// tests/test-nav-scenario-resolve.mjs
import assert from "node:assert/strict";
import { resolveScenario } from "@cycleways/core/navigation/scenarios/resolve.js";
import lTurn from "@cycleways/core/navigation/scenarios/routes/l-turn.js";

const base = {
  name: "test-scenario",
  description: "resolver test",
  route: { routeState: lTurn },
  track: { generate: { speedMps: 5, intervalMs: 1000, seed: 1 } },
};

// Happy resolution from a routeState module.
{
  const resolved = resolveScenario(base);
  assert.equal(resolved.name, "test-scenario");
  assert.equal(resolved.connector, "straight-line", "connector defaults");
  assert.deepEqual(resolved.expect, [], "expect defaults to []");
  assert.equal(resolved.visualOnly, false);
  assert.ok(resolved.navigationRoute.canNavigate, "route is navigable");
  assert.equal(
    resolved.navigationRoute.requiresStartAcquisition,
    true,
    "scenario rides start at the route start, like a ride-setup effective route" +
      " — without this, loop routes (start == end) can acquire at the end",
  );
  assert.ok(
    resolved.navigationRoute.distanceMeters > 1100 &&
      resolved.navigationRoute.distanceMeters < 1300,
    `l-turn is ~1200m, got ${resolved.navigationRoute.distanceMeters}`,
  );
  assert.ok(resolved.fixes.length > 200, "5 m/s over ~1200 m => 240ish fixes");
}

// The l-turn route produces a merged left-turn cue onto the second segment.
{
  const { buildRouteCues } = await import(
    "@cycleways/core/navigation/navigationCues.js"
  );
  const resolved = resolveScenario(base);
  const cues = buildRouteCues(resolved.navigationRoute);
  const turn = cues.find((c) => c.type === "turn");
  assert.ok(turn, "l-turn has a turn cue");
  assert.equal(turn.direction, "left");
  assert.equal(turn.ontoSegmentName, "שביל הצפון", "segment name merged onto the turn");
  assert.ok(
    Math.abs(turn.distanceMeters - 597) < 15,
    `turn at ~597m, got ${turn.distanceMeters}`,
  );
}

// gap + dwell post-processors compose.
{
  const plain = resolveScenario(base);
  const processed = resolveScenario({
    ...base,
    track: {
      ...base.track,
      gap: { startMeters: 300, endMeters: 400 },
      dwell: { atMeters: 500, durationMs: 10000, seed: 4 },
    },
  });
  assert.ok(
    processed.fixes.length < plain.fixes.length + 10 &&
      processed.fixes.length !== plain.fixes.length,
    "post-processors changed the track",
  );
}

// "current" route form requires a navigable current route.
{
  assert.throws(
    () => resolveScenario({ ...base, route: "current" }),
    /requires a navigable current route/,
  );
  const current = resolveScenario(base).navigationRoute;
  const resolved = resolveScenario(
    { ...base, route: "current" },
    { currentNavigationRoute: current },
  );
  assert.equal(resolved.navigationRoute, current);
}

// Validation failures name the scenario and the problem.
assert.throws(() => resolveScenario({ ...base, name: undefined }), /missing a name/);
assert.throws(() => resolveScenario({ ...base, route: {} }), /test-scenario.*route/);
assert.throws(() => resolveScenario({ ...base, track: {} }), /test-scenario.*track/);
assert.throws(
  () => resolveScenario({ ...base, connector: "teleport" }),
  /unknown connector mode/,
);

console.log("nav scenario resolve tests passed");
