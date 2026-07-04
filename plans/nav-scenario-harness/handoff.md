# Nav Scenario Harness — Handoff

**Date:** 2026-07-03. **Branch:** `feature/navigation-ux-review` (working tree
clean; not merged to `main`). Work was stopped mid-plan for budget reasons —
this documents exactly where it stopped and how to resume.

**Plan being executed:** `plans/nav-scenario-harness/implementation-plan.md`
(design in `design.md` alongside it). The plan is self-contained: each task has
the failing test, the implementation code, the test-chain edit, and the commit
message. Resume by executing it task-by-task with
superpowers:subagent-driven-development or superpowers:executing-plans, exactly
as its header says.

## Where things stand

Tasks 1–4 of 9 are **done, committed, and verified green** (re-run on
2026-07-03):

| Task | Commit | What it added |
|------|--------|---------------|
| 1 | `23fe85e4` | `trackTools.js` (`applyGpsGap`, `insertDwell`, `cumulativeFixMeters`) + `createSeededRandom` export from `trackGenerator.js` |
| 2 | `bcb004fc` | `scenarioRunner.js` (`runScenario`, `buildUserTimeline`, `connectorRouterForMode`) |
| 3 | `5c03aad2` | `scenarioExpectations.js` (`evaluateExpectations`, full v1 vocabulary) |
| 4 | `07ab2511` | `scenarios/resolve.js` (`resolveScenario`) + synthetic `scenarios/routes/l-turn.js` |

All four test files (`tests/test-track-tools.mjs`,
`test-nav-scenario-runner.mjs`, `test-nav-scenario-expectations.mjs`,
`test-nav-scenario-resolve.mjs`) pass individually and are already inserted in
the root `package.json` `test` chain after `test-navigation-replay.mjs`.

No unchecked-in work exists — the stop happened cleanly between Task 4 and
Task 5.

## What remains (Tasks 5–9, in order)

1. **Task 5 — seed scenario library + registry + headless suite** (next up).
   Create the seven scenario modules under
   `packages/core/src/navigation/scenarios/`
   (`on-route-happy-path`, `approach-from-distance`, `missed-turn-reroute`,
   `reroute-failure`, `gps-gap`, `stop-and-stand`, `current-route-generic`),
   the `scenarios/index.js` registry, and `tests/test-nav-scenarios.mjs`
   (writes failure artifacts to `test-results/nav-scenarios/<name>.json`).
   Full code is in the plan; note the milestone-window tuning rule in the
   plan's Global Constraints if a `betweenMeters`/`beforeMeters` assertion
   fails while the artifact shows correct behavior.
2. **Task 6 — recorded real-ride scenario.** One-off conversion of
   `tests/fixtures/nav-ride-realistic.json` into
   `scenarios/recorded/ride-realistic.js` (the exact `node -e` command is in
   the plan) + `recorded-real-ride.js` scenario + registry entry.
3. **Task 7 — catalog route snapshot script + real-route scenario.**
   `scripts/nav-scenario-route-snapshot.mjs` (uses `buildLiveDecodeRoute()`
   from `editor/server.mjs`; reads `public-data/route-catalog.json`
   read-only), snapshot the `sovev-beit-hillel` slug (fallback slugs listed in
   the plan if it doesn't decode), + `sovev-beit-hillel-ride.js` scenario.
4. **Task 8 — visual runner in the app.** `DevScenarioPicker.jsx` +
   BuildScreen wiring (`__DEV__`-gated; exact line anchors are in the plan but
   BuildScreen may have drifted — re-locate `handleDevSimulate`,
   `devInnerSourceRef`, `pendingNavigationRouteId` by name, not line number).
   Requires a simulator run for the manual checklist in the plan.
5. **Task 9 — final verification:** full `npm test`, the failure-artifact
   drill (deliberately break one expectation, confirm the artifact JSON is
   agent-readable, revert), and reconcile `design.md` with what shipped.

## How to pick up

```bash
git checkout feature/navigation-ux-review
npm test        # confirm the baseline is still green before starting Task 5
```

Then open `implementation-plan.md`, go to **Task 5 Step 1**, and follow the
steps verbatim (test-first, one commit per task, commit messages given in the
plan). Check off the plan's `- [ ]` boxes as you complete steps.

## Constraints to keep honoring

- Do NOT touch `data/map-source.geojson` or anything in `public-data/`
  (pipeline-owned; Task 7's script only *reads* `route-catalog.json`).
- `packages/core/src/**` stays pure ESM with no node-only APIs (`fs`/`path`
  live in `tests/` and `scripts/` only).
- Scenario data files are `.js` modules, never `.json` (node + Metro parity).
- Hebrew expectation strings must match `navigationPresentation.js` exactly.
- If a milestone window fails but the artifact shows correct behavior, adjust
  the window — never weaken the assertion type (Global Constraints in the
  plan).
