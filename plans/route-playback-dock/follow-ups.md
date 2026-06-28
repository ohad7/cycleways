# Follow-ups — route-playback-dock

## C1 — iOS web-parity `progress-head-pulse` cursor (split from the main plan)

The implementation plan (`implementation-plan.md`) delivers the usable three-up
layout + bidirectional sync + no auto-play, but **keeps the existing iOS playback
marker (a single playback-driven dot)**. Matching web's pulsing-head visual is a
separate, sizable sub-project and is deferred to its own plan.

**Why split:** web's cursor is built by `buildVideoCursorLayerData` +
the variant property tables + a pulse-phase rAF in
`src/map/mapLayers.product.js` (~300 lines, DOM/mapbox-gl coupled, three sources:
progress line, trail line, head/pulse/symbol). Porting it faithfully to
`@rnmapbox` requires: (a) extracting the pure feature/data builder + variant
tables + pulse profile into `@cycleways/core`; (b) a shared pulse-phase clock;
(c) RN `CircleLayer`/`SymbolLayer`s rendering the progress/trail/head/pulse via
`paintToRNStyle(VIDEO_CURSOR_*_STYLE)`.

**When picked up:** brainstorm/scope it as its own design + plan, then execute.
The shared playback cursor (`playback.cursor` with `{lat, lng, fraction,
bearing}`) is already the input it needs.

**Status:** deferred (scope decision during planning, 2026-06-28).

## From the final whole-branch review (deferred minors)

- **#3 — iOS fit padding is keyed to build-mode, not the live sheet snap.** `mapPresentationActive` is true across the whole build panel, so a fit while the sheet is at 16%/92% frames the route imperfectly. Acceptable because the sheet defaults to and re-docks to 48%. Could react to a real sheet-index state for precision.
- **#4 — web still creates and ticks the route-direction animator with zero subscribers.** Pre-existing (not a regression), but iOS dropping its last consumer makes the subsystem dead on the surfaces we touch. Consider disabling `enableRouteDirectionAnimation` on web too, or removing the subsystem.
- **#6 — `RoutePlaybackControls.jsx` keeps a one-line `formatTime` wrapper** that just delegates to the shared `formatPlaybackTime`. Cosmetic; could call the shared fn directly.
