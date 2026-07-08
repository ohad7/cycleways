# Connector Navigation Lens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an editor diagnostic + tuning lens over the base edge network that colors edges by classification / connector-eligibility / cost, lets the user tune the connector cost model live, and runs the real routing engine to produce a usage-frequency heatmap toward a selected route's start.

**Architecture:** Extract today's hardcoded connector gates from `route-manager.js` into a shared, tunable `connectorCostModel` module; make `previewBaseRoute` accept an injected strategy that is applied live during search. The editor browser computes classification/cost heatmaps client-side with that same shared model (instant, no round-trip); frequency runs go to a new editor-server endpoint that drives the real `RouteManager`.

**Tech Stack:** Node ESM (`.mjs` tests run with `node`), CommonJS `route-manager.js` (loaded via `createRequire`), the `@cycleways/core` workspace package, the editor's plain-Node `http` server (`editor/server.mjs`) and vanilla-JS client (`editor/editor.js`) with Mapbox GL layers.

## Global Constraints

- **No map-data edits.** This feature never writes `data/map-source.geojson`, `public-data/`, or any base-graph asset. The strategy is ephemeral client state, exportable as JSON only.
- **Default strategy is behavior-preserving.** `DEFAULT_CONNECTOR_STRATEGY` must reproduce the exact current connector verdicts and costs; all existing routing tests must pass unchanged with no strategy injected.
- **Current production values (copy verbatim):** allowed classes `road` (×1.0) and `local_road` (×1.1); `roadType === "road"` treated as `road`; every other `routeClass` (`cycle`, `path_track`, `manual`, `other`) excluded; `accessStatus` `restricted` and `conditional` excluded; uphill weight `8` (meters cost per meter climbed, from `this.baseRoutingUphillCostMetersPerMeter`); snap mode `"allowed-only"`.
- **Tests are added to the `test` npm script** (the long `&&` chain in `package.json`) so CI runs them. Run an individual test with `node tests/<file>.mjs`.
- **Baked connector cost stays the runtime fast path.** Live per-edge cost computation is used *only* when a custom strategy is injected (editor previews); the mobile/shard runtime path (no injected strategy) keeps reading `edge.connectorCost`.

---

## File Structure

- `packages/core/src/routing/connectorCostModel.js` — **new.** Pure model: `DEFAULT_CONNECTOR_STRATEGY` + `evaluateConnectorEdge(edge, strategy)`. Single source of truth for both connector gates. Consumed by `route-manager.js` (runtime) and `editor.js` (client heatmaps).
- `packages/core/src/routing/connectorSampling.js` — **new.** Pure origin-grid generator for frequency runs.
- `packages/core/route-manager.js` — **modify.** Delegate `_connectorEdgeAllowed` / `_connectorCostMultiplierFor` to the model; accept an injected strategy in `previewBaseRoute`; apply it live during snap + search + uphill.
- `editor/lib/connectorPreview.mjs` — **new.** `runConnectorPreview(manager, body)` — the testable core of the endpoint (grid generation, per-origin routing, usage aggregation, single-origin path). No HTTP.
- `editor/server.mjs` — **modify.** Add `POST /api/connector/preview` dispatch that parses the body and calls `runConnectorPreview` with the server's `RouteManager`.
- `editor/lib/connectorColors.mjs` — **new.** Pure `connectorCostColor(multiplier)` cost→color scale + legend stops.
- `editor/editor.js` — **modify.** Strategy state + panel; classification / eligibility / cost coloring of `base-graph-edges-layer`; frequency-run UI (target route, radius, Run, usage heatmap, origin dots, click-origin path); edge-inspector connector verdict.
- `editor/index.html`, `editor/styles.css` — **modify.** Markup + styling for the strategy panel and frequency controls.
- `tests/test-connector-cost-model.mjs`, `tests/test-connector-strategy.mjs`, `tests/test-connector-sampling.mjs`, `tests/test-connector-preview.mjs`, `tests/test-connector-colors.mjs` — **new.**

---

## Task 1: Shared connector cost model

**Files:**
- Create: `packages/core/src/routing/connectorCostModel.js`
- Test: `tests/test-connector-cost-model.mjs`
- Modify: `package.json` (add test to the `test` chain)

**Interfaces:**
- Produces:
  - `DEFAULT_CONNECTOR_STRATEGY` — `{ classMultipliers: { road: number, local_road: number, cycle: number|null, path_track: number|null, manual: number|null, other: number|null }, accessPolicy: { [status: string]: number|null }, uphillWeight: number, snap: "allowed-only"|"any" }`. A `null` multiplier/policy value means *excluded*.
  - `evaluateConnectorEdge(edge, strategy) → { allowed: boolean, multiplier: number }`. Excluded → `{ allowed: false, multiplier: Infinity }`.

- [ ] **Step 1: Write the failing test**

Create `tests/test-connector-cost-model.mjs`:

```js
import assert from "node:assert/strict";
import {
  DEFAULT_CONNECTOR_STRATEGY,
  evaluateConnectorEdge,
} from "@cycleways/core/routing/connectorCostModel.js";

const S = DEFAULT_CONNECTOR_STRATEGY;

// road → allowed, ×1.0
assert.deepEqual(
  evaluateConnectorEdge({ routeClass: "road" }, S),
  { allowed: true, multiplier: 1 },
);

// local_road → allowed, ×1.1
assert.deepEqual(
  evaluateConnectorEdge({ routeClass: "local_road" }, S),
  { allowed: true, multiplier: 1.1 },
);

// roadType "road" (non-road routeClass) → treated as road, ×1.0
assert.deepEqual(
  evaluateConnectorEdge({ routeClass: "other", roadType: "road" }, S),
  { allowed: true, multiplier: 1 },
);

// cycle → excluded under default
assert.deepEqual(
  evaluateConnectorEdge({ routeClass: "cycle" }, S),
  { allowed: false, multiplier: Infinity },
);

// path_track → excluded under default
assert.equal(evaluateConnectorEdge({ routeClass: "path_track" }, S).allowed, false);

// restricted access excludes an otherwise-allowed road
assert.deepEqual(
  evaluateConnectorEdge({ routeClass: "road", accessStatus: "restricted" }, S),
  { allowed: false, multiplier: Infinity },
);

// conditional access excludes
assert.equal(
  evaluateConnectorEdge({ routeClass: "local_road", accessStatus: "conditional" }, S).allowed,
  false,
);

// unspecified access does not penalize
assert.equal(
  evaluateConnectorEdge({ routeClass: "road", accessStatus: "unspecified" }, S).multiplier,
  1,
);

// null / missing edge → excluded
assert.deepEqual(
  evaluateConnectorEdge(null, S),
  { allowed: false, multiplier: Infinity },
);

// A softened strategy (cycle finite) flips the verdict and combines with access.
const softened = {
  ...S,
  classMultipliers: { ...S.classMultipliers, cycle: 1.5 },
  accessPolicy: { ...S.accessPolicy, conditional: 2 },
};
assert.deepEqual(
  evaluateConnectorEdge({ routeClass: "cycle" }, softened),
  { allowed: true, multiplier: 1.5 },
);
// class ×1.5 and access ×2 combine
assert.equal(
  evaluateConnectorEdge({ routeClass: "cycle", accessStatus: "conditional" }, softened).multiplier,
  3,
);

console.log("connector-cost-model OK");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/test-connector-cost-model.mjs`
Expected: FAIL — `Cannot find module '.../connectorCostModel.js'`.

