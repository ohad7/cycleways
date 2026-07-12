# When-In-Use Navigation Permission — Implementation Plan

**Date:** 2026-07-11 · **Design:** `design.md` (decisions W1–W5)

**Goal:** Remove the iOS Always-location request; lock-screen guidance runs on
While-Using permission via the foreground-started TaskManager path, with
startup-failure telemetry.

## Tasks

### Task 1: Config + guard tests (TDD anchor)
- Modify: `tests/test-ios-release-config.mjs`
- [x] Assert `NSLocationAlwaysAndWhenInUseUsageDescription` is **absent** from
  `app.json` infoPlist and `locales/he.json`; assert the expo-location plugin
  sets `locationAlwaysAndWhenInUsePermission: false`; assert
  `locationService.js` does not reference `requestBackgroundPermissionsAsync`.
  Keep the When-In-Use string assertions (base + Hebrew).
- [x] Run: fails against current config.

### Task 2: Permission flow (W1) + telemetry (W4)
- Modify: `apps/mobile/src/navigation/locationService.js`
- [x] `requestNavigationPermissions`: foreground request only; iOS +
  `background: true` option → `background: true` result. Delete
  `WHEN_IN_USE_BACKGROUND_SPIKE` and the Always request.
- [x] Delete `getNavigationPermissionStatus` (only consumer removed in Task 4).
- [x] `startNavigationBackgroundUpdates`: capture failures, emit
  `background_updates_start_failed` via `trackNavigationEvent`, expose
  `getBackgroundLocationDiagnostics()`.

### Task 3: Config (W2)
- Modify: `apps/mobile/app.json`, `apps/mobile/locales/he.json`
- [x] Remove the Always usage strings; set
  `locationAlwaysAndWhenInUsePermission: false` in the plugin config; keep
  `isIosBackgroundLocationEnabled: true` and both `UIBackgroundModes`.

### Task 4: UI sweep (W3)
- Modify: `apps/mobile/src/screens/BuildScreen.jsx`,
  `apps/mobile/src/planner/RideSetupSheet.jsx`,
  `apps/mobile/src/navigation/lockScreenVoiceTest.js`
- [x] Remove `refreshNavigationPermissionStatus`, the
  has-Always / needs-settings state, and the settings-notice props/UI; update
  the toggle helper copy to the While-Using wording.
- [x] Remove the now-unreachable `permissionSpike` surfacing from the soak
  test and sheet status line.

### Task 5: Verify + docs
- [x] `node tests/test-ios-release-config.mjs` + navigation test set + babel
  parse of touched RN files.
- [x] Record the owner decision in
  `plans/navigation-ride-feedback/permission-spike-findings.md`; add the
  `plans/README.md` entry.
- [ ] Device: fresh install (delete app first so iOS forgets the old grant),
  `scripts/run-on-device.sh --build`, grant **While Using** — no Always prompt
  anywhere; run the lock-screen soak test (long-press בדיקת קול) → prompts
  audible under lock; then a real ride.
