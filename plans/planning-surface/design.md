# Planning surface — desktop-first route building that persists

**Date:** 2026-06-10
**Status:** design (not yet planned)
**Related:** [discovery-surface](../discovery-surface/design.md), [navigation-handoff](../navigation-handoff/design.md), `front-page-overhaul/`, `route-point-editing/`, `route-sharing-v4/`

## Context

Per the surface-role split decided in June 2026 (see discovery-surface for the
full statement): **desktop web is the planning surface** and gets the Build
UX investment. Mobile web keeps Build *functional* — a rider must be able to
tweak a shared route at the trailhead — but we stop trying to make it great
there; the native app eventually takes over on-phone editing.

The desktop planner is already the strongest part of the product: precision
clicking, drag-to-reroute, elevation hover, playback. This document is about
closing the gaps that make it feel like a demo instead of a tool.

## Problems found in the review

1. **Zero persistence.** Build half a route, close the tab, it's gone. The
   `?route=` share URL encodes full state, but only if the user thinks to
   copy it. There is no draft autosave and no "recent routes" — a silent
   data-loss trap for a planning tool.
2. **Onboarding is a hidden text modal.** The "מדריך" nav item opens a
   four-line `<ol>` (`src/components/Tutorial.jsx`). Nobody finds it and it
   teaches nothing visually. An empty Build panel says only "סמנו נקודות על
   המפה כדי לבנות מסלול."
3. **The planner dead-ends at a GPX download.** For Garmin users that's fine;
   for everyone else the route's life ends in the Downloads folder. The
   *reason to return* — get this route onto my phone — has no first-class
   path (this is the bridge designed in navigation-handoff).
4. **Mobile Build is broken in one specific way: you cannot remove a point.**
   Removal is bound to `contextmenu` only (`src/map/MapSurface.jsx`
   `map.on("contextmenu", ROUTE_POINTS_LAYER_ID, removePoint)`); touch has no
   path except full undo. Also, touching a point immediately starts a drag
   and disables pan, so panning near your own route misfires (overlaps
   `mobile-map-gesture-intent/`, which designed this for the RN app).

## Design decisions

### D1. Draft autosave + recent routes (localStorage)

- The in-progress built route autosaves to `localStorage` on every change
  (the existing compact `?route=` encoding is the storage format — one
  string, already versioned by `route-sharing-v4/`).
- On load with no `?route=` param, a non-blocking toast/banner offers to
  restore the draft ("להמשיך את המסלול מאתמול?"); it never auto-restores over
  an explicit shared link.
- Keep the last ~5 distinct finalized/viewed routes (encoded string + name +
  distance + timestamp) and surface them as a "המסלולים שלי" strip at the top
  of Discover. This strip is the seed of retention and later becomes the sync
  point when accounts/app exist.
- No accounts, no server storage — everything client-side.

### D2. Contextual onboarding replaces the tutorial modal

Three one-time hints, each fired by the user's own progress, dismissed
forever once seen (localStorage flag):

1. Build state, empty map → on-map hint near the cursor: "לחצו על המפה ליד
   שביל כדי להתחיל".
2. First point placed → "הוסיפו נקודה נוספת כדי לחשב מסלול".
3. First route computed → "גררו את הקו או הנקודות כדי לשנות; קליק ימני מסיר
   נקודה".

Delete the "מדריך" nav item and `Tutorial.jsx` once these land.

### D3. "Send to phone" as a first-class output

Next to GPX and שיתוף in the Build panel: a QR code of the share URL
(rendered client-side, no service). Scanning opens the route on the phone —
today in mobile web, later deep-linking into the app (navigation-handoff D2).
This turns the desktop planner's output from a file into a hand-off.

### D4. Minimal mobile-Build repair (maintenance, not investment)

- Touch path for point removal: tap a point to select it (it highlights), a
  small floating "הסר נקודה" affordance appears; second tap elsewhere
  deselects. No long-press (conflicts with map gestures and iOS callouts).
- Require a slop threshold before a touch on a point becomes a drag, so map
  pans near the route don't misfire (reuse the intent rules from
  `mobile-map-gesture-intent/` where applicable to mobile web).
- Beyond this, mobile Build is feature-frozen until the app ships.

## Non-goals

- Mobile Build parity with desktop (explicitly frozen, D4 only).
- Accounts, server-side route storage, cross-device sync (future; D1's
  encoded strings are designed to migrate into it).
- Navigation or ride recording (navigation-handoff).
- New routing-engine capabilities.

## Sequencing (proposed)

1. **D4 mobile-Build repair** — small, fixes the only outright-broken flow.
2. **D1 draft autosave + recents** — highest retention value per effort.
3. **D2 contextual onboarding** — independent; can run parallel to D1.
4. **D3 send-to-phone QR** — after D1 (shares the encoding plumbing), and
   it's the desktop end of the navigation-handoff bridge.

Each step gets its own implementation plan when picked up.
