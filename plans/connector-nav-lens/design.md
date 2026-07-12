# Connector Navigation Lens — Design

**Date:** 2026-07-08
**Status:** Approved, pending implementation plan
**Topic dir:** `plans/connector-nav-lens/`

## Problem

The iOS app's "connector" — the routed suggestion showing how to reach a route's
start (or rejoin point) from the rider's current position — is currently turned
off because its fidelity is low. The root cause is that the connector's notion of
*which roads exist and are usable* is a set of hard, binary gates baked from OSM
tags at pipeline build time:

- `_connectorEdgeAllowed(edge)` excludes every edge that is not `routeClass`
  `road`/`local_road` (so all `cycle`, `path_track`, `manual`, `other` are
  dropped), and excludes any `road` tagged `accessStatus` `restricted` or
  `conditional`.
- `_connectorCostMultiplierFor(edge)` then applies `road → ×1.0`,
  `local_road → ×1.1`, plus an uphill penalty.
- The CycleWays route network already encodes curated ownership of base edges,
  but connector eligibility did not treat that ownership as stronger evidence
  than the underlying OSM/base-map tags.

Because the gates are binary and depend on OSM tag completeness, the connector
often refuses perfectly good roads or snap-fails entirely (e.g. when a route
start sits on a cycleway, which is excluded). Concrete edges the user knows are
mis-handled: `e582912979_1`, `e306636823_2`, `e1036215799_1`.

We want a way to **see** the base edge network through the connector's eyes,
**understand** why specific edges are picked or excluded, and **tune** the cost
model live to find a better strategy — before committing any change to the
production routing engine. No production data is edited; the connector remains
off until a better strategy is chosen.

## Goal

A diagnostic + tuning lens inside the editor's existing **base** workspace that:

1. Colors and inspects the base network by classification and by connector
   eligibility/cost.
2. Lets the user tune the connector cost model live (single strategy, live
   re-run) and see the heatmaps update instantly.
3. Runs the **real** connector routing engine (not a reimplementation) to
   produce a real usage-frequency heatmap toward a selected route's start.

Whatever strategy the user lands on here is expressed in the same config object
that could later be baked into `route-manager.js`.

## Non-goals (explicit scope cuts / YAGNI)

- **No A/B compare.** Single strategy, live re-run, with a "reset to production"
  baseline button.
- **No strategy persistence.** The strategy lives in editor client state only,
  is never written to disk, and is exportable as JSON to paste into
  `route-manager` later.
- **No editing of classifications or underlying OSM data.** This lens is
  read-only with respect to map data; it changes only the (ephemeral) cost
  strategy.
- **No standalone "run one connector" feature.** A single-origin run is folded
  in as the building block of the frequency map and surfaced by clicking an
  origin.
- **Usage-frequency scenario is fixed:** target = a selected route's start;
  origins = a radius grid around it.

## Enabling facts (verified in code)

- The editor **browser** (`editor/editor.js`) already has a `base` workspace
  mode that renders every base-graph edge (`base-graph-edges-layer` from the
  `base-graph-edges` source, fed by `state.baseOverlay.graphEdges`), and a click
  panel that inspects edge properties including `osmRouteClass`, `roadType`,
  `accessStatus`, `highway`, `oneway`, `distanceMeters`, node ids.
- The editor **server** (`editor/server.mjs`) already imports
  `createRouteManager` and builds a real `RouteManager` with the base routing
  network (`getBaseRoutingDecodeAssets` → `createRouteManager`). HTTP endpoints
  are simple `if (method && pathname)` dispatch blocks in `createServer`.
- The editor already has route-start/end awareness (Route Catalog mode,
  `endpoints.start`, `/api/featured-slugs`, featured-route snapshots on the
  server), so "target = a selected route's start" is available.
- Today the connector cost is pre-baked into the routing adjacency
  (`edge.connectorCost`, `route-manager.js` ~line 1050) and read during search
  (~line 1711). A tunable strategy therefore requires computing edge cost live
  during search when a custom strategy is supplied.

## Architecture

Three components plus a testing story.

### Component A — Shared connector cost model (enabling refactor)

