# Discover scroll ↔ map sync — design

Date: 2026-06-10

## Problem

The Discover panel's default (no-filter) list shows only the three `featured`
catalog entries, and the map draws *every* listed route's line at once. As the
catalog grows (7 routes today, more coming) this is both an incomplete list and
an increasingly cluttered map.

We want two things:

1. The default list should contain **all** catalog routes, in catalog order.
2. Scrolling the list should drive the map: routes whose cards are on-screen are
   highlighted; off-screen routes drop off the map; the cards immediately above
   and below the visible block are shown faintly as a "there's more" hint.

## Decisions (from brainstorming)

- **Default list content:** all catalog entries, catalog order (no special
  `featured` treatment).
- **Camera on scroll:** lines update live while scrolling; the camera re-fits to
  the visible set only once scrolling **settles** (debounced).
- **Styling tiers:** three tiers — **bright** (in-viewport), **ghost** (one card
  above + one below the visible block, drawn faint), **hidden** (everything
  else, not drawn).
- **Hover:** unchanged — hovering a card gives that route the boldest style and
  flies the camera to it; mouse-out returns to the scroll-settle fit.
- **Geometry loading:** lazy — fetch geometry only for routes near the viewport
  (visible ∪ ghost ∪ a small look-ahead), as the user scrolls.
- **"Visible" rule:** a card is bright as soon as **any part** of it intersects
  the scroll viewport.

## Architecture

Data flows in one direction: the panel observes its own scroll viewport, derives
slug sets, and emits them up to `App`, which loads geometry and tells the map
what to draw and where to look.

```
PanelRouteCard refs ──► useCardViewport (IntersectionObserver on list scroll root)
                              │  derives, from the ordered slug list:
                              │    visibleSlugs  (bright)
                              │    ghostSlugs    (1 above + 1 below the block)
                              │    prefetchSlugs (visible ∪ ghost ∪ lookahead)
                              ▼
        DiscoverPanel  ── onRouteViewport({ visibleSlugs, ghostSlugs, prefetchSlugs })
                       ── onSlugsChange(orderedSlugs)   // full list, for colors
                              ▼
            App.jsx  ── lazy-load geometry for prefetchSlugs (cached)
                     ── recommendedRoutes[] with { slug, geometry, color, tier, hovered }
                     ── debounced fit to visibleSlugs geometry on settle
                              ▼
        MapSurface ── syncRecommendedRoutesLayer ── tier-aware paint
```

### 1. List content — `discoverRouteList.js`, `DiscoverPanel.jsx`

- `selectDiscoverRoutes(entries, filters)`:
  - No active filters → `{ mode: "all", routes: <all entries, catalog order> }`
    (was `{ mode: "recommended", routes: featured only }`).
  - Active filters → `{ mode: "results", routes: catalogFilter(entries, filters) }`
    (unchanged).
- `hasActiveDiscoverFilters` unchanged.
- Panel list label: a plain count in both modes — `${routes.length} מסלולים`.
  Drop the "מומלצים" wording.
- Route color is still `discoverRouteColor(index)`, where `index` is the route's
  position in the **full ordered list**, so a route's color is stable regardless
  of which routes happen to be loaded or visible. The palette already cycles, so
  growth past 8 routes is fine.

### 2. Viewport tracking — new `useCardViewport` hook (panel)

A small hook colocated with the panel (e.g.
`src/components/frontPanel/useCardViewport.js`).

- Input: the scroll-container element (the element that actually scrolls — the
  list region inside `.discover-panel`) and the ordered array of slugs.
- Registers an `IntersectionObserver` with `root: <scroll container>`,
  `threshold: 0` (any-pixel intersection → bright).
- Maintains a Set of currently-intersecting slugs. On each observer callback
  (lightly debounced, ~50 ms, via `requestAnimationFrame` or a timer) it
  recomputes, preserving catalog order:
  - **`visibleSlugs`** — intersecting cards.
  - **`ghostSlugs`** — the slug immediately before the first visible slug and
    immediately after the last visible slug in the ordered list (0, 1, or 2
    entries; none at list ends).
  - **`prefetchSlugs`** — `visibleSlugs ∪ ghostSlugs ∪` up to 2 further slugs
    beyond each ghost (look-ahead for smooth lazy loading).
