# Featured Desktop Overlay Layout Design

Date: 2026-06-04

> **Update (2026-06-04):** after A/B comparison the overlay layout was adopted as
> the **only** desktop layout. The `?layout=overlay` toggle, the
> `featuredLayoutFromParam` helper, the `mapLayout` context value, and the old
> rail side-map layout were removed; the video-first featured page now always
> renders the PiP-on-video + description/stats/elevation rail. The sections below
> describe the original opt-in design for historical context.

## Goal

Users don't connect the featured-route map with the video. On mobile the map sits
*on* the video (a picture-in-picture overlay) and that connection reads well. We
want to try the same idea on desktop, and be able to A/B compare it against the
current desktop layout.

New desktop layout ("overlay"):

- The map becomes a small PiP in the top-right corner of the video (like mobile).
- The right rail — where the map currently sits — instead shows the route
  **description**, a **stats block**, and an **interactive elevation graph**.
- The elevation graph is currently missing from featured pages and is important.

The current desktop layout stays the default; the new one is opt-in via a URL
parameter so the two can be compared live.

## Scope

- Affects **desktop only**. Mobile already uses the overlay map and is unchanged.
- Below-the-fold sections (POI stories, "About the route") are unchanged in both
  layouts.
- The elevation graph is part of the **overlay** layout's rail only. The current
  layout has no room (its rail bottom is the map), so the comparison is:
  - *default*: map in rail, no elevation graph;
  - *overlay*: map as PiP on the video; rail = description + stats + interactive
    elevation graph.

## Toggle Mechanism

`?layout=overlay` selects the new layout; absent or any other value selects the
current layout.

- `FeaturedRoute` (the orchestrator component, already rendered inside the
  router) reads `useSearchParams()` once and computes
  `layout = searchParams.get("layout") === "overlay" ? "overlay" : "default"`.
- `layout` is exposed on `FeaturedRouteContext` so descendants
  (`FeaturedVideoRoute`, `FeaturedRouteMap`) can read it without prop-drilling
  through the per-slug page modules.
- When `layout === "default"`, rendering is byte-for-byte identical to today.

A tiny pure helper `featuredLayoutFromParam(value)` (returns `"overlay"` or
`"default"`) holds the param-to-layout mapping so it is unit-testable.

## Layout Structure

`FeaturedVideoRoute` adds a modifier class to the playback container:
`className={"fv-playback" + (layout === "overlay" ? " fv-playback--overlay" : "")}`.

The two existing map slots become layout-aware (via context) instead of being
gated purely on `isMobile` (today `FeaturedRouteMap` returns `null` based on
`variant` vs `isMobile`):

- **Overlay map slot** (inside `.fv-video-shell`, today `.fv-mobile-map`):
  renders when `isMobile || layout === "overlay"`. On desktop-overlay it is the
  PiP in the top-right corner of the video. Behavior mirrors mobile exactly:
  click the route line to seek the video, click a marker to open its POI,
  auto-recenter after interaction, and an expand button to open the full-screen
  map.
- **Rail side-map slot** (today `.fv-side-map`): renders only when
  `!isMobile && layout === "default"` (unchanged current behavior).

The gate change is expressed by making `FeaturedRouteMap` read `layout` from
context and compute a single `shouldRender` from `isMobile + layout + variant`,
replacing the current `variant`-only `isMobile` checks. The `variant` prop is
retained for the two call sites; `shouldRender` is derived as:

- overlay/video-shell slot: `isMobile || layout === "overlay"`;
- rail/desktop slot: `!isMobile && layout === "default"`.

**Rail in overlay mode** (`fv-side-rail` under `.fv-playback--overlay`) stacks:

1. Route **description** (the existing `fv-route-panel` intro content).
2. **Stats block** — distance, elevation gain/loss, difficulty, surface
   (`roadMix`) — sourced from the catalog meta already loaded for the page.
3. **`<ElevationProfile>`** — the interactive elevation graph.

The "distance from start" readout (today in the rail side-map heading) moves to
the elevation graph's header, its natural home alongside the x-axis. No readout
is lost when the rail map disappears.

## Elevation Graph + Sync

Reuse the existing `src/components/ElevationProfile.jsx`, fed `geometry` and
`distance` from the featured snapshot (snapshot `route.geometry` already carries
per-point `elevation`). The graph participates in the existing map/video sync in
both directions:

- **Graph → video/map:** `onElevationHover(payload)` →
  `setVideoCursorFromFraction(payload.t)` (which moves the on-map cursor marker);
  clicking the graph calls `seekVideoToFraction(payload.t)` to seek the video.
- **Video/map → graph:** the current `videoCursor.fraction` is passed into
  `ElevationProfile` so the graph reflects the live playback position.

`ElevationProfile` today derives its cursor from an `animator`. To support the
featured page (which drives position via `videoCursor`), add an **additive**
optional prop — an external cursor position (fraction along the route) — that,
when provided, positions the graph cursor. When the prop is absent the component
behaves exactly as it does for the planner (animator-driven), so the planner's
usage is unchanged.

## CSS

- Lift the overlay-map rules out of the `@media (max-width: 767px)` block into a
  `.fv-playback--overlay .fv-mobile-map` selector with desktop sizing: a small
  fixed corner box (≈ `clamp`-based ~240–300px wide) inset from the top-right of
  the video shell, with the existing expand affordance.
- In `.fv-playback--overlay`, the `.fv-side-rail` grid drops the map row and lays
  out description / stats / elevation; the `.fv-side-map` rule is suppressed in
  this mode.
- Non-overlay (current) CSS is untouched. Mobile rules are untouched.

## Components / Boundaries

- `FeaturedRoute` — reads the layout param, provides `layout` on context. New
  responsibility is small and explicit (one derived value).
- `featuredLayoutFromParam(value)` — pure helper, unit-testable.
- `FeaturedVideoRoute` — applies the modifier class and, in overlay mode, renders
  the stats block + `<ElevationProfile>` in the rail. Same component tree for
  both layouts; differences are a class and two conditional rail children.
- `FeaturedRouteMap` — `shouldRender` becomes layout-aware (reads context).
- `ElevationProfile` — additive external-cursor prop; otherwise unchanged.
- A small `FeaturedRouteStats` presentational unit may be extracted for the stats
  block if it keeps `FeaturedVideoRoute` focused.

## Testing

- **Unit:** `featuredLayoutFromParam` mapping (`"overlay"` vs default/garbage);
  any elevation cursor-position math added to `ElevationProfile`.
- **E2E (desktop):**
  - `?layout=overlay` renders the PiP map over the video, the elevation graph in
    the rail, and no rail side-map.
  - default (no param) renders today's rail side-map and no elevation graph.
  - hovering/scrubbing the elevation graph updates the video cursor (and the map
    cursor marker).
  - the snapshot network regression still holds (no planner/data assets fetched).
- **E2E (mobile):** unchanged — overlay map still renders, layout param has no
  effect.

## Compatibility

- Default layout is unchanged for all existing featured pages and links.
- Planner (`/`) and its `ElevationProfile` usage are unaffected (additive prop).
- No change to snapshots, route data, or the snapshot/code-split work; the
  featured page still renders from `public-data/featured-routes/<slug>.json`.

## Open / Deferred

- If the overlay layout wins, retrofitting the elevation graph into the default
  layout (which lacks rail space today) is a separate follow-up, not in scope.
