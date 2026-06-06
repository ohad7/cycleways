# Topbar Route Navigation And Hierarchy

Date: 2026-06-06

## Problem

Public navigation currently exposes several concepts that overlap:

- `/` is the front page and interactive route planner.
- `/routes/` is the route catalog.
- `/featured/` renders the same catalog surface in the current app, while the
  name still implies a separate featured-route gallery.
- `/routes/:slug` and `/featured/:slug` can both lead to route detail pages.
- The front-page topbar links to `/#reccomendations`, an outdated static
  recommendations section that now competes with the real route catalog.

This makes the route hierarchy hard to understand. Users can reach a route page
but not know whether they are inside the planner, the catalog, a featured
section, or a standalone story.

## Decision

Use one public route hierarchy:

```text
/                  map and planner
/routes/           all public routes
/routes/:slug      one public route
```

`featured` should no longer be a separate visible section. Featured routes are
ordinary route-catalog entries that sort to the top and carry a
`מומלץ במיוחד` badge.

Compatibility URLs may remain:

```text
/featured/         alias or redirect to /routes/
/featured/:slug    alias or redirect to /routes/:slug
```

All visible navigation should prefer `/routes/` and `/routes/:slug`.

## Navigation Model

The topbar should expose only top-level destinations and actions:

- `מפה` -> `/`
- `מסלולים` -> `/routes/`
- `מצא מסלול` -> opens the route finder when the planner is available; from
  non-planner pages it can navigate to `/` and open the finder in a later
  enhancement.
- `על המפה` -> `/#trails`
- `צרו קשר` or `דיווח ועדכונים` -> `/#contact`
- `מדריך` -> opens the tutorial on `/`, or navigates to `/` first.

Remove `המלצות` from the topbar and remove the stale front-page
`#reccomendations` section.

## Hierarchy Signal

Use breadcrumbs below the topbar for page hierarchy. The topbar tells users
which major area they are in; breadcrumbs tell them their exact location.

Breadcrumb examples:

```text
מפה
מפה > מסלולים
מפה > מסלולים > סובב בית הלל
```

Recommended display rules:

- Front page can omit breadcrumbs because the planner itself is the home
  surface.
- `/routes/` shows `מפה > מסלולים`.
- `/routes/:slug` shows `מפה > מסלולים > <route name>`.
- `/featured/` and `/featured/:slug`, while supported, should show the same
  `/routes` hierarchy so users are guided back to the canonical model.

Breadcrumbs should sit below the sticky/site topbar and above the page title or
route hero. They should be compact and visually quieter than the primary page
heading.

## Active Topbar State

Topbar active state should reflect the canonical major section:

- `/` -> `מפה`
- `/routes`, `/featured` -> `מסלולים`
- `/routes/:slug`, `/featured/:slug` -> `מסלולים`

Hash links such as `/#trails` and `/#contact` may be active only when the user
is on the front page and the hash matches, but they do not need to override the
main route hierarchy.

## Route Catalog Ordering

The route catalog should remain one unified list. Do not add separate
`כל המסלולים` / `מומלצים במיוחד` tabs yet.

Sort order:

1. Explicit `sortOrder`, when present.
2. Featured/recommended-highlighted routes before ordinary catalog routes.
3. Route stories/video routes before generic routes only when no explicit order
   exists.
4. `qualityScore` descending.
5. `distanceKm` ascending.

The existing `מומלץ במיוחד` badge is enough to explain why some routes are at
the top.

## URL Compatibility

The cleanest long-term behavior is redirecting:

- `/featured/` -> `/routes/`
- `/featured/:slug` -> `/routes/:slug`

During development, rendering aliases are acceptable if redirects create too
much test churn. Even if aliases render directly, all links, breadcrumbs, and
page copy should point users toward `/routes`.

## Non-Goals

- Do not redesign the route catalog cards in this topic.
- Do not remove route-story modules under `src/featured/` yet. That code name
  can remain internal until a broader cleanup.
- Do not change the route editor schema except where required to support sort
  order or featured badges already present in the catalog.
- Do not publish a separate featured gallery.

## Open Questions

- Should `מצא מסלול` appear on non-planner pages immediately, or should it be
  reserved for the front page until we add a cross-page open-finder mechanism?
- Should the contact label be `צרו קשר` or `דיווח ועדכונים`? The latter may
  better match the actual content of the section.
- Should `/featured/:slug` redirect immediately, or remain a render alias until
  external links are known to be low-risk?
