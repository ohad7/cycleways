# iOS Featured Route Web Embed — Implementation Plan

Date: 2026-07-01 (updated 2026-07-05)

1. Add an early embed bootstrap to the static HTML and suppress the web splash
   and analytics for `?app=1`.
2. Remove featured-header breadcrumbs when embedded.
3. Post a route-ready bridge message after featured content renders.
4. Warm the local static server from the native app after initial interactions.
5. Keep the native loading overlay until route-ready, with a bounded fallback.
6. Add browser regression tests for the embed contract.
7. Build the website, synchronize `apps/mobile/webroot`, regenerate iOS
   resources, and export the iOS JavaScript bundle.
8. Replace the embedded four-action wrap with a single-row Navigate/Edit/GPX
   hierarchy using the native app palette; retain the website Play action.
9. Route the Navigate bridge action through Build with an explicit ride-setup
   intent. Open setup after route loading settles; do not start a continuous
   navigation session until the rider confirms direction and start.
10. Apply the iOS safe-area inset to the native featured-route WebView shell.
11. Add a GPX bridge event and handle it with the native share/save flow while
    preserving browser download behavior outside the app.
12. Gate Build route restoration on routing-manager readiness, with visible
    loading/error/retry states and unit coverage for the restore policy.
13. Keep featured route detail WebViews local-only: remove production fallback,
    restart the bundled static server on a main-frame load failure, retry once,
    and show an explicit retry/back error state instead of the old native route
    detail fallback.

Expected tests: targeted Playwright embed/splash tests, `git diff --check`, web
production build, Expo config/prebuild, Expo iOS export, and a mobile route
detail smoke pass covering the local-server retry/error path.