- [ ] **Step 3: Write the module**

Create `packages/core/src/routing/connectorCostModel.js`:

```js
// Single source of truth for the connector cost model: the two gates that
// decide whether an edge may carry a connector route and how expensive it is.
// A `null` class multiplier or access-policy value means "excluded".
// DEFAULT_CONNECTOR_STRATEGY encodes the exact current production behavior.

export const DEFAULT_CONNECTOR_STRATEGY = {
  classMultipliers: {
    road: 1,
    local_road: 1.1,
    cycle: null,
    path_track: null,
    manual: null,
    other: null,
  },
  accessPolicy: {
    restricted: null,
    conditional: null,
  },
  uphillWeight: 8,
  snap: "allowed-only",
};

function classMultiplier(edge, strategy) {
  const cm = strategy.classMultipliers || {};
  if (edge.routeClass === "road" || edge.roadType === "road") {
    return cm.road ?? null;
  }
  const key = edge.routeClass;
  if (key != null && key in cm) return cm[key];
  return cm.other ?? null;
}

function accessMultiplier(edge, strategy) {
  const ap = strategy.accessPolicy || {};
  const status = edge.accessStatus;
  if (status != null && status in ap) return ap[status];
  return 1;
}

export function evaluateConnectorEdge(edge, strategy = DEFAULT_CONNECTOR_STRATEGY) {
  const excluded = { allowed: false, multiplier: Infinity };
  if (!edge) return excluded;

  const access = accessMultiplier(edge, strategy);
  if (access == null || !Number.isFinite(access)) return excluded;

  const klass = classMultiplier(edge, strategy);
  if (klass == null || !Number.isFinite(klass)) return excluded;

  return { allowed: true, multiplier: klass * access };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/test-connector-cost-model.mjs`
Expected: `connector-cost-model OK`.

- [ ] **Step 5: Wire into the test suite and commit**

In `package.json`, add `&& node tests/test-connector-cost-model.mjs` to the `test` script (place it just before `node tests/test-preview-base-route.mjs`).

```bash
git add packages/core/src/routing/connectorCostModel.js tests/test-connector-cost-model.mjs package.json
git commit -m "feat(routing): shared tunable connector cost model"
```

---

## Task 2: route-manager delegates to the model + injectable strategy

**Files:**
- Modify: `packages/core/route-manager.js`
  - `_connectorEdgeAllowed` (~1069–1079), `_connectorCostMultiplierFor` (~1059–1067)
  - `previewBaseRoute` (~255–286)
  - constructor (~58, near `this._connectorCostProfile = false;`)
  - `_baseRoutingTraversalCostParts` uphill line (~1131–1132)
  - connector search step cost (~1710–1713)
- Test: `tests/test-connector-strategy.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `DEFAULT_CONNECTOR_STRATEGY`, `evaluateConnectorEdge` from Task 1.
- Produces: `previewBaseRoute(points, { costProfile: "connector", connectorStrategy })` — when `connectorStrategy` is supplied, eligibility, per-edge multiplier, uphill weight, and snap filter all follow it, computed live. With no `connectorStrategy`, behavior is byte-for-byte unchanged (baked `edge.connectorCost`, `allowed-only` snap, uphill weight `8`).

- [ ] **Step 1: Write the failing test**

Create `tests/test-connector-strategy.mjs`. It builds a diamond where the direct A→C hop is a `cycle` edge (excluded by default) and the detour A→B→C is `local_road`. Default connector must detour; a softened strategy that allows `cycle` cheaply must take the direct hop.

```js
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { DEFAULT_CONNECTOR_STRATEGY } from "@cycleways/core/routing/connectorCostModel.js";

const require = createRequire(import.meta.url);
const RouteManager = require("../packages/core/route-manager.js");

const network = {
  schemaVersion: 2,
  nodes: [
    { id: "a", coord: [35.0, 33.0] },
    { id: "b", coord: [35.001, 33.001] },
    { id: "c", coord: [35.002, 33.0] },
  ],
  edges: [
    // Direct A->C: a cycleway (excluded by default), geometrically shortest.
    {
      id: "direct",
      from: "a",
      to: "c",
      distanceMeters: 186,
      coordinates: [[35.0, 33.0], [35.002, 33.0]],
      routeClass: "cycle",
      cwSegmentIds: [],
    },
    // Detour A->B->C over local_road.
    {
      id: "ab",
      from: "a",
      to: "b",
      distanceMeters: 150,
      coordinates: [[35.0, 33.0], [35.001, 33.001]],
      routeClass: "local_road",
      cwSegmentIds: [],
    },
    {
      id: "bc",
      from: "b",
      to: "c",
      distanceMeters: 150,
      coordinates: [[35.001, 33.001], [35.002, 33.0]],
      routeClass: "local_road",
      cwSegmentIds: [],
    },
  ],
};

const manager = new RouteManager();
await manager.load({ type: "FeatureCollection", features: [] }, {}, network);

const from = { lat: 33.0, lng: 35.00005 };
const to = { lat: 33.0, lng: 35.00195 };

// Default connector: cycle edge excluded → must route the local_road detour
// (via node b), so the path passes near b's latitude 33.001.
const base = manager.previewBaseRoute([from, to], { costProfile: "connector" });
assert.equal(base.failure, null, "default connector should find the detour");
const usesDetour = base.geometry.some((p) => Math.abs(p.lat - 33.001) < 1e-4);
assert.ok(usesDetour, "default connector should detour via the local_road node b");

