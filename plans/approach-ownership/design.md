# App-Owned Approach with Confidence-Gated Handoff — Design

**Date:** 2026-07-09
**Status:** Approved. `implementation-plan.md` covers Phases 1–3. Phase 3
(Components 4 & 5 — runtime approach ownership and external-handoff demotion)
ships with conservative launch thresholds and keeps the calibration loop for
later adjustment once broader labels or user feedback exist.
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

- `snap-failed` — the origin could not attach to any eligible edge. This is **not automatically** "the rider is not on the network": the point may be in a field/water/closed area, or it may sit on a real base edge that the current connector strategy excludes.
- `no-path` — the origin snapped but the router could not reach the start = a **real** connector gap.

So the honest quality signal is not the raw failure count, and it is also not allowed to blindly discard every `snap-failed`. Component 1 makes this distinction first-class by retrying `snap-failed` origins with `snap:any` for diagnostics only:

- persistent `snap-failed` = **off-network / illegal origin**, excluded from reachable quality and hidden by default.
- `snap-ineligible` = the point is on the base graph but not on an eligible connector edge under the current strategy, counted as reachable-but-failed.
- `no-path` = snapped but disconnected from the target, counted as reachable-but-failed.

## Goal

1. Trust the connector numbers (separate illegal origins from real gaps).
2. Build a labeled dataset of connector routes (valid / unacceptable / borderline) in the editor.
3. Evaluate interpretable confidence thresholds in the editor and tune them when the labeled dataset is broad enough.
4. At ride time, use those thresholds to decide, per tier, whether to **guide** (turn-by-turn), **show a leg** (visual only), or declare **too far** — demoting external handoff to a confidence-gated fallback.

## Non-goals (YAGNI)

- **No fitted/ML confidence model.** Interpretable thresholds only; revisit only if the dataset shows thresholds cannot separate the classes.
- **No population/parking-based origin sampling.** The radius grid stays; the metric simply excludes unreachable origins.
- **No new external-nav integrations.** `externalNav.js` is reused as-is; only its prominence changes.
- **No embedding of external app UI.** (iOS forbids it; unchanged from prior designs.)
- **No fitted confidence tuning before runtime ownership.** The first runtime build uses conservative interpretable defaults; the editor calibration loop remains available when broader labels or user feedback justify changing them.

## Enabling facts (verified in code)

- The frequency endpoint (`editor/lib/connectorPreview.mjs`) already records per-origin `status` and `stats.byFailure` with the reasons above.
- `previewBaseRoute` already returns `edgeCosts` traversal diagnostics with the route class / road type / CycleWays membership data needed by `computeConnectorFeatures`.
- `buildRouteCues(navigationRoute)` (`navigationCues.js`) generates cues from *any* geometry (turn angles, junction gating, POIs). `buildEffectiveNavigationRoute(sourceRoute, selection)` (`effectiveNavigationRoute.js`) already assembles the effective route at nav-start and supports `splitGeometryAtProgress`. The current main-route tracker clamps progress to the main route, so Phase 3 v1 keeps the connector as a separate approach leg and switches to the existing main route at the seam instead of prepending negative-progress geometry.
- `externalNav.js` provides the installed-app registry and `buildUrl(point)` deep links; the approach UI currently presents it as a co-equal up-front choice.

## Architecture — five components

### Component 1 — Honest connector metric (editor + preview core)

Make the failure distinction first-class instead of a flat "failed" count.

- `runConnectorPreview` (frequency) adds: `stats.reachable = ok + no-path + snap-ineligible` (origins that are on the base graph and could plausibly be real rider starts) and `stats.reachableQuality = ok / reachable`. `total`, `ok`, `failed`, `byFailure` remain for transparency. `snap-failed` / `no-coverage` / `no-base-network` are reported separately and never count toward quality.
- Lens UI shows both raw `total` and `reachableQuality` (e.g. "reachable 116/124 = 94%"), plus the `byFailure` breakdown, and a **"hide unreachable origins"** toggle that removes only persistent `snap-failed` dots from the map.

**Files:** `editor/lib/connectorPreview.mjs`; `editor/editor.js`, `editor/index.html`, `editor/styles.css`.
**Test:** extend `tests/test-connector-preview.mjs` — `reachable`/`reachableQuality` exclude persistent `snap-failed` and count both `no-path` and `snap-ineligible`.

### Component 2 — Connector labeling + dataset (editor)

Builds on the existing single-path draw (`runConnectorSingle` + `connector-single-path`).

- After a frequency run, its **snapped** origins form a labelable set. Click an origin dot **or** step with `[` / `]` (nearby prev/next); the current origin's connector path draws and the origin is highlighted.
- `v` = valid, `i` = unacceptable, `b` = borderline. Each keypress writes one record and auto-advances to a **random unlabeled** snapped origin so small labeling sessions cover the origin space better than natural-order iteration. Labeled origins show a colored ring (green/red/amber); pressing again re-labels. `snap-failed` origins are skipped in the stepping/random-sampling order.
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
- **Relabel semantics:** JSONL remains an event log, but calibration/evaluation reduces records to the latest label for the same `(routeSlug, routeStart, origin, strategyHash, featureVersion)` key. This preserves auditability without double-counting stale labels.

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

To feed this cheaply, feature extraction uses the existing `previewBaseRoute().edgeCosts` traversal diagnostics (`routeClass`, `roadType`, `cyclewaysSegmentIds`, `distanceMeters`, cost diagnostics). Phase 2 should not add a second per-edge descriptor to `route-manager.js`; runtime `computeConnector` must continue returning the same diagnostics in Phase 3.

```
edgeCosts: [{ edgeId, routeClass, roadType, cyclewaysSegmentIds, distanceMeters, ... }]
```

