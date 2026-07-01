# Mobile Home Engagement — Implementation Plan

Date: 2026-07-02

## Status

Design selected, implemented, and validated.

## Implementation tasks

1. Define the shared hero-route selection rule and fallback. Initial rule: rotate the
   hero randomly per app session from eligible featured/recommended routes, and
   exclude the selected hero from the list below.
2. Add a deterministic session-level hero selector so the hero does not change
   while the user is browsing the screen. The fallback is the first eligible
   featured/recommended route.
3. Put reusable route-discovery selection helpers in shared/core code where
   practical so iOS, mobile web, and desktop Discover can use the same hero and
   list rules.
4. Split native Discover into hero, intent filters, vertical secondary route
   cards, and compact catalog sections.
5. Add the same hierarchy to mobile web narrow breakpoints.
6. Add a compact version of the hierarchy to the desktop `חפש מסלול` /
   Discover tab: compact hero, existing search/filter controls, vertical cards.
7. Reuse the existing bundled image, route summary, difficulty, distance, and
   video metadata maps.
8. Exclude the active hero from the secondary list, unless filtering leaves no
   other results.
9. Keep search/filter state shared across every section. If a filter excludes
   the hero, either pick a matching hero or collapse the hero area into the
   filtered list state.
10. Add accessibility ordering and meaningful image labels.
11. Add tests for hero selection, session stability, hero exclusion from the
   list, filter propagation, and compact route ordering.
12. Verify layout on small and large iPhones, mobile web, and desktop Discover.

## Validation and test expectations

1. Unit-test the hero selector:
   - chooses an eligible route;
   - remains stable for the session;
   - excludes the chosen hero from the secondary list;
   - handles empty/single-route catalogs.
2. Component/render tests or snapshot-style checks for:
   - hero card present with image/title/blurb/stats/CTA;
   - secondary cards render vertically;
   - filters update both hero/list state coherently.
3. Mobile web E2E/visual coverage for the selected hierarchy at narrow
   breakpoints.
4. Desktop E2E/visual coverage for the compact `חפש מסלול` tab variant.
5. Manual visual verification on small and large iPhone sizes plus desktop.
6. Web production build.
7. Expo iOS export after native UI changes.

## Non-goals

- No map-led homepage in this iteration on any platform.
- No horizontal carousel for secondary routes.
- No personalization beyond session-level hero rotation yet.
- No full-screen desktop Discover redesign; desktop receives a compact panel
  adaptation.
