# Follow-ups — rn-mobile-map-style-parity

Deferred items surfaced during implementation / final review. Not blocking the
parity branch.

## F1 — Mobile playback POI cue dwell (from final review M4)

The native build-sheet playback passes `cueSlides: NO_CUE_SLIDES` (empty), so the
preview animates the whole route at the fast "boring" rate (4×) with no
slow-down/dwell at points of interest. The mobile **web** planner derives cue
slides from the route's POIs (`routeState.activeDataPoints`) so the preview
lingers at them (see `App.jsx` `plannerCueSlides`).

**To do:** build mobile cue slides from `routeState.activeDataPoints` the way the
web planner does (ideally extract that derivation into `@cycleways/core` so both
surfaces share it — consistent with this branch's code-sharing goal), and pass a
memoized array into `useSyntheticRoutePlaybackEngine`. Memoizing is also required
to keep the engine stable (the empty `NO_CUE_SLIDES` constant currently provides
that stability).

**Status:** deferred (user decision, 2026-06-27).

## Notes already resolved on the parity branch

- Route-line dark variant is now gated to build mode (matches web) — done
  (`fix(mobile): gate route-line dark variant to build mode`).
- `getPlannerBuildModel.warningCount === poiCount` (broken-route warnings not
  counted) — plan-mandated; revisit only if a caller needs true warning counts.
