# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Map data and public data are editor/pipeline-owned

Every change to the map data files and promoted public data MUST come through
the editor and the Build → Promote pipeline — **never** by hand-editing these
files — unless the user gives explicit permission for a specific change.

This covers, in particular:

- `data/map-source.geojson` — the source of truth, edited only via the editor
  UI (saved through `POST /api/source`).
- `public-data/` — generated/promoted artifacts (e.g. `segments.json`,
  `bike_roads*.geojson`, `map-manifest.json`, base-routing shards). The app and
  featured pages read these via `public-data/map-manifest.json`.

If the running app appears to be missing the user's edits, the fix is to run
(or ask the user to run) Build + Promote — not to edit the generated files.

## Planning documents

All design specs and implementation plans live under `plans/`, **not** in
`docs/` or anywhere else. Use one directory per topic:

```
plans/<topic>/
  design.md               # the design spec (from brainstorming)
  implementation-plan.md  # the step-by-step implementation plan
```

- When the brainstorming skill says to write a design to
  `docs/superpowers/specs/...`, write it to `plans/<topic>/design.md` instead.
- When the writing-plans skill produces an implementation plan, write it to
  `plans/<topic>/implementation-plan.md`.
- Use a short kebab-case `<topic>` directory name (no date prefix); record the
  date inside the document.
- Add a one-line entry for each new topic to `plans/README.md`.