Features are then pure over the connector result — no second lookup — and identical in editor and app.

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

Rule sketch: `too-far` if beyond `tooFarRadiusMeters` or `!snapOk`; else `guide` if within `guideRadiusMeters` and detour ratio / routed distance / worst class within limits; else `show-leg`. Launch defaults: `guideRadiusMeters = 3000`, `tooFarRadiusMeters = 10000`, `maxDetourRatio = 2.5`, `maxRoutedMeters = 8000`, `worstClassAllowed = "local_road"`.

**Calibration loop (editor):** an **"evaluate thresholds vs. labels"** panel reads `labels.jsonl`, reduces it to the latest label per identity key, runs `classifyConnector` on each record's stored features under the current thresholds, and shows a confusion readout — e.g. "would guide 92% of `valid`, would wrongly guide 6% of `unacceptable`". A pure `connectorEvaluate.js` helper does the scoring. This loop remains for later tuning; it no longer blocks Phase 3.

**Tests:** `tests/test-connector-features.mjs` (features incl. detour ratio + cw fraction from a synthetic connector), `tests/test-connector-confidence.mjs` (each tier boundary), `tests/test-connector-evaluate.mjs` (confusion counts on a fixture label set).

### Component 4 — Runtime approach ownership (app / core nav)

At nav-start and while approaching, the app computes the connector (already happens), then `computeConnectorFeatures` → `classifyConnector` → branch by tier.

**`guide` — narrated turn-by-turn to the start (connector as a separate approach leg):**

- Phase 3 v1 does **not** prepend the connector into the main route. It builds an `approachLeg` from the connector geometry, creates cues over that leg, and keeps the main route/tracker unchanged.
- Status stays **`approaching`** while the rider is on the connector leg. The app selects approach-leg cues from approach progress; when the existing main tracker acquires the route start/seam, status flips to **`navigating`**, emits a distinct **`join-route`** cue/event, clears the approach leg, and resumes the existing main-route cue flow.
- Connector vertices/feature properties are tagged `leg: "approach"` so the map styles the approach leg distinctly (dashed / different color) from the CW route.
- A true combined route with connector progress occupying negative meters is explicitly deferred until the tracker and restore path support negative offsets.

**`show-leg` — visual only:** draw the connector path + live compass/distance to the start; **no voice**. Secondary external-handoff button present. (Effectively today's non-narrated dashed suggestion, now chosen deliberately by tier.)

**`too-far` — do not draw:** "Start is X km away — too far to guide," with external handoff as the primary offered action.

**Recompute:** as the rider moves toward the start, the connector and therefore the tier recompute under the existing move-gating (`REQUEST_MIN_MOVE_M`), so someone approaching crosses `too-far → show-leg → guide` naturally.

**Off-route on the approach:** leaving the connector leg is detected by the temporary approach-leg tracker. A hard divergence clears/downgrades the current approach leg and lets the existing move-gated connector request path compute a fresh connector from the new position.

**Files:** `navigationSession.js` (tier branch, pre-route connector request, approach-leg state/cues, seam transition), `navigationCues.js` (`join-route` cue helper/type), `navigationPresentation.js` (tier/prominence/copy), mobile nav-runtime wiring and approach UI. `effectiveNavigationRoute.js` stays unchanged in Phase 3 v1.
**Tests:** session requests a pre-route connector, classifies `guide`/`show-leg`/`too-far`, guide tier exposes narrated approach cues, `show-leg` remains visual-only, connector failures become `too-far`, and acquisition emits `join-route`/transitions `approaching → navigating`.

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
- **App runtime:** live origin + route start → `computeConnector` (with `edgeCosts` diagnostics) → `computeConnectorFeatures` → `classifyConnector(thresholds)` → tier → guide / show-leg / too-far + handoff prominence.

## Error handling

- Connector compute failure at runtime is a tier input, not a crash: `!snapOk` or no path → `too-far`/handoff, never a broken guide.
- `POST /api/connector/label` validates the record shape; malformed input → structured 400 (mirrors the connector-preview endpoint).
- The calibration panel tolerates an empty/absent `labels.jsonl` (shows "no labels yet").
- Threshold config is validated on load; missing keys fall back to the launch defaults.

## Testing strategy

Pure, node-tested modules carry the logic (`connectorFeatures`, `connectorConfidence`, `connectorEvaluate`, `connectorLabelStore`, preview stats, separate approach-leg tracking, `join-route` seam event, session seam transition). Editor UI (labeling keys/rings, calibration panel) and mobile approach UI/prominence are verified by driving the running editor/app where feasible, as in the connector-nav-lens work.

## Phasing (for the implementation plan)

- **Phase 1:** Component 1 (honest metric) — small, unblocks trust.
- **Phase 2:** Component 3 features/confidence modules + Component 2 labeling + calibration loop — produces the dataset and the tunable thresholds.
- **Phase 3:** Component 4 (runtime ownership, the large build) + Component 5 (handoff demotion).

Threshold values for Phase 3 launch are `guideRadiusMeters = 3000` and
`tooFarRadiusMeters = 10000`. They are intentionally conservative product
defaults, not a fitted model.

## Open decisions resolved during brainstorming

- Scope → **everything** (A data collection + full runtime B), phased.
- Confidence → **interpretable thresholds, data-tuned** (no ML).
- Labeling → **random origin → path → `v`/`i`/`b` → random unlabeled origin**, with click selection and `[`/`]` nearby stepping available.
- Guide level → **full turn-by-turn on the connector** (connector as a narrated leading leg).
- Labels location → **committed** under `data/connector-eval/` (non-pipeline); strategy provenance via `strategyHash` + sidecar.