- Returns/emits `{ visibleSlugs, ghostSlugs, prefetchSlugs }`.

Cards expose their DOM node to the hook via a ref-registration callback keyed by
slug (`PanelRouteCard` gains an `onCardRef(slug, el)` style prop, or the panel
keeps a `Map<slug, el>` of refs). Observer is re-synced when the ordered slug
list changes (filters, catalog load).

### 3. App — lazy geometry loading (`App.jsx`)

- Keep `discoverSlugs` as the **full ordered list** (drives card colors and the
  stable index). Add panel-emitted `viewport = { visibleSlugs, ghostSlugs,
  prefetchSlugs }` state.
- The existing "load geometry for all `discoverSlugs`" effect is rekeyed to load
  **`prefetchSlugs`** only. Still de-duped through `recommendedGeomCacheRef`,
  still streamed, still cached. Routes never scrolled near never fetch.

### 4. App + map — tier-aware drawing

- `recommendedRoutes` is built from `visibleSlugs ∪ ghostSlugs` (only those with
  loaded geometry); each entry carries:
  - `slug`, `geometry`,
  - `color: discoverRouteColor(<full-list index>)`,
  - `tier: "bright" | "ghost"`,
  - `hovered: slug === hoveredRouteSlug`.
  Routes outside both sets are simply absent → not drawn (hidden tier).
- `buildRecommendedRoutesFeatureCollection` carries `tier` (plus existing
  `hovered`) into feature properties.
- `syncRecommendedRoutesLayer` paint becomes three-step (hovered wins, then
  tier):
  - **hovered** → `line-width 6`, `line-opacity 1` (unchanged boldest).
  - **bright** → `line-width 3.5`, `line-opacity 0.9` (today's default).
  - **ghost** → `line-width ~2`, `line-opacity ~0.25` (faint hint).

  Expressed as Mapbox `case` expressions on the `hovered` (boolean) and `tier`
  (string) properties.

### 5. App — camera (`App.jsx`)

- Replace the current "fit to all loaded discover routes" effect with a
  **fit-to-visible-on-settle** effect: when `visibleSlugs` changes, debounce
  ~200 ms (so it only fires after scrolling pauses), combine the geometries of
  the **bright** routes (ghost routes excluded from the fit), and `requestFit`
  to that combined geometry via the existing overlay-aware
  `buildRouteFitRequest` path. Store the last combined geometry in a ref so
  hover-restore can fall back to it.
- Hover-to-fit / restore-on-leave is unchanged (hovered route geometry, else the
  stored visible-set geometry).

## Edge cases

- **List ends:** at the top of the list there is no ghost-above; at the bottom no
  ghost-below. `ghostSlugs` simply omits the missing side.
- **Empty visible set:** if no card is visible yet (initial mount, mid-fling),
  keep the last good visible/fit state rather than clearing the map; the next
  observer tick re-populates it.
- **Filter mode:** the same viewport machinery applies to `results` mode —
  scrolling a long filtered list behaves identically.
- **Geometry still loading:** a visible/ghost slug whose geometry hasn't arrived
  yet is just not in `recommendedRoutes` until it loads (no placeholder line);
  the settle-fit recomputes as geometries stream in.
- **Mobile:** the hook keys off whatever element actually scrolls, so the same
  behavior applies in the mobile panel without special-casing.

## Testing

- **Unit — `selectDiscoverRoutes`:** no filters returns all entries in catalog
  order (mode `"all"`); filters return `catalogFilter` results (mode
  `"results"`). Update existing `tests/test-discover-route-list.mjs`.
- **Unit — `useCardViewport` derivation:** given an ordered slug list and a set
  of "intersecting" slugs, it derives the correct `visibleSlugs`, `ghostSlugs`
  (incl. top-of-list and bottom-of-list cases with a one-sided ghost), and
  `prefetchSlugs` (look-ahead window, clamped at list ends). Extract the
  pure derivation into a tested function so it doesn't need a real
  `IntersectionObserver`.
- **Unit — feature collection:** `buildRecommendedRoutesFeatureCollection`
  emits correct `tier` and `hovered` properties per route.
- **Existing colors test** (`tests/test-discover-route-colors.mjs`): confirm
  colors stay keyed to full-list index after the all-routes change.
```
