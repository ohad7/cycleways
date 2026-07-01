# Mobile Home Engagement — Design

Date: 2026-07-02

## Status

Design selected, implemented, and validated.

## Problem

The native Discover screen presents useful search, filters, and rich route
cards, but every route has similar visual weight. The screen reads as a catalog
rather than an invitation to choose a ride.

## Goals

- Create an immediate reason to explore.
- Preserve search and filters without making them the first emotional moment.
- Use existing catalog data and photography.
- Make the route list easier to scan by varying hierarchy rather than adding
  more information.

## Decisions

- Use the editorial discovery direction, not a map-led homepage.
- Apply the design as a shared discovery model across:
  - iOS native Discover/home;
  - mobile web Discover/home;
  - the desktop `חפש מסלול` / Discover tab, adapted to the desktop side-panel
    density.
- Show one dominant hero route near the top.
- Rotate the hero randomly per app session at first; this can later become
  curated, seasonal, or proximity-aware.
- Exclude the active hero route from the list below.
- Use vertical secondary route cards instead of a horizontal carousel.
- Preserve search and intent filters, and apply them across hero/list behavior
  without making search the first emotional moment.

## Platform scope

### iOS native

Use the selected visual hierarchy directly: greeting/search, large rotating
hero, intent chips, then vertical secondary cards. This is the primary design
target.

### Mobile web

Use the same hierarchy at narrow breakpoints so the web and app discovery
experience feel consistent. The mobile web version can reuse web-native links
and browser scrolling, but the content hierarchy should match iOS.

### Desktop `חפש מסלול` tab

Adopt the same editorial model, but not the exact phone layout. The desktop tab
already sits beside the map, so it should use a denser panel variant:

- compact hero card at the top of the tab;
- search and filters remain available in the tab;
- vertical route cards below the hero;
- selected hero excluded from the list;
- no map-led homepage redesign and no attempt to make the tab full-screen.

This keeps desktop discovery visually aligned with mobile while preserving the
desktop app shell and map-first spatial context.

## Option A — Editorial discovery (recommended)

Top-to-bottom:

1. Compact brand greeting and search.
2. One large featured story with photography, summary, route stats, and CTA.
3. Intent chips such as easy, family, water, and near me.
4. A vertical list of secondary route cards, not a horizontal carousel.
5. The complete catalog continues below in the same compact vertical rhythm.

The selected hero can rotate randomly per app session, be curated, become
seasonal, or later be personalized by proximity. The active hero is excluded
from the list below it.

### Advantages

- Strongest emotional entry point.
- Reuses current route photos, summaries, difficulty, and video metadata.
- Reduces repetition because only the hero is large.
- Keeps secondary routes readable and comparable because they line up
  vertically.

### Tradeoff

- One route receives substantially more prominence.

## Option B — Map-led discovery

A compact route map occupies the upper part of the screen, with nearby/featured
route cards floating below it. Search and filters refine both map and list.

### Advantages

- Makes location and regional context immediately clear.
- Stronger utility for riders already deciding where to go.

### Tradeoffs

- Higher implementation and runtime cost.
- Competes with the existing Build map and can make the home screen feel like
  another planning screen.
- Less effective when location permission is unavailable.

## Recommendation

Implement Option A with a rotating hero and vertical secondary route cards. It
differentiates Discover from Build and creates engagement using assets already
shipped in the app. A small map thumbnail or route trace can remain inside
individual cards without turning the whole screen into a second map surface.

## Card hierarchy

- Hero card:
  - large route photo/video image;
  - route name;
  - short blurb;
  - distance, difficulty, and loop/linear metadata;
  - clear route CTA.
- Secondary vertical cards:
  - thumbnail image;
  - route name;
  - one-line blurb;
  - compact stats;
  - row/chevron affordance to open the route.

## Acceptance criteria

- First screen feels editorial, not like a uniform catalog.
- One hero route is visibly dominant.
- Secondary routes are vertically stacked and large enough to read without
  feeling like leftovers.
- The current hero route does not appear again immediately in the secondary
  route list.
- Search/filter state applies consistently to the visible route sections.
- The design works on small and large iPhones without clipping the hero or
  making the secondary cards unreadable.
- The Build/planning surface remains map-focused; Discover does not become a
  second map screen.
- iOS and mobile web share the same discovery hierarchy.
- Desktop `חפש מסלול` uses the same hierarchy in a compact side-panel variant,
  without disrupting the map/build layout.

## Visual comparison

See `vertical-list-mockup.html` / `vertical-list-mockup.jpg` for the selected
direction. The earlier comparison remains in `mockup.html` / `comparison.png`.
