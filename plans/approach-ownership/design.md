# App-Owned Approach with Confidence-Gated Handoff — Design

**Date:** 2026-07-09
**Status:** Approved, pending implementation plan
**Topic dir:** `plans/approach-ownership/`
**Builds on:** [connector-nav-lens](../connector-nav-lens/design.md) (shared connector cost model, `cw_network` eligibility, the editor lens), [approach-destination-picker](../approach-destination-picker/design.md) (`externalNav.js`, approach target UX), [navigation-intro-rethink](../navigation-intro-rethink/design.md) (external handoff at every distance — this design supersedes that default).

## Problem & intent

The full-route turn-by-turn (riding the CycleWays route) is already app-owned. The **approach leg** — getting the rider from their current position to the route *start* (or a rejoin point) — is today handed off to external apps (Waze / Google / Apple / Moovit), because the in-app connector routing over the base graph was not trusted.

Two problems with the handoff-by-default:

1. **We give up the user's context to another app** on the very leg where, increasingly, we route as well or better — especially over the curated CycleWays network. A rider dropped into Waze may not return.
2. The reason for the handoff (low connector fidelity) is now addressable: the `connector-nav-lens` work produced a tunable cost model and, crucially, `cw_network` eligibility that treats CW-owned base edges as first-class connector edges.

**Intent:** invert the default. The app **owns the approach** with turn-by-turn guidance when it is confident, and external handoff becomes a **demoted, confidence-gated fallback** — surfaced only when our connector is not trustworthy for this specific origin→start pair, or the start is simply too far to guide.

The blocker is measuring "confident." We do not hand-craft a confidence formula blind; we **collect a labeled dataset in the editor** and set **interpretable thresholds** by eye against it.

## Key correction that motivates this: illegal origins vs. real gaps

A frequency run on `banias-gan-hatsafon` showed ~240/356 origins failing under the default strategy. That number is misleading. `previewBaseRoute` already returns *distinct* failure reasons:

- `snap-failed` — the origin could not attach to any eligible edge = **the rider is not on the network** (a field, water, a closed area). A rider would never actually start there; this is not a connector failure.
- `no-path` — the origin snapped but the router could not reach the start = a **real** connector gap.

So the honest quality signal is the `no-path` slice, not the raw failure count. Component 1 makes this distinction first-class.

## Goal

1. Trust the connector numbers (separate illegal origins from real gaps).
2. Build a labeled dataset of connector routes (valid / unacceptable / borderline) in the editor.
3. Derive interpretable confidence thresholds from that dataset, evaluated in the editor.
4. At ride time, use those thresholds to decide, per tier, whether to **guide** (turn-by-turn), **show a leg** (visual only), or declare **too far** — demoting external handoff to a confidence-gated fallback.

## Non-goals (YAGNI)

- **No fitted/ML confidence model.** Interpretable thresholds only; revisit only if the dataset shows thresholds cannot separate the classes.
- **No population/parking-based origin sampling.** The radius grid stays; the metric simply excludes unreachable origins.
- **No new external-nav integrations.** `externalNav.js` is reused as-is; only its prominence changes.
- **No embedding of external app UI.** (iOS forbids it; unchanged from prior designs.)
- **No final threshold numbers baked in.** Thresholds ship as calibrated-later interpretable defaults; the editor calibration loop sets them once data exists.

## Enabling facts (verified in code)

- The frequency endpoint (`editor/lib/connectorPreview.mjs`) already records per-origin `status` and `stats.byFailure` with the reasons above.
- `previewBaseRoute` returns `edgeIds`; the base edges (`routeClass`, `cwSegmentIds`, `lengthMeters`) live in the route manager's `baseRoutingEdges`, so a per-edge descriptor is cheap to add.
- `buildRouteCues(navigationRoute)` (`navigationCues.js`) generates cues from *any* geometry (turn angles, junction gating, POIs). `buildEffectiveNavigationRoute(sourceRoute, selection)` (`effectiveNavigationRoute.js`) already assembles the effective route at nav-start and supports `splitGeometryAtProgress`. The tracker follows progress along a geometry — so a prepended leg needs no new tracking machinery.
- `externalNav.js` provides the installed-app registry and `buildUrl(point)` deep links; the approach UI currently presents it as a co-equal up-front choice.

## Architecture — five components

### Component 1 — Honest connector metric (editor + preview core)

Make the failure distinction first-class instead of a flat "failed" count.

- `runConnectorPreview` (frequency) adds: `stats.reachable = ok + no-path` (origins that could start) and `stats.reachableQuality = ok / reachable`. `total`, `ok`, `failed`, `byFailure` remain for transparency. `no-coverage` / `no-base-network` are reported separately and never count toward quality.
- Lens UI shows both raw `total` and `reachableQuality` (e.g. "reachable 116/124 = 94%"), plus the `byFailure` breakdown, and a **"hide unreachable origins"** toggle that removes `snap-failed` dots from the map.