// Softened strategy: allow cycle cheaply → take the direct hop (stays on lat 33.0).
const softened = {
  ...DEFAULT_CONNECTOR_STRATEGY,
  classMultipliers: { ...DEFAULT_CONNECTOR_STRATEGY.classMultipliers, cycle: 1 },
};
const soft = manager.previewBaseRoute([from, to], {
  costProfile: "connector",
  connectorStrategy: softened,
});
assert.equal(soft.failure, null, "softened connector should find the direct hop");
const usesDirect = soft.geometry.every((p) => Math.abs(p.lat - 33.0) < 1e-4);
assert.ok(usesDirect, "softened connector should take the direct cycle hop");

// Injecting a strategy must not mutate the manager afterwards: a subsequent
// default connector still detours.
const baseAgain = manager.previewBaseRoute([from, to], { costProfile: "connector" });
assert.ok(
  baseAgain.geometry.some((p) => Math.abs(p.lat - 33.001) < 1e-4),
  "strategy must not leak into later default runs",
);

console.log("connector-strategy OK");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/test-connector-strategy.mjs`
Expected: FAIL — the softened run still detours (strategy not yet honored) or `connectorStrategy` is ignored.

- [ ] **Step 3: Add strategy state to the constructor**

In `packages/core/route-manager.js`, immediately after `this._connectorCostProfile = false;` (~line 58) add:

```js
    this._connectorStrategy = null;
```

Add the import near the top of the file (match the file's existing `require(...)` style for core deps; `route-manager.js` is CommonJS, so use a dynamic-free static require if the file already requires core modules, otherwise add):

```js
const {
  DEFAULT_CONNECTOR_STRATEGY,
  evaluateConnectorEdge,
} = require("./src/routing/connectorCostModel.js");
```

> Note: `connectorCostModel.js` uses ESM `export`. If `route-manager.js` cannot `require` an ESM file in this repo's setup, instead re-export the two symbols from a tiny CommonJS shim `packages/core/src/routing/connectorCostModel.cjs` that `module.exports` the same constants/function, and have both the ESM module and the shim share one implementation file. Verify which works by running Step 4's test; do not duplicate logic — the CJS shim must import/re-export, not re-implement.

- [ ] **Step 4: Delegate the two gate methods and add a strategy accessor**

Replace `_connectorCostMultiplierFor` (~1059–1067) and `_connectorEdgeAllowed` (~1069–1079) with delegations, and add an accessor:

```js
  _activeConnectorStrategy() {
    return this._connectorStrategy || DEFAULT_CONNECTOR_STRATEGY;
  }

  _connectorCostMultiplierFor(edge) {
    return evaluateConnectorEdge(edge, this._activeConnectorStrategy()).multiplier;
  }

  _connectorEdgeAllowed(edge) {
    return evaluateConnectorEdge(edge, this._activeConnectorStrategy()).allowed;
  }
```

- [ ] **Step 5: Make uphill weight strategy-aware in the connector branch**

In `_baseRoutingTraversalCostParts` (~1126–1132), replace the uphill-cost line:

```js
    const uphillCost =
      uphillMeters * this.baseRoutingUphillCostMetersPerMeter;
```

with:

```js
    const uphillWeight = connector
      ? this._activeConnectorStrategy().uphillWeight
      : this.baseRoutingUphillCostMetersPerMeter;
    const uphillCost = uphillMeters * uphillWeight;
```

(Default connector `uphillWeight` is `8`, equal to `baseRoutingUphillCostMetersPerMeter`, so baked costs are unchanged.)

- [ ] **Step 6: Compute live connector step cost during search when a strategy is injected**

Add a helper method (place near `_connectorCostMultiplierFor`):

```js
  _connectorStepCost(adjEntry) {
    const edge = this.baseRoutingEdges.get(adjEntry.edgeId);
    if (!edge) return Infinity;
    const fromDistance = adjEntry.direction === "reverse" ? edge.lengthMeters : 0;
    const toDistance = adjEntry.direction === "reverse" ? 0 : edge.lengthMeters;
    return this._baseRoutingTraversalCost(edge, fromDistance, toDistance, true);
  }
```

Then, in the connector search loop (~1710–1713), replace:

```js
        const stepCost = this._connectorCostProfile
          ? edge.connectorCost
          : edge.cost;
```

with:

```js
        const stepCost = this._connectorCostProfile
          ? this._connectorStrategy
            ? this._connectorStepCost(edge)
            : edge.connectorCost
          : edge.cost;