New pure module `packages/core/src/routing/connectorCostModel.js`:

- `DEFAULT_CONNECTOR_STRATEGY` — a declarative object encoding **exactly** the
  intended connector values:
  - `classMultipliers`: `{ cw_network: 0.8, road: 1, local_road: 1.1 }`, with every other
    `routeClass` (`cycle`, `path_track`, `manual`, `other`) → excluded.
    `roadType === "road"` also maps to the `road` multiplier (mirrors the
    current `|| edge.roadType === "road"` allowance).
    `cw_network` is not an OSM class; it applies when the edge has accepted
    CycleWays ownership (`cwSegmentIds` / `cyclewaysSegmentIds`). It is evaluated
    before base-map class/access gates, making CW-owned edges connector-eligible
    even if OSM/base tags would otherwise exclude them.
  - `accessPolicy`: `{ restricted: "excluded", conditional: "excluded" }`; all
    other statuses pass with multiplier 1. CW-owned edges bypass this base-map
    access policy by using the `cw_network` multiplier.
  - `uphillWeight`: the existing `baseRoutingUphillCostMetersPerMeter`.
  - `snap`: `"allowed-only"` (endpoints may snap only to allowed edges) — the
    current behavior; alternative value `"any"`.
- `evaluateConnectorEdge(edge, strategy) → { allowed: boolean, multiplier: number }`
  — the single source of truth for **both** gates (eligibility and cost). An
  excluded edge returns `{ allowed: false, multiplier: Infinity }`.

`route-manager.js` refactor:

- `_connectorEdgeAllowed` and `_connectorCostMultiplierFor` delegate to
  `evaluateConnectorEdge` with the active strategy (defaulting to
  `DEFAULT_CONNECTOR_STRATEGY`). With the default strategy, existing
  road/local-road behavior is preserved while CW-owned edges gain the requested
  connector eligibility through `cw_network`.
- `previewBaseRoute(points, { costProfile, connectorStrategy })` gains an
  optional `connectorStrategy`. When present, the connector graph search computes
  edge traversal cost **live** from the strategy (via the shared model) instead
  of reading the pre-baked `edge.connectorCost` field, and the snap `edgeFilter`
  uses the strategy's eligibility + `snap` mode. When absent, behavior is
  unchanged (baked cost, allowed-only snap).

This module is the bridge between the editor experiment and any future
production change: the same strategy shape is consumed at runtime and in the
editor.

### Component B — Server endpoint `POST /api/connector/preview`

Reuses the editor server's existing `RouteManager`. Request body:

```json
{
  "routeStart": { "lat": 0, "lng": 0 },
  "strategy": { /* connector strategy object */ },
  "radiusMeters": 2000,
  "gridSpacingMeters": 150,
  "mode": "frequency"
}
```

- `mode: "frequency"` — generate a grid of origin points within `radiusMeters`
  of `routeStart` at `gridSpacingMeters` spacing, run
  `previewBaseRoute(origin → routeStart, { costProfile: "connector",
  connectorStrategy })` for each origin, and accumulate:
  - per-`edgeId` usage counts,
  - per-origin outcome (`ok` / `snap-failed` / `no-path` / `no-coverage`).
  Grid size is capped (e.g. ≤ ~400 origins) so a run stays responsive; if the
  requested radius/spacing exceeds the cap, spacing is coarsened and the response
  reports the effective grid. Coverage for the radius bbox is ensured before the
  runs.
  - Response: `{ edgeUsage: { [edgeId]: count }, origins: [{ lat, lng, status }],
    stats: { total, ok, failed, byFailure } }`.
- `mode: "single"` — one `origin` → returns the picked path geometry and its
  per-edge cost breakdown. This is the frequency map's building block and also
  serves the "click an origin to see its path" interaction.

The endpoint restores the manager's cached route/failure after previews (as
`computeConnector` already does) so diagnostics never disturb other editor
state.

### Component C — Editor client: the lens (inside base workspace)

Added to the existing `base` workspace mode (no new top-level workspace):

