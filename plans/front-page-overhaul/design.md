# Front Page Overhaul — Two-Column App Shell (Design)

**Date:** 2026-06-08
**Status:** Design approved; implementation plan to follow.

## Overview

Reshape the desktop front page from "giant map + small floating overlays" into a
**persistent two-column app shell**: the Mapbox map on the **left** (`flex: 1`)
and a fixed **right-side panel** (RTL, ~408px) that owns all route context. The
panel moves between two states the user toggles between:

- **Discover (`גילוי מסלול`)** — find/browse: route-finder search filters and a
  curated/recommended route list.
- **Build (`בניית מסלול`)** — the user has a drawn route: route header + edit
  tools, stat strip, an **interactive elevation graph**, route actions, route
  warnings, and auto-detected points-of-interest cards.

This is **largely a re-layout** of capabilities the app already has, not a
green-field build. The route-finder Discover content already exists as a modal
(`WelcomeWizard` + `WelcomeDiscover`); the unified play-the-route-like-a-video
timeline already exists on the front page (`useSyntheticRoutePlayback`,
`RoutePlaybackControls`, the rider cursor, POI preview cards). The overhaul
relocates today's floating overlays and the modal Discover into one persistent
panel, restyles the elevation graph, and wires **real** data into the prototype's
faked recommended-routes / POI lists.