```

- [ ] **Step 7: Accept `connectorStrategy` in `previewBaseRoute` and use it for snap + search**

In `previewBaseRoute` (~255), change the signature and snap filter:

```js
  previewBaseRoute(points, { costProfile = "default", connectorStrategy = null } = {}) {
    const connectorProfile = costProfile === "connector";
    const strategy = connectorProfile ? connectorStrategy : null;
    const snapAny = Boolean(strategy && strategy.snap === "any");
    const snapped = this._snapRoutePoints(points, {
      edgeFilter:
        connectorProfile && !snapAny
          ? (edge) => this._connectorEdgeAllowedFor(edge, strategy)
          : null,
    });
```

Add a small strategy-explicit eligibility helper (so the snap filter honors the injected strategy even before `this._connectorStrategy` is set):

```js
  _connectorEdgeAllowedFor(edge, strategy) {
    return evaluateConnectorEdge(edge, strategy || DEFAULT_CONNECTOR_STRATEGY).allowed;
  }
```

Then set/reset the strategy around the route calculation. Replace:

```js
    this._connectorCostProfile = connectorProfile;
    let route;
    try {
      route = this._calculateBaseRoute(snapped);
    } finally {
      this._connectorCostProfile = false;
    }
```

with:

```js
    this._connectorCostProfile = connectorProfile;
    this._connectorStrategy = strategy;
    let route;
    try {
      route = this._calculateBaseRoute(snapped);
    } finally {
      this._connectorCostProfile = false;
      this._connectorStrategy = null;
    }
```

- [ ] **Step 8: Run the new test and the regression tests**

Run:
```bash
node tests/test-connector-strategy.mjs
node tests/test-preview-base-route.mjs
node tests/test-compute-connector.mjs
node tests/test-base-routing-network.mjs
```
Expected: `connector-strategy OK` plus all three existing tests pass unchanged.

- [ ] **Step 9: Wire into the suite and commit**

Add `&& node tests/test-connector-strategy.mjs` to the `test` script in `package.json` (just after the cost-model test).

```bash
git add packages/core/route-manager.js tests/test-connector-strategy.mjs package.json packages/core/src/routing/connectorCostModel.*
git commit -m "feat(routing): inject tunable connector strategy into previewBaseRoute"
```

---

## Task 3: Origin-grid sampling helper

**Files:**
- Create: `packages/core/src/routing/connectorSampling.js`
- Test: `tests/test-connector-sampling.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `buildOriginGrid(center, { radiusMeters, spacingMeters, maxOrigins }) → { origins: Array<{ lat, lng }>, spacingMeters, radiusMeters, capped: boolean }`. Generates a square grid clipped to the circle of `radiusMeters` around `center`, excludes the exact center, coarsens `spacingMeters` upward until `origins.length <= maxOrigins` (setting `capped: true` when it had to).

- [ ] **Step 1: Write the failing test**

Create `tests/test-connector-sampling.mjs`:

```js
import assert from "node:assert/strict";
import { buildOriginGrid } from "@cycleways/core/routing/connectorSampling.js";

const center = { lat: 33.0, lng: 35.0 };

const grid = buildOriginGrid(center, {
  radiusMeters: 1000,
  spacingMeters: 250,
  maxOrigins: 400,
});
assert.ok(grid.origins.length > 0, "grid should have origins");
assert.ok(grid.origins.length <= 400, "grid respects the cap");
assert.equal(grid.capped, false, "1km/250m is under the cap");

// Every origin is within the radius (+ small tolerance) of center.
const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
for (const o of grid.origins) {
  const dLat = toRad(o.lat - center.lat);
  const dLng = toRad(o.lng - center.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(center.lat)) * Math.cos(toRad(o.lat)) * Math.sin(dLng / 2) ** 2;
  const dist = 2 * R * Math.asin(Math.sqrt(a));
  assert.ok(dist <= 1000 + 1, `origin within radius (${dist})`);
}

// The center itself is excluded.
assert.ok(
  !grid.origins.some((o) => o.lat === center.lat && o.lng === center.lng),
  "center excluded",
);

// A dense request over a big radius must coarsen and cap.
const capped = buildOriginGrid(center, {
  radiusMeters: 5000,
  spacingMeters: 50,
  maxOrigins: 400,
});
assert.ok(capped.origins.length <= 400, "coarsened grid respects the cap");
assert.equal(capped.capped, true, "flagged as capped");
assert.ok(capped.spacingMeters > 50, "spacing was coarsened");

console.log("connector-sampling OK");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/test-connector-sampling.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper**

Create `packages/core/src/routing/connectorSampling.js`:

```js
// Pure origin-grid generator for connector usage-frequency runs. Produces a
// square lattice clipped to a circle around the target, excluding the center,
// and coarsens spacing until the origin count fits `maxOrigins`.

const EARTH_RADIUS_M = 6371000;

function metersPerDegLat() {
  return (Math.PI / 180) * EARTH_RADIUS_M;
}

function metersPerDegLng(lat) {
  return (Math.PI / 180) * EARTH_RADIUS_M * Math.cos((lat * Math.PI) / 180);
}

function generate(center, radiusMeters, spacingMeters) {
  const origins = [];
  const mLat = metersPerDegLat();
  const mLng = metersPerDegLng(center.lat) || mLat;
  const steps = Math.floor(radiusMeters / spacingMeters);
  for (let iy = -steps; iy <= steps; iy++) {
    for (let ix = -steps; ix <= steps; ix++) {
      if (ix === 0 && iy === 0) continue;
      const dxM = ix * spacingMeters;
      const dyM = iy * spacingMeters;
      if (Math.hypot(dxM, dyM) > radiusMeters) continue;
      origins.push({
        lat: center.lat + dyM / mLat,
        lng: center.lng + dxM / mLng,
      });
    }
  }
  return origins;
}

export function buildOriginGrid(
  center,
  { radiusMeters = 2000, spacingMeters = 150, maxOrigins = 400 } = {},
) {
  let spacing = Math.max(1, spacingMeters);
  let origins = generate(center, radiusMeters, spacing);
  let capped = false;
  // Coarsen spacing (×1.25 per pass) until under the cap.
  while (origins.length > maxOrigins) {
    spacing *= 1.25;
    origins = generate(center, radiusMeters, spacing);
    capped = true;
  }
  return { origins, spacingMeters: spacing, radiusMeters, capped };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/test-connector-sampling.mjs`
Expected: `connector-sampling OK`.

- [ ] **Step 5: Wire into the suite and commit**

Add `&& node tests/test-connector-sampling.mjs` to the `test` script in `package.json`.

```bash
git add packages/core/src/routing/connectorSampling.js tests/test-connector-sampling.mjs package.json
git commit -m "feat(routing): origin-grid sampler for connector frequency runs"
```

---

## Task 4: Connector-preview core (testable, no HTTP)

**Files:**
- Create: `editor/lib/connectorPreview.mjs`
- Test: `tests/test-connector-preview.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `buildOriginGrid` (Task 3); a `manager` exposing `previewBaseRoute(points, { costProfile, connectorStrategy })` (Task 2).
- Produces: `runConnectorPreview(manager, body) → result`, where `body = { mode, routeStart, strategy, radiusMeters, gridSpacingMeters, maxOrigins, origin }`.
  - `mode: "frequency"` → `{ mode, edgeUsage: { [edgeId]: number }, origins: Array<{ lat, lng, status }>, stats: { total, ok, failed, byFailure }, grid: { spacingMeters, radiusMeters, capped } }`.
  - `mode: "single"` → `{ mode, failure: string|null, geometry: Array<{lat,lng}>, distanceMeters: number, edgeIds: string[] }`.
  - Invalid input throws `Error` with a `.status = 400` property.

- [ ] **Step 1: Write the failing test**

Create `tests/test-connector-preview.mjs`. Reuse the diamond network from Task 2 so a default run detours (cycle excluded) and a softened run uses the direct cycle hop, changing which edges get used.

```js
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { DEFAULT_CONNECTOR_STRATEGY } from "@cycleways/core/routing/connectorCostModel.js";
import { runConnectorPreview } from "../editor/lib/connectorPreview.mjs";

const require = createRequire(import.meta.url);
const RouteManager = require("../packages/core/route-manager.js");

const network = {
  schemaVersion: 2,
  nodes: [
    { id: "a", coord: [35.0, 33.0] },
    { id: "b", coord: [35.001, 33.001] },
    { id: "c", coord: [35.002, 33.0] },
  ],
  edges: [
    { id: "direct", from: "a", to: "c", distanceMeters: 186,
      coordinates: [[35.0, 33.0], [35.002, 33.0]], routeClass: "cycle", cwSegmentIds: [] },
    { id: "ab", from: "a", to: "b", distanceMeters: 150,
      coordinates: [[35.0, 33.0], [35.001, 33.001]], routeClass: "local_road", cwSegmentIds: [] },
    { id: "bc", from: "b", to: "c", distanceMeters: 150,
      coordinates: [[35.001, 33.001], [35.002, 33.0]], routeClass: "local_road", cwSegmentIds: [] },
  ],
};

const manager = new RouteManager();
await manager.load({ type: "FeatureCollection", features: [] }, {}, network);

const routeStart = { lat: 33.0, lng: 35.002 };

// Single mode, default strategy: from near a to c → detours over ab/bc (cycle excluded).
const single = runConnectorPreview(manager, {
  mode: "single",
  routeStart,
  origin: { lat: 33.0, lng: 35.0 },
  strategy: DEFAULT_CONNECTOR_STRATEGY,
});
assert.equal(single.failure, null);
assert.ok(single.edgeIds.includes("ab") || single.edgeIds.includes("bc"),
  "default single run uses the local_road detour");
assert.ok(!single.edgeIds.includes("direct"), "default single run avoids the cycle edge");

// Frequency mode, default: aggregate usage exists and every origin has a status.
const freq = runConnectorPreview(manager, {
  mode: "frequency",
  routeStart,
  strategy: DEFAULT_CONNECTOR_STRATEGY,
  radiusMeters: 200,
  gridSpacingMeters: 80,
  maxOrigins: 100,
});
assert.equal(freq.stats.total, freq.origins.length);
assert.ok(freq.stats.total > 0);
assert.ok(Object.keys(freq.edgeUsage).length > 0, "some edges are used");
for (const o of freq.origins) assert.ok(typeof o.status === "string");

// Softened strategy shifts usage onto the direct cycle edge.
const softened = {
  ...DEFAULT_CONNECTOR_STRATEGY,
  classMultipliers: { ...DEFAULT_CONNECTOR_STRATEGY.classMultipliers, cycle: 1 },
};
const freqSoft = runConnectorPreview(manager, {
  mode: "frequency", routeStart, strategy: softened,
  radiusMeters: 200, gridSpacingMeters: 80, maxOrigins: 100,
});
assert.ok((freqSoft.edgeUsage.direct || 0) > 0, "softened run uses the cycle edge");

// Invalid input → 400.
assert.throws(
  () => runConnectorPreview(manager, { mode: "frequency" }),
  (err) => err.status === 400,
);

console.log("connector-preview OK");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/test-connector-preview.mjs`
Expected: FAIL — `editor/lib/connectorPreview.mjs` not found.

- [ ] **Step 3: Write the core**

Create `editor/lib/connectorPreview.mjs`:

```js
import { buildOriginGrid } from "@cycleways/core/routing/connectorSampling.js";

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function isLatLng(p) {
  return p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));
}

function edgeIdsFromPreview(preview) {
  // previewBaseRoute returns ordered segments; collect their base edge ids.
  const ids = [];
  for (const seg of preview.segments || []) {
    const id = seg?.edgeId ?? seg?.baseEdgeId ?? seg?.id;
    if (id != null) ids.push(String(id));
  }
  return ids;
}

function runSingle(manager, origin, routeStart, strategy) {
  const preview = manager.previewBaseRoute([origin, routeStart], {
    costProfile: "connector",
    connectorStrategy: strategy,
  });
  return {
    mode: "single",
    failure: preview.failure || null,
    geometry: preview.geometry || [],
    distanceMeters: preview.distanceMeters || 0,
    edgeIds: preview.failure ? [] : edgeIdsFromPreview(preview),
  };
}

export function runConnectorPreview(manager, body = {}) {
  const { mode, routeStart, strategy } = body;
  if (!isLatLng(routeStart)) throw badRequest("routeStart {lat,lng} required");
  if (!strategy || typeof strategy !== "object") throw badRequest("strategy required");

  if (mode === "single") {
    if (!isLatLng(body.origin)) throw badRequest("origin {lat,lng} required for single mode");
    return runSingle(manager, body.origin, routeStart, strategy);
  }

  if (mode === "frequency") {
    const { origins, spacingMeters, radiusMeters, capped } = buildOriginGrid(routeStart, {
      radiusMeters: Number(body.radiusMeters) || 2000,
      spacingMeters: Number(body.gridSpacingMeters) || 150,
      maxOrigins: Number(body.maxOrigins) || 400,
    });
    const edgeUsage = {};
    const outOrigins = [];
    const byFailure = {};
    let ok = 0;
    for (const origin of origins) {
      const preview = manager.previewBaseRoute([origin, routeStart], {
        costProfile: "connector",
        connectorStrategy: strategy,
      });
      const status = preview.failure || "ok";
      outOrigins.push({ lat: origin.lat, lng: origin.lng, status });
      if (preview.failure) {
        byFailure[status] = (byFailure[status] || 0) + 1;
      } else {
        ok += 1;
        for (const id of edgeIdsFromPreview(preview)) {
          edgeUsage[id] = (edgeUsage[id] || 0) + 1;
        }
      }
    }
    return {
      mode: "frequency",
      edgeUsage,
      origins: outOrigins,
      stats: { total: outOrigins.length, ok, failed: outOrigins.length - ok, byFailure },
      grid: { spacingMeters, radiusMeters, capped },
    };
  }

  throw badRequest(`unknown mode: ${mode}`);
}
```

> **Verify the edge-id field.** Before finalizing, confirm what `previewBaseRoute(...).segments[i]` exposes as the base-edge id by inspecting the return shape in `packages/core/route-manager.js` (`previewBaseRoute` ~299 and `_findOptimalRouteThroughPoints` results, e.g. line ~428 where `routeClass`/`roadType` are attached). Adjust `edgeIdsFromPreview` to read the actual property (likely `edgeId`). The Task-4 test failing on `edgeIds` is the signal to fix this mapping.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/test-connector-preview.mjs`
Expected: `connector-preview OK`. If `edgeIds` assertions fail, fix `edgeIdsFromPreview` per the note above, then re-run.

- [ ] **Step 5: Wire into the suite and commit**

Add `&& node tests/test-connector-preview.mjs` to the `test` script in `package.json`.

```bash
git add editor/lib/connectorPreview.mjs tests/test-connector-preview.mjs package.json
git commit -m "feat(editor): connector-preview core (frequency + single) with usage aggregation"
```

---

## Task 5: Editor server endpoint

**Files:**
- Modify: `editor/server.mjs` (add import + one dispatch block inside `createServer`, near the other `/api/...` blocks ~2707+)

**Interfaces:**
- Consumes: `runConnectorPreview` (Task 4); the server's existing `getBaseRoutingDecodeAssets` + `createRouteManager` pattern (used ~1081, ~1224, ~1259).
- Produces: `POST /api/connector/preview` — JSON body in, JSON result out; `400` on `err.status === 400`, `500` otherwise.

- [ ] **Step 1: Read the existing manager-construction + JSON-body patterns**

Read `editor/server.mjs` around lines 1081 and 2707–2860 to copy: (a) how a `RouteManager` is built from `getBaseRoutingDecodeAssets`, and (b) the existing helper that reads/parses a JSON request body for `POST` routes (used by `/api/osm/recalculate` etc.). Note the exact body-reader function name.

- [ ] **Step 2: Add the import**

Near the top imports of `editor/server.mjs`:

```js
import { runConnectorPreview } from "./lib/connectorPreview.mjs";
```

- [ ] **Step 3: Add the dispatch block**

Inside `createServer(async (request, response) => { ... })`, alongside the other `/api/...` checks, add (using the same JSON-body reader and manager construction found in Step 1 — names shown here as `readJsonBody` and `getBaseRoutingDecodeAssets`/`createRouteManager`; substitute the real ones):

```js
    if (request.method === "POST" && url.pathname === "/api/connector/preview") {
      try {
        const body = await readJsonBody(request);
        const { baseRoutingNetwork, cwBaseIndex } = await getBaseRoutingDecodeAssets({ log });
        const manager = await createRouteManager(
          sourceGeoJson,
          segmentsData,
          baseRoutingNetwork,
          cwBaseIndex,
        );
        const result = runConnectorPreview(manager, body);
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(result));
      } catch (err) {
        const status = err && err.status === 400 ? 400 : 500;
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: String(err && err.message || err) }));
      }
      return;
    }