**Files:** `editor/lib/connectorPreview.mjs`; `editor/editor.js`, `editor/index.html`, `editor/styles.css`.
**Test:** extend `tests/test-connector-preview.mjs` — `reachable`/`reachableQuality` exclude `snap-failed` and count `no-path`.

### Component 2 — Connector labeling + dataset (editor)

Builds on the existing single-path draw (`runConnectorSingle` + `connector-single-path`).

- After a frequency run, its **snapped** origins form a labelable set. Click an origin dot **or** step with `[` / `]` (prev/next); the current origin's connector path draws and the origin is highlighted.
- `v` = valid, `i` = unacceptable, `b` = borderline. Each keypress writes one record and auto-advances to the next unlabeled snapped origin. Labeled origins show a colored ring (green/red/amber); pressing again re-labels. `snap-failed` origins are skipped in the stepping order.
- Persistence: **append-only JSONL** at **`data/connector-eval/labels.jsonl`** via a new **`POST /api/connector/label`** endpoint. This directory is **new and non-pipeline** — it must never enter the Build→Promote flow. Labels are **committed to git** (small, versioned ground truth). One record per keypress:

```json
{
  "ts": "2026-07-09T...Z",
  "routeSlug": "banias-gan-hatsafon",
  "routeStart": { "lat": 0, "lng": 0 },
  "origin": { "lat": 0, "lng": 0 },
  "strategyHash": "sha256:...",
  "verdict": "valid | unacceptable | borderline",
  "features": { /* Component 3 features, computed once at label time */ }
}
```

- **Strategy provenance:** each label stores `strategyHash`; the full strategy is written once to a sidecar `data/connector-eval/strategies.json` keyed by hash. A label is interpretable only against the strategy that produced it; a material strategy change means relabeling.

**Files:** `editor/editor.js`, `editor/index.html`, `editor/styles.css`; `editor/server.mjs` (`POST /api/connector/label`); `editor/lib/connectorLabelStore.mjs` (append/read, testable).
**Test:** `tests/test-connector-label-store.mjs` — appends a well-formed record; rejects malformed input.

### Component 3 — Shared connector features + confidence (core, testable)

One feature/confidence path used **identically** by editor labeling and app runtime (single source of truth).

**Feature extraction** — `packages/core/src/routing/connectorFeatures.js`:

```
computeConnectorFeatures(connectorResult) → {
  snapOk,               // both endpoints snapped
  routedMeters,         // connector path length
  straightLineMeters,   // origin → start crow-flies
  detourRatio,          // routedMeters / straightLineMeters
  cwNetworkFraction,    // length on cw-owned edges / routedMeters
  worstRouteClass,      // worst class encountered (cw_network < road < local_road < ...)
  edgeCount
}
```

To feed this cheaply, `previewBaseRoute` / `computeConnector` gain an **additive** per-edge descriptor:

```
edges: [{ id, routeClass, cwOwned, lengthMeters }]
```

(extends the existing `edgeIds`, populated from `baseRoutingEdges`). Features are then pure over the connector result — no second lookup — and identical in editor and app.

**Classification** — `packages/core/src/routing/connectorConfidence.js`:

```
classifyConnector(features, thresholds) → {
  tier: "guide" | "show-leg" | "too-far",
  handoffSuggested: boolean,
  reasons: string[]        // which thresholds fired (debug / telemetry)
}

DEFAULT_CONNECTOR_THRESHOLDS = {
  guideRadiusMeters,       // straight-line ≤ this → eligible to guide
  tooFarRadiusMeters,      // straight-line > this → too-far
  maxDetourRatio,          // routed/straight above this → downgrade from guide
  maxRoutedMeters,         // hard cap on routed distance for guiding
  worstClassAllowed        // do not guide over a class worse than this
}
```

Rule sketch (tunable, calibrated later): `too-far` if beyond `tooFarRadiusMeters` or `!snapOk`; else `guide` if within `guideRadiusMeters` and detour ratio / routed distance / worst class within limits; else `show-leg`. Threshold *values* are calibrated-later interpretable defaults, not final numbers.

**Calibration loop (editor):** an **"evaluate thresholds vs. labels"** panel reads `labels.jsonl`, runs `classifyConnector` on each record's stored features under the current thresholds, and shows a confusion readout — e.g. "would guide 92% of `valid`, would wrongly guide 6% of `unacceptable`". A pure `connectorEvaluate.js` helper does the scoring.

**Tests:** `tests/test-connector-features.mjs` (features incl. detour ratio + cw fraction from a synthetic connector), `tests/test-connector-confidence.mjs` (each tier boundary), `tests/test-connector-evaluate.mjs` (confusion counts on a fixture label set).

### Component 4 — Runtime approach ownership (app / core nav)

At nav-start and while approaching, the app computes the connector (already happens), then `computeConnectorFeatures` → `classifyConnector` → branch by tier.

**`guide` — narrated turn-by-turn to the start (the connector as a leading leg):**

