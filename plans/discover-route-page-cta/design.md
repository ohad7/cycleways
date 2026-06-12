# Discover → route page CTA

Date: 2026-06-12

## Problem

On the front page, tapping a Discover panel card loads the route into the live
planner (`?route=` state, sheet drops to peek) — a cheap, in-context map
preview that supports the compare-a-few-routes loop. The dedicated route page
(`/routes/<slug>`) — the richer discovery artifact with photos/video, story,
warnings, and GPX — is reachable only via a subtle `לעמוד המסלול ←` text link
on each card that most users never notice.

Flipping the default (card → page) was considered and rejected: it makes every
tap a full page navigation, kills the fast compare-on-map loop, and on desktop
(the planning surface) pushes users away from the planner.

## Decision (approach B)

Keep the map preview as the card-tap default, and promote the route page to
the natural *next* step — a prominent CTA shown at the moment of highest
intent, after the user has picked a route.

## Design

### 1. Card tap behavior — unchanged

`handleSelectRecommended` still loads the route into the live planner and
drops the sheet to peek.

### 2. Track the selected catalog entry

`App.jsx` keeps a `selectedCatalogEntry` state (`slug`, `name`, display photo)
set when `handleSelectRecommended` succeeds with an entry that has a slug.

It is **cleared** when the user edits the route (add/move/delete point,
undo/redo) or clears it: once the drawn route diverges from the catalog route,
the page no longer describes what's on the map, so the CTA disappears.

### 3. Prominent CTA in the build panel

When `selectedCatalogEntry` is set, `BuildPanel`:

- replaces the generic "מסלול חדש" head title with the route's name, and
- shows a photo-strip CTA above the stats — thumbnail + "לעמוד המסלול המלא ←"
  — linking to `/routes/<slug>`.

Same-tab navigation: the `?route=` param is already pushed to history, so the
browser back button restores the planner.

### 4. CTA in the mobile peek strip

The build-peek button currently shows "מסלול חדש · X נקודות". When a catalog
route is loaded, it shows the route name instead, with a small adjacent
"לעמוד המסלול ←" link. This is exactly where the user lands after tapping a
card on mobile.

### 5. Strengthen the per-card link

The subtle text link on `PanelRouteCard` becomes a small chip/button —
visually distinct, same destination, still `stopPropagation` so it doesn't
trigger the card's map-preview action.

### 6. Recents carry the slug

`handleAddRecentRoute` stores `slug` alongside `param`/`name`/`distanceKm`, so
selecting a recent route also lights up the CTA. Old recents without a slug
simply don't show it.

## Testing

Extend the existing panel e2e specs:

- tapping a Discover card shows the CTA in the build panel and the peek strip;
- the CTA navigates to `/routes/<slug>`;
- editing the route (adding a point) hides the CTA;
- clearing the route hides the CTA.