1. **Classification coloring** — recolor `base-graph-edges-layer` by a chosen
   attribute: `routeClass`, `accessStatus`, or **connector-eligibility**
   (allowed vs. excluded under the current strategy), each with a legend.
   Connector-eligibility coloring is what directly explains why `e582912979_1`,
   `e306636823_2`, `e1036215799_1` are excluded.
2. **Cost heatmap** — color edges by their strategy **multiplier**, computed
   **client-side** via the shared `connectorCostModel` (the editor already holds
   every edge's properties in `state.baseOverlay.graphEdges`). This updates
   *instantly* as the strategy is edited. Excluded edges (multiplier `Infinity`)
   render greyed/dashed. Uses a colorblind-safe sequential ramp with a discrete
   "excluded" swatch.
3. **Strategy panel** — editable controls bound to the strategy object: per-class
   multiplier (including the special `cw_network` multiplier and turning
   `cycle`/`path_track` from excluded into a finite penalty), per-`accessStatus`
   policy (excluded vs. finite penalty), uphill weight, and snap looseness
   (`allowed-only` vs. `any`). Includes a **"Reset to production"** button
   (loads `DEFAULT_CONNECTOR_STRATEGY`) and a **"Copy as JSON"** button.
4. **Frequency run** — select a route (its start becomes the target) → set radius
   → **Run** → `POST /api/connector/preview` (`mode: "frequency"`) → render the
   usage heatmap (edge width and/or color by count) plus origin dots colored by
   outcome. Clicking an origin issues a `mode: "single"` request and draws that
   origin's picked path.
5. **Edge inspector** — extend the existing click panel to show the selected
   edge's connector verdict under the current strategy: `allowed?`, `multiplier`,
   and which rule produced it (class multiplier vs. access policy vs. excluded).

### Data flow

- **Classification + cost heatmaps:** pure client-side, instant, live on every
  strategy edit — no server round-trip (uses the shared `connectorCostModel` and
  the already-loaded `graphEdges`).
- **Frequency + single-path runs:** client → `/api/connector/preview` → real
  `RouteManager` (with injected strategy) → back to client.
- **Strategy:** held in editor client state only; sent to the server per run;
  never persisted to disk; exportable as JSON.

### Error handling

- Endpoint validates `routeStart`, `strategy`, and grid params; returns a
  structured `400` on malformed input.
- Per-origin routing failures are **data, not errors**: they are counted by
  reason and surfaced as colored origin dots + a stats summary, so a strategy
  that snap-fails everywhere is visible rather than silent.
- Coverage failures for the requested bbox return a clear message; the client
  shows it in the existing status bar.
- Client-side cost heatmap treats a missing/invalid edge property defensively
  (unknown class → excluded), matching the engine's conservative default.

## Testing

- **`connectorCostModel` unit tests:** the default strategy reproduces current
  connector verdicts for representative edges — a `road`, a `local_road`, a
  non-CW `cycle`, a `restricted`, and a CW-owned edge whose base tags would
  otherwise exclude it — using the user's named edges (`e582912979_1`,
  `e306636823_2`, `e1036215799_1`) as fixtures where their properties are known.
  A softened strategy (e.g. `cycle` finite) flips the expected verdict, and the
  default `cw_network` multiplier makes CW-owned edges eligible.
- **`route-manager` regression:** existing `tests/test-compute-connector.mjs`
  and `tests/test-preview-base-route.mjs` pass unchanged under the default
  strategy, and the new CW-owned-edge regression proves the intentional
  eligibility change.
- **Endpoint test** on a small synthetic base network: a `frequency` run returns
  the expected per-edge usage counts and outcome stats; changing the strategy to
  soften `cycle` from excluded → finite changes the picked path / usage counts.
- **Client pure helpers:** origin-grid generation and the cost→color scale are
  unit-tested; heavy DOM/map wiring is exercised manually in the editor.

## Open questions resolved during brainstorming

- Primary goal → **Diagnostic + tune strategy** (no classification editing).
- "Pick-likelihood" meaning → **cost heatmap (attractiveness)** + **usage
  frequency (true likelihood)**; single-run folded in as the building block.
- Frequency scenario → **target = selected route's start; origins = radius grid**.
- Comparison → **single strategy, live re-run** (with reset-to-production).
