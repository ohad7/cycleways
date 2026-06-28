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
