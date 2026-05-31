# Native Route Restore / Deep-Link Parity — Design

**Date:** 2026-05-31. **Phase:** 2.10.
**Topic dir:** `plans/rn-mobile-route-restore/`.

## Goal

Make the iPhone app open the same shared route payloads that the mobile web
planner opens from `?route=...`, while keeping route decoding and route state in
the shared `useCyclewaysApp` controller.

This closes the next parity gap after the native elevation profile: a user can
receive or tap a shared route link and land in the iPhone planner with the route
already restored, fitted, and available for summary/share/GPX just like mobile
web.

## Current State

- Web restores routes through `packages/core/src/app/useCyclewaysApp.js`, which
  reads `getQueryParam("route")` when the routing manager becomes ready.
- Native resolves `packages/core/src/platform/location.native.js`, but that
  adapter currently returns no query params.
- The Expo app already has an installed dev-client URL scheme based on the app
  id (`app.cycleways.mobile://...`). This slice adds an explicit public scheme
  (`cycleways://...`) in app config for future rebuilds.
- Native initial URLs arrive asynchronously through React Native `Linking`, but
  the shared controller expects synchronous query-param reads.

## Chosen Approach

Keep `useCyclewaysApp` unchanged. Make the native app initialize the native
location adapter before rendering `MapScreen`.

- `apps/mobile/App.js` reads `Linking.getInitialURL()` once on startup.
- The URL is stored in `packages/core/src/platform/location.native.js`.
- `MapScreen` only mounts after that URL is cached, so the existing shared
  `getQueryParam("route")` call restores the route without a native-only path.
- Warm links (`Linking.addEventListener("url", ...)`) update the same native
  location cache and remount `MapScreen`. Remounting is acceptable for this
  slice because a new route link is a route-session replacement.

Rejected alternative: make `getQueryParam` async or add route-link subscription
logic inside `useCyclewaysApp`. That would widen the shared controller contract
for a native-only timing concern.

## Link Formats

The native parser accepts any absolute or relative URL with query params:

- `cycleways:///?route=<payload>` — intended public custom scheme after rebuild.
- `app.cycleways.mobile:///?route=<payload>` — current dev-client scheme.
- `https://.../?route=<payload>` — parsed if delivered by the OS in the future;
  associated-domain universal links are out of scope for this slice.
- `?route=<payload>` — accepted for tests and adapter-level callers.

## In Scope

- Native query-param cache/parser with `getQueryParam`, `hasQueryParam`,
  `setUrlParam`, `removeUrlParam`, and `getShardLoaderLocation`.
- App startup gate so initial route links are visible to the shared controller.
- Warm-link handling by remounting the native map screen.
- Explicit Expo scheme in `apps/mobile/app.json`.
- Unit coverage for the native location adapter.
- Maestro smoke that opens a route link and verifies the restored route UI.

## Out of Scope

- Universal link / associated-domain setup.
- Opening the installed app from web share links automatically.
- Navigation/following mode.
- Persisting native route state across app restarts outside the incoming link.

## Acceptance Criteria

- Opening `cycleways:///?route=<known-route>` or
  `app.cycleways.mobile:///?route=<known-route>` restores a route in the iPhone
  planner without manual point entry.
- The restored route renders route points, route sheet copy, stats, and enabled
  summary/share affordances.
- Warm route links replace the current native route session.
- Web route restore behavior is unchanged.
- Verification passes: unit tests, web build, smoke baseline with no new
  failures, iOS export, and a Maestro route-restore smoke when the simulator
  dev client has a compatible URL scheme installed.
