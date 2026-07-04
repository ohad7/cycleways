// tests/test-nav-approach-connector.mjs — the approach-calculated-route
// scenario exists to demonstrate a REAL routed approach connector (unlike the
// synthetic l-turn scenarios, whose coordinates are off the routing network,
// so the app can only show a beeline there). This test runs the actual
// sharded routing over public-data and asserts the scenario's approach point
// resolves to a genuinely calculated route — multiple points, sane length —
// so the in-app demo can never silently degrade back into a straight line.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { getScenario } from "@cycleways/core/navigation/scenarios/index.js";
import { getDistance } from "@cycleways/core/utils/distance.js";
import { createShardedRouteSession } from "@cycleways/core/routing/shardedRouteSession.js";
import { decodeCompactBaseRoutingShard } from "@cycleways/core/routing/compactBaseRoutingShard.js";

const require = createRequire(import.meta.url);
const RouteManager = require("../packages/core/route-manager.js");

const scenario = getScenario("approach-calculated-route");
assert.ok(scenario, "approach-calculated-route scenario is registered");

const approachFrom = scenario.track?.generate?.approachFrom;
const routeStart = scenario.route?.routeState?.geometry?.[0];
assert.ok(approachFrom, "scenario has an approach start point");
assert.ok(routeStart, "scenario route has geometry");

const beelineMeters = getDistance(approachFrom, routeStart);
assert.ok(
  beelineMeters > 300,
  `approach is far enough to be a meaningful demo (${Math.round(beelineMeters)}m)`,
);

const manifest = JSON.parse(
  readFileSync("public-data/base-routing-shards/manifest.json", "utf8"),
);
const loader = async (entry) =>
  decodeCompactBaseRoutingShard(
    readFileSync(`public-data/base-routing-shards/${entry.formats.compact.path}`),
  );
const session = await createShardedRouteSession(
  RouteManager,
  { type: "FeatureCollection", features: [] },
  {},
  manifest,
  loader,
  { paddingShards: 0 },
);

const connector = await session.computeConnector(approachFrom, routeStart);
assert.equal(connector.failure, null, `connector failed: ${connector.failure}`);
assert.ok(
  connector.geometry.length > 2,
  `a calculated route has intermediate points, got ${connector.geometry.length}`,
);
const routedMeters = connector.geometry.reduce(
  (sum, point, i) =>
    i === 0 ? 0 : sum + getDistance(connector.geometry[i - 1], point),
  0,
);
assert.ok(
  routedMeters >= beelineMeters * 0.9 && routedMeters <= beelineMeters * 4,
  `routed length ${Math.round(routedMeters)}m is sane vs beeline ${Math.round(beelineMeters)}m`,
);

console.log(
  `nav approach connector test passed (${connector.geometry.length} points, ${Math.round(routedMeters)}m routed vs ${Math.round(beelineMeters)}m beeline)`,
);