The visual reference is the high-fidelity prototype in
`plans/front-page-overhaul/design_handoff_front_page/` ("Option A · Classic").
Colors, typography, spacing, radii, and shadows are intended to be matched
closely (see the prototype's `styles.css` `:root` tokens). This document records
where we **deliberately diverge** from that prototype based on the design review.

## Divergences from the prototype handoff

The prototype put everything in the panel and faked the map. The review settled
these changes:

1. **Route-play transport stays at the bottom of the map**, where it is today —
   not integrated into the panel. The panel's elevation graph and the bottom
   transport are two surfaces driven by the same shared `progress`.
2. **Location-search (geocoder) box stays floating at the top of the map**, where
   it is today. This is distinct from the panel's route-finder search.
3. **Elevation graph lives in the Build panel** (under the stat strip), not at the
   bottom of the map. Only the slim play/scrub transport remains at the bottom.
4. **Default state is Discover**, not Build.
5. **No hero "build your own" CTA card.** Replaced by a one-line hint near the top
   of the Discover panel that links to Build.
6. **Recommended list is curated by default, results on search** (see "Discover
   state" below), instead of always-a-filtered-finder.
7. **Panel is collapsible** via a drawer toggle to reclaim full-map width.

## Shell layout

- Full-viewport column. The existing site **header** stays on top. Below it, a
  flex **row-reverse** region (RTL) containing the **map** (`flex: 1`) and the
  **panel** (`flex: 0 0 ~408px`, on the right).
- **Panel collapse:** a toggle collapses the panel so the map takes the full
  width — for focused map work. Collapsed state should be cheap to toggle back.
- **Responsiveness / mobile:** narrow viewports stack the panel under the map via
  responsive CSS (one code path, no legacy fallback). A more refined bottom-sheet
  panel treatment is a later follow-up; the stacked layout is the baseline.

## The map keeps its current furniture

- **Geocoder search box** — stays floating at the **top** of the map, unchanged.
- **Route-play transport** — the slim play / scrub bar with the distance readout
  stays at the **bottom** of the map (today's `RoutePlaybackControls` /
  `planner-route-playback`). Appears only when a route is ready
  (`routeState.geometry.length >= 2`).
- **Road-types legend** — stays top-left.
- **Rider marker, POI pins, route line, segment highlight** — native Mapbox
  layers, as today / as the prototype's "Map Integration" section describes.

### Moved off the map into the panel

- **Undo / redo / clear** — relocate into the Build panel's route-header mini
  toolbar. (Only meaningful while building.)
- **Summary / GPX / share** — relocate into the Build panel's route actions.
- **Route warnings ("מידע חשוב")** — the on-map warnings toggle and its
  individual-warnings popover are **removed from the map**; route warnings render
  in the **Build panel** instead. The road-types legend stays on the map; the
  warnings do not.

## Panel — state toggle

A segmented toggle at the top of the panel switches **`panelState`** between
`discover` and `build` (`גילוי מסלול` / `בניית מסלול`). The toggle is always
visible so the user can override the state at any time.

### State transitions

- **Default:** `discover`.
- **Placing the first route point on the map auto-switches to `build`** — the act
  of dropping a point is the act of building, so the panel immediately reflects
  the route taking shape.
- Using the geocoder search box or clicking a recommended-route card does **not**
  switch state.
- **Clearing the route keeps the user in `build`** (still in planning mode); it
  does not bounce back to Discover.

## Discover state

Top → bottom:

- **Eyebrow + heading** (`מצא מסלול` / `מצאו את הרכיבה הבאה`).
- **One-line hint** near the top (e.g. `או סמנו נקודות על המפה ובנו מסלול משלכם`)
  that switches to Build. No hero CTA card.
- **Route-finder search** (today's `WelcomeDiscover`, relocated into the panel):
  - Start-location and "via" place filters (`PlaceAutocompleteFilter`).
  - Pill-group filters: difficulty (`קל`/`בינוני`/`קשה`), surface
    (`סלול`/`שטח/סלול`/`שטח`), length (`עד 10 ק״מ`/`10-25 ק״מ`/`25 ק״מ ומעלה`).
    Single-select per group; selected pill = green-tint fill + green border.
- **Route list — two modes:**
  - **No filters active →** a curated **`מומלצים`** list = the **featured / story
    routes** (catalog entries with `featured: true`; the same set shown on
    `/featured`). Small, editorial.
  - **Any search / filter active →** the finder over the **full catalog**
    (`catalogFilter(entries, filters)`), headed **`N מסלולים`** (count), not
    "recommended."
  - This resolves today's label collision (both `/featured` and the panel are
    titled "מסלולים מומלצים"). `/routes/` remains the full browse;
    `/featured` remains the editorial showcase.
- **Cards** use real catalog data (`RouteCard`), not placeholders. Clicking a card
  loads that route (`/?route=…`) without changing panel state.

### Map in Discover

Clean (no drawn route), road-types legend top-left, no floating tools, no on-map
route-finder search (the panel owns it). The geocoder box remains.

## Build state

Top → bottom:

- **Route header:** eyebrow (`המסלול שלי · טיוטה`), editable title with a pencil
  glyph, and a **mini edit toolbar** on the right — undo / redo / clear (the
  relocated map tools).
- **Stat strip:** length, climb, descent, surface, difficulty. Key = rust 11px
  bold; value = 15px weight 800.
- **Interactive elevation graph** (the prototype's design):
  - Curve + **difficulty-segment bands** beneath it (proportional-width, colored
    from the difficulty scale; derived from per-point grade buckets).
  - A **vertical cursor + dot** at `progress`, and a **readout chip** that follows
    the cursor showing distance / interpolated elevation / grade, flipping its
    anchor near the edges so it never clips.
  - **Hover/click seeks** (`progress = clamp((x − left) / width, 0, 1)`); the chart
    x-axis stays **LTR** even though the UI is RTL.
  - **Hovering a difficulty band** swaps the header to that segment's stats and
    **brightens the matching stretch on the map**; clicking a band sets `progress`
    to the segment midpoint.
- **Route actions:** primary `שמירת מסלול`, ghost `GPX`, ghost `ניווט` (the
  relocated summary/GPX/share + navigate).
- **Route warnings:** the relocated "מידע חשוב" — route warnings derived from the
  active data points (`getRouteWarningPresentation`), rendered as a panel section.
- **POI cards:** divider `נקודות עניין בדרך` + count tag, then numbered cards —
  index circle, category icon (tinted square, colored per category), category
  label, title, description, distance-along. Sourced from the route's **real**
  detected data points (`routeState.activeDataPoints` / the existing cue slides),
  not placeholders.

### Map in Build

The drawn route as a Mapbox line (blue casing as today), a start dot, colored POI
pins, and the white rider marker at the scrubbed position. Road-types legend
top-left. No floating tool buttons (moved into the panel). Bottom transport bar
visible.

## The unified timeline

A single **`progress` (0–1)** is shared across three surfaces, all reading and
writing it:

1. **Panel elevation graph** — hover/click to seek; segment hover highlights the
   map.
2. **Bottom transport bar** — play/pause + range scrubber + distance readout
   (today's `RoutePlaybackControls`).
3. **Map rider marker** — positioned with `@turf/along` at `progress * totalKm`.

This reuses the existing `useSyntheticRoutePlayback` machinery (the front page
already drives the rider cursor, POI preview, and elevation hover from one
playback state). The new work is: (a) the restyled, segment-banded elevation
graph as a second scrub surface in the panel, and (b) deriving the difficulty
bands from per-point grade buckets.

## State summary

- `panelState: 'discover' | 'build'`
- `progress: number` (0–1) — shared timeline position (existing playback state)
- `hoveredSegment: number | null` — hovered difficulty band
- `playing: boolean` — existing playback
- `panelCollapsed: boolean` — drawer toggle
- Discover search selections: difficulty / surface / length / start / via
  (existing `WelcomeDiscover` filter state)
- **Data (real, not faked):** the drawn route GeoJSON `LineString`; per-point
  elevation + cumulative distance; derived difficulty segments; detected POIs;
  recommended/featured route list from the catalog.

## Components — reuse vs. new

**Reuse / relocate (existing):**

- `WelcomeDiscover` (route-finder search + filters + result cards) → panel Discover
  body. `WelcomeWizard` modal shell retired on desktop (kept for the mobile
  fallback for now).
- `RouteCard` / `catalogFilter` / `loadCatalog` / `loadFeaturedMetaList` → panel
  route list (curated-by-default, results-on-search).
- `useSyntheticRoutePlayback`, `RoutePlaybackControls` → bottom transport
  (unchanged location).
- `ElevationProfile` → basis for the panel's interactive graph (restyle + add
  difficulty bands + readout chip per the prototype).
- `getRouteWarningPresentation` → panel warnings section (relocated from the map
  legend).
- `routePoiStoryData` / POI cue slides / `DataMarkerCard` content → panel POI
  cards.
- Undo/redo/clear + download handlers from `useCyclewaysApp` → panel route header
  + actions.

**New:**

- The two-column **app-shell layout** + panel container + segmented state toggle
  + collapse drawer.
- The `panelState` machine with the **auto-switch-to-Build-on-first-point** rule.
- The **difficulty-band** derivation (per-point grade buckets) and the banded,
  segment-hoverable elevation graph variant.

## Rollout

**Straight rollout — no feature flag.** The two-column shell is the default and
only desktop layout; the relocated on-map controls are deleted (single source of
truth in the panel), and no parallel legacy code path is kept. Narrow viewports
are handled by responsive CSS that stacks the panel under the map.

## Out of scope (this pass)

- Mobile / narrow-viewport panel design (bottom sheet). Falls back to today's
  layout for now.
- Editing/curation of the recommended/featured set (driven by existing catalog
  `featured` flags).
- Any change to `/routes/` or `/featured` page content beyond clarifying their
  relationship to the panel.