- `buildEffectiveNavigationRoute` gains an optional `approachLeg` (connector geometry). The combined geometry is `[connector … routeStart … route …]`, with `distanceFromStartMeters` offset so the connector occupies `[-connectorLen, 0]` and the real route stays at `[0, +]`. **The seam at progress 0 is the route start.**
- `buildRouteCues` runs over the combined geometry, narrating connector turns like route turns. At the seam, a distinct **`join-route`** cue announces joining the route (kept separate from `arrive`).
- Status stays **`approaching`** while progress < 0 and flips to **`navigating`** at the seam. The existing tracker / off-route / rejoin machinery is unchanged — it already tracks progress along a geometry.
- Connector vertices are tagged `leg: "approach"` so the map styles the approach leg distinctly (dashed / different color) from the CW route.

**`show-leg` — visual only:** draw the connector path + live compass/distance to the start; **no voice**. Secondary external-handoff button present. (Effectively today's non-narrated dashed suggestion, now chosen deliberately by tier.)

**`too-far` — do not draw:** "Start is X km away — too far to guide," with external handoff as the primary offered action.

**Recompute:** as the rider moves toward the start, the connector and therefore the tier recompute under the existing move-gating (`REQUEST_MIN_MOVE_M`), so someone approaching crosses `too-far → show-leg → guide` naturally.

**Off-route on the approach:** leaving the connector leg triggers the existing rejoin logic within the leg (the connector is just route geometry to the tracker). A hard divergence recomputes a fresh connector from the new position.

**Files:** `effectiveNavigationRoute.js` (approachLeg prepend + seam offsets), `navigationCues.js` (`join-route` cue), `navigationSession.js` (tier branch, status seam, connector→leg assembly), `navigationPresentation.js` (leg styling), plus mobile nav-runtime wiring.
**Tests:** effective route with approach leg (progress offsets + seam), cue generation emits `join-route` at the seam, session transitions `approaching → navigating` at the seam, tier branching drives the correct state.

### Component 5 — External handoff demotion (app UI)

`externalNav.js` is unchanged; only prominence changes, driven by the Component 3 tier.

- Primary flow no longer leads with "navigate in another app"; it moves to a secondary/hidden control.
- Prominence by tier: `guide` → hidden behind an overflow/"navigate differently" affordance; `show-leg` → secondary button beside the drawn leg; `too-far` → primary offered action.
- The travel-mode caveat ("external app owns the approach; Waze has no cycling mode") rides along wherever the list appears.
- The target coordinate handed to the external app is the same effective start the connector targeted — consistent whether we guide or hand off.

**Files:** mobile approach UI components + `navigationPresentation.js` (control prominence per tier).
**Test:** presentation-level — the handoff control's prominence (`hidden` / `secondary` / `primary`) is driven by tier, via the existing presentation test harness.

## Data flow

- **Editor labeling:** frequency run → per-origin single connector → `computeConnectorFeatures` → human verdict → `POST /api/connector/label` → `labels.jsonl`.
- **Editor calibration:** `labels.jsonl` → `connectorEvaluate` under current thresholds → confusion readout → hand-tuned thresholds.
- **App runtime:** live origin + route start → `computeConnector` (with `edges` descriptor) → `computeConnectorFeatures` → `classifyConnector(thresholds)` → tier → guide / show-leg / too-far + handoff prominence.

## Error handling

- Connector compute failure at runtime is a tier input, not a crash: `!snapOk` or no path → `too-far`/handoff, never a broken guide.
- `POST /api/connector/label` validates the record shape; malformed input → structured 400 (mirrors the connector-preview endpoint).
- The calibration panel tolerates an empty/absent `labels.jsonl` (shows "no labels yet").
- Threshold config is validated on load; missing keys fall back to the calibrated-later defaults.

## Testing strategy

Pure, node-tested modules carry the logic (`connectorFeatures`, `connectorConfidence`, `connectorEvaluate`, `connectorLabelStore`, preview stats, effective-route approach leg, `join-route` cue, session seam transition). Editor UI (labeling keys/rings, calibration panel) and mobile approach UI/prominence are verified by driving the running editor/app where feasible, as in the connector-nav-lens work.

## Phasing (for the implementation plan)

- **Phase 1:** Component 1 (honest metric) — small, unblocks trust.
- **Phase 2:** Component 3 features/confidence modules + Component 2 labeling + calibration loop — produces the dataset and the tunable thresholds.
- **Phase 3:** Component 4 (runtime ownership, the large build) + Component 5 (handoff demotion).

Threshold *values* are set from real labels between Phase 2 and Phase 3; the code ships with interpretable defaults so Phase 3 is not blocked on final numbers.

## Open decisions resolved during brainstorming

- Scope → **everything** (A data collection + full runtime B), phased.
- Confidence → **interpretable thresholds, data-tuned** (no ML).
- Labeling → **click origin → path → `v`/`i`/`b`**, with `[`/`]` fast stepping.
- Guide level → **full turn-by-turn on the connector** (connector as a narrated leading leg).
- Labels location → **committed** under `data/connector-eval/` (non-pipeline); strategy provenance via `strategyHash` + sidecar.
