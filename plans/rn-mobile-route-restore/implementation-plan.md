# Native Route Restore / Deep-Link Parity Implementation Plan

**Goal:** Let the React Native iPhone planner restore shared `?route=` payloads
from custom-scheme links while keeping route decoding in `useCyclewaysApp`.

**Design spec:** `plans/rn-mobile-route-restore/design.md`.

---

## Verification Guard

- `npm test`
- `npm run build`
- `npm run test:smoke` at the documented 40 pass / 12 fail / 1-2 skipped
  baseline, with no new failures.
- `npx expo export --platform ios --output-dir /tmp/isravelo-mobile-export-route-restore`
- `git diff --check`
- Maestro route-restore smoke on the iPhone 15 / iOS 17.5 simulator when the
  installed dev client has a compatible scheme:
  `app.cycleways.mobile:///?route=Bjjy1nRHHDArrNAoctqGv4RHL3un`.

---

## Task 1: Native Location Adapter

Files:
- `packages/core/src/platform/location.native.js`
- `tests/test-native-location.mjs`
- `package.json`

- [ ] Replace the no-op native location adapter with an in-memory URL cache.
- [ ] Export native-only helpers:
  - `setNativeLocationHref(href)`
  - `getNativeLocationHref()`
  - `resetNativeLocationHref()`
- [ ] Implement query-param reads and URL-param mutation against the cached URL.
- [ ] Keep `getShardLoaderLocation()` returning an object with `href` so shared
  share-url generation produces `cycleways:///?route=...` style links.
- [ ] Add adapter unit tests covering absolute custom-scheme URLs, relative
  query strings, param removal, and invalid URL fallback.
- [ ] Add the new test to the root `npm test` chain.

## Task 2: App Startup + Warm Links

Files:
- `apps/mobile/App.js`
- `apps/mobile/app.json`

- [ ] Add `scheme: "cycleways"` to Expo config for future native rebuilds.
- [ ] In `App.js`, read `Linking.getInitialURL()` before mounting `MapScreen`.
- [ ] Store that URL in the native location adapter.
- [ ] Subscribe to warm `Linking` URL events and remount `MapScreen` when a new
  route link arrives.
- [ ] Keep the loading gate visually minimal; this is a sub-second bootstrap
  concern, not a new user-facing screen.

## Task 3: Native Smoke

Files:
- `apps/mobile/.maestro/route-restore-smoke.yaml`

- [ ] Add a Maestro flow that opens a known route link, waits for the planner,
  and asserts restored route UI such as `נקודות מסלול` and the summary/share
  action.
- [ ] Prefer the already-installed dev-client scheme
  `app.cycleways.mobile:///?route=...` for current simulator verification; the
  explicit `cycleways://` scheme becomes available after a native rebuild.

## Task 4: Handoff

Files:
- `plans/HANDOFF.md`

- [ ] Record Phase 2.10 status, implemented files, known link schemes, and
  verification results.
- [ ] Update the next-slice recommendation after route restore is complete.
