# Discovery surface — mobile-first route discovery on the web

**Date:** 2026-06-10
**Status:** design (not yet planned)
**Related:** [planning-surface](../planning-surface/design.md), [navigation-handoff](../navigation-handoff/design.md), `recommended-routes/`, `discover-scroll-map-sync/`, `front-page-overhaul/`

## Context

We reviewed the desktop and mobile web UX (June 2026) and settled a
surface-role split for the product:

- **Mobile web = discovery and consumption.** It is the acquisition surface —
  shared links and search land here, very often on a phone, often outdoors.
- **Desktop web = planning** (see planning-surface).
- **Native app = navigation and recording**, once in production (see
  navigation-handoff). Mobile-web geolocation is not reliable enough for
  navigation, but a one-shot coarse fix is fine for discovery.

This document covers the discovery objective: make the mobile web (and the
Discover experience generally) excellent at answering *"what should I ride,
and is it near me?"*

## Problems found in the review

1. **No location awareness at all.** There is no "locate me" control and no
   `navigator.geolocation` usage anywhere in the web app. A rider standing in
   the Galilee cannot see where they are relative to the trails. The only
   spatial entry point is town-name search (Nominatim).
2. **Mobile is a stacked desktop, not a discovery experience.** The narrow
   layout (`front-panel.css` @max-width: 860px) stacks a 52vh map over a 48vh
   panel, while the page also scrolls into SEO content sections — three
   competing scroll regions. The first screen communicates no value
   proposition and pushes no first action.
3. **Selecting a Discover route is a context-destroying full reload.**
   `handleSelectRecommended` in `src/App.jsx` does
   `window.location.assign('/?route=...')`: the splash replays, the map
   re-initializes, filters are lost — at the product's core conversion moment.
4. **Three sibling catalogs.** The home Discover panel, `/routes`, and
   `/featured` feel like separate apps. Discover cards don't link to a
   route's rich story page when one exists.
5. **On `/routes` mobile, filters fill the entire first screen** before a
   single route card is visible.
6. **`user-scalable=no`** in the viewport meta blocks pinch zoom of the page —
   an accessibility violation (WCAG 1.4.4), hostile on a map product.

## Design decisions

### D1. One-shot "locate me", scoped to discovery

Add a locate control on the map (Mapbox `GeolocateControl` or equivalent,
one-shot mode — **not** tracking/follow):

- Centers the map on the user with an accuracy circle.
- While Discover is open, ranks/annotates the route list by distance from the
  fix ("3 ק"מ ממך" on cards; nearest first as a soft sort or a "קרוב אליי"
  chip in the filter groups).
- Permission is requested only on explicit tap of the control, never on load.
- Failure (denied / unavailable) degrades silently to today's behavior.

Explicit non-goal: continuous tracking, heading, or anything navigation-like.
That is the app's job (navigation-handoff).

### D2. Discovery-first mobile layout

Rework the narrow-viewport home layout around the Google-Maps-style pattern
users already know:

- Map becomes the full-height stage; the Discover/Build panel becomes a
  bottom sheet with peek / half / full snap points (peek shows the Discover
  intro + first card edge, signalling scrollable content).
- The SEO content sections stay below for crawlers but leave the primary
  viewport; a single page-level scroll only begins past the app shell.
- Remove `user-scalable=no` from the viewport meta.
- Keep Build reachable on mobile (state toggle as today) but de-emphasized;
  its mobile-specific fixes live in planning-surface (notably touch point
  removal).

### D3. Seamless route selection

Replace `window.location.assign` with a client-side transition (React Router
is already in place): selecting a Discover card keeps the map instance alive,
flies the camera to the route, and updates the URL (`?route=` stays the
canonical shareable encoding). The splash must not replay; filters and scroll
position in Discover are preserved on back.

### D4. One catalog, three views

`/routes` remains the canonical catalog (per `recommended-routes/`). The home
Discover panel and `/featured` become views of it:

- Discover cards link to the route's story page when one exists
  ("לעמוד המסלול ←") in addition to drawing it on the map.
- On `/routes` mobile, route cards render first; filters collapse into a
  sticky "סינון" bar that expands on demand.

### D5. First-30-seconds story

The first screen must present exactly two actions: **מצאו מסלול מוכן**
(opens Discover, 2–3 spotlighted routes) and **בנו מסלול** (Build state, with
an on-map hint "לחצו על המפה כדי להתחיל"). The hidden "מדריך" nav item and its
text modal are replaced by contextual first-interaction hints (detailed in
planning-surface, where the planner onboarding lives).

## Non-goals

- Navigation, tracking, offline maps (navigation-handoff).
- Build/edit UX investment (planning-surface).
- Accounts or server-side personalization; "near me" works off a transient
  client-side fix only.

## Sequencing (proposed)

1. **D3 + D6-fixes bundle** (seamless selection, remove `user-scalable=no`,
   `/routes` mobile cards-first) — small, independent, immediately felt.
2. **D1 locate-me** — small, high value, no layout dependency.
3. **D4 catalog unification** — Discover ↔ story-page links.
4. **D2 bottom-sheet mobile layout** — the large piece; do last, on top of a
   stabilized Discover.
5. **D5 first-screen story** — after D2 so the hero lands on the final layout.

Each step gets its own implementation plan when picked up.