```

> Match the exact argument list `createRouteManager` expects in this file (copy from the ~1081 call site verbatim). If manager construction is expensive, it is acceptable for v1 to build it per request (diagnostic tool, low call rate); a cached manager is a later optimization, not part of this task.

- [ ] **Step 4: Manual verification**

Start the editor server (the repo's editor dev command — check `editor/README.md` / `package.json`; e.g. `node editor/server.mjs` or the documented script). Then:

```bash
curl -s -X POST http://localhost:<port>/api/connector/preview \
  -H 'Content-Type: application/json' \
  -d '{"mode":"single","routeStart":{"lat":33.2,"lng":35.57},"origin":{"lat":33.21,"lng":35.58},"strategy":{"classMultipliers":{"road":1,"local_road":1.1,"cycle":null,"path_track":null,"manual":null,"other":null},"accessPolicy":{"restricted":null,"conditional":null},"uphillWeight":8,"snap":"allowed-only"}}' | head -c 400
```
Expected: a JSON object with `"mode":"single"` and either a `geometry` array or a `failure`. A malformed body (omit `routeStart`) returns HTTP 400 with `{"error":...}`.

- [ ] **Step 5: Commit**

```bash
git add editor/server.mjs
git commit -m "feat(editor): POST /api/connector/preview endpoint"
```

---

## Task 6: Cost→color helper + connector-aware base coloring

**Files:**
- Create: `editor/lib/connectorColors.mjs`
- Test: `tests/test-connector-colors.mjs`
- Modify: `package.json`, `editor/editor.js`

**Interfaces:**
- Produces:
  - `connectorCostColor(multiplier) → string` (CSS hex). `Infinity`/non-finite → the excluded color `"#9ca3af"`.
  - `CONNECTOR_COST_LEGEND → Array<{ label: string, color: string }>`.
  - `connectorClassColor(routeClass) → string` and `CONNECTOR_CLASS_LEGEND` for the classification lens.

- [ ] **Step 1: Write the failing test**

Create `tests/test-connector-colors.mjs`:

```js
import assert from "node:assert/strict";
import {
  connectorCostColor,
  connectorClassColor,
  CONNECTOR_COST_LEGEND,
  CONNECTOR_CLASS_LEGEND,
} from "../editor/lib/connectorColors.mjs";

