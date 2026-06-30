# Approach-to-Route Guidance Acceptance

**Date:** 2026-06-30 (redesign; supersedes the Phase B turn-by-turn connector)
**Status:** core/web automated validation complete; native per-file Babel
validation complete; iOS export + device acceptance pending local Expo/Xcode.

## Automated validation (complete)

- [x] Full `npm test` suite passes (EXIT=0), including: road-preferring
  connector profile (`test-preview-base-route`, `test-compute-connector`),
  approach target choices (`test-connector-targeting`), external-app links
  (`test-external-nav`), the rewritten session approach slot
  (`test-navigation-session`, `test-navigation-replay`), and the approach
  presentation (`test-navigation-presentation`), plus all prior regressions.
- [x] Web production build passes (`npm run build`, EXIT=0). Regenerated
  pipeline-owned `public-data/` artifacts were restored, not committed.
- [x] Native files transform under `babel-preset-expo` individually:
  `apps/mobile/src/navigation/useNavigationSession.js`,
  `apps/mobile/src/MapScreen.jsx`, `apps/mobile/src/planner/NavPanel.jsx`.

## iOS export (pending local environment)

- [ ] `cd apps/mobile && npx expo export --platform ios` (or the project's
  checked-in export command) builds without resolver/syntax errors. Not run
  here: no local Expo CLI / `apps/mobile` toolchain in this environment.
  Record the build identifiers below.

## Simulator/device acceptance (pending)

Run with the dev simulate-ride source on a simulator/device:

- [ ] **≤1 km approach:** dashed road-preferring suggestion + faint direct line
  both render and differentiate; "X to route" + the "outside the CycleWays
  network" disclaimer show; "Open in Waze / Google Maps" launches the right app
  at the target.
- [ ] **Start-vs-join prompt:** appears only when joining skips ≥
  `JOIN_SKIP_PROMPT_M`; each option re-targets the line/suggestion/external
  destination.
- [ ] **>1 km / off coverage:** suggestion suppressed; external-app button is
  primary; direct line + distance + disclaimer remain.
- [ ] **Acquisition handoff:** physically reaching the route starts Phase A
  turn-by-turn at that point (no jump, no seeded progress).
- [ ] **Mid-ride off-route:** a confirmed departure shows the approach view
  toward the nearest-ahead point (no narrated rejoin).
- [ ] **Failure:** off-graph/no-path keeps the direct line + external handoff;
  no crash; logged once.
- [ ] **Pause/stop:** pause preserves the approach slot; stop clears it and
  ignores a late suggestion result.
- [ ] Record device/build identifiers and any tuning changes
  (`CONNECTOR_NEAR_RADIUS_M`, `JOIN_SKIP_PROMPT_M`, road-preference multipliers,
  the 200 m suggestion-request gate).

## Results

Pending simulator/device execution.