// Excluded / non-finite → grey.
assert.equal(connectorCostColor(Infinity), "#9ca3af");
assert.equal(connectorCostColor(NaN), "#9ca3af");

// Finite multipliers → a hex color; cheaper and pricier differ.
const cheap = connectorCostColor(1);
const pricey = connectorCostColor(4);
assert.match(cheap, /^#[0-9a-fA-F]{6}$/);
assert.match(pricey, /^#[0-9a-fA-F]{6}$/);
assert.notEqual(cheap, pricey);

// Classification colors are stable per class and distinct across a few.
assert.match(connectorClassColor("road"), /^#[0-9a-fA-F]{6}$/);
assert.notEqual(connectorClassColor("road"), connectorClassColor("cycle"));
assert.equal(connectorClassColor("road"), connectorClassColor("road"));

assert.ok(CONNECTOR_COST_LEGEND.length >= 2);
assert.ok(CONNECTOR_CLASS_LEGEND.length >= 3);

console.log("connector-colors OK");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/test-connector-colors.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper**

Create `editor/lib/connectorColors.mjs` (colorblind-safe sequential ramp; discrete excluded swatch):

```js
export const CONNECTOR_EXCLUDED_COLOR = "#9ca3af";

// Sequential low→high cost stops (viridis-ish, colorblind-safe).
const COST_STOPS = [
  { max: 1.0, color: "#1b7837" }, // free / road
  { max: 1.25, color: "#5aae61" },
  { max: 1.75, color: "#d9ef8b" },
  { max: 2.5, color: "#fee08b" },
  { max: 4.0, color: "#f46d43" },
  { max: Infinity, color: "#a50026" }, // very expensive but still traversable
];

export function connectorCostColor(multiplier) {
  if (!Number.isFinite(multiplier)) return CONNECTOR_EXCLUDED_COLOR;
  for (const stop of COST_STOPS) {
    if (multiplier <= stop.max) return stop.color;
  }
  return COST_STOPS[COST_STOPS.length - 1].color;
}

export const CONNECTOR_COST_LEGEND = [
  { label: "≤1.0 (road)", color: "#1b7837" },
  { label: "≤1.25", color: "#5aae61" },
  { label: "≤1.75", color: "#d9ef8b" },
  { label: "≤2.5", color: "#fee08b" },
  { label: "≤4.0", color: "#f46d43" },
  { label: ">4.0", color: "#a50026" },
  { label: "excluded", color: CONNECTOR_EXCLUDED_COLOR },
];

const CLASS_COLORS = {
  road: "#1f78b4",
  local_road: "#6d7785",
  cycle: "#33a02c",
  path_track: "#8f6a20",
  manual: "#b15928",
  other: "#999999",
};

export function connectorClassColor(routeClass) {
  return CLASS_COLORS[routeClass] || CLASS_COLORS.other;
}

export const CONNECTOR_CLASS_LEGEND = Object.entries(CLASS_COLORS).map(
  ([label, color]) => ({ label, color }),
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/test-connector-colors.mjs`
Expected: `connector-colors OK`.

- [ ] **Step 5: Add a "connector lens" color mode to the base-graph layer**

In `editor/editor.js`:

1. Add imports near the top (alongside the existing `@cycleways/core` imports):

```js
import {
  DEFAULT_CONNECTOR_STRATEGY,
  evaluateConnectorEdge,
} from "../packages/core/src/routing/connectorCostModel.js";
import {
  connectorCostColor,
  connectorClassColor,
} from "./lib/connectorColors.mjs";
```

2. Add lens state to the `state` object (near `baseOverlay`):

```js
  connectorLens: {
    // "off" | "class" | "eligibility" | "cost"
    colorMode: "off",
    strategy: structuredClone(DEFAULT_CONNECTOR_STRATEGY),
  },
```

3. When building the `base-graph-edges` GeoJSON (`baseGraphCollection`, ~836), compute and attach a `connectorColor` property per feature from the active lens + strategy. Add a helper and call it where features are assembled:

```js
function connectorLensColor(props) {
  const mode = state.connectorLens.colorMode;
  if (mode === "off") return null;
  const edge = {
    routeClass: props.osmRouteClass ?? props.routeClass,
    roadType: props.roadType,
    accessStatus: props.accessStatus,
  };
  if (mode === "class") return connectorClassColor(edge.routeClass);
  const verdict = evaluateConnectorEdge(edge, state.connectorLens.strategy);
  if (mode === "eligibility") return verdict.allowed ? "#1b7837" : "#9ca3af";
  return connectorCostColor(verdict.multiplier); // "cost"
}
```

Attach it to each base-graph feature's `properties.connectorLensColor` when assembling the collection (invalidate the `baseGraphCollection` cache when `colorMode`/`strategy` change — extend the existing cache-key check that already compares `graphEdges`/`manualBaseEdges`).

4. Update the `base-graph-edges-layer` paint (`~6893`) so the lens color wins when set:

```js
        "line-color": [
          "case",
          ["==", ["get", "source"], "manual"],
          BASE_GRAPH_LINE_COLOR,
          ["coalesce",
            ["get", "connectorLensColor"],
            ["get", "graphColor"],
            BASE_GRAPH_FALLBACK_LINE_COLOR],
        ],
```

- [ ] **Step 6: Manual verification**

Open the editor, enter the **base** workspace, load base overlay data. Add a temporary dev hook (or use the panel from Task 7) to set `state.connectorLens.colorMode = "eligibility"` and re-render. Confirm: `road`/`local_road` edges turn green, `cycle`/`path_track` turn grey. Switch to `"cost"` and confirm allowed edges shade by multiplier. Click `e582912979_1` / `e306636823_2` / `e1036215799_1` and confirm they render as excluded (grey) under the default strategy.

- [ ] **Step 7: Commit**

Add `&& node tests/test-connector-colors.mjs` to the `test` script in `package.json`.

```bash
git add editor/lib/connectorColors.mjs tests/test-connector-colors.mjs editor/editor.js package.json
git commit -m "feat(editor): connector lens coloring (class / eligibility / cost) for base edges"
```

---

## Task 7: Strategy panel + frequency-run UI

**Files:**
- Modify: `editor/index.html` (panel markup), `editor/styles.css` (panel styles), `editor/editor.js` (controls, run, layers)

**Interfaces:**
- Consumes: `state.connectorLens` (Task 6); `POST /api/connector/preview` (Task 5); `DEFAULT_CONNECTOR_STRATEGY`.
- Produces: a "Connector Lens" panel visible in the base workspace with a color-mode selector, strategy editors, Reset/Copy, target-route + radius controls, a Run button, and rendered usage/origin layers.

- [ ] **Step 1: Add panel markup**

In `editor/index.html`, near the existing base-graph panel (`id="base-graph-panel"`), add a `connector-lens-panel` containing:
- a `<select id="connector-color-mode">` with options `off` / `class` / `eligibility` / `cost`;
- a legend container `<div id="connector-legend">`;
- per-class multiplier inputs (`road`, `local_road`, `cycle`, `path_track`, `manual`, `other`) each a number input + an "excluded" checkbox;
- per-access policy rows for `restricted` and `conditional` (number + excluded checkbox);
- an `uphillWeight` number input and a `snap` select (`allowed-only` / `any`);
- buttons `Reset to production` and `Copy strategy JSON`;
- a target row: `Route: <select id="connector-target-route">`, `Radius (m): <input id="connector-radius">`, `Run` button `id="connector-run"`;
- a `<div id="connector-run-status">` for stats.

- [ ] **Step 2: Wire strategy editing (live recolor)**

In `editor/editor.js`, add change handlers that mutate `state.connectorLens.strategy` and `state.connectorLens.colorMode`, invalidate the base-graph collection cache, and re-render (call the existing render/refresh path that pushes `baseGraphCollection()` to the source). An "excluded" checkbox sets the corresponding `classMultipliers`/`accessPolicy` value to `null`; unchecking restores the number input's value. `Reset to production` does `state.connectorLens.strategy = structuredClone(DEFAULT_CONNECTOR_STRATEGY)` and repopulates inputs. `Copy strategy JSON` writes `JSON.stringify(state.connectorLens.strategy, null, 2)` to the clipboard via `navigator.clipboard.writeText`. Render the legend from `CONNECTOR_COST_LEGEND` / `CONNECTOR_CLASS_LEGEND` per the active mode.

- [ ] **Step 3: Populate target routes**

Populate `#connector-target-route` from the editor's existing route list (`/api/featured-slugs` + snapshot endpoints already used by Route Catalog mode). On selection, resolve the route's start point (`endpoints.start` / snapshot first coordinate) and store it as `state.connectorLens.targetStart = { lat, lng }`. If no route is selected, allow a fallback: clicking the map with the panel open sets `targetStart` (reuse the existing base-mode click handler; guard on a "pick target" toggle).

- [ ] **Step 4: Add usage + origin layers and the Run handler**

Add two GeoJSON sources/layers (created once, like the existing base layers ~6840+):
- `connector-usage` (line layer): width and color scaled by a per-feature `count` (use a Mapbox `interpolate` expression on `["get","count"]`, e.g. width 1→8, color light→dark).
- `connector-origins` (circle layer): color by `status` (`ok` → green, else red/orange) via a `match` expression.

The Run handler:

```js
async function runConnectorFrequency() {
  const target = state.connectorLens.targetStart;
  if (!target) { setStatus("Pick a target route/point first", "error"); return; }
  setStatus("Running connector frequency…");
  const res = await fetch("/api/connector/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "frequency",
      routeStart: target,
      strategy: state.connectorLens.strategy,
      radiusMeters: Number(document.getElementById("connector-radius").value) || 2000,
      gridSpacingMeters: 150,
      maxOrigins: 400,
    }),
  });
  if (!res.ok) { setStatus(`Connector run failed (${res.status})`, "error"); return; }
  const data = await res.json();
  renderConnectorUsage(data.edgeUsage);   // join counts onto base-graph geometry by edgeId
  renderConnectorOrigins(data.origins);   // circles at origin lat/lng colored by status
  const s = data.stats;
  document.getElementById("connector-run-status").textContent =
    `origins ${s.total} · ok ${s.ok} · failed ${s.failed}` +
    (data.grid.capped ? ` · grid coarsened to ${Math.round(data.grid.spacingMeters)}m` : "");
}
```

`renderConnectorUsage` builds a FeatureCollection by looking up each `edgeId` in the already-loaded base-graph features (there is an existing `baseFeaturesByEdgeId` cache ~1899 — reuse it) and attaching `count`. `renderConnectorOrigins` builds point features from `data.origins`.

- [ ] **Step 5: Click-an-origin → single path**

Add a click handler on `connector-origins` that POSTs `{ mode: "single", routeStart: target, origin, strategy }`, then draws the returned `geometry` into a `connector-single-path` line layer (create it once). Clear it when a new frequency run starts.

- [ ] **Step 6: Manual verification**

In the editor base workspace: open the Connector Lens panel, pick a real route as target, set radius 2000, click Run. Confirm: usage heatmap appears over base edges near the start; origin dots show ok/failed; the status line reports counts. Toggle `cycle` from excluded to a finite multiplier and Run again — confirm usage shifts onto cycle edges and fewer origins fail. Click a failed origin and confirm either no path or a drawn path. Click Copy strategy JSON and paste elsewhere to confirm valid JSON.

- [ ] **Step 7: Commit**

```bash
git add editor/index.html editor/styles.css editor/editor.js
git commit -m "feat(editor): connector-lens strategy panel + usage-frequency run UI"
```

---

## Task 8: Edge-inspector connector verdict

**Files:**
- Modify: `editor/editor.js` (the base-edge click/inspection panel that renders `BASE_EDGE_PROPERTY_PRIORITY`, ~1290–1330 and its render site)

**Interfaces:**
- Consumes: `evaluateConnectorEdge`, `state.connectorLens.strategy` (Tasks 1, 6).
- Produces: a "Connector verdict" line in the edge inspector showing allowed/excluded, multiplier, and the deciding rule.

- [ ] **Step 1: Add a verdict formatter**

In `editor/editor.js`, add:

```js
function connectorVerdictText(props) {
  const edge = {
    routeClass: props.osmRouteClass ?? props.routeClass,
    roadType: props.roadType,
    accessStatus: props.accessStatus,
  };
  const strategy = state.connectorLens.strategy;
  const v = evaluateConnectorEdge(edge, strategy);
  if (!v.allowed) {
    const accessExcluded =
      edge.accessStatus && strategy.accessPolicy?.[edge.accessStatus] == null;
    const reason = accessExcluded
      ? `access "${edge.accessStatus}" excluded`
      : `class "${edge.routeClass}" excluded`;
    return `excluded — ${reason}`;
  }
  return `allowed — ×${v.multiplier.toFixed(2)}`;
}
```

- [ ] **Step 2: Render it in the inspector**

Where the selected base edge's properties are rendered into the panel, prepend a row labeled "Connector" with `connectorVerdictText(selectedProps)`. Re-render this row whenever `state.connectorLens.strategy` changes (fold into the same re-render triggered by the strategy panel in Task 7).

- [ ] **Step 3: Manual verification**

Open the base workspace, click `e582912979_1` — the inspector shows `excluded — …`. Soften its class in the panel and confirm the row flips to `allowed — ×N` live. Click a `road` edge and confirm `allowed — ×1.00`; a `restricted` road shows `excluded — access "restricted" excluded`.

- [ ] **Step 4: Commit**

```bash
git add editor/editor.js
git commit -m "feat(editor): connector verdict line in the base-edge inspector"
```

---

## Final verification

- [ ] **Run the full JS test chain (or at least the new + adjacent tests):**

```bash
node tests/test-connector-cost-model.mjs
node tests/test-connector-strategy.mjs
node tests/test-connector-sampling.mjs
node tests/test-connector-preview.mjs
node tests/test-connector-colors.mjs
node tests/test-preview-base-route.mjs
node tests/test-compute-connector.mjs
```
Expected: all print their `OK` / pass with no assertion failures.

- [ ] **Manual editor pass:** base workspace → Connector Lens → eligibility/cost coloring, edit strategy live, run a frequency scenario against a real route, inspect the three named edges, copy strategy JSON.

- [ ] **Confirm no data files changed:** `git status` shows only source/test/editor files — never `data/map-source.geojson`, `public-data/`, or base-graph assets.

## Self-review notes (traceability to design)

- Design "Component A" → Tasks 1–2. "Component B" (server) → Tasks 3–5. "Component C" (client lens: classification/eligibility/cost coloring, strategy panel, frequency run, edge inspector) → Tasks 6–8.
- Behavior-preserving default → Task 2 Step 8 regression; asserted by `test-preview-base-route`/`test-compute-connector` passing unchanged.
- "Single run folded in as frequency building block" → Task 4 (`mode:"single"`) + Task 7 Step 5.
- "No data edits / ephemeral strategy / export JSON" → Global Constraints + Task 7 Step 2 (Copy JSON) + Final verification `git status` check.
- Known follow-up left explicit, not silent: the exact base-edge id property returned by `previewBaseRoute().segments` must be verified during Task 4 (noted inline) rather than assumed.
